import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { AnchorRepository } from '../src/anchor/anchor.repository.js';
import { AnchorService } from '../src/anchor/anchor.service.js';
import { AnchorProcessor } from '../src/anchor/anchor.processor.js';
import type { AnchorProcessorOptions } from '../src/anchor/anchor.processor.js';
import { canonicalizeJson, hashContent } from '../src/anchor/anchor-canonicalizer.js';
import { InvalidInputError, UniqueViolationError } from '../src/errors.js';
import { FakeChainClient } from './fakes/chain-client.fake.js';
import { ensureDatabaseSchema } from './setup.js';

// ASSUMPTION: the suite runs against a real PostgreSQL (DATABASE_URL in the
// environment) and with tsx (devDependency) installed so the crash child
// process can be spawned with `node --import tsx`.

const prisma = new PrismaClient();

const contentA: Record<string, unknown> = {
  reportId: 'R-100',
  patient: 'p-42',
  sections: [{ name: 'labs', values: [1, 2] }],
};
const contentB: Record<string, unknown> = {
  reportId: 'R-100',
  patient: 'p-42',
  sections: [{ name: 'labs', values: [9, 9] }],
};

const processorOptions: AnchorProcessorOptions = {
  enabled: false,
  confirmationIntervalMs: 1_000,
  recoveryIntervalMs: 1_000,
  recoveryMinAgeMs: 0,
  batchLimit: 100,
};

let repo: AnchorRepository | undefined;
let service: AnchorService;
let processor: AnchorProcessor;

beforeAll(() => {
  ensureDatabaseSchema();
});

beforeEach(async () => {
  await prisma.anchor.deleteMany();
  repo = new AnchorRepository();
  const fake = new FakeChainClient();
  service = new AnchorService(repo, fake);
  processor = new AnchorProcessor(repo, fake, processorOptions);
});

afterAll(async () => {
  if (repo) await repo.disconnect();
  await prisma.$disconnect();
});

