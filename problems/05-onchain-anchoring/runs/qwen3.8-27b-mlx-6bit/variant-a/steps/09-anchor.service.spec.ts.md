# 09-anchor.service.spec.ts

## reply

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { AnchorService, ResourceNotFoundError } from '../src/anchor/anchor.service';
import { AnchorRepository, DuplicateAnchorError } from '../src/anchor/anchor.repository';
import { FakeChainClient } from '../src/anchor/chain';
import type { AnchorTx, Receipt } from '../src/anchor/chain';
import { hashContent, CanonicalizationError } from '../src/anchor/canonical';

interface Row {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  content: string;
  txId: string | null;
  state: 'pending' | 'broadcasting' | 'confirmed' | 'failed';
  blockNumber: number | null;
}

class InMemoryAnchorRepository extends AnchorRepository {
  private rows: Row[] = [];
  private nextId = 1;

  constructor() {
    super({} as PrismaClient);
  }

  async create(input: {
    documentId: string;
    version: number;
    contentHash: string;
    content: string;
    txId: string | null;
    state: 'pending' | 'broadcasting' | 'confirmed' | 'failed';
  }): Promise<Row> {
    const existing = this.rows.find(
      (r) => r.documentId === input.documentId && r.version === input.version,
    );
    if (existing) {
      throw new DuplicateAnchorError(
        `Anchor already exists for document ${input.documentId} version ${input.version}`,
      );
    }
    const row: Row = {
      id: `row-${this.nextId++}`,
      documentId: input.documentId,
      version: input.version,
      contentHash: input.contentHash,
      content: input.content,
      txId: input.txId,
      state: input.state,
      blockNumber: null,
    };
    this.rows.push(row);
    return { ...row };
  }

  async findUnique(documentId: string, version: number): Promise<Row | null> {
    const row = this.rows.find(
      (r) => r.documentId === documentId && r.version === version,
    );
    return row ? { ...row } : null;
  }

  async findByState(state: 'pending' | 'broadcasting' | 'confirmed' | 'failed'): Promise<Row[]> {
    return this.rows.filter((r) => r.state === state).map((r) => ({ ...r }));
  }

  async updateState(
    id: string,
    patch: {
      state?: 'pending' | 'broadcasting' | 'confirmed' | 'failed';
      txId?: string;
      blockNumber?: number | null;
    },
  ): Promise<Row> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) {
      throw new Error(`Row ${id} not found`);
    }
    if (patch.state !== undefined) {
      row.state = patch.state;
    }
    if (patch.txId !== undefined) {
      row.txId = patch.txId;
    }
    if (patch.blockNumber !== undefined) {
      row.blockNumber = patch.blockNumber;
    }
    return { ...row };
  }

  // Test helpers (not part of the repository contract used by the service).
  seedRow(partial: Partial<Row> & { documentId: string; version: number }): Row {
    const row: Row = {
      id: `row-${this.nextId++}`,
      contentHash: partial.contentHash ?? '',
      content: partial.content ?? '',
      txId: partial.txId ?? null,
      state: partial.state ?? 'pending',
      blockNumber: partial.blockNumber ?? null,
      ...partial,
    } as Row;
    this.rows.push(row);
    return { ...row };
  }

  allRows(): Row[] {
    return this.rows.map((r) => ({ ...r }));
  }

  rowFor(documentId: string, version: number): Row | null {
    return this.findUnique(documentId, version);
  }
}

function deriveTxId(documentId: string, version: number, contentHash: string): string {
  const tx: AnchorTx = { documentId, version, contentHash };
  return hashContent(tx);
}

function receiptFor(documentId: string, version: number, contentHash: string, blockNumber: number): Receipt {
  const txId = deriveTxId(documentId, version, contentHash);
  return { found: true, txId, blockNumber };
}

