import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AnchoringRepository } from '../src/anchoring/anchoring.repository.js';
import { AnchoringService } from '../src/anchoring/anchoring.service.js';
import { ConfirmationWorker } from '../src/anchoring/confirmation-worker.service.js';
import { RecoverySweep } from '../src/anchoring/recovery-sweep.service.js';
import { loadAnchoringConfig } from '../src/anchoring/anchoring.config.js';
import { BroadcastTimeoutError } from '../src/anchoring/chain-client.js';
import { AlreadyAnchoredError } from '../src/anchoring/errors.js';
import { canonicalHash } from '../src/anchoring/canonical-json.js';
import { ensureMigrated } from './db.js';
import { FakeChain } from './fake-chain.js';

const DOC = 'doc-anchoring-spec';

/**
 * Models a process death: thrown from the fake chain's broadcast() AFTER the
 * chain has accepted the tx, and NOT caught by the service (the service only
 * handles BroadcastTimeoutError). Once it propagates out of anchorDocument,
 * no further service code runs — exactly what a crash leaves behind.
 */
class SimulatedCrash extends Error {
  constructor() {
    super('simulated process death: no writes occur after this point');
    this.name = 'SimulatedCrash';
  }
}

const config = loadAnchoringConfig({ ANCHOR_WORKER_ENABLED: 'false' });

let db: PrismaService;
let chain: FakeChain;
let repo: AnchoringRepository;
let service: AnchoringService;
let worker: ConfirmationWorker;
let sweep: RecoverySweep;

beforeAll(async () => {
  ensureMigrated();
  db = new PrismaService();
  await db.$connect();
  await db.anchor.deleteMany();
});

beforeEach(async () => {
  await db.anchor.deleteMany();
  chain = new FakeChain();
  repo = new AnchoringRepository(db);
  service = new AnchoringService(repo, chain);
  worker = new ConfirmationWorker(repo, chain, config);
  sweep = new RecoverySweep(repo, chain, config);
});

afterAll(async () => {
  await db.$disconnect();
});

