import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import type { Anchor } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { ErrorEnvelopeFilter } from '../src/errors.js';
import { CHAIN_CLIENT } from '../src/chain/chain-client.js';
import { FakeChainClient } from '../src/chain/fake-chain-client.js';
import { DOCUMENT_SOURCE } from '../src/anchoring/document-source.js';
import { FakeDocumentSource } from '../src/anchoring/fake-document-source.js';
import { AnchoringWorker } from '../src/anchoring/anchoring.worker.js';
import { canonicalContentHash } from '../src/anchoring/anchoring.service.js';

// Effectively "the worker will not tick during this test" — transitions are
// driven explicitly by calling worker.poll()/worker.sweep().
const SLOW_WORKER_MS = 3_600_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => Promise<void>, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() - startedAt > timeoutMs) throw error;
      await sleep(25);
    }
  }
}

interface AppOpts {
  intervalMs: number;
  stuckAfterMs?: number;
  maxAttempts?: number;
  chain?: FakeChainClient;
  docs?: FakeDocumentSource;
}

interface AppHandles {
  app: INestApplication;
  chain: FakeChainClient;
  docs: FakeDocumentSource;
  worker: AnchoringWorker;
}

async function createApp(opts: AppOpts): Promise<AppHandles> {
  const chain = opts.chain ?? new FakeChainClient();
  const docs = opts.docs ?? new FakeDocumentSource();
  process.env.ANCHOR_WORKER_INTERVAL_MS = String(opts.intervalMs);
  process.env.ANCHOR_STUCK_AFTER_MS = String(opts.stuckAfterMs ?? SLOW_WORKER_MS);
  process.env.ANCHOR_MAX_BROADCAST_ATTEMPTS = String(opts.maxAttempts ?? 5);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CHAIN_CLIENT)
    .useValue(chain)
    .overrideProvider(DOCUMENT_SOURCE)
    .useValue(docs)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  await app.listen(0);
  return { app, chain, docs, worker: app.get(AnchoringWorker) };
}

async function withApp(opts: AppOpts, run: (handles: AppHandles) => Promise<void>): Promise<void> {
  await cleanAnchors();
  const handles = await createApp(opts);
  try {
    await run(handles);
  } finally {
    await handles.app.close();
    await cleanAnchors();
  }
}

const whereFor = (documentId: string, version: number) => ({
  documentId_version: { documentId, version },
});

async function cleanAnchors(): Promise<void> {
  await prisma.anchor.deleteMany({});
}

let prisma: PrismaClient;

