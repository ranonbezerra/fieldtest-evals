import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnchorStatus } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ApiError } from '../src/common/api-error.js';
import { canonicalHash } from '../src/common/canonicalize.js';
import { ChainRejectionError } from '../src/chain/chain.client.js';
import { InMemoryChainClient } from '../src/chain/in-memory-chain.client.js';
import { DocumentsRepository } from '../src/documents/documents.repository.js';
import { DocumentsService } from '../src/documents/documents.service.js';
import { AnchorsRepository } from '../src/anchors/anchors.repository.js';
import { AnchorsService } from '../src/anchors/anchors.service.js';
import { AnchorsProcessor } from '../src/anchors/anchors.processor.js';

//
// Requires a running Postgres reachable via DATABASE_URL with migrations
// applied (`pnpm prisma migrate deploy`).
// ANCHOR_STALE_AFTER_MS=0 makes the recovery sweep treat fresh rows as stale,
// emulating "the process came back long after the crash".
//
process.env.ANCHOR_STALE_AFTER_MS = '0';

const prisma = new PrismaService();

let chain: InMemoryChainClient;
let documents: DocumentsService;
let service: AnchorsService;
let processor: AnchorsProcessor;

const DOC = 'doc-alpha';
const VERSION = 1;
const CONTENT = {
  documentId: DOC,
  sections: [
    { heading: 'Vitals', values: { hr: 72, spo2: 98 } },
    { heading: 'Labs', values: { hba1c: 6.1 } },
  ],
  meta: { author: 'clinic-a', issuedAt: '2025-01-15T09:30:00Z' },
};

/** Independently compute what the on-chain tx identity must be. */
function expectedTxId(documentId: string, version: number, content: unknown): string {
  return canonicalHash({ op: 'anchor-document', documentId, version, contentHash: canonicalHash(content) });
}

function buildServices(chainClient: InMemoryChainClient): { service: AnchorsService; processor: AnchorsProcessor } {
  const anchorsRepo = new AnchorsRepository(prisma);
  const documentsRepo = new DocumentsRepository(prisma);
  return {
    service: new AnchorsService(anchorsRepo, documentsRepo, chainClient),
    processor: new AnchorsProcessor(anchorsRepo, chainClient),
  };
}

function anchorWhere() {
  return { documentId_version: { documentId: DOC, version: VERSION } };
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.documentAnchor.deleteMany();
  await prisma.reportVersion.deleteMany();
  chain = new InMemoryChainClient();
  documents = new DocumentsService(new DocumentsRepository(prisma));
  ({ service, processor } = buildServices(chain));
});

describe('exactly one anchor per (document, version)', () => {
  it('survives a process crash between broadcast and the (wrong) late persist a naive design would do', async () => {
    await documents.createVersion(DOC, VERSION, CONTENT);

    // The chain records the tx and then the local process dies (simulated SIGKILL):
    // the tx is on the chain, but nothing runs after `chain.broadcast` returned —
    // exactly the window where a naive design would still have to "late persist"
    // the tx identity.
    const crashingChain = new InMemoryChainClient({
      onBroadcastRecorded: () => {
        throw new Error('simulated SIGKILL');
      },
    });
    const crashing = buildServices(crashingChain);

    // The call is interrupted: the tx went out, the broadcast outcome is unknown.
    await expect(crashing.service.anchorDocument(DOC, VERSION)).rejects.toBeInstanceOf(ApiError);
    await expect(crashing.service.anchorDocument(DOC, VERSION)).resolves.toMatchObject({ status: 'BROADCAST' });

    // The intent + tx identity survived the crash: persisted BEFORE the broadcast.
    const rows = await prisma.documentAnchor.findMany({ where: { documentId: DOC, version: VERSION } });
    expect(rows).toHaveLength(1);
    expect(rows[0].txId).toBe(expectedTxId(DOC, VERSION, CONTENT));
    expect(rows[0].contentHash).toBe(canonicalHash(CONTENT));
    // Non-terminal, awaiting reconciliation. (In a real SIGKILL the row would be
    // PREPARED — the sweep handles both PREPARED and BROADCAST.)
    expect(['PREPARED', 'BROADCAST']).toContain(rows[0].status);
    expect(crashingChain.broadcastLog).toHaveLength(1);

    // "Restart": fresh service over the same database. The chain is external and
    // kept the tx.
    const restarted = buildServices(crashingChain);
    await crashingChain.settle(); // the chain includes the tx in block 1
    await restarted.processor.runRecoverySweep(); // queries the chain FIRST → finds the receipt

    const after = await prisma.documentAnchor.findUnique({ where: anchorWhere() });
    expect(after?.status).toBe('CONFIRMED');
    expect(after?.blockNumber).toBe(1);
    expect(after?.blockHash).toMatch(/^[0-9a-f]{64}$/);

    // Still exactly one anchor and one tx on the chain — the crash minted no
    // second anchor.
    expect(await prisma.documentAnchor.count({ where: { documentId: DOC, version: VERSION } })).toBe(1);
    expect(crashingChain.broadcastLog).toHaveLength(1);

    // A late re-anchor request is idempotent and mints nothing new.
    const view = await restarted.service.anchorDocument(DOC, VERSION);
    expect(view.status).toBe('CONFIRMED');
    expect(view.txId).toBe(expectedTxId(DOC, VERSION, CONTENT));
    expect(view.blockNumber).toBe(1);
    expect(crashingChain.broadcastLog).toHaveLength(1);
    expect(await prisma.documentAnchor.count()).toBe(1);
  });

  it('enforces at the schema level that no second anchor row can exist for (document, version)', async () => {
    await documents.createVersion(DOC, VERSION, CONTENT);
    await service.anchorDocument(DOC, VERSION);
    await chain.settle();
    await processor.runRecoverySweep();

    let constraintError: unknown;
    try {
      await prisma.documentAnchor.create({
        data: {
          documentId: DOC,
          version: VERSION,
          contentHash: 'f'.repeat(64),
          txId: 'second-anchor-tx',
          signedTx: 'second-anchor-signed',
        },
      });
    } catch (err) {
      constraintError = err;
    }
    expect(constraintError).toMatchObject({ code: 'P2002' });
    expect(await prisma.documentAnchor.count({ where: { documentId: DOC, version: VERSION } })).toBe(1);
  });
});