describe('anchorDocument / verify / workers', () => {
  it('anchors a version: the intent with the tx identity is committed before broadcast; the receipt confirms it', async () => {
    const content = { type: 'lab-report', panel: 'cbc', vitals: { hr: 72 } };
    const expectedTxId = FakeChain.txIdFor(
      FakeChain.sign({ documentId: DOC, version: 1, contentHash: canonicalHash(content) }),
    );

    let observedAtBroadcast: unknown = undefined;
    chain.onBeforeBroadcast = async () => {
      observedAtBroadcast = await db.anchor.findFirst({ where: { documentId: DOC, version: 1 } });
    };

    const anchor = await service.anchorDocument(DOC, 1, content);

    // Write-ahead: by the time broadcast() is called, the intent is already
    // committed, carrying the tx identity a naive design would still have
    // thrown away.
    expect(observedAtBroadcast).toMatchObject({
      documentId: DOC,
      version: 1,
      txId: expectedTxId,
      contentHash: canonicalHash(content),
      signedTx: chain.broadcasts[0],
      status: 'PREPARED',
    });

    expect(anchor).toMatchObject({
      documentId: DOC,
      version: 1,
      txId: expectedTxId,
      contentHash: canonicalHash(content),
      status: 'BROADCAST_SENT',
    });
    expect(chain.broadcasts).toHaveLength(1);

    // Confirmation comes from a receipt, via the confirmation worker —
    // never from broadcast() returning.
    const report = await worker.runOnce();
    expect(report.confirmed).toBe(1);

    const confirmed = await repo.findByDocumentAndVersion(DOC, 1);
    expect(confirmed?.status).toBe('CONFIRMED');
    expect(confirmed?.blockNumber).toBeTypeOf('number');
    expect(confirmed?.blockHash).toBeTypeOf('string');
    expect(confirmed?.confirmedAt).not.toBeNull();

    const proof = await service.verify(DOC, 1, content);
    expect(proof).toMatchObject({ result: 'verified', suppliedContentHash: canonicalHash(content) });
    expect(proof.anchor).toMatchObject({
      txId: expectedTxId,
      status: 'CONFIRMED',
      blockNumber: confirmed?.blockNumber,
      contentHash: canonicalHash(content),
    });
  });

  it('broadcast times out but the tx landed: recovery confirms from the receipt and does not re-broadcast', async () => {
    const content = { type: 'lab-report', panel: 'lipid' };
    chain.landOnBroadcast = true; // the chain accepted it; the client timed out
    chain.broadcastError = new BroadcastTimeoutError();

    const anchor = await service.anchorDocument(DOC, 1, content);
    expect(anchor.status).toBe('BROADCAST_UNKNOWN');
    expect(await repo.findByDocumentAndVersion(DOC, 1)).toMatchObject({ status: 'BROADCAST_UNKNOWN' });

    const report = await sweep.runOnce();
    expect(report).toMatchObject({ swept: 1, confirmed: 1, rebroadcast: 0 });

    const after = await repo.findByDocumentAndVersion(DOC, 1);
    expect(after?.status).toBe('CONFIRMED');
    expect(after?.blockNumber).toBeTypeOf('number');
    expect(chain.broadcasts).toHaveLength(1); // asked the chain first; no re-broadcast
  });

  it('broadcast times out and the tx did not land: the same signed tx is re-broadcast, one anchor', async () => {
    const content = { type: 'med-admin', claim: 11 };
    chain.landOnBroadcast = false;
    chain.broadcastError = new BroadcastTimeoutError();

    await service.anchorDocument(DOC, 1, content);
    expect((await repo.findByDocumentAndVersion(DOC, 1))?.status).toBe('BROADCAST_UNKNOWN');

    await sweep.runOnce(); // no trace on chain -> re-broadcast the same signed tx
    expect(chain.broadcasts).toHaveLength(2);
    expect(chain.broadcasts[1]).toBe(chain.broadcasts[0]); // the same one, not a new one
    expect((await repo.findByDocumentAndVersion(DOC, 1))?.status).toBe('BROADCAST_SENT');

    // The chain accepts it (late); confirmation follows from the receipt.
    chain.land(FakeChain.txIdFor(chain.broadcasts[0]));
    await worker.runOnce();

    const after = await repo.findByDocumentAndVersion(DOC, 1);
    expect(after?.status).toBe('CONFIRMED');
    expect(chain.txIdsOnChain()).toHaveLength(1); // one anchor on chain
    expect(await db.anchor.count({ where: { documentId: DOC, version: 1 } })).toBe(1); // one row
  });

  it('crash between broadcast and confirmation: restart recovers; exactly one anchor and one tx identity', async () => {
    const content = { type: 'imaging', study: 'ct-chest', slices: 128 };
    const expectedTxId = FakeChain.txIdFor(
      FakeChain.sign({ documentId: DOC, version: 1, contentHash: canonicalHash(content) }),
    );

    // The chain accepts the tx, then the process dies mid-broadcast. The
    // throw escapes the service, so nothing is written after the broadcast —
    // this is the window where a naive design (persist AFTER broadcast) loses
    // the tx identity forever.
    chain.broadcastError = new SimulatedCrash();

    await expect(service.anchorDocument(DOC, 1, content)).rejects.toBeInstanceOf(SimulatedCrash);

    // Post-crash state: the write-ahead intent is the only row, still
    // PREPARED, carrying the tx identity; the chain holds exactly that tx.
    const rows = await db.anchor.findMany({ where: { documentId: DOC, version: 1 } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ txId: expectedTxId, signedTx: chain.broadcasts[0], status: 'PREPARED' });
    expect(chain.txIdsOnChain()).toEqual([expectedTxId]);

    // The naive design's "late persist" would now insert a second row for the
    // same (document, version). The schema-level unique constraint rejects it
    // — this is what keeps duplicates out no matter what the application does.
    await expect(
      db.anchor.create({
        data: {
          documentId: DOC,
          version: 1,
          contentHash: canonicalHash(content),
          txId: 'tx_naive_late_persist',
          signedTx: 'signed:naive',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    // Restart: a fresh process (new repository + sweep) against the same DB
    // and chain. The sweep asks the chain first and confirms from the receipt.
    const freshSweep = new RecoverySweep(new AnchoringRepository(db), chain, config);
    await freshSweep.runOnce();

    const recovered = await db.anchor.findFirst({ where: { documentId: DOC, version: 1 } });
    expect(recovered?.status).toBe('CONFIRMED');
    expect(recovered?.txId).toBe(expectedTxId);
    expect(recovered?.blockNumber).toBeTypeOf('number');
    expect(chain.broadcasts).toHaveLength(1); // recovered, not re-broadcast
    expect(await db.anchor.count({ where: { documentId: DOC, version: 1 } })).toBe(1);
    expect(chain.txIdsOnChain()).toHaveLength(1);

    // And anchoring the version again is refused, not silently duplicated.
    await expect(service.anchorDocument(DOC, 1, content)).rejects.toBeInstanceOf(AlreadyAnchoredError);
  });

  it('crash before the tx reached the chain: the sweep re-broadcasts the stored signed tx', async () => {
    const content = { type: 'lab-report', panel: 'tsh' };
    chain.landOnBroadcast = false; // this tx never lands
    chain.broadcastError = new SimulatedCrash();

    await expect(service.anchorDocument(DOC, 1, content)).rejects.toBeInstanceOf(SimulatedCrash);
    expect(chain.txIdsOnChain()).toHaveLength(0);
    expect((await repo.findByDocumentAndVersion(DOC, 1))?.status).toBe('PREPARED');

    // Restart healthy; the sweep finds the PREPARED intent, asks the chain
    // first (no trace), then re-broadcasts the same stored signed tx.
    chain.broadcastError = null;
    await sweep.runOnce();
    expect(chain.broadcasts).toHaveLength(2); // the in-flight attempt + the re-broadcast
    expect(chain.broadcasts[1]).toBe(chain.broadcasts[0]);
    expect((await repo.findByDocumentAndVersion(DOC, 1))?.status).toBe('BROADCAST_SENT');

    chain.land(FakeChain.txIdFor(chain.broadcasts[0]));
    await worker.runOnce();
    expect((await repo.findByDocumentAndVersion(DOC, 1))?.status).toBe('CONFIRMED');
    expect(chain.txIdsOnChain()).toHaveLength(1);
  });

  it('anchoring the same (document, version) twice is rejected; another version is fine', async () => {
    const content = { type: 'lab', panel: 'cbc' };
    const first = await service.anchorDocument(DOC, 1, content);

    await expect(service.anchorDocument(DOC, 1, content)).rejects.toBeInstanceOf(AlreadyAnchoredError);
    await expect(service.anchorDocument(DOC, 1, { type: 'lab', panel: 'cbc', extra: true })).rejects.toBeInstanceOf(
      AlreadyAnchoredError,
    );
    expect(chain.broadcasts).toHaveLength(1); // the rejections never reach the chain

    const second = await service.anchorDocument(DOC, 2, content);
    expect(second.txId).not.toBe(first.txId);
    expect(await db.anchor.count()).toBe(2);
  });

  it('concurrent anchoring of the same (document, version): one winner, the loser hits the unique constraint', async () => {
    const content = { type: 'lab', panel: 'mp' };
    const results = await Promise.allSettled([
      service.anchorDocument(DOC, 1, content),
      service.anchorDocument(DOC, 1, content),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AlreadyAnchoredError);
    expect(await db.anchor.count({ where: { documentId: DOC, version: 1 } })).toBe(1);
    expect(chain.broadcasts).toHaveLength(1);
  });

  it('verify returns a mismatch report saying what differs when the content differs', async () => {
    const content = { type: 'lab', result: 7.2 };
    await service.anchorDocument(DOC, 1, content);
    await worker.runOnce();

    const report = await service.verify(DOC, 1, { type: 'lab', result: 7.3 });
    expect(report.result).toBe('hash_mismatch');
    expect(report.suppliedContentHash).toBe(canonicalHash({ type: 'lab', result: 7.3 }));
    expect(report.anchor?.contentHash).toBe(canonicalHash(content));
    expect(report.detail).toContain(canonicalHash({ type: 'lab', result: 7.3 }));
    expect(report.detail).toContain(canonicalHash(content));
  });

  it('verify returns no_anchor when the version was never anchored', async () => {
    const report = await service.verify(DOC, 1, { a: 1 });
    expect(report).toMatchObject({ result: 'no_anchor', anchor: null, suppliedContentHash: canonicalHash({ a: 1 }) });
  });

  it('verify returns pending_confirmation when the content matches but the anchor is unconfirmed', async () => {
    chain.landOnBroadcast = false;
    await service.anchorDocument(DOC, 1, { a: 1 });
    const report = await service.verify(DOC, 1, { a: 1 });
    expect(report.result).toBe('pending_confirmation');
    expect(report.anchor?.txId).toBe((await repo.findByDocumentAndVersion(DOC, 1))?.txId);
    expect(report.anchor?.blockNumber).toBeNull();
  });

  it('a stale broadcast-sent anchor with no trace on chain is re-broadcast with the same signed tx', async () => {
    const content = { type: 'rx', n: 3 };
    chain.landOnBroadcast = false;
    await service.anchorDocument(DOC, 1, content);
    const row = (await repo.findByDocumentAndVersion(DOC, 1))!;

    // Backdate it past the staleness window.
    await db.anchor.update({
      where: { id: row.id },
      data: { updatedAt: new Date(Date.now() - config.staleAfterMs - 5000) },
    });

    await sweep.runOnce();
    expect(chain.broadcasts).toHaveLength(2);
    expect(chain.broadcasts[1]).toBe(chain.broadcasts[0]);
    const afterSweep = await repo.findByDocumentAndVersion(DOC, 1);
    expect(afterSweep?.status).toBe('BROADCAST_SENT');
    expect(afterSweep?.broadcastAttempts).toBe(1);

    chain.land(FakeChain.txIdFor(chain.broadcasts[0]));
    await worker.runOnce();
    expect((await repo.findByDocumentAndVersion(DOC, 1))?.status).toBe('CONFIRMED');
  });

  it('the sweep does not re-broadcast a fresh broadcast-sent anchor; it confirms from the receipt', async () => {
    await service.anchorDocument(DOC, 1, { a: 1 }); // landed on broadcast (default)
    await sweep.runOnce();
    expect(chain.broadcasts).toHaveLength(1);
    expect((await repo.findByDocumentAndVersion(DOC, 1))?.status).toBe('CONFIRMED');
  });

  it('a receipt reporting failure moves the anchor to FAILED', async () => {
    await service.anchorDocument(DOC, 1, { a: 1 });
    const row = (await repo.findByDocumentAndVersion(DOC, 1))!;
    chain.land(row.txId, 'failure');
    await worker.runOnce();
    expect((await repo.findByDocumentAndVersion(DOC, 1))?.status).toBe('FAILED');
  });
});
