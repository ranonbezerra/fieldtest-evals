import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient, type Anchor } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/api-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnchorService } from '../src/anchor/anchor.service';
import { AnchorConfirmationWorker } from '../src/anchor/anchor.worker';
import { AnchorRecoverySweep } from '../src/anchor/anchor.sweep';
import { CHAIN_CLIENT } from '../src/anchor/chain.client';
import { REPORT_SOURCE } from '../src/anchor/report.source';
import { FakeChainClient } from '../src/anchor/fake-chain.client';
import { FakeReportSource } from '../src/anchor/fake-report.source';
import { hashContent } from '../src/anchor/canonical';

// Background timers are driven manually via tick() in tests; push the
// intervals far out so a stray tick cannot interfere with a scenario.
process.env.ANCHOR_CONFIRMATION_INTERVAL_MS = '600000';
process.env.ANCHOR_SWEEP_INTERVAL_MS = '600000';

// Direct database handle for assertions and cleanup.
const admin = new PrismaClient();

const sampleReport = {
  documentId: 'rep-1',
  kind: 'clinical',
  measurements: { temperature: 37.1, weight: 70.5 },
  issuedAt: '2025-05-01T12:00:00Z',
  notes: ['stable'],
};

interface AppHandle {
  app: INestApplication;
  chain: FakeChainClient;
  reports: FakeReportSource;
}

async function createApp(overrides: Partial<Pick<AppHandle, 'chain' | 'reports'>> = {}): Promise<AppHandle> {
  const chain = overrides.chain ?? new FakeChainClient();
  const reports = overrides.reports ?? new FakeReportSource();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CHAIN_CLIENT)
    .useValue(chain)
    .overrideProvider(REPORT_SOURCE)
    .useValue(reports)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  return { app, chain, reports };
}

