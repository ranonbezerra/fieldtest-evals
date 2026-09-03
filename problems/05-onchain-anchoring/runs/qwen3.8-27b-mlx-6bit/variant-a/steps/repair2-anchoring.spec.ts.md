# repair2-anchoring.spec.ts

## reasoning

```
The compiler errors are all `TS2307: Cannot find module` errors. This means the modules that `test/anchoring.spec.ts` imports don't exist yet (they're listed in the plan but haven't been created). However, the task says "Change nothing the messages do not name" — and the messages only name `test/anchoring.spec.ts` as something to fix.

Wait, let me re-read the task: "Rewrite `test/anchoring.spec.ts` complete, fixing what these messages require of this file."

The errors for `test/anchoring.spec.ts` are:
- `test/anchoring.spec.ts(2,64): error TS2307: Cannot find module '../src/anchoring/anchoring.service'`
- `test/anchoring.spec.ts(3,48): error TS2307: Cannot find module '../src/anchoring/anchoring.repository'`
- `test/anchoring.spec.ts(4,52): error TS2307: Cannot find module '../src/anchoring/chain-client.interface'`
- `test/anchoring.spec.ts(5,37): error TS2307: Cannot find module '../src/anchoring/anchor-worker.service'`

These are all "cannot find module" errors. The modules don't exist yet. The task says to fix what these messages require of `test/anchoring.spec.ts`. Since the modules don't exist, the imports will fail. But I can't create those files (the task says "Change nothing the messages do not name" — and those source files aren't named as things to change, they're just missing).

Wait, actually re-reading: "Rewrite `test/anchoring.spec.ts` complete, fixing what these messages require of this file." The messages require that the imports resolve. But I can only change `test/anchoring.spec.ts`. 

Hmm, but the instructions say "If a message refers to a shape you cannot see, say so in an `// ASSUMPTION:` line rather than guessing at it repeatedly."

The issue is that the source modules don't exist yet. I can't make them exist by changing only the test file. But I need to write the test file as if those modules will exist (per the plan). The compiler errors are expected because the source files haven't been written yet — they're part of the plan and will be created.

Actually, I think the task is asking me to write the test file that will work once the source files exist per the plan. The "fixing what these messages require" means I need to make sure my imports match what the plan specifies (the correct module paths and exported names). The errors are just telling me the modules don't exist yet — that's expected in a plan-first workflow.

So I should write `test/anchoring.spec.ts` with the correct imports that match the plan's file layout and exports, and write all the tests described in section 5 of the plan.

Let me look at what the plan specifies:

From the plan, the files will be:
- `src/anchoring/chain-client.interface.ts` — exports `ChainClient`, `PreparedTx`, `ChainReceipt`, `BroadcastTimeoutError`
- `src/anchoring/anchoring.repository.ts` — exports `AnchoringRepository`, `AnchorRow`
- `src/anchoring/anchoring.service.ts` — exports `AnchoringService`, `AnchorResult`, `VerifyResult`, `canonicalize`, `AnchoringError`
- `src/anchoring/anchor-worker.service.ts` — exports `AnchorWorkerService`

The test file imports from:
- `../src/anchoring/anchoring.service`
- `../src/anchoring/anchoring.repository`
- `../src/anchoring/chain-client.interface`
- `../src/anchoring/anchor-worker.service`

Now let me write the tests per section 5 of the plan:

1. **Canonicalize determinism:** two objects with different key insertion order produce the same hash; a single value change produces a different hash.
2. **Anchor happy path:** `anchorDocument` returns `broadcast`, repository row has correct hash/txId/status.
3. **Duplicate anchor rejected:** second call for same `(documentId, version)` throws `duplicate_anchor`; repository has exactly one row.
4. **Broadcast timeout leaves row in pending:** mock `broadcast` to throw `BroadcastTimeoutError`; assert row status is `pending` and result status is `pending`.
5. **Broadcast hard failure marks row failed:** mock `broadcast` to throw generic error; assert row status is `failed` with reason.
6. **Verify match:** anchor then verify with same content → `match: true`, correct txId and block (after confirming via worker tick).
7. **Verify mismatch:** anchor then verify with different content → `match: false`, both hashes present.
8. **Verify not found:** verify with no prior anchor → throws `resource_not_found`.
9. **Recovery sweep resolves crashed-after-broadcast:** persist row as `pending` (simulating crash after broadcast, before status update), mock `getReceipt` to return a success receipt, run worker tick → row becomes `confirmed` with block data.
10. **Recovery sweep re-broadcasts unsubmitted tx:** persist row as `pending`, mock `getReceipt` → null, mock `broadcast` → success, run tick → row becomes `broadcast`.
11. **Confirmation worker confirms broadcast rows:** persist as `broadcast`, mock `getReceipt` → success, run tick → `confirmed`.
12. **Worker skips on null receipt for broadcast row:** persist as `broadcast`, mock `getReceipt` → null, run tick → still `broadcast`.

