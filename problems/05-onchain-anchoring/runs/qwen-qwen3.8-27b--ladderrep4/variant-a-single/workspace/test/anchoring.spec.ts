import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { AnchoringConfig } from '../src/anchoring/anchoring.config.js';
import { InMemoryChainClient, InMemoryChainState } from '../src/anchoring/in-memory-chain-client.js';
import { AnchoringRepository, type StoredAnchor } from '../src/anchoring/anchoring.repository.js';
import { AnchoringService } from '../src/anchoring/anchoring.service.js';
import { AnchoringWorker } from '../src/anchoring/anchoring.worker.js';
import { canonicalHash, canonicalize } from '../src/anchoring/canonicalize.js';
import { DomainException } from '../src/common/domain-exception.js';

const CONFIG: AnchoringConfig = {
  broadcastTimeoutMs: 500,
  confirmationPollMs: 0, // no background timers: the passes are driven explicitly
  recoverySweepMs: 0,
  stuckAfterMs: 0, // every limbo row counts as stuck for a test
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('report anchoring (behaviour against the chain-client interface)', () => {
  const prisma = new PrismaService();
  // The chain survives "process restarts"; app state does not.
  const chainState = new InMemoryChainState();
  let repo: AnchoringRepository;
  let chain: InMemoryChainClient;
  let service: AnchoringService;
  let worker: AnchoringWorker;

  /** A fresh app "process": new client/service/worker over the same chain. */
  function makeProcess(): { client: InMemoryChainClient; service: AnchoringService; worker: AnchoringWorker } {
    const client = new InMemoryChainClient(chainState);
    return {
      client,
      service: new AnchoringService(repo, client, CONFIG),
      worker: new AnchoringWorker(repo, client, CONFIG),
    };
  }

  async function issue(documentId: string, version: number, content: Record<string, unknown>): Promise<void> {
    await service.createVersion(documentId, version, content);
  }

  async function waitForAnchor(documentId: string, version: number, timeoutMs = 3000): Promise<StoredAnchor> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await repo.findAnchor(documentId, version);
      if (row) return row;
      if (Date.now() > deadline) throw new Error(`anchor row for ${documentId}#${version} did not appear`);
      await sleep(10);
    }
  }

  beforeAll(async () => {
    await prisma.$connect();
    repo = new AnchoringRepository(prisma);
  }, 60_000);

  beforeEach(async () => {
    const p = makeProcess();
    chain = p.client;
    service = p.service;
    worker = p.worker;
    await prisma.anchor.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('commits the anchor intent — with the tx identity — before the broadcast returns', async () => {
    await issue('doc-wa', 1, { patient: 'anon-42', result: 'positive', score: 1.5 });

    let release!: () => void;
    chain.setBroadcast(async (_signedTx, txId, state) => {
      state.land(txId); // the chain has accepted the tx
      await new Promise<void>((resolve) => {
        release = resolve;
      }); // ...but broadcast() does not return yet
    });

    const anchorCall = service.anchorDocument('doc-wa', 1);
    anchorCall.catch(() => undefined); // keep a hypothetical failure from surfacing as unhandled

    // While the broadcast is still in flight, the intent must already be
    // committed, with the tx identity a naive (persist-after-broadcast) design
    // would only write later.
    const inFlight = await waitForAnchor('doc-wa', 1);
    expect(inFlight.status).toBe('prepared');
    expect(inFlight.txId).toMatch(/^tx_/);
    expect(inFlight.signedTx).toBe(`signed:${inFlight.txId}`);

    release();
    const anchor = await anchorCall;
    expect(anchor.status).toBe('broadcast_sent');
    expect(anchor.txId).toBe(inFlight.txId);

    const receipt = await chain.getReceipt(inFlight.txId);
    expect(receipt?.txId).toBe(inFlight.txId); // the on-chain tx is the one we persisted
  });

  it('broadcast timeout that landed: recovery confirms from the receipt, no re-broadcast', async () => {
    await issue('doc-to', 3, { a: 1 });

    chain.setBroadcast(async (_signedTx, txId, state) => {
      state.land(txId); // the chain accepted it
      await new Promise<void>(() => {}); // ...and broadcast() never returns (timeout)
    });

    const anchor = await service.anchorDocument('doc-to', 3);
    expect(anchor.status).toBe('broadcast_unknown');
    expect(anchor.txId).toMatch(/^tx_/);

    const broadcastsBefore = chainState.broadcastLog.length; // exactly 1
    await worker.runRecoveryPass(); // chain first: the receipt already exists

    const recovered = await repo.findAnchor('doc-to', 3);
    expect(recovered?.status).toBe('confirmed');
    expect(recovered?.blockNumber).toBeTypeOf('number');
    expect(recovered?.txId).toBe(anchor.txId);
    expect(chainState.broadcastLog.length).toBe(broadcastsBefore); // no re-broadcast
    expect(await prisma.anchor.count({ where: { documentId: 'doc-to', version: 3 } })).toBe(1);
  });

  it('broadcast timeout that did not land: the same signed tx is re-broadcast, one anchor results', async () => {
    await issue('doc-nl', 1, { a: 1 });

    chain.setBroadcast(() => new Promise<void>(() => {})); // hang, and nothing lands
    const anchor = await service.anchorDocument('doc-nl', 1);
    expect(anchor.status).toBe('broadcast_unknown');

    chain.setBroadcast(null); // the chain is back to normal for the recovery pass

    await worker.runRecoveryPass(); // no receipt on chain -> re-broadcast the SAME signed tx
    const afterRebroadcast = await repo.findAnchor('doc-nl', 1);
    expect(afterRebroadcast?.status).toBe('broadcast_sent');
    expect(chainState.broadcastLog).toEqual([anchor.signedTx, anchor.signedTx]);

    await worker.runConfirmationPass();
    const confirmed = await repo.findAnchor('doc-nl', 1);
    expect(confirmed?.status).toBe('confirmed');
    expect(confirmed?.txId).toBe(anchor.txId);
    expect(await prisma.anchor.count({ where: { documentId: 'doc-nl', version: 1 } })).toBe(1);
  });

  it('process crash between broadcast and confirmation: restart recovers exactly one anchor', async () => {
    await issue('doc-cr', 7, { b: [1, 2, 3] });

    // The chain accepts the tx, then the process dies before any post-broadcast
    // state write. A real SIGKILL would leave the row 'prepared'; this
    // simulation leaves it 'broadcast_unknown' — both are limbo states the
    // recovery sweep resolves by asking the chain first, using the write-ahead
    // tx identity that a persist-after-broadcast design would not have.
    chain.setBroadcast((_signedTx, txId, state) => {
      state.land(txId);
      throw new Error('simulated process crash');
    });

    const anchor = await service.anchorDocument('doc-cr', 7);
    expect(anchor.status).toBe('broadcast_unknown');
    const txId = anchor.txId;

    // "Restart": fresh process state, same chain (the chain keeps the tx).
    const { worker: restartedWorker } = makeProcess();
    await restartedWorker.runRecoveryPass();

    const rows = await prisma.anchor.findMany({ where: { documentId: 'doc-cr', version: 7 } });
    expect(rows).toHaveLength(1); // one anchor, total
    expect(rows[0].status).toBe('CONFIRMED');
    expect(rows[0].txId).toBe(txId); // one transaction identity
    expect(chainState.broadcastLog.length).toBe(1); // broadcast exactly once, in total
  });

  it('anchoring the same (document, version) twice is rejected by the database', async () => {
    await issue('doc-uq', 2, { x: true });

    const [first, second] = await Promise.allSettled([
      service.anchorDocument('doc-uq', 2),
      service.anchorDocument('doc-uq', 2),
    ]);
    const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
    const rejected = [first, second].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(DomainException);
    expect((rejected[0].reason as DomainException).code).toBe('anchor_conflict');

    // A third attempt, after the first is confirmed, is rejected the same way.
    await worker.runConfirmationPass();
    await expect(service.anchorDocument('doc-uq', 2)).rejects.toMatchObject({ code: 'anchor_conflict', httpStatus: 409 });

    const rows = await prisma.anchor.findMany({ where: { documentId: 'doc-uq', version: 2 } });
    expect(rows).toHaveLength(1);
    expect(rows[0].txId).toBeTruthy();
  });

  describe('verify', () => {
    it('returns the on-chain proof for matching content (key order does not matter)', async () => {
      const content = { report: { patient: 'anon-1', values: [1, 2.5, 'ok'] }, issued: '2025-01-01' };
      await issue('doc-vf', 5, content);
      await service.anchorDocument('doc-vf', 5);
      await worker.runConfirmationPass();

      const row = await repo.findAnchor('doc-vf', 5);
      expect(row?.status).toBe('confirmed');

      const report = await service.verify('doc-vf', 5, {
        issued: '2025-01-01',
        report: { values: [1, 2.5, 'ok'], patient: 'anon-1' },
      });
      expect(report.match).toBe(true);
      expect(report.differences).toEqual([]);
      expect(report.anchorState).toBe('confirmed');
      expect(report.proof).toEqual({
        txId: row?.txId,
        blockNumber: row?.blockNumber,
        blockHash: row?.receipt?.blockHash,
      });
    });

    it('returns a mismatch report that says what differs', async () => {
      const content = { patient: 'anon-9', labs: { hgb: 12.5, wbc: 6.1 }, flags: [] };
      await issue('doc-mm', 1, content);
      await service.anchorDocument('doc-mm', 1);
      await worker.runConfirmationPass();

      const tampered = { patient: 'ANON-9', labs: { hgb: 13.0, wbc: 6.1 }, flags: ['review'], extra: 1 };
      const report = await service.verify('doc-mm', 1, tampered);

      expect(report.match).toBe(false);
      expect(report.storedContentHash).not.toBe(report.suppliedContentHash);
      expect(report.proof).toBeNull(); // no proof is served for content that does not match

      const byPath = new Map(report.differences.map((d) => [d.path, d]));
      expect(byPath.get('$.patient')?.kind).toBe('value');
      expect(byPath.get('$.patient')?.stored).toBe('anon-9');
      expect(byPath.get('$.patient')?.supplied).toBe('ANON-9');
      expect(byPath.get('$.labs.hgb')?.kind).toBe('value');
      expect(byPath.get('$.labs.hgb')?.stored).toBe(12.5);
      expect(byPath.get('$.labs.hgb')?.supplied).toBe(13);
      expect(byPath.get('$.labs.wbc')).toBeUndefined(); // unchanged fields are not reported
      expect(byPath.get('$.flags[0]')?.kind).toBe('missing_in_stored');
      expect(byPath.get('$.extra')?.kind).toBe('missing_in_stored');
      expect(byPath.get('$.extra')?.supplied).toBe(1);
    });

    it('reports pending anchors (matching content, no block yet) and rejects unknown versions/anchors', async () => {
      chain.setBroadcast(() => new Promise<void>(() => {})); // the anchor will never confirm
      await issue('doc-pd', 1, { a: 1 });
      await service.anchorDocument('doc-pd', 1);

      const pending = await service.verify('doc-pd', 1, { a: 1 });
      expect(pending.match).toBe(true);
      expect(pending.anchorState).toBe('broadcast_unknown');
      expect(pending.proof).toBeNull();

      await expect(service.anchorDocument('ghost', 1)).rejects.toMatchObject({
        code: 'document_version_not_found',
        httpStatus: 404,
      });
      await expect(service.verify('ghost', 1, { a: 1 })).rejects.toMatchObject({
        code: 'document_version_not_found',
      });

      await issue('doc-na', 1, { a: 1 });
      await expect(service.verify('doc-na', 1, { a: 1 })).rejects.toMatchObject({
        code: 'anchor_not_found',
        httpStatus: 404,
      });
    });
  });

  describe('canonicalization (per docs/canonicalization.md)', () => {
    it('is key-order insensitive and number-normalizing', () => {
      expect(canonicalize({ b: 1, a: { d: 2, c: [true, null] } })).toBe('{"a":{"c":[true,null],"d":2},"b":1}');
      expect(canonicalHash({ b: 1, a: { c: [true, null], d: 2 } })).toBe(canonicalHash({ a: { d: 2, c: [true, null] }, b: 1 }));
      expect(canonicalHash({ n: 1.1, m: 1e2 })).toBe(canonicalHash({ n: 1.1, m: 100 }));
      expect(canonicalize({ s: 'x"y' })).toBe('{"s":"x\\"y"}');
      expect(canonicalHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects non-JSON values and drops undefined-valued keys', () => {
      expect(() => canonicalize({ bad: Number.NaN })).toThrow();
      expect(canonicalize({ a: 1, gone: undefined })).toBe('{"a":1}');
    });
  });
});