async function waitFor<T>(probe: () => Promise<T | null | undefined>, what: string, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function anchorRow(documentId: string, version: number): Promise<Anchor | null> {
  return admin.anchor.findUnique({ where: { documentId_version: { documentId, version } } });
}

beforeAll(async () => {
  await admin.$connect();
});

beforeEach(async () => {
  await admin.anchor.deleteMany({});
});

afterAll(async () => {
  await admin.$disconnect();
});

describe('anchorDocument', () => {
  it('persists the anchor intent (with the tx identity) before broadcasting, then confirms with a proof', async () => {
    const { app, chain, reports } = await createApp();
    reports.seed('rep-1', 2, sampleReport);
    try {
      const service = app.get(AnchorService);
      const dto = await service.anchorDocument('rep-1', 2);

      expect(dto.state).toBe('BROADCASTING');
      expect(dto.contentHash).toBe(hashContent(sampleReport));
      expect(dto.txId).toMatch(/^0x[0-9a-f]{40}$/);
      expect(chain.broadcastCount()).toBe(1);

      const row = await anchorRow('rep-1', 2);
      expect(row?.txId).toBe(dto.txId);

      chain.advanceBlock();
      await app.get(AnchorConfirmationWorker).tick();

      const confirmed = await anchorRow('rep-1', 2);
      expect(confirmed?.state).toBe('CONFIRMED');
      expect(confirmed?.blockNumber).toBe(100);

      const receipt = await chain.getReceipt(dto.txId);
      expect(receipt).not.toBeNull();
      const verified = await service.verify('rep-1', 2, sampleReport);
      expect(verified.status).toBe('verified');
      expect(verified.proof).toEqual({
        txId: dto.txId,
        blockNumber: receipt!.blockNumber,
        blockHash: receipt!.blockHash,
      });
    } finally {
      await app.close();
    }
  });

  it('is idempotent per (document, version): repeats return the same anchor, one broadcast, one row', async () => {
    const { app, chain, reports } = await createApp();
    reports.seed('rep-idem', 4, { k: 'v' });
    try {
      const service = app.get(AnchorService);
      const first = await service.anchorDocument('rep-idem', 4);
      const second = await service.anchorDocument('rep-idem', 4);
      expect(second.txId).toBe(first.txId);
      expect(second.contentHash).toBe(first.contentHash);
      expect(chain.broadcastCount()).toBe(1);
      expect(await admin.anchor.count({ where: { documentId: 'rep-idem', version: 4 } })).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('rejects anchoring a version the report store does not have', async () => {
    const { app } = await createApp();
    try {
      await expect(app.get(AnchorService).anchorDocument('missing-doc', 1)).rejects.toMatchObject({
        status: 404,
        code: 'resource_not_found',
      });
      expect(await admin.anchor.count()).toBe(0);
    } finally {
      await app.close();
    }
  });
});

describe('canonicalization and verify', () => {
  it('treats key-order differences as identical, mutations as mismatches (proof still returned)', async () => {
    const { app, chain, reports } = await createApp();
    chain.autoMine = true;
    const original = { b: 2, a: { z: 'later', y: [1, 2, { d: 1, c: 2, b: 3 }] }, c: null };
    reports.seed('rep-can', 1, original);
    try {
      const service = app.get(AnchorService);
      const dto = await service.anchorDocument('rep-can', 1);
      await app.get(AnchorConfirmationWorker).tick();

      const reordered = { c: null, a: { y: [1, 2, { b: 3, d: 1, c: 2 }], z: 'later' }, b: 2 };
      const ok = await service.verify('rep-can', 1, reordered);
      expect(ok.status).toBe('verified');
      expect(ok.actualHash).toBe(dto.contentHash);

      const scalarChanged = { ...reordered, b: 3 };
      const mismatch = await service.verify('rep-can', 1, scalarChanged);
      expect(mismatch.status).toBe('mismatch');
      expect(mismatch.expectedHash).toBe(dto.contentHash);
      expect(mismatch.actualHash).not.toBe(dto.contentHash);
      expect(mismatch.proof?.txId).toBe(dto.txId);

      // Array order is meaningful in a report.
      const arrayReordered = { ...reordered, a: { ...reordered.a, y: [2, 1, { d: 1, c: 2, b: 3 }] } };
      expect((await service.verify('rep-can', 1, arrayReordered)).status).toBe('mismatch');
    } finally {
      await app.close();
    }
  });

  it('reports not_anchored, then pending, then verified across the lifecycle', async () => {
    const { app, chain, reports } = await createApp();
    reports.seed('rep-lc', 1, { a: 1 });
    try {
      const service = app.get(AnchorService);
      const none = await service.verify('rep-lc', 9, { a: 1 });
      expect(none.status).toBe('not_anchored');
      expect(none.proof).toBeNull();

      const dto = await service.anchorDocument('rep-lc', 1);
      expect(dto.state).toBe('BROADCASTING');
      const pending = await service.verify('rep-lc', 1, { a: 1 });
      expect(pending.status).toBe('pending');
      expect(pending.proof).toBeNull();

      chain.advanceBlock();
      await app.get(AnchorConfirmationWorker).tick();
      const verified = await service.verify('rep-lc', 1, { a: 1 });
      expect(verified.status).toBe('verified');
      expect(verified.proof?.txId).toBe(dto.txId);
      expect(verified.proof?.blockNumber).toBeTypeOf('number');
    } finally {
      await app.close();
    }
  });
});

describe('exactly one anchor per (document, version)', () => {
  it('is enforced at the schema level: a second row for the same key violates the unique constraint', async () => {
    const { app } = await createApp();
    try {
      const prisma = app.get(PrismaService);
      await prisma.anchor.create({
        data: { id: randomUUID(), documentId: 'rep-uq', version: 1, contentHash: 'sha256:aa', txId: '0xaaaa' },
      });
      await expect(
        prisma.anchor.create({
          data: { id: randomUUID(), documentId: 'rep-uq', version: 1, contentHash: 'sha256:bb', txId: '0xbbbb' },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      expect(await admin.anchor.count({ where: { documentId: 'rep-uq', version: 1 } })).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('survives a crash between broadcast and persist: the sweep recovers the original tx and sends no second tx', async () => {
    const chain = new FakeChainClient();
    const reports = new FakeReportSource();
    reports.seed('rep-crash', 3, { diagnosis: 'stable', score: 12 });

    // The broadcast never completes: the process dies with the tx in flight.
    chain.holdBroadcasts();

    // --- first life ----------------------------------------------------------
    const first = await createApp({ chain, reports });
    const inFlight = first.app.get(AnchorService).anchorDocument('rep-crash', 3);

    // The intent — with the tx identity — is durable BEFORE the broadcast.
    const intent = await waitFor<Anchor>(async () => anchorRow('rep-crash', 3), 'the anchor intent row');
    expect(intent.state).toBe('PENDING');
    expect(intent.txId).toMatch(/^0x[0-9a-f]{40}$/);

    await chain.whenBroadcast(intent.txId); // the tx reached the chain; the process now dies
    await first.app.close(); // crash: nothing is (or needs to be) persisted after this

    // The chain keeps running without the process: the tx is mined.
    chain.advanceBlock();
    expect(chain.isMined(intent.txId)).toBe(true);

    // --- second life: same database, same chain --------------------------------
    const second = await createApp({ chain, reports });
    try {
      await second.app.get(AnchorRecoverySweep).tick();

      const recovered = await anchorRow('rep-crash', 3);
      expect(recovered?.state).toBe('CONFIRMED');
      expect(recovered?.txId).toBe(intent.txId); // the original identity, not a new tx
      expect(recovered?.blockNumber).toBe(100);

      // The sweep queried the chain first: the tx was already there, so it
      // never re-broadcast. A naive "broadcast first, persist later" design
      // would have lost the tx identity in the crash and minted a second
      // on-chain tx (whose second row the unique constraint would reject).
      expect(chain.broadcastCount()).toBe(1);
      expect(chain.distinctBroadcasts()).toBe(1);
      expect(chain.minedTxIds()).toEqual([intent.txId]);

      const proof = await second.app.get(AnchorService).verify('rep-crash', 3, { score: 12, diagnosis: 'stable' });
      expect(proof.status).toBe('verified');
      expect(proof.proof?.txId).toBe(intent.txId);
      expect(proof.proof?.blockNumber).toBe(100);
    } finally {
      chain.releaseHeldBroadcasts();
      await inFlight.catch(() => undefined);
      await second.app.close();
    }
  });

  it('resolves a timed-out broadcast that never landed by re-sending the same tx identity', async () => {
    const chain = new FakeChainClient();
    const reports = new FakeReportSource();
    reports.seed('rep-limbo', 1, { a: 1 });
    chain.failNextBroadcast(new Error('upstream timeout'), false); // the tx never reached the chain

    const { app } = await createApp({ chain, reports });
    try {
      const service = app.get(AnchorService);
      await expect(service.anchorDocument('rep-limbo', 1)).rejects.toMatchObject({
        status: 503,
        code: 'broadcast_unknown',
      });

      const before = await anchorRow('rep-limbo', 1);
      expect(before?.state).toBe('PENDING');

      await app.get(AnchorRecoverySweep).tick();
      const after = await anchorRow('rep-limbo', 1);
      expect(after?.state).toBe('BROADCASTING'); // re-sent, awaiting inclusion
      expect(chain.broadcastCount()).toBe(2);
      expect(chain.distinctBroadcasts()).toBe(1); // same identity, no second anchor possible

      chain.advanceBlock();
      await app.get(AnchorConfirmationWorker).tick();
      const confirmed = await anchorRow('rep-limbo', 1);
      expect(confirmed?.state).toBe('CONFIRMED');
      expect(confirmed?.txId).toBe(before?.txId);
    } finally {
      await app.close();
    }
  });
});

describe('HTTP surface', () => {
  const json = { 'content-type': 'application/json' };

  it('POST /anchors returns 202 while in flight; POST /anchors/verify returns the proof', async () => {
    const { app, chain, reports } = await createApp();
    reports.seed('rep-http', 1, { a: 1 });
    const url = await app.getUrl();
    try {
      const post = await fetch(`${url}/anchors`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ documentId: 'rep-http', version: 1 }),
      });
      expect(post.status).toBe(202);
      const dto = (await post.json()) as { txId: string; state: string };
      expect(dto.state).toBe('BROADCASTING');

      chain.advanceBlock();
      await app.get(AnchorConfirmationWorker).tick();

      const verifyRes = await fetch(`${url}/anchors/verify`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ documentId: 'rep-http', version: 1, content: { a: 1 } }),
      });
      expect(verifyRes.status).toBe(200);
      const result = (await verifyRes.json()) as { status: string; proof: { txId: string } | null };
      expect(result.status).toBe('verified');
      expect(result.proof?.txId).toBe(dto.txId);
    } finally {
      await app.close();
    }
  });

  it('answers failures with the standard error envelope', async () => {
    const { app } = await createApp();
    const url = await app.getUrl();
    try {
      const invalid = await fetch(`${url}/anchors`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ documentId: '', version: 0 }),
      });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({
        error: { code: 'invalid_request', message: expect.any(String), details: {} },
      });

      const missing = await fetch(`${url}/anchors`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ documentId: 'nope', version: 1 }),
      });
      expect(missing.status).toBe(404);
      const missingBody = (await missing.json()) as { error: { code: string; details: unknown } };
      expect(missingBody.error.code).toBe('resource_not_found');
      expect(typeof missingBody.error.details).toBe('object');
      expect(missingBody.error.details).not.toBeNull();
    } finally {
      await app.close();
    }
  });
});