describe('recovery sweep', () => {
  it('completes an anchor whose process died before the broadcast (intent persisted, tx never sent)', async () => {
    await documents.createVersion(DOC, VERSION, CONTENT);

    // Seed exactly what a crash in that window leaves behind: the intent row, no broadcast.
    const contentHash = canonicalHash(CONTENT);
    const prepared = await chain.prepare({ op: 'anchor-document', documentId: DOC, version: VERSION, contentHash });
    await prisma.documentAnchor.create({
      data: {
        documentId: DOC,
        version: VERSION,
        contentHash,
        txId: prepared.txId,
        signedTx: prepared.signedTx,
        status: AnchorStatus.PREPARED,
      },
    });
    expect(chain.broadcastLog).toHaveLength(0);

    await processor.runRecoverySweep();
    expect(chain.broadcastLog).toHaveLength(1); // the sweep sent the persisted signed tx

    await chain.settle();
    await processor.runRecoverySweep();
    const after = await prisma.documentAnchor.findUnique({ where: anchorWhere() });
    expect(after?.status).toBe('CONFIRMED');
    expect(after?.txId).toBe(prepared.txId);
    expect(chain.broadcastLog).toHaveLength(1);
  });

  it('re-broadcasts a lost tx with the same signed payload (same txId), then confirms', async () => {
    await documents.createVersion(DOC, VERSION, CONTENT);

    const flakyChain = new InMemoryChainClient();
    flakyChain.onBroadcastAttempt = () => {
      throw new Error('rpc timeout: the tx never landed');
    };
    const flaky = buildServices(flakyChain);
    await expect(flaky.service.anchorDocument(DOC, VERSION)).rejects.toMatchObject({ code: 'broadcast_unknown', status: 503 });

    const row = await prisma.documentAnchor.findUnique({ where: anchorWhere() });
    expect(row).not.toBeNull();
    expect(row!.txId).toBe(expectedTxId(DOC, VERSION, CONTENT));
    expect(row!.status).toBe('BROADCAST');
    expect(row!.attempt).toBe(1);
    expect(flakyChain.broadcastLog).toHaveLength(0); // the tx never reached the chain
    await expect(flakyChain.getReceipt(row!.txId)).resolves.toBeNull();

    // "Restart": the process is back and the network recovered; the chain is unchanged.
    flakyChain.onBroadcastAttempt = undefined;
    const restarted = buildServices(flakyChain);
    await restarted.processor.runRecoverySweep();

    // The sweep queried the chain first, found nothing, and re-sent the SAME signed tx.
    expect(flakyChain.broadcastLog).toHaveLength(1);
    expect(flakyChain.broadcastLog[0]).toBe(row!.signedTx);
    expect(await prisma.documentAnchor.count({ where: { documentId: DOC, version: VERSION } })).toBe(1);

    await flakyChain.settle();
    await restarted.processor.runRecoverySweep();
    const after = await prisma.documentAnchor.findUnique({ where: anchorWhere() });
    expect(after?.status).toBe('CONFIRMED');
    expect(after?.attempt).toBe(2);
    expect(flakyChain.broadcastLog).toHaveLength(1); // the receipt exists: nothing is re-broadcast
  });
});