beforeAll(async () => {
  // DATABASE_URL is validated, and the client generated / schema migrated,
  // by the vitest global setup (see vitest.config.ts).
  prisma = new PrismaClient();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('canonicalization', () => {
  it('pins the canonical text and hash of a flat object', () => {
    const expected = `sha256:${createHash('sha256').update('{"a":1}', 'utf8').digest('hex')}`;
    expect(canonicalContentHash({ a: 1 })).toBe(expected);
  });

  it('is invariant to object key order at any depth', () => {
    expect(canonicalContentHash({ a: 1, b: { d: [3, 4], c: 2 } })).toBe(
      canonicalContentHash({ b: { c: 2, d: [3, 4] }, a: 1 }),
    );
  });

  it('is sensitive to every semantic difference', () => {
    expect(canonicalContentHash({ a: 1 })).not.toBe(canonicalContentHash({ a: 2 }));
    expect(canonicalContentHash({ a: [1, 2] })).not.toBe(canonicalContentHash({ a: [2, 1] }));
    expect(canonicalContentHash({ a: 1 })).not.toBe(canonicalContentHash({ b: 1 }));
    expect(canonicalContentHash({ a: null })).not.toBe(canonicalContentHash({}));
  });
});

describe('anchorDocument', () => {
  it('persists the anchor intent (with tx identity) before broadcasting, then the confirmation worker advances it to confirmed', async () => {
    await withApp({ intervalMs: SLOW_WORKER_MS }, async ({ app, chain, docs, worker }) => {
      const content = { title: 'Discharge summary', measurements: [{ name: 'systolic', value: 121 }] };
      docs.set('doc-1', 3, content);

      let rowAtBroadcast: Anchor | null = null;
      chain.broadcastHook = async () => {
        rowAtBroadcast = await prisma.anchor.findUnique({ where: whereFor('doc-1', 3) });
      };

      const res = await request(app.getHttpServer()).post('/anchors').send({ documentId: 'doc-1', version: 3 });
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('broadcast_sent');
      expect(res.body.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(res.body.txId).toMatch(/^0x[0-9a-f]{64}$/);

      // The intent, including the tx identity, was already persisted when the
      // broadcast was issued (the ordering the naive design gets backwards).
      expect(rowAtBroadcast).not.toBeNull();
      const atBroadcast = rowAtBroadcast as Anchor;
      expect(atBroadcast.status).toBe('pending_broadcast');
      expect(atBroadcast.txId).toBe(res.body.txId);
      expect(atBroadcast.signedTx).toBe(chain.broadcasts[0]);
      expect(atBroadcast.contentHash).toBe(res.body.contentHash);

      // The confirmation worker advances the state once the receipt exists.
      await worker.poll();
      const row = await prisma.anchor.findUnique({ where: whereFor('doc-1', 3) });
      expect(row).not.toBeNull();
      const confirmedRow = row as Anchor;
      expect(confirmedRow.status).toBe('confirmed');
      expect(confirmedRow.blockNumber).toBeInstanceOf(BigInt);
      expect(confirmedRow.confirmedAt).toBeInstanceOf(Date);

      // Re-anchoring the same (document, version) is idempotent: proof out,
      // no new broadcast in.
      const again = await request(app.getHttpServer()).post('/anchors').send({ documentId: 'doc-1', version: 3 });
      expect(again.status).toBe(200);
      expect(again.body.status).toBe('confirmed');
      expect(again.body.proof.txId).toBe(res.body.txId);
      expect(again.body.proof.blockNumber).toBe(confirmedRow.blockNumber.toString());
      expect(chain.broadcasts).toHaveLength(1);
      expect(await prisma.anchor.count({ where: { documentId: 'doc-1', version: 3 } })).toBe(1);
    });
  });

  it('survives a process crash between broadcast and confirmation: the recovery sweep queries the chain first and keeps exactly one on-chain anchor', async () => {
    await cleanAnchors();
    const chain = new FakeChainClient();
    const docs = new FakeDocumentSource();
    docs.set('doc-crash', 7, { section: 'lab-results', value: 4.2 });

    // --- process #1 ---
    const first = await createApp({ intervalMs: SLOW_WORKER_MS, chain, docs });
    const res = await request(first.app.getHttpServer()).post('/anchors').send({ documentId: 'doc-crash', version: 7 });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('broadcast_sent');

    // The tx is on the (fake) chain and its receipt is available, but nothing
    // after the broadcast ran: the process "crashes" right here. A naive
    // design would persist the anchor only AFTER the broadcast (late persist)
    // and would lose the record entirely in this window.
    await first.app.close();

    const afterCrash = await prisma.anchor.findUnique({ where: whereFor('doc-crash', 7) });
    expect(afterCrash).not.toBeNull(); // the intent survived the crash
    expect((afterCrash as Anchor).status).toBe('broadcast_sent'); // nothing advanced it

    // --- process #2 (restart; same database, same chain) ---
    const second = await createApp({ intervalMs: SLOW_WORKER_MS, chain, docs });
    try {
      // Recovery sweep: resolves the limbo by querying the chain FIRST.
      await second.worker.sweep();

      const row = await prisma.anchor.findUnique({ where: whereFor('doc-crash', 7) });
      expect(row).not.toBeNull();
      expect((row as Anchor).status).toBe('confirmed');
      expect((row as Anchor).blockNumber).toBeInstanceOf(BigInt);

      // Exactly one anchor row (schema uniqueness) and exactly one tx on
      // chain; the sweep did NOT re-broadcast because the chain already had it.
      expect(await prisma.anchor.count({ where: { documentId: 'doc-crash', version: 7 } })).toBe(1);
      expect(chain.distinctTxIds()).toHaveLength(1);
      expect(chain.broadcasts).toHaveLength(1);

      // A post-crash retry of the anchoring must not anchor a second time.
      const retry = await request(second.app.getHttpServer()).post('/anchors').send({ documentId: 'doc-crash', version: 7 });
      expect(retry.status).toBe(200);
      expect(retry.body.status).toBe('confirmed');
      expect(await prisma.anchor.count({ where: { documentId: 'doc-crash', version: 7 } })).toBe(1);
      expect(chain.broadcasts).toHaveLength(1);
    } finally {
      await second.app.close();
      await cleanAnchors();
    }
  });

  it('enforces exactly one anchor per (document, version) at the schema level', async () => {
    await cleanAnchors();
    try {
      await prisma.anchor.create({
        data: {
          documentId: 'doc-same',
          version: 2,
          contentHash: 'sha256:a',
          txId: '0x1',
          signedTx: 's1',
          status: 'pending_broadcast',
        },
      });
      await expect(
        prisma.anchor.create({
          data: {
            documentId: 'doc-same',
            version: 2,
            contentHash: 'sha256:b',
            txId: '0x2',
            signedTx: 's2',
            status: 'pending_broadcast',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      expect(await prisma.anchor.count({ where: { documentId: 'doc-same', version: 2 } })).toBe(1);
    } finally {
      await cleanAnchors();
    }
  });

  it('recovers a broadcast timeout that never landed by re-sending the same signed tx (one tx on chain)', async () => {
    await withApp({ intervalMs: SLOW_WORKER_MS, stuckAfterMs: 0 }, async ({ app, chain, docs, worker }) => {
      docs.set('doc-limbo', 1, { note: 'timeout, not landed' });
      chain.broadcastOutcome = 'timeout';
      chain.timeoutLands = false;

      const res = await request(app.getHttpServer()).post('/anchors').send({ documentId: 'doc-limbo', version: 1 });
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('broadcast_unknown');
      const stored = (await prisma.anchor.findUnique({ where: whereFor('doc-limbo', 1) })) as Anchor;
      expect(stored.attempts).toBe(1);

      // The chain comes back; the sweep must re-send the SAME signed tx.
      chain.broadcastOutcome = 'ok';
      await sleep(25);
      await worker.sweep();

      const afterSweep = (await prisma.anchor.findUnique({ where: whereFor('doc-limbo', 1) })) as Anchor;
      expect(afterSweep.status).toBe('broadcast_sent');
      expect(afterSweep.attempts).toBe(2);
      expect(chain.broadcasts).toEqual([stored.signedTx, stored.signedTx]);

      await worker.poll();
      const confirmed = (await prisma.anchor.findUnique({ where: whereFor('doc-limbo', 1) })) as Anchor;
      expect(confirmed.status).toBe('confirmed');
      expect(chain.distinctTxIds()).toHaveLength(1);
      expect(await prisma.anchor.count({ where: { documentId: 'doc-limbo', version: 1 } })).toBe(1);
    });
  });

  it('recovers a broadcast timeout that DID land by confirming from the receipt, without re-broadcasting', async () => {
    await withApp({ intervalMs: SLOW_WORKER_MS, stuckAfterMs: 0 }, async ({ app, chain, docs, worker }) => {
      docs.set('doc-limbo2', 1, { note: 'timeout, but it landed' });
      chain.broadcastOutcome = 'timeout';
      chain.timeoutLands = true;

      const res = await request(app.getHttpServer()).post('/anchors').send({ documentId: 'doc-limbo2', version: 1 });
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('broadcast_unknown');

      await sleep(25);
      await worker.sweep();

      const row = (await prisma.anchor.findUnique({ where: whereFor('doc-limbo2', 1) })) as Anchor;
      expect(row.status).toBe('confirmed');
      expect(row.blockNumber).toBeInstanceOf(BigInt);
      expect(chain.broadcasts).toHaveLength(1); // no re-broadcast: the chain already had the tx
      expect(chain.distinctTxIds()).toHaveLength(1);
    });
  });

  it('marks the anchor failed when the chain receipt reports a failure', async () => {
    await withApp({ intervalMs: SLOW_WORKER_MS }, async ({ app, chain, docs, worker }) => {
      docs.set('doc-receipt-fail', 1, { note: 'chain-level failure' });
      chain.receiptStatus = 'failed';

      const res = await request(app.getHttpServer()).post('/anchors').send({ documentId: 'doc-receipt-fail', version: 1 });
      expect(res.status).toBe(202);

      await worker.poll();
      const row = (await prisma.anchor.findUnique({ where: whereFor('doc-receipt-fail', 1) })) as Anchor;
      expect(row.status).toBe('failed');
      expect(row.error).toContain('failed');

      const again = await request(app.getHttpServer()).post('/anchors').send({ documentId: 'doc-receipt-fail', version: 1 });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('anchor_failed');
      expect(again.body.error.details.cause).toBeTruthy();
    });
  });

  it('fails the anchor once the broadcast attempts are exhausted', async () => {
    await withApp({ intervalMs: SLOW_WORKER_MS, stuckAfterMs: 0, maxAttempts: 2 }, async ({ app, chain, docs, worker }) => {
      docs.set('doc-exhaust', 1, { note: 'chain is down' });
      chain.broadcastOutcome = 'timeout';
      chain.timeoutLands = false;

      const res = await request(app.getHttpServer()).post('/anchors').send({ documentId: 'doc-exhaust', version: 1 });
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('broadcast_unknown'); // attempt 1

      await sleep(25);
      await worker.sweep(); // attempt 2 -> exhausted

      const row = (await prisma.anchor.findUnique({ where: whereFor('doc-exhaust', 1) })) as Anchor;
      expect(row.status).toBe('failed');
      expect(row.attempts).toBe(2);
      expect(row.error).toContain('exhausted');
      expect(chain.broadcasts).toHaveLength(2);

      // Terminal: further sweeps do nothing.
      await worker.sweep();
      expect(chain.broadcasts).toHaveLength(2);
      expect((await prisma.anchor.findUnique({ where: whereFor('doc-exhaust', 1) }))?.status).toBe('failed');
    });
  });

  it('the confirmation worker runs on its own and confirms a freshly broadcast anchor', async () => {
    await withApp({ intervalMs: 25 }, async ({ app, docs }) => {
      docs.set('doc-auto', 1, { note: 'worker driven' });
      const res = await request(app.getHttpServer()).post('/anchors').send({ documentId: 'doc-auto', version: 1 });
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('broadcast_sent');

      await waitFor(async () => {
        const row = await prisma.anchor.findUnique({ where: whereFor('doc-auto', 1) });
        expect((row as Anchor).status).toBe('confirmed');
      }, 5000);
    });
  });
});

describe('verify', () => {
  it('returns the anchoring proof for matching content, and a mismatch report otherwise', async () => {
    await withApp({ intervalMs: SLOW_WORKER_MS }, async ({ app, docs, worker }) => {
      const content = { a: 1, b: { c: 2 } };
      docs.set('doc-v', 2, content);

      const anchored = await request(app.getHttpServer()).post('/anchors').send({ documentId: 'doc-v', version: 2 });
      expect(anchored.status).toBe(202);
      const txId = anchored.body.txId as string;

      // Matching content with a shuffled key order — not confirmed yet.
      let v = await request(app.getHttpServer()).post('/anchors/verify').send({
        documentId: 'doc-v',
        version: 2,
        content: { b: { c: 2 }, a: 1 },
      });
      expect(v.status).toBe(200);
      expect(v.body.match).toBe(true);
      expect(v.body.confirmed).toBe(false);
      expect(v.body.status).toBe('broadcast_sent');

      await worker.poll();

      v = await request(app.getHttpServer()).post('/anchors/verify').send({ documentId: 'doc-v', version: 2, content });
      expect(v.status).toBe(200);
      expect(v.body.match).toBe(true);
      expect(v.body.confirmed).toBe(true);
      expect(v.body.proof.txId).toBe(txId);
      expect(v.body.proof.blockNumber).toMatch(/^\d+$/);
      expect(v.body.proof.logIndex).toBe(0);

      // Mismatch report for tampered content.
      const mismatch = await request(app.getHttpServer()).post('/anchors/verify').send({
        documentId: 'doc-v',
        version: 2,
        content: { a: 999 },
      });
      expect(mismatch.status).toBe(200);
      expect(mismatch.body.match).toBe(false);
      expect(mismatch.body.reason).toBe('content_hash_mismatch');
      expect(mismatch.body.storedContentHash).toBe(canonicalContentHash(content));
      expect(mismatch.body.computedContentHash).toBe(canonicalContentHash({ a: 999 }));
      expect(mismatch.body.storedContentHash).not.toBe(mismatch.body.computedContentHash);
    });
  });

  it('answers 404 with the error envelope when no anchor exists', async () => {
    await withApp({ intervalMs: SLOW_WORKER_MS }, async ({ app, docs }) => {
      docs.set('doc-none', 1, { x: 1 });
      const res = await request(app.getHttpServer()).post('/anchors/verify').send({ documentId: 'doc-none', version: 1, content: { x: 1 } });
      expect(res.status).toBe(404);
      expect(Object.keys(res.body)).toEqual(['error']);
      expect(res.body.error.code).toBe('anchor_not_found');
      expect(typeof res.body.error.message).toBe('string');
      expect(res.body.error.details).toEqual(expect.objectContaining({ documentId: 'doc-none', version: 1 }));
    });
  });
});

describe('error handling', () => {
  it('answers 404 document_not_found when the document store lacks the version', async () => {
    await withApp({ intervalMs: SLOW_WORKER_MS }, async ({ app }) => {
      const res = await request(app.getHttpServer()).post('/anchors').send({ documentId: 'ghost', version: 1 });
      expect(res.status).toBe(404);
      expect(Object.keys(res.body)).toEqual(['error']);
      expect(res.body.error.code).toBe('document_not_found');
      expect(res.body.error.details).toEqual(expect.objectContaining({ documentId: 'ghost', version: 1 }));
      expect(res.body.error.details).toBeTypeOf('object');
      expect(res.body.error.details).not.toBeNull();
    });
  });

  it('answers 400 invalid_request with details for malformed requests', async () => {
    await withApp({ intervalMs: SLOW_WORKER_MS }, async ({ app }) => {
      const missingId = await request(app.getHttpServer()).post('/anchors').send({ version: 1 });
      expect(missingId.status).toBe(400);
      expect(missingId.body.error.code).toBe('invalid_request');
      expect(missingId.body.error.details.issues).toEqual(
        expect.arrayContaining([expect.stringContaining('documentId')]),
      );

      const badVersion = await request(app.getHttpServer()).post('/anchors').send({ documentId: 'd', version: 1.5 });
      expect(badVersion.status).toBe(400);
      expect(badVersion.body.error.code).toBe('invalid_request');

      const arrayContent = await request(app.getHttpServer()).post('/anchors/verify').send({ documentId: 'd', version: 1, content: [1, 2] });
      expect(arrayContent.status).toBe(400);
      expect(arrayContent.body.error.details.issues).toEqual(
        expect.arrayContaining([expect.stringContaining('content')]),
      );
    });
  });
});