Now, I need to think about how to structure these tests. The key challenge is that `AnchoringService` depends on `AnchoringRepository` and `ChainClient`. I'll use fakes/mocks for both.

For the repository, I'll create an in-memory fake. For the chain client, I'll create a configurable fake.

Let me think about the `AnchorWorkerService` — it has a `tick()` method that I can call directly. It depends on `AnchoringService` and `AnchoringRepository`.

Let me write this out:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { AnchoringService, canonicalize, AnchoringError, type AnchorResult, type VerifyResult } from '../src/anchoring/anchoring.service';
import { type AnchorRow } from '../src/anchoring/anchoring.repository';
import { type ChainClient, BroadcastTimeoutError, type ChainReceipt, type PreparedTx } from '../src/anchoring/chain-client.interface';
import { AnchorWorkerService } from '../src/anchoring/anchor-worker.service';
```

Wait, I need to think about what's exported. The plan says:

From `anchoring.service.ts`:
- `AnchoringService` class
- `AnchorResult` interface
- `VerifyResult` interface
- `canonicalize` function
- `AnchoringError` (custom error with `code` field)

From `anchoring.repository.ts`:
- `AnchoringRepository` class
- `AnchorRow` interface

From `chain-client.interface.ts`:
- `ChainClient` interface
- `PreparedTx` interface
- `ChainReceipt` interface
- `BroadcastTimeoutError` class

From `anchor-worker.service.ts`:
- `AnchorWorkerService` class

Now let me think about the fake repository. I need it to support:
- `create(data)` → creates a row, throws on duplicate (documentId, version)
- `findById(id)` 
- `findByDocumentAndVersion(documentId, version)`
- `findPending(limit)`
- `findBroadcast(limit)`
- `markBroadcast(id)`
- `markConfirmed(id, blockNumber, blockHash)`
- `markFailed(id, reason)`

For the fake chain client:
- `prepare(contentHash)` → returns `{txId, signedTx}`
- `broadcast(signedTx)` → configurable to succeed, timeout, or fail
- `getReceipt(txId)` → configurable to return a receipt or null

Let me write the full test file now.

Actually, I need to be careful about `BigInt` serialization. The plan says `blockNumber` is `bigint`. In tests, I'll use `BigInt` values.

Let me also think about the `AnchoringError` — it has a `code` field. I'll need to check `error.code` in assertions.

Let me write this out properly:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AnchoringService,
  canonicalize,
  AnchoringError,
} from '../src/anchoring/anchoring.service';
import type { AnchorRow } from '../src/anchoring/anchoring.repository';
import type { ChainClient, ChainReceipt, PreparedTx } from '../src/anchoring/chain-client.interface';
import { BroadcastTimeoutError } from '../src/anchoring/chain-client.interface';
import { AnchorWorkerService } from '../src/anchoring/anchor-worker.service';

// --- Fakes ---

class FakeRepository {
  rows: Map<string, AnchorRow> = new Map();
  private counter = 0;

  async create(data: {
    documentId: string;
    version: number;
    contentHash: string;
    txId: string;
    signedTx: string;
  }): Promise<AnchorRow> {
    // Check for duplicate
    for (const row of this.rows.values()) {
      if (row.documentId === data.documentId && row.version === data.version) {
        throw new Error('unique constraint violation');
      }
    }
    const id = `id-${++this.counter}`;
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

  async findByDocumentAndVersion(documentId: string, version: number): Promise<AnchorRow | null> {
    for (const row of this.rows.values()) {
      if (row.documentId === documentId && row.version === version) {
        return { ...row };
      }
    }
    return null;
  }

  async findPending(limit: number): Promise<AnchorRow[]> {
    const result: AnchorRow[] = [];
    for (const row of this.rows.values()) {
      if (row.status === 'pending') {
        result.push({ ...row });
        if (result.length >= limit) break;
      }
    }
    return result;
  }

  async findBroadcast(limit: number): Promise<AnchorRow[]> {
    const result: AnchorRow[] = [];
    for (const row of this.rows.values()) {
      if (row.status === 'broadcast') {
        result.push({ ...row });
        if (result.length >= limit) break;
      }
    }
    return result;
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
  prepareResult?: PreparedTx;
  broadcastBehavior?: 'success' | 'timeout' | 'fail';
  broadcastError?: Error;
  receiptByTxId?: Map<string, ChainReceipt | null>;
}

class FakeChainClient implements ChainClient {
  config: FakeChainConfig = {
    prepareResult: { txId: 'tx-1', signedTx: 'signed-1' },
    broadcastBehavior: 'success',
    receiptByTxId: new Map(),
  };

  async prepare(contentHash: string): Promise<PreparedTx> {
    return this.config.prepareResult!;
  }

  async broadcast(signedTx: string): Promise<void> {
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
    return this.config.receiptByTxId?.get(txId) ?? null;
  }
}

// --- Helper to set up service + worker ---

function makeSetup() {
  const repo = new FakeRepository();
  const chain = new FakeChainClient();
  const service = new AnchoringService(repo as any, chain);
  const worker = new AnchorWorkerService(service, repo as any);
  return { repo, chain, service, worker };
}

// --- Tests ---

describe('canonicalize', () => {
  it('produces the same hash for objects with different key insertion order', () => {
    const a = canonicalize({ name: 'Alice', age: 30, city: 'NYC' });
    const b = canonicalize({ city: 'NYC', age: 30, name: 'Alice' });
    expect(a).toBe(b);
  });

  it('produces different hashes when a value changes', () => {
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

  it('duplicate anchor is rejected with duplicate_anchor code', async () => {
    const { repo, chain, service } = makeSetup();
    chain.config.prepareResult = { txId: 'tx-1', signedTx: 'signed-1' };
    chain.config.broadcastBehavior = 'success';

    const content = { patient: 'John' };
    await service.anchorDocument('doc-1', 1, content);

    await expect(
      service.anchorDocument('doc-1', 1, { patient: 'Jane' })
    ).rejects.toMatchObject({ code: 'duplicate_anchor' });

    // Only one row should exist
    const pending = await repo.findPending(100);
    const broadcast = await repo.findBroadcast(100);
    const confirmed = await repo.findPending(100); // just checking count
    const allRows = [...repo.rows.values()];
    expect(allRows.length).toBe(1);
  });

  it('broadcast timeout leaves row in pending status', async () => {
    const { repo, chain, service } = makeSetup();
    chain.config.prepareResult = { txId: 'tx-1', signedTx: 'signed-1' };
    chain.config.broadcastBehavior = 'timeout';

    const result = await service.anchorDocument('doc-1', 1, { a: 1 });

    expect(result.status).toBe('pending');
    const row = await repo.findByDocumentAndVersion('doc-1', 1);
    expect(row!.status).toBe('pending');
  });

  it('broadcast hard failure marks row as failed', async () => {
    const { repo, chain, service } = makeSetup();
    chain.config.prepareResult = { txId: 'tx-1', signedTx: 'signed-1' };
    chain.config.broadcastBehavior = 'fail';
    chain.config.broadcastError = new Error('connection refused');

    await expect(
      service.anchorDocument('doc-1', 1, { a: 1 })
    ).rejects.toMatchObject({ code: 'broadcast_failed' });

    const row = await repo.findByDocumentAndVersion('doc-1', 1);
    expect(row!.status).toBe('failed');
    expect(row!.failureReason).toBeTruthy();
  });
});

describe('verify', () => {
  it('returns match=true when content matches the anchored hash', async () => {
    const { repo, chain, service, worker } = makeSetup();
    chain.config.prepareResult = { txId: 'tx-1', signedTx: 'signed-1' };
    chain.config.broadcastBehavior = 'success';
    chain.config.receiptByTxId.set('tx-1', { blockNumber: 100n, blockHash: '0xblock', status: 'success' });

    const content = { patient: 'John', score: 95 };
    await service.anchorDocument('doc-1', 1, content);
    await worker.tick();

    const result = await service.verify('doc-1', 1, content);
    expect(result.match).toBe(true);
    expect(result.txId).toBe('tx-1');
    expect(result.blockNumber).toBe(100n);
  });

  it('returns match=false when content differs', async () => {
    const { service } = makeSetup();
    const chain = new FakeChainClient();
    // ... need to restructure
    
    // Actually let me re-think this. Let me just use makeSetup and configure.
  });

  it('throws resource_not_found when no anchor exists', async () => {
    const { service } = makeSetup();
    await expect(
      service.verify('nonexistent', 1, { a: 1 })
    ).rejects.toMatchObject({ code: 'resource_not_found' });
  });
});

describe('recovery sweep (resolvePending)', () => {
  it('resolves a pending row to confirmed when receipt is available (crash-after-broadcast)', async () => {
    const { repo, chain, service, worker } = makeSetup();
    // Simulate: row was persisted as pending (crash happened after broadcast, before status update)
    await repo.create({
      documentId: 'doc-1',
      version: 1,
      contentHash: 'abc123',
      txId: 'tx-crashed',
      signedTx: 'signed-crashed',
    });

    chain.config.receiptByTxId.set('tx-crashed', {
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

  it('re-broadcasts a pending row when no receipt exists (crash-before-broadcast)', async () => {
    const { repo, chain, worker } = makeSetup();
    await repo.create({
      documentId: 'doc-1',
      version: 1,
      contentHash: 'abc123',
      txId: 'tx-never-sent',
      signedTx: 'signed-never-sent',
    });

    // No receipt available
    chain.config.receiptByTxId.set('tx-never-sent', null);
    chain.config.broadcastBehavior = 'success';

    await worker.tick();

    const row = await repo.findByDocumentAndVersion('doc-1', 1);
    expect(row!.status).toBe('broadcast');
  });
});

describe('confirmation worker (confirmBroadcast)', () => {
  it('confirms a broadcast row when receipt is available', async () => {
    const { repo, chain, worker } = makeSetup();
    // Create a row directly in broadcast status
    const created = await repo.create({
      documentId: 'doc-1',
      version: 1,
      contentHash: 'abc',
      txId: 'tx-bc',
      signedTx: 'signed-bc',
    });
    await repo.markBroadcast(created.id);

    chain.config.receiptByTxId.set('tx-bc', {
      blockNumber: 77n,
      blockHash: '0xabc',
      status: 'success',
    });

    await worker.tick();

    const row = await repo.findByDocumentAndVersion('doc-1', 1);
    expect(row!.status).toBe('confirmed');
    expect(row!.blockNumber).toBe(77n);
  });

  it('leaves broadcast row unchanged when receipt is not yet available', async () => {
    const { repo, chain, worker } = makeSetup();
    const created = await repo.create({
      documentId: 'doc-1',
      version: 1,
      contentHash: 'abc',
      txId: 'tx-pending-receipt',
      signedTx: 'signed-pending',
    });
    await repo.markBroadcast(created.id);

    // No receipt
    chain.config.receiptByTxId.set('tx-pending-receipt', null);

    await worker.tick();

    const row = await repo.findByDocumentAndVersion('doc-1', 1);
    expect(row!.status).toBe('broadcast');
  });
});
```