describe('anchorDocument', () => {
  it('fails the anchor when the chain definitively rejects the transaction', async () => {
    await documents.createVersion(DOC, VERSION, CONTENT);
    chain.onBroadcastAttempt = () => {
      throw new ChainRejectionError('invalid signature');
    };

    await expect(service.anchorDocument(DOC, VERSION)).rejects.toMatchObject({ code: 'anchor_failed', status: 409 });
    const row = await prisma.documentAnchor.findUnique({ where: anchorWhere() });
    expect(row?.status).toBe('FAILED');
    expect(row?.failureReason).toContain('invalid signature');
    expect(chain.broadcastLog).toHaveLength(0);

    // Terminal: a second request fails with the same code.
    await expect(service.anchorDocument(DOC, VERSION)).rejects.toMatchObject({ code: 'anchor_failed', status: 409 });
  });

  it('fails the anchor when the chain reports the transaction failed on chain', async () => {
    await documents.createVersion(DOC, VERSION, CONTENT);
    await service.anchorDocument(DOC, VERSION);
    const row = await prisma.documentAnchor.findUnique({ where: anchorWhere() });
    expect(row).not.toBeNull();

    await chain.settle([row!.txId]);
    await processor.runConfirmationPoll();
    const after = await prisma.documentAnchor.findUnique({ where: anchorWhere() });
    expect(after?.status).toBe('FAILED');
    expect(after?.failureReason).toBeTruthy();

    await expect(service.anchorDocument(DOC, VERSION)).rejects.toMatchObject({ code: 'anchor_failed', status: 409 });
    await expect(service.verify(DOC, VERSION, CONTENT)).resolves.toMatchObject({
      verified: false,
      reason: 'anchor_failed',
      proof: null,
    });
  });

  it('rejects anchoring a version that does not exist', async () => {
    await expect(service.anchorDocument('doc-missing', 1)).rejects.toMatchObject({
      code: 'version_not_found',
      status: 404,
    });
    expect(await prisma.documentAnchor.count()).toBe(0); // no intent was persisted
    expect(chain.broadcastLog).toHaveLength(0); // nothing was broadcast
  });
});

describe('verify', () => {
  it('returns the proof for the anchored content and a mismatch report otherwise', async () => {
    await documents.createVersion(DOC, VERSION, CONTENT);
    const started = await service.anchorDocument(DOC, VERSION);
    expect(started.status).toBe('BROADCAST');

    await chain.settle();
    await processor.runConfirmationPoll();

    const ok = await service.verify(DOC, VERSION, CONTENT);
    expect(ok.verified).toBe(true);
    expect(ok.reason).toBeNull();
    expect(ok.proof).toEqual({ txId: expectedTxId(DOC, VERSION, CONTENT), blockNumber: 1, blockHash: expect.any(String) });
    expect(ok.proof!.blockHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ok.contentHash).toBe(canonicalHash(CONTENT));
    expect(ok.anchoredHash).toBe(ok.contentHash);

    // Canonicalization: a different key order is the same content.
    const reordered = { meta: CONTENT.meta, sections: CONTENT.sections, documentId: CONTENT.documentId };
    expect((await service.verify(DOC, VERSION, reordered)).verified).toBe(true);

    // A different content is a mismatch, with both hashes for the audit trail.
    const tampered = { ...CONTENT, sections: [{ heading: 'Vitals', values: { hr: 99, spo2: 98 } }] };
    const mismatch = await service.verify(DOC, VERSION, tampered);
    expect(mismatch.verified).toBe(false);
    expect(mismatch.reason).toBe('hash_mismatch');
    expect(mismatch.anchoredHash).toBe(canonicalHash(CONTENT));
    expect(mismatch.contentHash).not.toBe(mismatch.anchoredHash);
    expect(mismatch.proof).toBeNull();

    // A never-anchored version.
    const none = await service.verify(DOC, 99, CONTENT);
    expect(none).toEqual({
      verified: false,
      reason: 'not_anchored',
      contentHash: canonicalHash(CONTENT),
      anchoredHash: null,
      proof: null,
      anchorStatus: null,
    });
  });

  it('reports anchor_pending for an anchor without a receipt yet', async () => {
    await documents.createVersion(DOC, VERSION, CONTENT);
    await service.anchorDocument(DOC, VERSION);
    const res = await service.verify(DOC, VERSION, CONTENT);
    expect(res).toEqual({
      verified: false,
      reason: 'anchor_pending',
      contentHash: canonicalHash(CONTENT),
      anchoredHash: canonicalHash(CONTENT),
      proof: null,
      anchorStatus: 'BROADCAST',
    });
  });
});
