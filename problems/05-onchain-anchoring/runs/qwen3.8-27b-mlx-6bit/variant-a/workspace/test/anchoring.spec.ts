import { describe, it, expect } from 'vitest';
import {
  AnchoringService,
  canonicalize,
  AnchoringError,
} from '../src/anchoring/anchoring.service';
import type { AnchorRow } from '../src/anchoring/anchoring.repository';
import type { AnchoringRepository } from '../src/anchoring/anchoring.repository';
import type { ChainClient, ChainReceipt, PreparedTx } from '../src/anchoring/chain-client.interface';
import { BroadcastTimeoutError } from '../src/anchoring/chain-client.interface';
import { AnchorWorkerService } from '../src/anchoring/anchor-worker.service';

// ─── Fakes ────────────────────────────────────────────────────────────────────────

class FakeRepository {
  rows = new Map<string, AnchorRow>();
  private counter = 0;

  async create(data: {
    documentId: string;
    version: number;
    contentHash: string;
    txId: string;
    signedTx: string;
  }): Promise<AnchorRow> {
    for (const row of this.rows.values()) {
      if (row.documentId === data.documentId && row.version === data.version) {
        throw Object.assign(new Error('Unique constraint violation'), { code: 'P2002' });
      }
    }
    const id = `anchor-${++this.counter}`;
    const row: AnchorRow = {
      id,
      documentId: data.documentId,
      version: data.version,
      contentHash: data.contentHash,
      txId: data.txId,
      signedTx: data.signedTx,
      status: 'pending',
      blockNumber: null,
      blockHash: null,
      failureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(id, row);
    return { ...row };
  }

  async findById(id: string): Promise<AnchorRow | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async findByDocumentAndVersion(
    documentId: string,
    version: number,
  ): Promise<AnchorRow | null> {
    for (const row of this.rows.values()) {
      if (row.documentId === documentId && row.version === version) {
        return { ...row };
      }
    }
    return null;
  }

  async findPending(limit: number): Promise<AnchorRow[]> {
    const out: AnchorRow[] = [];
    for (const row of this.rows.values()) {
      if (row.status === 'pending') {
        out.push({ ...row });
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  async findBroadcast(limit: number): Promise<AnchorRow[]> {
    const out: AnchorRow[] = [];
    for (const row of this.rows.values()) {
      if (row.status === 'broadcast') {
        out.push({ ...row });
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  async markBroadcast(id: string): Promise<void> {
    const row = this.rows.get(id)!;
    row.status = 'broadcast';
    row.updatedAt = new Date();
  }

  async markConfirmed(id: string, blockNumber: bigint, blockHash: string): Promise<void> {
    const row = this.rows.get(id)!;
    row.status = 'confirmed';
    row.blockNumber = blockNumber;
    row.blockHash = blockHash;
    row.updatedAt = new Date();
  }

  async markFailed(id: string, reason: string): Promise<void> {
    const row = this.rows.get(id)!;
    row.status = 'failed';
    row.failureReason = reason;
    row.updatedAt = new Date();
  }
}

interface FakeChainConfig {
  prepareResult: PreparedTx;
  broadcastBehavior: 'success' | 'timeout' | 'fail';
  broadcastError?: Error;
  receipts: Map<string, ChainReceipt | null>;
}

class FakeChainClient implements ChainClient {
  config: FakeChainConfig;

  constructor(config?: Partial<FakeChainConfig>) {
    this.config = {
      prepareResult: config?.prepareResult ?? { txId: 'tx-default', signedTx: 'signed-default' },
      broadcastBehavior: config?.broadcastBehavior ?? 'success',
      broadcastError: config?.broadcastError,
      receipts: config?.receipts ?? new Map(),
    };
  }

  async prepare(_contentHash: string): Promise<PreparedTx> {
    return this.config.prepareResult;
  }

  async broadcast(_signedTx: string): Promise<void> {
    switch (this.config.broadcastBehavior) {
      case 'success':
        return;
      case 'timeout':
        throw new BroadcastTimeoutError('broadcast timed out');
      case 'fail':
        throw this.config.broadcastError ?? new Error('broadcast failed');
    }
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.config.receipts.get(txId) ?? null;
  }
}

// ─── Setup helper ─────────────────────────────────────────────────────────────────

function makeSetup() {
  const repo = new FakeRepository();
  const chain = new FakeChainClient();
  const service = new AnchoringService(repo as unknown as AnchoringRepository, chain);
  const worker = new AnchorWorkerService(service, repo as unknown as AnchoringRepository);
  return { repo, chain, service, worker };
}

// ─── Tests ────────────────────────────────────────────────────────────────────────

describe('canonicalize', () => {
  it('produces the same hash regardless of key insertion order', () => {
    const a = canonicalize({ name: 'Alice', age: 30, city: 'NYC' });
    const b = canonicalize({ city: 'NYC', age: 30, name: 'Alice' });
    expect(a).toBe(b);
  });

  it('produces a different hash when any value changes', () => {
    const a = canonicalize({ name: 'Alice', age: 30 });
    const b = canonicalize({ name: 'Alice', age: 31 });
    expect(a).not.toBe(b);
  });
});

describe('anchorDocument', () => {
  it('happy path: returns broadcast status with correct hash and txId', async () => {
    const { repo, chain, service } = makeSetup();
    chain.config.prepareResult = { txId: 'tx-abc', signedTx: 'signed-abc' };
    chain.config.broadcastBehavior = 'success';

    const content = { patient: 'John', score: 95 };
    const result = await service.anchorDocument('doc-1', 1, content);

    expect(result.status).toBe('broadcast');
    expect(result.txId).toBe('tx-abc');

    const row = await repo.findByDocumentAndVersion('doc-1', 1);
    expect(row).not.toBeNull();
    expect(row!.contentHash).toBe(canonicalize(content));
    expect(row!.txId).toBe('tx-abc');
    expect(row!.status).toBe('broadcast');
  });

  it('rejects a duplicate anchor with code duplicate_anchor', async () => {
    const { repo, chain, service } = makeSetup();
    chain.config.prepareResult = { txId: 'tx-1', signedTx: 'signed-1' };
    chain.config.broadcastBehavior = 'success';

    await service.anchorDocument('doc-1', 1, { patient: 'John' });

    await expect(
      service.anchorDocument('doc-1', 1, { patient: 'Jane' }),
    ).rejects.toMatchObject({ code: 'duplicate_anchor' });

    // Exactly one row in the repository
    expect(repo.rows.size).toBe(1);
  });

  it('leaves the row in pending status when broadcast times out', async () => {
    const { repo, chain, service } = makeSetup();
    chain.config.prepareResult = { txId: 'tx-1', signedTx: 'signed-1' };
    chain.config.broadcastBehavior = 'timeout';

    const result = await service.anchorDocument('doc-1', 1, { a: 1 });

    expect(result.status).toBe('pending');
    const row = await repo.findByDocumentAndVersion('doc-1', 1);
    expect(row!.status).toBe('pending');
  });

  it('marks the row as failed when broadcast throws a non-timeout error', async () => {
    const { repo, chain, service } = makeSetup();
    chain.config.prepareResult = { txId: 'tx-1', signedTx: 'signed-1' };
    chain.config.broadcastBehavior = 'fail';
    chain.config.broadcastError = new Error('connection refused');

    await expect(
      service.anchorDocument('doc-1', 1, { a: 1 }),
    ).rejects.toMatchObject({ code: 'broadcast_failed' });

    const row = await repo.findByDocumentAndVersion('doc-1', 1);
    expect(row!.status).toBe('failed');
    expect(row!.failureReason).toBeTruthy();
  });
});

describe('verify', () => {
  it('returns match=true with proof fields when content matches and anchor is confirmed', async () => {
    const { chain, service, worker } = makeSetup();
    chain.config.prepareResult = { txId: 'tx-verify', signedTx: 'signed-verify' };
    chain.config.broadcastBehavior = 'success';
    chain.config.receipts.set('tx-verify', {
      blockNumber: 100n,
      blockHash: '0xblockhash',
      status: 'success',
    });

    const content = { patient: 'John', score: 95 };
    await service.anchorDocument('doc-1', 1, content);
    await worker.tick(); // confirm

    const result = await service.verify('doc-1', 1, content);
    expect(result.match).toBe(true);
    expect(result.txId).toBe('tx-verify');
    expect(result.blockNumber).toBe(100n);
  });

  it('returns match=false with both hashes when content differs', async () => {
    const { chain, service } = makeSetup();
    chain.config.prepareResult = { txId: 'tx-1', signedTx: 'signed-1' };
    chain.config.broadcastBehavior = 'success';

    const original = { patient: 'John', score: 95 };
    await service.anchorDocument('doc-1', 1, original);

    const tampered = { patient: 'John', score: 99 };
    const result = await service.verify('doc-1', 1, tampered);

    expect(result.match).toBe(false);
    expect(result.contentHash).toBe(canonicalize(tampered));
    expect(result.anchoredHash).toBe(canonicalize(original));
    expect(result.contentHash).not.toBe(result.anchoredHash);
  });

  it('throws resource_not_found when no anchor exists for the given document/version', async () => {
    const { service } = makeSetup();

    await expect(
      service.verify('nonexistent-doc', 1, { a: 1 }),
    ).rejects.toMatchObject({ code: 'resource_not_found' });
  });
});

describe('recovery sweep (resolvePending)', () => {
  it('confirms a pending row when the chain already has a receipt (crash after broadcast, before status update)', async () => {
    const { repo, chain, worker } = makeSetup();

    // Simulate the row that was persisted before broadcast; crash happened after
    // broadcast but before markBroadcast was called.
    await repo.create({
      documentId: 'doc-1',
      version: 1,
      contentHash: canonicalize({ a: 1 }),
      txId: 'tx-crashed',
      signedTx: 'signed-crashed',
    });

    // The chain has the receipt — the broadcast did go through.
    chain.config.receipts.set('tx-crashed', {
      blockNumber: 42n,
      blockHash: '0xdeadbeef',
      status: 'success',
    });

    await worker.tick();

    const row = await repo.findByDocumentAndVersion('doc-1', 1);
    expect(row!.status).toBe('confirmed');
    expect(row!.blockNumber).toBe(42n);
    expect(row!.blockHash).toBe('0xdeadbeef');
  });

  it('re-broadcasts a pending row when no receipt exists (crash before broadcast)', async () => {
    const { repo, chain, worker } = makeSetup();

    await repo.create({
      documentId: 'doc-1',
      version: 1,
      contentHash: canonicalize({ a: 1 }),
      txId: 'tx-never-sent',
      signedTx: 'signed-never-sent',
    });

    // No receipt on-chain; broadcast will succeed this time.
    chain.config.receipts.set('tx-never-sent', null);
    chain.config.broadcastBehavior = 'success';

    await worker.tick();

    const row = await repo.findByDocumentAndVersion('doc-1', 1);
    expect(row!.status).toBe('broadcast');
  });
});

describe('confirmation worker (confirmBroadcast)', () => {
  it('confirms a broadcast row once the receipt becomes available', async () => {
    const { repo, chain, worker } = makeSetup();

    const created = await repo.create({
      documentId: 'doc-1',
      version: 1,
      contentHash: canonicalize({ a: 1 }),
      txId: 'tx-bc',
      signedTx: 'signed-bc',
    });
    await repo.markBroadcast(created.id);

    chain.config.receipts.set('tx-bc', {
      blockNumber: 77n,
      blockHash: '0xabc',
      status: 'success',
    });

    await worker.tick();

    const row = await repo.findByDocumentAndVersion('doc-1', 1);
    expect(row!.status).toBe('confirmed');
    expect(row!.blockNumber).toBe(77n);
    expect(row!.blockHash).toBe('0xabc');
  });

  it('leaves a broadcast row unchanged when the receipt is not yet available', async () => {
    const { repo, chain, worker } = makeSetup();

    const created = await repo.create({
      documentId: 'doc-1',
      version: 1,
      contentHash: canonicalize({ a: 1 }),
      txId: 'tx-pending-receipt',
      signedTx: 'signed-pending',
    });
    await repo.markBroadcast(created.id);

    // No receipt yet.
    chain.config.receipts.set('tx-pending-receipt', null);

    await worker.tick();

    const row = await repo.findByDocumentAndVersion('doc-1', 1);
    expect(row!.status).toBe('broadcast');
  });
});