describe('AnchorService', () => {
  let repo: InMemoryAnchorRepository;
  let chain: FakeChainClient;
  let service: AnchorService;

  beforeEach(() => {
    repo = new InMemoryAnchorRepository();
    chain = new FakeChainClient({ receipts: {} });
    service = new AnchorService(repo, chain);
  });

  it('anchorDocument persists the tx identity before broadcast', async () => {
    const content = { a: 1, b: 'x' };
    const contentHash = hashContent(content);

    let observedStateDuringBroadcast: { state: string; txId: string | null } | null = null;
    const spyChain = {
      prepare: (tx: AnchorTx) => chain.prepare(tx),
      broadcast: async (_signedTx: string) => {
        const row = await repo.findUnique('doc-1', 1);
        observedStateDuringBroadcast = row
          ? { state: row.state, txId: row.txId }
          : null;
        throw new Error('broadcast timed out; outcome unknown');
      },
      getReceipt: (txId: string) => chain.getReceipt(txId),
    };
    const spyService = new AnchorService(repo, spyChain);

    await expect(spyService.anchorDocument('doc-1', 1, content)).resolves.toBeTruthy();

    expect(observedStateDuringBroadcast).not.toBeNull();
    expect(observedStateDuringBroadcast?.state).toBe('broadcasting');
    expect(observedStateDuringBroadcast?.txId).toBe(deriveTxId('doc-1', 1, contentHash));
  });

  it('anchorDocument broadcast timeout leaves the row in broadcasting limbo (not failed, not confirmed)', async () => {
    const content = { a: 1 };
    chain = new FakeChainClient({ broadcastFails: true, receipts: {} });
    service = new AnchorService(repo, chain);

    await expect(service.anchorDocument('doc-1', 1, content)).resolves.toBeTruthy();

    const row = await repo.findUnique('doc-1', 1);
    expect(row).not.toBeNull();
    expect(row?.state).toBe('broadcasting');
    expect(row?.txId).not.toBeNull();
  });

  it('anchorDocument persists the canonical content with a matching hash', async () => {
    const content = { a: 1, b: 'x' };
    const contentHash = hashContent(content);

    await service.anchorDocument('doc-1', 1, content);

    const row = await repo.findUnique('doc-1', 1);
    expect(row).not.toBeNull();
    expect(row?.contentHash).toBe(contentHash);
    expect(JSON.parse(row!.content)).toEqual(content);

    const result = await service.verify('doc-1', 1, content);
    expect(result.ok).toBe(true);
  });

  it('anchorDocument returns a proof with the correct identity fields', async () => {
    const content = { a: 1, b: 'x' };
    const contentHash = hashContent(content);
    const expectedTxId = deriveTxId('doc-1', 1, contentHash);

    const proof = await service.anchorDocument('doc-1', 1, content);

    expect(proof.documentId).toBe('doc-1');
    expect(proof.version).toBe(1);
    expect(proof.contentHash).toBe(contentHash);
    expect(proof.txId).toBe(expectedTxId);
  });

  it('anchorDocument returns blockNumber 0 for an anchor not yet confirmed', async () => {
    const content = { a: 1 };

    const proof = await service.anchorDocument('doc-1', 1, content);

    expect(proof.blockNumber).toBe(0);
  });

  it('anchorDocument rejects an already-anchored pair with DuplicateAnchorError and does not broadcast', async () => {
    const content = { a: 1 };
    await service.anchorDocument('doc-1', 1, content);

    const rowCountBefore = repo.allRows().length;
    await expect(service.anchorDocument('doc-1', 1, content)).rejects.toBeInstanceOf(
      DuplicateAnchorError,
    );
    expect(repo.allRows().length).toBe(rowCountBefore);
  });

  it('anchorDocument rejects non-serializable content with CanonicalizationError and persists nothing', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(service.anchorDocument('doc-1', 1, circular)).rejects.toBeInstanceOf(
      CanonicalizationError,
    );
    expect(repo.allRows().length).toBe(0);
  });

  it('concurrent anchorDocument calls for one pair yield exactly one row', async () => {
    const content = { a: 1 };

    const results = await Promise.allSettled([
      service.anchorDocument('doc-1', 1, content),
      service.anchorDocument('doc-1', 1, content),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const rejections = results.filter((r) => r.status === 'rejected');
    expect(successes.length).toBe(1);
    expect(rejections.length).toBe(1);
    expect((rejections[0] as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateAnchorError);
    expect(repo.allRows().length).toBe(1);
  });

  it('crash between broadcast and late persist loses no anchor: recovery confirms from the chain without a second row', async () => {
    const content = { a: 1 };
    const contentHash = hashContent(content);
    const txId = deriveTxId('doc-1', 1, contentHash);

    chain = new FakeChainClient({
      broadcastFails: true,
      receipts: { [txId]: { found: true, txId, blockNumber: 42 } },
    });
    service = new AnchorService(repo, chain);

    await service.anchorDocument('doc-1', 1, content);
    expect(repo.allRows().length).toBe(1);

    const resolved = await service.runRecoverySweep();
    expect(resolved).toBe(1);

    const rows = repo.allRows();
    expect(rows.length).toBe(1);
    expect(rows[0].state).toBe('confirmed');
    expect(rows[0].blockNumber).toBe(42);
    expect(rows[0].txId).toBe(txId);
  });

  it('recovery re-broadcasts when the chain has no record of the tx', async () => {
    const content = { a: 1 };
    const contentHash = hashContent(content);
    const txId = deriveTxId('doc-1', 1, contentHash);

    chain = new FakeChainClient({ receipts: {} });
    service = new AnchorService(repo, chain);

    await service.anchorDocument('doc-1', 1, content);

    const resolved = await service.runRecoverySweep();
    expect(resolved).toBe(1);

    const row = await repo.findUnique('doc-1', 1);
    expect(row?.state).toBe('broadcasting');
    expect(row?.txId).toBe(txId);
  });

  it('recovery leaves the row broadcasting when a receipt exists but has no block yet', async () => {
    const content = { a: 1 };
    const contentHash = hashContent(content);
    const txId = deriveTxId('doc-1', 1, contentHash);

    chain = new FakeChainClient({
      receipts: { [txId]: { found: true, txId, blockNumber: null } },
    });
    service = new AnchorService(repo, chain);

    await service.anchorDocument('doc-1', 1, content);

    const resolved = await service.runRecoverySweep();
    expect(resolved).toBe(0);

    const row = await repo.findUnique('doc-1', 1);
    expect(row?.state).toBe('broadcasting');
    expect(row?.txId).toBe(txId);
  });

  it('recovery marks the row failed when re-broadcast rejects and no receipt exists', async () => {
    const content = { a: 1 };

    chain = new FakeChainClient({ broadcastFails: true, receipts: {} });
    service = new AnchorService(repo, chain);

    await service.anchorDocument('doc-1', 1, content);

    const resolved = await service.runRecoverySweep();
    expect(resolved).toBe(0);

    const row = await repo.findUnique('doc-1', 1);
    expect(row?.state).toBe('failed');
  });

  it('recovery skips a row whose stored txId does not match the re-derived one', async () => {
    const content = { a: 1 };
    const contentHash = hashContent(content);
    const derivedTxId = deriveTxId('doc-1', 1, contentHash);

    chain = new FakeChainClient({
      receipts: { [derivedTxId]: { found: true, txId: derivedTxId, blockNumber: 7 } },
    });
    service = new AnchorService(repo, chain);

    const row = repo.seedRow({
      documentId: 'doc-1',
      version: 1,
      contentHash,
      content: JSON.stringify(content),
      txId: 'tampered-tx-id',
      state: 'broadcasting',
    });

    const resolved = await service.runRecoverySweep();
    expect(resolved).toBe(0);

    const after = await repo.findUnique('doc-1', 1);
    expect(after?.id).toBe(row.id);
    expect(after?.state).toBe('broadcasting');
    expect(after?.txId).toBe('tampered-tx-id');
  });

  it('recovery is idempotent across passes', async () => {
    const content = { a: 1 };
    const contentHash = hashContent(content);
    const txId = deriveTxId('doc-1', 1, contentHash);

    chain = new FakeChainClient({
      receipts: { [txId]: { found: true, txId, blockNumber: 99 } },
    });
    service = new AnchorService(repo, chain);

    await service.anchorDocument('doc-1', 1, content);

    const first = await service.runRecoverySweep();
    expect(first).toBe(1);

    const second = await service.runRecoverySweep();
    expect(second).toBe(0);

    const row = await repo.findUnique('doc-1', 1);
    expect(row?.state).toBe('confirmed');
    expect(row?.blockNumber).toBe(99);
  });

  it('confirmation pass confirms a broadcasting row with the receipt\'s block number', async () => {
    const content = { a: 1 };
    const contentHash = hashContent(content);

    chain = new FakeChainClient({
      receipts: { [deriveTxId('doc-1', 1, contentHash)]: receiptFor('doc-1', 1, contentHash, 55) },
    });
    service = new AnchorService(repo, chain);

    await service.anchorDocument('doc-1', 1, content);

    const confirmed = await service.runConfirmationPass();
    expect(confirmed).toBe(1);

    const row = await repo.findUnique('doc-1', 1);
    expect(row?.state).toBe('confirmed');
    expect(row?.blockNumber).toBe(55);
  });

  it('confirmation pass leaves the row unchanged when no receipt exists yet', async () => {
    const content = { a: 1 };
    const contentHash = hashContent(content);
    const txId = deriveTxId('doc-1', 1, contentHash);

    chain = new FakeChainClient({ receipts: {} });
    service = new AnchorService(repo, chain);

    await service.anchorDocument('doc-1', 1, content);

    const confirmed = await service.runConfirmationPass();
    expect(confirmed).toBe(0);

    const row = await repo.findUnique('doc-1', 1);
    expect(row?.state).toBe('broadcasting');
    expect(row?.txId).toBe(txId);
  });

  it('confirmation pass skips rows without a txId', async () => {
    const content = { a: 1 };
    const contentHash = hashContent(content);

    let receiptQueries = 0;
    const spyChain = {
      prepare: (tx: AnchorTx) => chain.prepare(tx),
      broadcast: async (_signedTx: string) => {},
      getReceipt: (txId: string) => {
        receiptQueries++;
        return chain.getReceipt(txId);
      },
    };
    service = new AnchorService(repo, spyChain);

    await service.anchorDocument('doc-1', 1, content);
    await repo.updateState((await repo.findUnique('doc-1', 1))!.id, { txId: null });

    const confirmed = await service.runConfirmationPass();
    expect(confirmed).toBe(0);
    expect(receiptQueries).toBe(0);

    const row = await repo.findUnique('doc-1', 1);
    expect(row?.state).toBe('broadcasting');
    expect(row?.txId).toBeNull();
  });

  it('verify returns the proof for matching content', async () => {
    const content = { a: 1 };
    const contentHash = hashContent(content);
    const txId = deriveTxId('doc-1', 1, contentHash);

    chain = new FakeChainClient({
      receipts: { [txId]: { found: true, txId, blockNumber: 10 } },
    });
    service = new AnchorService(repo, chain);

    await service.anchorDocument('doc-1', 1, content);
    await service.runConfirmationPass();

    const result = await service.verify('doc-1', 1, content);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proof.txId).toBe(txId);
      expect(result.proof.blockNumber).toBe(10);
      expect(result.proof.contentHash).toBe(contentHash);
    }
  });

  it('verify returns a mismatch report (not an error) for different content', async () => {
    const original = { a: 1 };
    const different = { a: 2 };
    const expectedHash = hashContent(original);
    const providedHash = hashContent(different);

    await service.anchorDocument('doc-1', 1, original);

    const result = await service.verify('doc-1', 1, different);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.mismatch.expectedHash).toBe(expectedHash);
      expect(result.mismatch.providedHash).toBe(providedHash);
    }
  });

  it('verify raises ResourceNotFoundError when no anchor exists for the pair', async () => {
    const content = { a: 1 };

    await expect(service.verify('nope', 1, content)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    expect(repo.allRows().length).toBe(0);
  });

  it('verify raises CanonicalizationError on non-serializable content before any lookup', async () => {
    const content = { a: 1 };
    await service.anchorDocument('doc-1', 1, content);

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(service.verify('doc-1', 1, circular)).rejects.toBeInstanceOf(
      CanonicalizationError,
    );

    const row = await repo.findUnique('doc-1', 1);
    expect(row?.state).toBe('broadcasting');
  });

  it('verify raises ResourceNotFoundError for an anchor that has no txId', async () => {
    const content = { a: 1 };
    const contentHash = hashContent(content);

    const row = repo.seedRow({
      documentId: 'doc-1',
      version: 1,
      contentHash,
      content: JSON.stringify(content),
      txId: null,
      state: 'broadcasting',
    });

    await expect(service.verify('doc-1', 1, content)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );

    const after = await repo.findUnique('doc-1', 1);
    expect(after?.id).toBe(row.id);
    expect(after?.txId).toBeNull();
  });
});
```