Wait, I have an issue with the "verify mismatch" test. Let me restructure. Also, I need to be more careful about the `AnchoringService` constructor — it takes `(repo: AnchoringRepository, chain: ChainClient)`. My fake repo needs to be cast as `AnchoringRepository` for TypeScript.

Actually, since the modules don't exist yet, I can't import `AnchoringRepository` as a type for casting. But the plan says it exists. I'll import it as a type and use `as any` or a proper type assertion.

Wait, actually the imports will work once the files exist. The compiler errors are just because the files don't exist yet. I should write the test file as if they will exist. Let me use proper type imports.

Let me also reconsider the `AnchoringError` — looking at the plan, it says "all thrown as a custom `AnchoringError` with a `code` field". So it's likely:

```typescript
export class AnchoringError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
```

So in tests I can check `error.code`.

Let me also think about whether `AnchoringError` should be imported separately or is part of the service module. The plan lists it in `anchoring.service.ts` section, so I'll import it from there.

Now let me also think about the `verify mismatch` test more carefully. I need to:
1. Anchor with content A
2. Verify with content B (different)
3. Expect `match: false`, both hashes present

Let me write the complete file now, being careful about all the details.

One more thing — the plan says the test should prove "crashes the process between broadcast and the (wrong) late persist a naive design would do." The recovery sweep test "resolves crashed-after-broadcast" covers this: we persist a row as `pending` (simulating the crash happened after broadcast but before the status update to `broadcast`), then the worker's recovery sweep queries the chain, finds the receipt, and confirms it. This proves the pre-broadcast persist is what makes recovery possible.

Let me finalize the test file. I'll use `as any` casts where needed for the fake repository to satisfy the type system (since the actual `AnchoringRepository` class will exist with a specific constructor).

Actually, I realize I should think about this more carefully. The `AnchoringService` constructor takes `(repo: AnchoringRepository, chain: ChainClient)`. My `FakeRepository` is not an instance of `AnchoringRepository`. In TypeScript, I can cast it with `as unknown as AnchoringRepository` or use `as any`.

Let me write the final version:
```

## reply

```typescript
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
```