describe('canonicalization', () => {
  it('is invariant to object key order at any depth', () => {
    const a = { b: 2, a: [1, { d: 4, c: { f: 6, e: 5 } }] };
    const b = { a: [1, { c: { e: 5, f: 6 }, d: 4 }], b: 2 };
    expect(canonicalizeJson(a)).toBe(canonicalizeJson(b));
    expect(hashContent(a)).toBe(hashContent(b));
  });

  it('preserves array order', () => {
    expect(hashContent({ a: [1, 2] })).not.toBe(hashContent({ a: [2, 1] }));
  });

  it('hashes numerically equal numbers identically and produces sha256 hex', () => {
    expect(hashContent({ n: 100 })).toBe(hashContent({ n: 1e2 }));
    expect(hashContent({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects non-canonical values with invalid_input', () => {
    const bad: unknown[] = [
      { n: Number.NaN },
      { n: Infinity },
      { d: new Date() },
      { u: undefined },
      { fn: () => 1 },
    ];
    for (const value of bad) {
      let thrown: unknown;
      try {
        hashContent(value);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(InvalidInputError);
      expect((thrown as InvalidInputError).code).toBe('invalid_input');
    }
  });
});

describe('anchorDocument', () => {
  it('persists the anchor intent with tx identity, broadcasts, then confirms via the worker', async () => {
    const result = await service.anchor('doc-1', 1, contentA);

    expect(result.created).toBe(true);
    expect(result.view.documentId).toBe('doc-1');
    expect(result.view.version).toBe(1);
    expect(result.view.contentHash).toBe(hashContent(contentA));
    expect(result.view.txId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.view.state).toBe('pending');
    expect(result.view.blockNumber).toBeNull();
    expect(result.view.broadcastAt).not.toBeNull();

    // The intent row (tx identity + signed payload) is durable in the DB.
    const row = await prisma.anchor.findFirst();
    expect(row).not.toBeNull();
    expect(row!.txId).toBe(result.view.txId);
    expect(row!.signedTx).toBe(`sig:${result.view.txId}`);

    // The confirmation worker polls the receipt and advances the state.
    const tick = await processor.runConfirmationTick();
    expect(tick).toMatchObject({ checked: 1, confirmed: 1, failed: 0 });

    const confirmed = await prisma.anchor.findFirst();
    expect(confirmed?.state).toBe('confirmed');
    expect(confirmed?.blockNumber).toBe(100);
    expect(confirmed?.confirmedAt).toBeInstanceOf(Date);

    const report = await service.verify('doc-1', 1, contentA);
    expect(report.status).toBe('verified');
    expect(report.proof).toMatchObject({ txId: result.view.txId, blockNumber: 100 });
  });

  it('is idempotent for identical content and rejects different content', async () => {
    const first = await service.anchor('doc-2', 1, contentA);
    const again = await service.anchor('doc-2', 1, contentA);

    expect(again.created).toBe(false);
    expect(again.view.id).toBe(first.view.id);
    expect(await prisma.anchor.count()).toBe(1);

    await expect(service.anchor('doc-2', 1, contentB)).rejects.toMatchObject({
      name: 'AnchorConflictError',
      code: 'anchor_conflict',
      details: {
        documentId: 'doc-2',
        version: 1,
        existingHash: hashContent(contentA),
        requestedHash: hashContent(contentB),
      },
    });

    expect(await prisma.anchor.count()).toBe(1);
    const row = await prisma.anchor.findFirst();
    expect(row?.contentHash).toBe(hashContent(contentA)); // the original anchor is unchanged
  });

  it('enforces exactly one anchor per (document, version) at the schema level', async () => {
    const base = { documentId: 'doc-3', version: 9 };
    await repo!.create({ ...base, contentHash: 'a'.repeat(64), txId: '0x1', signedTx: 'sig:0x1' });

    await expect(repo!.create({ ...base, contentHash: 'b'.repeat(64), txId: '0x2', signedTx: 'sig:0x2' })).rejects.toBeInstanceOf(
      UniqueViolationError,
    );

    expect(await prisma.anchor.count()).toBe(1);
  });

  it('maps a chain prepare failure to chain_error and persists nothing', async () => {
    const deadChain = new FakeChainClient({ failPrepare: true });
    await expect(new AnchorService(repo!, deadChain).anchor('doc-9', 1, contentA)).rejects.toMatchObject({
      name: 'ChainError',
      code: 'chain_error',
      httpStatus: 502,
    });
    expect(await prisma.anchor.count()).toBe(0);
  });

  it('survives a broadcast timeout: the sweep re-broadcasts, then the worker confirms', async () => {
    const flaky = new FakeChainClient({ failBroadcast: true });
    const svc = new AnchorService(repo!, flaky);

    const result = await svc.anchor('doc-4', 1, contentA);
    expect(result.created).toBe(true);
    expect(result.view.state).toBe('pending');
    expect(result.view.broadcastAt).toBeNull();

    const live = new FakeChainClient({ deferMining: true });
    const p = new AnchorProcessor(repo!, live, processorOptions);

    const sweep = await p.runRecoverySweep();
    expect(sweep).toMatchObject({ checked: 1, confirmed: 0, rebroadcast: 1, failed: 0 });
    expect(live.broadcastTotal).toBe(1);

    const afterSweep = await prisma.anchor.findFirst();
    expect(afterSweep?.state).toBe('pending');
    expect(afterSweep?.broadcastAt).not.toBeNull();

    // No receipt yet: the confirmation worker does not advance.
    expect((await p.runConfirmationTick()).confirmed).toBe(0);

    live.mine(result.view.txId);
    expect((await p.runConfirmationTick()).confirmed).toBe(1);
    expect((await service.verify('doc-4', 1, contentA)).status).toBe('verified');
  });

  it('recovery sweep queries the chain first and never re-sends a tx already on chain', async () => {
    const txId = '0x' + 'f'.repeat(64);
    // Post-crash state: the tx is on chain, but the row is still pending with
    // no recorded send.
    await repo!.create({
      documentId: 'doc-5',
      version: 1,
      contentHash: hashContent(contentA),
      txId,
      signedTx: `sig:${txId}`,
    });

    const seeded = new FakeChainClient({ seedChainState: { [txId]: 77 } });
    const p = new AnchorProcessor(repo!, seeded, processorOptions);

    const sweep = await p.runRecoverySweep();
    expect(sweep).toMatchObject({ checked: 1, confirmed: 1, rebroadcast: 0, failed: 0 });
    expect(seeded.broadcastTotal).toBe(0); // no double-spend

    const row = await prisma.anchor.findFirst();
    expect(row?.state).toBe('confirmed');
    expect(row?.blockNumber).toBe(77);
    expect(row?.broadcastAt).toBeNull(); // no send was ever recorded
  });
});

describe('verify', () => {
  it('reports a mismatch when the content no longer matches the stored hash', async () => {
    await service.anchor('doc-6', 2, contentA);

    const report = await service.verify('doc-6', 2, contentB);
    expect(report.status).toBe('mismatch');
    expect(report.storedHash).toBe(hashContent(contentA));
    expect(report.computedHash).toBe(hashContent(contentB));
    expect(report.txId).not.toBeNull();
    expect(report.proof).toBeNull();
  });

  it('reports not_anchored for a (document, version) without an anchor', async () => {
    const report = await service.verify('doc-7', 1, contentA);
    expect(report.status).toBe('not_anchored');
    expect(report.storedHash).toBeNull();
    expect(report.txId).toBeNull();
    expect(report.proof).toBeNull();
  });

  it('reports pending for a matching anchor that has no receipt yet', async () => {
    const svc = new AnchorService(repo!, new FakeChainClient({ deferMining: true }));
    const result = await svc.anchor('doc-8', 1, contentA);

    const report = await service.verify('doc-8', 1, contentA);
    expect(report.status).toBe('pending');
    expect(report.txId).toBe(result.view.txId);
    expect(report.proof).toBeNull();
  });
});

describe('crash between broadcast and post-broadcast persistence', () => {
  it('recovers the anchor from the chain and keeps exactly one anchor', async () => {
    const chainFile = join(tmpdir(), `fake-chain-${process.pid}-${Date.now()}.json`);
    const childScript = fileURLToPath(new URL('./fixtures/anchor-crash-child.ts', import.meta.url));

    // The child anchors against a chain fake that kills the process right
    // after the tx is recorded on chain — i.e. between the broadcast and the
    // post-broadcast persistence.
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', childScript, chainFile, 'doc-crash', '3', JSON.stringify(contentA)],
      { encoding: 'utf8', timeout: 90_000 },
    );

    // The child must have died (process.crash, or the exit(137) fallback),
    // not completed.
    expect(child.status).not.toBe(0);
    if (child.status === 0 || !existsSync(chainFile)) {
      console.error('crash child stderr:', child.stderr);
    }

    // The chain recorded exactly one tx.
    expect(existsSync(chainFile)).toBe(true);
    const chainState = JSON.parse(readFileSync(chainFile, 'utf8')) as Record<string, number>;
    const txIds = Object.keys(chainState);
    expect(txIds).toHaveLength(1);
    const txId = txIds[0]!;
    expect(txId).toMatch(/^0x[0-9a-f]{64}$/);

    // Exactly one row after the crash: the intent was persisted before the
    // broadcast; it is still pending with no recorded send.
    const rows = await prisma.anchor.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.documentId).toBe('doc-crash');
    expect(rows[0]!.version).toBe(3);
    expect(rows[0]!.contentHash).toBe(hashContent(contentA));
    expect(rows[0]!.txId).toBe(txId);
    expect(rows[0]!.state).toBe('pending');
    expect(rows[0]!.broadcastAt).toBeNull();

    // The recovery sweep (a fresh fake seeded from the crashed process's
    // chain state) queries the chain first and confirms without re-sending.
    const recovered = new FakeChainClient({ seedChainState: chainState });
    const p = new AnchorProcessor(new AnchorRepository(), recovered, processorOptions);
    const sweep = await p.runRecoverySweep();
    expect(sweep).toMatchObject({ checked: 1, confirmed: 1, rebroadcast: 0, failed: 0 });
    expect(recovered.broadcastTotal).toBe(0);

    const block = chainState[txId]!;
    const row = await prisma.anchor.findFirst();
    expect(row?.state).toBe('confirmed');
    expect(row?.blockNumber).toBe(block);

    // verify now returns the anchoring proof.
    const svc = new AnchorService(new AnchorRepository(), recovered);
    const report = await svc.verify('doc-crash', 3, contentA);
    expect(report.status).toBe('verified');
    expect(report.proof).toMatchObject({ txId, blockNumber: block });

    // The schema constraint still bounds (document, version) to one anchor:
    // identical content is idempotent, different content conflicts.
    const retry = await svc.anchor('doc-crash', 3, contentA);
    expect(retry.created).toBe(false);
    expect(retry.view.txId).toBe(txId);
    await expect(svc.anchor('doc-crash', 3, contentB)).rejects.toMatchObject({ code: 'anchor_conflict' });
    expect(await prisma.anchor.count()).toBe(1);
  }, 120_000);
});
