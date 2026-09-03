# 10-anchoring.spec.ts

## reasoning

```
Let me analyze what I need to write:

1. The file is `test/anchoring.spec.ts`
2. It must contain all behavioural tests listed in section 5 of PLAN.md AND all cases from the cases.txt file
3. I need to use Vitest
4. I need to test against the service, repository (mocked), worker, and chain client (fake)

Let me look at the cases from the cases.txt file:
1. canonicalize: key insertion order does not affect the hash
2. canonicalize: a single leaf value change produces a different hash
3. canonicalize: arrays preserve positional order (not sorted)
4. anchorDocument happy path: row persisted before broadcast, status advances to 'broadcast'
5. anchorDocument: broadcast timeout leaves row in 'pending' and returns pending status
6. anchorDocument: broadcast hard failure marks row 'failed' with reason and throws broadcast_failed
7. duplicate anchor: second insert for same (documentId, version) throws duplicate_anchor
8. concurrent duplicate: two simultaneous anchorDocument calls for same (document, version), exactly one succeeds
9. verify: matching content returns match=true with proof fields (txId, blockNumber, blockHash)
10. verify: mismatched content returns match=false with both hashes present
11. verify: no anchor for (documentId, version) throws resource_not_found
12. recovery sweep: pending row with existing on-chain receipt is confirmed (crash-after-broadcast recovery)
13. recovery sweep: pending row with no receipt is re-broadcast and transitions to 'broadcast'
14. recovery sweep: pending row with on-chain failure receipt is marked 'failed'
15. recovery sweep idempotency: running tick twice for a confirmed row does not re-broadcast or corrupt state
16. confirmation worker: broadcast row with success receipt transitions to 'confirmed' with block data
17. confirmation worker: broadcast row with null receipt is a no-op (stays 'broadcast')
18. worker tick: zero pending and zero broadcast rows completes without error
19. worker tick: an exception in resolvePending for one row does not prevent processing subsequent rows
20. anchorDocument: content is empty object {} — still produces a valid hash and anchor
21. anchorDocument: version 0 is rejected (boundary below minimum positive integer)

Now let me think about the structure:

- I need a fake `ChainClient` implementation
- I need to mock `AnchoringRepository` 
- I need to instantiate `AnchoringService` with the mocks
- I need to test `AnchorWorkerService.tick()`

For the "concurrent duplicate" test, I need to simulate two simultaneous calls where both pass the check but only one insert succeeds. Since the repository is mocked, I'll have `create` succeed on first call and throw P2002 on second.

For the "version 0 is rejected" test - looking at the plan, it says the controller validates version. But the cases file says "proves the controller's input validation enforces version >= 1". However, since we're testing at the service level (not controller), I need to think about this. Wait, looking more carefully at the plan:

"Controller validates that `content` is a non-null object and `version` is a positive integer; returns 400 with the standard error envelope otherwise."

But the test file is testing service-level behavior. The cases.txt says "anchorDocument: version 0 is rejected (boundary below minimum positive integer)". This implies the service should also validate this, or we test it at the controller level.

Wait, looking at the plan more carefully - the service signature is `anchorDocument(documentId: string, version: number, content: Record<string, unknown>)`. The plan says the controller validates. But the test case says it's tested in `test/anchoring.spec.ts`.

Since I'm writing the test file and the plan says the controller validates, but the test case is in the service test... I think the most defensible reading is that the service should also validate (defense in depth), or we test it at a level where validation happens. But looking at the service code provided, there's NO validation of version in the service.

Actually, re-reading the cases.txt: "proves the controller's input validation enforces `version >= 1`". So this is a controller-level test. But the manifest says all tests are in `test/anchoring.spec.ts`. 

Looking at the plan section 5 (Tests), it doesn't explicitly list "version 0 is rejected" but the cases.txt does. Since the cases.txt says "Write every one of them", I need to include it.

The most defensible approach: since the service code as shown doesn't validate version, but the test case says it should be rejected, I'll write a test that calls `service.anchorDocument` with version 0 and expects it to be rejected. This implies the service SHOULD validate it. I'll add an `// ASSUMPTION` comment.

Wait, actually let me reconsider. The plan says "Controller validates that content is a non-null object and version is a positive integer". So the validation is in the controller. But since we're writing unit tests (not e2e), and the controller is a thin layer, maybe I should test it by instantiating the controller directly with a mocked service.

Actually, looking at the layout conventions: `test/<feature>.spec.ts` - this is a single test file for the feature. It can test multiple layers. Let me include a controller test for the version validation.

But wait - the plan says the controller "validates that `content` is a non-null object and `version` is a positive integer; returns 400 with the standard error envelope otherwise." So I can test the controller directly by instantiating it with a mocked service.

Let me think about how to structure this:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnchoringService, AnchoringError, canonicalize } from '../src/anchoring/anchoring.service';
import { AnchoringRepository, AnchorRow } from '../src/anchoring/anchoring.repository';
import { ChainClient, BroadcastTimeoutError, PreparedTx, ChainReceipt } from '../src/anchoring/chain-client.interface';
import { AnchorWorkerService } from '../src/anchoring/anchor-worker.service';
```

For the fake chain client:

```ts
class FakeChainClient implements ChainClient {
  preparedTxs: PreparedTx[] = [];
  broadcasted: string[] = [];
  receipts: Map<string, ChainReceipt> = new Map();
  broadcastError: Error | null = null;
  prepareError: Error | null = null;

  async prepare(contentHash: string): Promise<PreparedTx> {
    if (this.prepareError) throw this.prepareError;
    const txId = `tx-${contentHash.slice(0, 8)}`;
    return { txId, signedTx: `signed-${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    if (this.broadcastError) throw this.broadcastError;
    this.broadcasted.push(signedTx);
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.receipts.get(txId) ?? null;
  }
}
```

For the mocked repository, I'll use a simple in-memory implementation or vi.fn() mocks.

Let me think about the "anchorDocument happy path: row persisted before broadcast" test. The case description says "proves the intent row exists in the DB *before* the chain call returns". To prove this, I can use a spy on `repo.create` and verify it was called before `chain.broadcast`. Or I can make the fake chain client's `broadcast` method check if the row exists in the repo at that point.

Actually, a cleaner approach: make the fake `broadcast` method capture whether `repo.create` has been called (by checking a flag or the repo state). Or use `vi.fn()` and check call order.

Let me use a different approach: I'll make the fake chain client's `broadcast` method call back to check if the repo has the row. But that creates a circular dependency. 

Better: Use `vi.fn()` for the repository and check call order with `mock.invocationCallOrder`.

Actually, the simplest approach that "proves" the ordering: in the `broadcast` fake, I can assert that the repo's `create` was already called. Let me use a flag-based approach:

```ts
let createCalledBeforeBroadcast = false;
// In the fake broadcast:
createCalledBeforeBroadcast = repoCreateMock.mock.calls.length > 0;
```

Or even simpler: use `vi.fn()` for both and check `mock.invocationCallOrder`.

Let me think about the concurrent duplicate test. Two simultaneous calls - both call `prepare`, both try to `create`. The first succeeds, the second gets P2002. I'll simulate this by having `create` succeed on first call and throw P2002 on second.

For the "recovery sweep idempotency" test: "running tick twice for a confirmed row does not re-broadcast or corrupt state". This means after the first tick confirms the row, a second tick should find no pending rows (because it's now confirmed) and do nothing.

Let me now write the complete test file:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnchoringService, AnchoringError, canonicalize } from '../src/anchoring/anchoring.service';
import { AnchoringRepository, AnchorRow } from '../src/anchoring/anchoring.repository';
import { ChainClient, BroadcastTimeoutError, PreparedTx, ChainReceipt } from '../src/anchoring/chain-client.interface';
import { AnchorWorkerService } from '../src/anchoring/anchor-worker.service';
```

Wait, I need to think about the `AnchorWorkerService` constructor. It takes `AnchoringService` and `AnchoringRepository`. I'll instantiate it with the real service (which has mocked repo and chain) and a mocked repo.

Actually for the worker tests, I'll create a real `AnchoringService` with mocked repo and fake chain, then create `AnchorWorkerService` with that service and the same mocked repo.

Let me think about the repository mock more carefully. I'll create a helper that builds an `AnchorRow` and a mock repository with all methods as `vi.fn()`.

Let me draft the full file now:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnchoringService, AnchoringError, canonicalize } from '../src/anchoring/anchoring.service';
import type { AnchorRow } from '../src/anchoring/anchoring.repository';
import { AnchoringRepository } from '../src/anchoring/anchoring.repository';
import { ChainClient, BroadcastTimeoutError, type PreparedTx, type ChainReceipt } from '../src/anchoring/chain-client.interface';
import { AnchorWorkerService } from '../src/anchoring/anchor-worker.service';

// --- Helpers ---

function makeAnchorRow(overrides: Partial<AnchorRow> = {}): AnchorRow {
  return {
    id: 'anchor-1',
    documentId: 'doc-1',
    version: 1,
    contentHash: 'a'.repeat(64),
    txId: 'tx-1',
    signedTx: 'signed-tx-1',
    status: 'pending',
    blockNumber: null,
    blockHash: null,
    failureReason: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

class FakeChainClient implements ChainClient {
  broadcastError: Error | null = null;
  receipts = new Map<string, ChainReceipt>();
  broadcastCalls: string[] = [];
  prepareCallCount = 0;

  async prepare(contentHash: string): Promise<PreparedTx> {
    this.prepareCallCount++;
    const txId = `tx-${this.prepareCallCount}`;
    return { txId, signedTx: `signed-${txId}` };
  }

  async broadcast(signedTx: string): Promise<void> {
    if (this.broadcastError) throw this.broadcastError;
    this.broadcastCalls.push(signedTx);
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    return this.receipts.get(txId) ?? null;
  }
}

function makeRepoMock() {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByDocumentAndVersion: vi.fn(),
    findPending: vi.fn().mockResolvedValue([]),
    findBroadcast: vi.fn().mockResolvedValue([]),
    markBroadcast: vi.fn().mockResolvedValue(undefined),
    markConfirmed: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  } as unknown as AnchoringRepository & { [k: string]: ReturnType<typeof vi.fn> };
}

function makeService(repo: AnchoringRepository, chain: ChainClient): AnchoringService {
  return new AnchoringService(repo as any, chain);
}

// --- Tests ---

describe('canonicalize', () => {
  it('key insertion order does not affect the hash', () => {
    const a = { x: 1, y: { b: 2, a: 3 }, z: [1, 2] };
    const b = { z: [1, 2], y: { a: 3, b: 2 }, x: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('a single leaf value change produces a different hash', () => {
    const a = { x: 1, y: 2 };
    const b = { x: 1, y: 3 };
    expect(canonicalize(a)).not.toBe(canonicalize(b));
  });

  it('arrays preserve positional order (not sorted)', () => {
    const a = { list: [1, 2, 3] };
    const b = { list: [3, 2, 1] };
    expect(canonicalize(a)).not.toBe(canonicalize(b));
  });
});

describe('anchorDocument', () => {
  let repo: ReturnType<typeof makeRepoMock>;
  let chain: FakeChainClient;
  let service: AnchoringService;

  beforeEach(() => {
    repo = makeRepoMock();
    chain = new FakeChainClient();
    service = makeService(repo, chain);
  });

  it('happy path: row persisted before broadcast, status advances to broadcast', async () => {
    const anchor = makeAnchorRow({ id: 'new-anchor' });
    repo.create.mockResolvedValue(anchor);

    // Track call order
    const createSpy = vi.fn(repo.create);
    const broadcastSpy = vi.fn(async (tx: string) => { chain.broadcastCalls.push(tx); });
    
    // Actually, let me use a different approach. I'll override chain.broadcast to check repo state.
    // Better: use invocationCallOrder from vi.fn()
    
    // Reset and use proper spies
    repo.create.mockReset();
    repo.create.mockResolvedValue(anchor);
    
    const result = await service.anchorDocument('doc-1', 1, { hello: 'world' });
    
    expect(result.status).toBe('broadcast');
    expect(result.anchorId).toBe('new-anchor');
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.markBroadcast).toHaveBeenCalledWith('new-anchor');
    
    // Verify create was called before broadcast
    // Since repo.create is a vi.fn() and chain.broadcast is on the fake, let's check differently
    // The key assertion: the row was persisted (create called) and then markBroadcast was called
    // The ordering is proven by the fact that markBroadcast uses the id from create's return
  });

  // Hmm, I need a better way to prove ordering. Let me think...
});
```

Actually, let me reconsider the approach for proving "persisted before broadcast". The cleanest way is:

1. Make `chain.broadcast` a spy that records whether `repo.create` has been called at that point.
2. Or use `vi.fn()` for both and check `invocationCallOrder`.

Since I'm using a `FakeChainClient` class, I can modify it to accept an optional callback for broadcast. Or better, I'll just use `vi.fn()` for the chain client methods too.

Let me restructure to use pure `vi.fn()` mocks for both repo and chain:

```ts
function makeChainMock() {
  return {
    prepare: vi.fn(),
    broadcast: vi.fn(),
    getReceipt: vi.fn(),
  };
}
```

This is cleaner. Let me redo:

```ts
function makeChainMock() {
  return {
    prepare: vi.fn().mockResolvedValue({ txId: 'tx-1', signedTx: 'signed-tx-1' } as PreparedTx),
    broadcast: vi.fn().mockResolvedValue(undefined),
    getReceipt: vi.fn().mockResolvedValue(null as ChainReceipt | null),
  };
}
```

Now for the "persisted before broadcast" test, I can use `invocationCallOrder`:

```ts
const result = await service.anchorDocument('doc-1', 1, { hello: 'world' });
const createCallOrder = repo.create.mock.invocationCallOrder[0];
const broadcastCallOrder = chain.broadcast.mock.invocationCallOrder[0];
expect(createCallOrder).toBeLessThan(broadcastCallOrder);
```

This is clean and definitive.

Now for the concurrent duplicate test:
```ts
it('concurrent duplicate: two simultaneous calls, exactly one succeeds', async () => {
  const anchor1 = makeAnchorRow();
  // First create succeeds, second throws P2002
  repo.create
    .mockResolvedValueOnce(anchor1)
    .mockRejectedValueOnce({ code: 'P2002' });

  const [result1, result2] = await Promise.allSettled([
    service.anchorDocument('doc-1', 1, { a: 1 }),
    service.anchorDocument('doc-1', 1, { a: 1 }),
  ]);

  expect(result1.status).toBe('fulfilled');
  expect(result2.status).toBe('rejected');
  // ... check the error code
});
```

Wait, but with `Promise.allSettled`, both calls start simultaneously. The first one's `create` will resolve, the second's will reject with P2002. But there's a subtlety: both calls first call `chain.prepare`. With my mock, both get the same txId. That's fine for the test.

Actually wait - with `mockResolvedValueOnce` and `mockRejectedValueOnce`, the order of calls to `repo.create` depends on which promise resolves first. Since both are async and both call `prepare` first (which resolves), then both call `create`. The microtask ordering should be: first `prepare` resolves, first `create` is called; second `prepare` resolves, second `create` is called. But actually with `Promise.allSettled`, both are started, and they interleave at await points.

Let me trace through:
1. Call 1: `await this.chain.prepare(...)` → microtask queued
2. Call 2: `await this.chain.prepare(...)` → microtask queued
3. Call 1's prepare resolves → continues to `await this.repo.create(...)` → microtask queued
4. Call 2's prepare resolves → continues to `await this.repo.create(...)` → microtask queued
5. Call 1's create resolves (first mockResolvedValueOnce) → continues
6. Call 2's create rejects (mockRejectedValueOnce) → throws AnchoringError

This should work. The `mockResolvedValueOnce`/`mockRejectedValueOnce` will be consumed in order of invocation.

Actually, I realize there might be an issue. Let me check: `vi.fn().mockResolvedValueOnce(a).mockRejectedValueOnce(b)` - the first call gets `a`, the second gets `b`. Yes, that's correct.

Now for the "version 0 is rejected" test. The plan says the controller validates this. Since I'm writing a unit test file, I should test the controller. Let me look at the controller signature:

```ts
@Post('documents/:documentId/versions/:version/anchor')
anchor(@Param() p, @Body() body: { content: Record<string, unknown> }): Promise<AnchorResult>;
```

The controller extracts `version` from the path param (a string) and validates it's a positive integer. To test this, I'd instantiate the controller with a mocked service and call `anchor` directly.

But wait - looking at the controller code, I don't have it shown in the references. The plan describes it but doesn't show the implementation. The plan says:

"Controller validates that `content` is a non-null object and `version` is a positive integer; returns 400 with the standard error envelope otherwise."

Since I don't have the controller source, and the test needs to verify version 0 rejection, I have two options:
1. Test it at the service level (assuming the service also validates) - but the service code shown doesn't validate
2. Test it at the controller level by importing and instantiating the controller

Since the cases.txt explicitly says "proves the controller's input validation enforces version >= 1", I should test the controller. But I don't have the controller implementation shown. I'll need to import it and test it.

Actually, looking at the manifest: `src/anchoring/anchoring.controller.ts` exists. I can import it. The controller takes `AnchoringService` in its constructor.

Let me write the test:
```ts
import { AnchoringController } from '../src/anchoring/anchoring.controller';

// In the test:
const controller = new AnchoringController(service as any);
await expect(controller.anchor({ documentId: 'doc-1', version: '0' } as any, { content: {} })).rejects.toThrow();
```

Wait, but the controller might use NestJS decorators and return HTTP responses rather than throwing. The plan says "returns 400 with the standard error envelope". In NestJS, this could be done by throwing an HttpException or by using an exception filter.

Since I don't have the controller implementation, and the plan says it "returns 400 with the standard error envelope", the controller likely throws an exception (which NestJS converts to a 400 response) or returns a response object directly.

Given the uncertainty, I'll write the test to expect either:
- A thrown error with a specific code
- Or a returned response with error envelope

Actually, the most defensible approach given I don't have the controller source: I'll test it at the service level with an assumption comment, OR I'll import the controller and test its behavior.

Let me go with importing the controller. The plan says the controller validates, so calling it with version '0' should result in an error. I'll expect it to either throw or return an error response.

Hmm, but actually in NestJS, if the controller method throws an HttpException, the test would see a rejection. If it uses an exception filter, the controller method itself might not throw - the filter catches it at the middleware level. In a unit test, we'd be calling the method directly, so if it throws, we'd catch it.

Let me just write: `await expect(controller.anchor(...)).rejects.toThrow()` and check the error has the right code. If the controller returns a 400 response object instead of throwing, I'd need to check the return value. 

Given the plan's error envelope convention and the fact that this is a unit test, I'll assume the controller throws (or returns a rejected promise) for invalid input. This is the most common NestJS pattern with exception filters.

Actually, you know what, let me re-read the plan: "Controller validates that `content` is a non-null object and `version` is a positive integer; returns 400 with the standard error envelope otherwise."

"Returns 400" in NestJS typically means throwing an HttpException with status 400, which the framework converts to a 400 response. In a unit test calling the method directly, this would be a thrown exception.

I'll write:
```ts
it('version 0 is rejected', async () => {
  const controller = new AnchoringController(service as any);
  await expect(
    controller.anchor({ documentId: 'doc-1', version: '0' } as any, { content: {} } as any)
  ).rejects.toThrow();
});
```

But I'm not sure about the exact param structure. The controller uses `@Param() p` which would give `{ documentId: string, version: string }`. Let me just pass the object.

Actually, I realize I'm overcomplicating this. Let me look at what the plan says about the controller more carefully:

```ts
@Post('documents/:documentId/versions/:version/anchor')
anchor(@Param() p, @Body() body: { content: Record<string, unknown> }): Promise<AnchorResult>;
```

So `p` would be `{ documentId: 'doc-1', version: '0' }` and `body` would be `{ content: {} }`.

I'll write the test assuming the controller throws for invalid version. If it returns a 400 object instead, I'll adjust. But since I can't see the implementation, I'll add an assumption comment.

Wait, actually - re-reading the discipline rules: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence and do not reason around it: write the file using the most defensible reading and mark it with one `// ASSUMPTION:` comment at the point it matters."

The controller implementation is absent. I'll write the test in the most defensible way and add an assumption.

Let me now also think about the "recovery sweep idempotency" test more carefully:

"running tick twice for a confirmed row does not re-broadcast or corrupt state"

Scenario:
1. A row is in `pending` status
2. First tick: `resolvePending` finds a receipt, marks it `confirmed`
3. Second tick: `findPending` should return empty (row is now confirmed), so nothing happens

To test this:
- Set up repo so first `findPending` returns the pending row, second returns empty
- Set up chain so `getReceipt` returns a success receipt
- Call `tick()` twice
- Assert `broadcast` was never called (no re-broadcast)
- Assert `markConfirmed` was called exactly once

Actually wait, the case says "running tick twice for a confirmed row". This means after the first tick confirms it, on the second tick the row is already confirmed. So `findPending` on the second tick returns nothing (because the row is no longer pending). This is the natural behavior.

But there's a subtlety: what if `findPending` is called before the `markConfirmed` write has committed? In a real system with async writes, this could happen. But in our mock, we can simulate this by having `findPending` return the row both times, and verify that the second call to `resolvePending` on an already-confirmed row doesn't cause issues.

Hmm, but the service's `resolvePending` just calls `getReceipt` and then `markConfirmed` or `markFailed`. If the row is already confirmed, calling `markConfirmed` again would just update it with the same data (idempotent). The key assertion is that `broadcast` is NOT called (no re-broadcast).

Let me write it as: `findPending` returns the row both times (simulating overlapping ticks), and verify that `chain.broadcast` is never called and the row ends up confirmed.

Actually, re-reading: "proves duplicate delivery of the same pending row (e.g., overlapping ticks before the status write commits) is safe". So yes, the scenario is that `findPending` returns the same row on both ticks (because the status update hasn't "committed" yet in the real system). The test should verify no re-broadcast happens.

For this to work with `resolvePending`:
- First call: `getReceipt` returns success → `markConfirmed`
- Second call: `getReceipt` returns success → `markConfirmed` again (idempotent)
- No `broadcast` call in either

This works! The key is that `resolvePending` checks receipt first, and if found with success, just confirms. It never re-broadcasts when a receipt exists.

Now let me write the complete file. Let me be careful about all the imports and make sure everything is consistent.

One more thing: for the "worker tick: an exception in resolvePending for one row does not prevent processing subsequent rows" test, I need to make `resolvePending` throw for one row but not the other. I can do this by making `chain.getReceipt` throw for a specific txId.

Let me finalize my approach:

1. Use `vi.fn()` mocks for both repo and chain
2. Create a real `AnchoringService` with these mocks
3. Create a real `AnchorWorkerService` with the service and repo mock
4. For each test, set up the mocks appropriately

Here's my final plan for the file structure:

```
imports

helper: makeAnchorRow(overrides)
helper: makeRepoMock()
helper: makeChainMock()

describe('canonicalize')
  - key insertion order
  - leaf value change
  - arrays preserve order

describe('anchorDocument')
  beforeEach: fresh mocks, service
  - happy path (persisted before broadcast)
  - broadcast timeout → pending
  - broadcast hard failure → failed + throw
  - duplicate (sequential)
  - concurrent duplicate
  - empty object content

describe('verify')
  beforeEach: fresh mocks, service
  - match
  - mismatch
  - not found

describe('recovery sweep (resolvePending via worker tick)')
  beforeEach: fresh mocks, service, worker
  - pending + receipt success → confirmed
  - pending + no receipt → re-broadcast → broadcast
  - pending + receipt failure → failed

describe('confirmation worker (confirmBroadcast via worker tick)')
  beforeEach: fresh mocks, service, worker
  - broadcast + receipt success → confirmed
  - broadcast + null receipt → no-op

describe('worker tick edge cases')
  beforeEach: fresh mocks, service, worker
  - empty (no pending, no broadcast) → no error
  - exception in one row doesn't stop others
  - idempotency: tick twice, no re-broadcast

describe('controller validation')
  - version 0 rejected
```

Wait, I should group things more logically. Let me look at the cases list again and map them:

1. canonicalize: key insertion order → `describe('canonicalize')`
2. canonicalize: leaf value change → `describe('canonicalize')`
3. canonicalize: arrays → `describe('canonicalize')`
4. anchorDocument happy path → `describe('anchorDocument')`
5. broadcast timeout → `describe('anchorDocument')`
6. broadcast hard failure → `describe('anchorDocument')`
7. duplicate sequential → `describe('anchorDocument')`
8. concurrent duplicate → `describe('anchorDocument')`
9. verify match → `describe('verify')`
10. verify mismatch → `describe('verify')`
11. verify not found → `describe('verify')`
12. recovery: pending + receipt → `describe('worker tick — recovery sweep')`
13. recovery: pending + no receipt → `describe('worker tick — recovery sweep')`
14. recovery: pending + failure receipt → `describe('worker tick — recovery sweep')`
15. idempotency → `describe('worker tick — edge cases')`
16. confirmation: broadcast + success → `describe('worker tick — confirmation')`
17. confirmation: broadcast + null → `describe('worker tick — confirmation')`
18. empty tick → `describe('worker tick — edge cases')`
19. exception isolation → `describe('worker tick — edge cases')`
20. empty object content → `describe('anchorDocument')`
21. version 0 → `describe('controller validation')`

OK let me write this now. I'll be thorough and make sure each test has meaningful assertions.

For the "happy path: row persisted before broadcast" test, I want to use `invocationCallOrder`. Let me verify: `vi.fn()` tracks `mock.invocationCallOrder` which is an array of numbers (globally incrementing). So if `repo.create` is called before `chain.broadcast`, its invocation order number will be lower.

Let me write the full file now:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnchoringService, AnchoringError, canonicalize } from '../src/anchoring/anchoring.service';
import type { AnchorRow } from '../src/anchoring/anchoring.repository';
import { AnchoringRepository } from '../src/anchoring/anchoring.repository';
import type { PreparedTx, ChainReceipt } from '../src/anchoring/chain-client.interface';
import { BroadcastTimeoutError, type ChainClient } from '../src/anchoring/chain-client.interface';
import { AnchorWorkerService } from '../src/anchoring/anchor-worker.service';
import { AnchoringController } from '../src/anchoring/anchoring.controller';
```

Wait, I need to double-check: does the plan mention an `AnchoringController` export? Yes, section 3 shows `export class AnchoringController`. Good.

Now, for the controller test with version 0 - I need to think about what the controller actually does. The plan says it "validates that content is a non-null object and version is a positive integer; returns 400 with the standard error envelope otherwise."

In NestJS, "returns 400" typically means throwing `new BadRequestException(...)` or similar. In a unit test, calling the method directly would result in a thrown exception.

But I don't know the exact implementation. The most defensible reading: the controller method throws an error (likely an HttpException or a custom error) when version is not a positive integer. I'll test that it rejects/throws.

Actually, I just realized - maybe the controller doesn't throw but returns a response. In some patterns, the controller catches errors and returns them. But that's unusual for NestJS. The standard pattern is to throw and let the exception filter handle it.

I'll write: `await expect(controller.anchor(params, body)).rejects.toThrow()` and check the error contains something about version or has a specific code.

But what's the error code? The plan's error codes are: `duplicate_anchor`, `resource_not_found`, `broadcast_failed`. For validation errors, it's not specified. The standard error envelope has a `code` field. For a 400 validation error, it might be something like `invalid_input` or `validation_error`.

Since this isn't specified, I'll just check that it throws/rejects without asserting a specific code. Or I can assert the error message mentions version or something.

Actually, let me just assert it rejects (throws). That's the minimum defensible assertion.

Let me also think about whether I need to mock the controller's dependency. The controller takes `AnchoringService` in its constructor. I'll pass a mocked service.

OK here's another consideration: the `@Param() p` decorator. In a unit test, I'm calling the method directly, so `p` is just an object `{ documentId: 'doc-1', version: '0' }`. The `version` will be a string (since it comes from a URL param). The controller should parse it and validate.

Let me write the test:
```ts
const controller = new AnchoringController(vi.fn() as any);
await expect(
  controller.anchor({ documentId: 'doc-1', version: '0' } as any, { content: {} } as any)
).rejects.toThrow();
```

This should work regardless of whether the controller throws a NestJS HttpException or a custom error.

Alright, let me write the complete file now. I'll be careful to:
1. Have meaningful assertions in every test
2. Not just assert that a call happened (per the discipline rules)
3. Test behavior, not implementation

Let me write it out fully:

Actually, one more thought on the "concurrent duplicate" test. The cases.txt says "proves the schema-level constraint holds under race; fails if enforcement were a findByDocumentAndVersion guard in the service (both reads return null before either insert commit)". 

To truly prove this, I should show that the service does NOT do a pre-check (or if it does, the constraint still catches it). In our mock, we simulate the race by having both `create` calls happen (the first succeeds, the second gets P2002). The fact that one succeeds and one fails with `duplicate_anchor` proves the constraint is the enforcement mechanism.

But to make it even stronger, I could assert that `repo.findByDocumentAndVersion` is NOT called before `create` (proving there's no application-level pre-check). But that might be testing implementation rather than behavior. The behavioral assertion is: exactly one succeeds, one gets `duplicate_anchor`.

I'll go with the behavioral assertion.

Let me finalize and write the file.
```

## reply

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnchoringService, AnchoringError, canonicalize } from '../src/anchoring/anchoring.service';
import type { AnchorRow } from '../src/anchoring/anchoring.repository';
import { AnchoringRepository } from '../src/anchoring/anchoring.repository';
import type { PreparedTx, ChainReceipt } from '../src/anchoring/chain-client.interface';
import { BroadcastTimeoutError, type ChainClient } from '../src/anchoring/chain-client.interface';
import { AnchorWorkerService } from '../src/anchoring/anchor-worker.service';
import { AnchoringController } from '../src/anchoring/anchoring.controller';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeAnchorRow(overrides: Partial<AnchorRow> = {}): AnchorRow {
  return {
    id: 'anchor-1',
    documentId: 'doc-1',
    version: 1,
    contentHash: 'a'.repeat(64),
    txId: 'tx-1',
    signedTx: 'signed-tx-1',
    status: 'pending',
    blockNumber: null,
    blockHash: null,
    failureReason: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeRepoMock() {
  return {
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(null),
    findByDocumentAndVersion: vi.fn().mockResolvedValue(null),
    findPending: vi.fn().mockResolvedValue([]),
    findBroadcast: vi.fn().mockResolvedValue([]),
    markBroadcast: vi.fn().mockResolvedValue(undefined),
    markConfirmed: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
}

function makeChainMock() {
  return {
    prepare: vi.fn().mockResolvedValue({ txId: 'tx-1', signedTx: 'signed-tx-1' } satisfies PreparedTx),
    broadcast: vi.fn().mockResolvedValue(undefined),
    getReceipt: vi.fn().mockResolvedValue(null as ChainReceipt | null),
  };
}

type RepoMock = ReturnType<typeof makeRepoMock>;
type ChainMock = ReturnType<typeof makeChainMock>;

function buildService(repo: RepoMock, chain: ChainMock): AnchoringService {
  return new AnchoringService(repo as unknown as AnchoringRepository, chain as unknown as ChainClient);
}

// ─── canonicalize ──────────────────────────────────────────────────────────────

describe('canonicalize', () => {
  it('key insertion order does not affect the hash', () => {
    const a = { x: 1, y: { b: 2, a: 3 }, z: [1, 2, 3] };
    const b = { z: [1, 2, 3], y: { a: 3, b: 2 }, x: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });

  it('a single leaf value change produces a different hash', () => {
    const a = { patient: 'john', score: 42 };
    const b = { patient: 'john', score: 43 };
    expect(canonicalize(a)).not.toBe(canonicalize(b));
  });

  it('arrays preserve positional order (not sorted)', () => {
    const a = { readings: [1, 2, 3] };
    const b = { readings: [3, 2, 1] };
    expect(canonicalize(a)).not.toBe(canonicalize(b));
  });
});

// ─── anchorDocument ────────────────────────────────────────────────────────────

describe('anchorDocument', () => {
  let repo: RepoMock;
  let chain: ChainMock;
  let service: AnchoringService;

  beforeEach(() => {
    repo = makeRepoMock();
    chain = makeChainMock();
    service = buildService(repo, chain);
  });

  it('happy path: row persisted before broadcast, status advances to broadcast', async () => {
    const anchor = makeAnchorRow({ id: 'new-1' });
    repo.create.mockResolvedValue(anchor);

    const content = { patient: 'alice', score: 99 };
    const result = await service.anchorDocument('doc-1', 1, content);

    expect(result.status).toBe('broadcast');
    expect(result.anchorId).toBe('new-1');
    expect(result.txId).toBe('tx-1');
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(repo.markBroadcast).toHaveBeenCalledWith('new-1');

    // Proves the intent row was persisted before the broadcast call
    const createOrder = repo.create.mock.invocationCallOrder[0];
    const broadcastOrder = chain.broadcast.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(broadcastOrder);
  });

  it('broadcast timeout leaves row in pending and returns pending status', async () => {
    const anchor = makeAnchorRow({ id: 'new-2' });
    repo.create.mockResolvedValue(anchor);
    chain.broadcast.mockRejectedValue(new BroadcastTimeoutError());

    const result = await service.anchorDocument('doc-1', 1, { a: 1 });

    expect(result.status).toBe('pending');
    expect(result.anchorId).toBe('new-2');
    expect(repo.markFailed).not.toHaveBeenCalled();
    expect(repo.markBroadcast).not.toHaveBeenCalled();
  });

  it('broadcast hard failure marks row failed with reason and throws broadcast_failed', async () => {
    const anchor = makeAnchorRow({ id: 'new-3' });
    repo.create.mockResolvedValue(anchor);
    chain.broadcast.mockRejectedValue(new Error('network unreachable'));

    await expect(service.anchorDocument('doc-1', 1, { a: 1 })).rejects.toThrow(AnchoringError);
    await expect(service.anchorDocument('doc-1', 1, { a: 1 })).rejects.toMatchObject({
      code: 'broadcast_failed',
    });

    // Second call above re-runs; let's use a fresh setup for a clean assertion
    const repo2 = makeRepoMock();
    const chain2 = makeChainMock();
    const service2 = buildService(repo2, chain2);
    repo2.create.mockResolvedValue(anchor);
    chain2.broadcast.mockRejectedValue(new Error('network unreachable'));

    try {
      await service2.anchorDocument('doc-1', 1, { a: 1 });
    } catch (err) {
      expect(err).toBeInstanceOf(AnchoringError);
      expect((err as AnchoringError).code).toBe('broadcast_failed');
    }

    expect(repo2.markFailed).toHaveBeenCalledWith('new-3', 'network unreachable');
    expect(repo2.markBroadcast).not.toHaveBeenCalled();
  });

  it('duplicate anchor: second insert for same (documentId, version) throws duplicate_anchor', async () => {
    const anchor = makeAnchorRow({ id: 'dup-1' });
    repo.create
      .mockResolvedValueOnce(anchor)
      .mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));

    const first = await service.anchorDocument('doc-1', 1, { a: 1 });
    expect(first.status).toBe('broadcast');

    await expect(service.anchorDocument('doc-1', 1, { a: 2 })).rejects.toThrow(AnchoringError);
    await expect(service.anchorDocument('doc-1', 1, { a: 2 })).rejects.toMatchObject({
      code: 'duplicate_anchor',
    });
  });

  it('concurrent duplicate: two simultaneous calls for same (document, version), exactly one succeeds', async () => {
    const anchor = makeAnchorRow({ id: 'conc-1' });
    repo.create
      .mockResolvedValueOnce(anchor)
      .mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));

    const results = await Promise.allSettled([
      service.anchorDocument('doc-1', 1, { a: 1 }),
      service.anchorDocument('doc-1', 1, { a: 1 }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((fulfilled[0] as PromiseFulfilledResult<unknown>).value).toMatchObject({ status: 'broadcast' });
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AnchoringError);
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe('duplicate_anchor');
  });

  it('content is empty object {} — still produces a valid hash and anchor', async () => {
    const anchor = makeAnchorRow({ id: 'empty-1' });
    repo.create.mockResolvedValue(anchor);

    const result = await service.anchorDocument('doc-1', 1, {});

    expect(result.status).toBe('broadcast');
    expect(repo.create).toHaveBeenCalledTimes(1);
    const createArg = repo.create.mock.calls[0][0];
    // The hash of {} is deterministic and non-empty
    expect(createArg.contentHash).toBe(canonicalize({}));
    expect(createArg.contentHash).toHaveLength(64);
  });
});

// ─── verify ────────────────────────────────────────────────────────────────────

describe('verify', () => {
  let repo: RepoMock;
  let chain: ChainMock;
  let service: AnchoringService;

  beforeEach(() => {
    repo = makeRepoMock();
    chain = makeChainMock();
    service = buildService(repo, chain);
  });

  it('matching content returns match=true with proof fields (txId, blockNumber, blockHash)', async () => {
    const content = { patient: 'bob', grade: 'A' };
    const anchor = makeAnchorRow({
      contentHash: canonicalize(content),
      txId: 'tx-proof',
      status: 'confirmed',
      blockNumber: 12345n,
      blockHash: '0xblockhash',
    });
    repo.findByDocumentAndVersion.mockResolvedValue(anchor);

    const result = await service.verify('doc-1', 1, content);

    expect(result.match).toBe(true);
    expect(result.txId).toBe('tx-proof');
    expect(result.blockNumber).toBe(12345n);
    expect(result.blockHash).toBe('0xblockhash');
    expect(result.anchoredHash).toBe(canonicalize(content));
    expect(result.contentHash).toBe(canonicalize(content));
  });

  it('mismatched content returns match=false with both hashes present', async () => {
    const originalContent = { patient: 'bob', grade: 'A' };
    const tamperedContent = { patient: 'bob', grade: 'F' };
    const anchor = makeAnchorRow({
      contentHash: canonicalize(originalContent),
      txId: 'tx-proof',
    });
    repo.findByDocumentAndVersion.mockResolvedValue(anchor);

    const result = await service.verify('doc-1', 1, tamperedContent);

    expect(result.match).toBe(false);
    expect(result.contentHash).toBe(canonicalize(tamperedContent));
    expect(result.anchoredHash).toBe(canonicalize(originalContent));
    expect(result.contentHash).not.toBe(result.anchoredHash);
  });

  it('no anchor for (documentId, version) throws resource_not_found', async () => {
    repo.findByDocumentAndVersion.mockResolvedValue(null);

    await expect(service.verify('doc-1', 1, { a: 1 })).rejects.toThrow(AnchoringError);
    await expect(service.verify('doc-1', 1, { a: 1 })).rejects.toMatchObject({
      code: 'resource_not_found',
    });
  });
});

// ─── Worker tick: recovery sweep ──────────────────────────────────────────────

describe('worker tick — recovery sweep (resolvePending)', () => {
  let repo: RepoMock;
  let chain: ChainMock;
  let service: AnchoringService;
  let worker: AnchorWorkerService;

  beforeEach(() => {
    repo = makeRepoMock();
    chain = makeChainMock();
    service = buildService(repo, chain);
    worker = new AnchorWorkerService(
      service,
      repo as unknown as AnchoringRepository,
    );
  });

  it('pending row with existing on-chain receipt is confirmed (crash-after-broadcast recovery)', async () => {
    const anchor = makeAnchorRow({ id: 'rec-1', status: 'pending' });
    repo.findPending.mockResolvedValue([anchor]);

    chain.getReceipt.mockResolvedValue({
      blockNumber: 999n,
      blockHash: '0xconfirmed',
      status: 'success',
    });

    await worker.tick();

    expect(repo.markConfirmed).toHaveBeenCalledWith('rec-1', 999n, '0xconfirmed');
    expect(chain.broadcast).not.toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('pending row with no receipt is re-broadcast and transitions to broadcast', async () => {
    const anchor = makeAnchorRow({ id: 'rec-2', status: 'pending', signedTx: 'my-signed-tx' });
    repo.findPending.mockResolvedValue([anchor]);
    chain.getReceipt.mockResolvedValue(null);

    await worker.tick();

    expect(chain.broadcast).toHaveBeenCalledWith('my-signed-tx');
    expect(repo.markBroadcast).toHaveBeenCalledWith('rec-2');
    expect(repo.markConfirmed).not.toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('pending row with on-chain failure receipt is marked failed', async () => {
    const anchor = makeAnchorRow({ id: 'rec-3', status: 'pending' });
    repo.findPending.mockResolvedValue([anchor]);

    chain.getReceipt.mockResolvedValue({
      blockNumber: 500n,
      blockHash: '0xfailed',
      status: 'failure',
    });

    await worker.tick();

    expect(repo.markFailed).toHaveBeenCalledWith('rec-3', 'on-chain failure');
    expect(repo.markConfirmed).not.toHaveBeenCalled();
    expect(chain.broadcast).not.toHaveBeenCalled();
  });
});

// ─── Worker tick: confirmation ────────────────────────────────────────────────

describe('worker tick — confirmation (confirmBroadcast)', () => {
  let repo: RepoMock;
  let chain: ChainMock;
  let service: AnchoringService;
  let worker: AnchorWorkerService;

  beforeEach(() => {
    repo = makeRepoMock();
    chain = makeChainMock();
    service = buildService(repo, chain);
    worker = new AnchorWorkerService(
      service,
      repo as unknown as AnchoringRepository,
    );
  });

  it('broadcast row with success receipt transitions to confirmed with block data', async () => {
    const anchor = makeAnchorRow({ id: 'conf-1', status: 'broadcast' });
    repo.findBroadcast.mockResolvedValue([anchor]);

    chain.getReceipt.mockResolvedValue({
      blockNumber: 777n,
      blockHash: '0xblock777',
      status: 'success',
    });

    await worker.tick();

    expect(repo.markConfirmed).toHaveBeenCalledWith('conf-1', 777n, '0xblock777');
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('broadcast row with null receipt is a no-op (stays broadcast)', async () => {
    const anchor = makeAnchorRow({ id: 'conf-2', status: 'broadcast' });
    repo.findBroadcast.mockResolvedValue([anchor]);
    chain.getReceipt.mockResolvedValue(null);

    await worker.tick();

    expect(repo.markConfirmed).not.toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
    expect(chain.broadcast).not.toHaveBeenCalled();
  });
});

// ─── Worker tick: edge cases ──────────────────────────────────────────────────

describe('worker tick — edge cases', () => {
  let repo: RepoMock;
  let chain: ChainMock;
  let service: AnchoringService;
  let worker: AnchorWorkerService;

  beforeEach(() => {
    repo = makeRepoMock();
    chain = makeChainMock();
    service = buildService(repo, chain);
    worker = new AnchorWorkerService(
      service,
      repo as unknown as AnchoringRepository,
    );
  });

  it('zero pending and zero broadcast rows completes without error', async () => {
    repo.findPending.mockResolvedValue([]);
    repo.findBroadcast.mockResolvedValue([]);

    await expect(worker.tick()).resolves.toBeUndefined();
    expect(chain.getReceipt).not.toHaveBeenCalled();
    expect(chain.broadcast).not.toHaveBeenCalled();
    expect(repo.markConfirmed).not.toHaveBeenCalled();
    expect(repo.markFailed).not.toHaveBeenCalled();
  });

  it('an exception in resolvePending for one row does not prevent processing subsequent rows', async () => {
    const badAnchor = makeAnchorRow({ id: 'bad-1', status: 'pending' });
    const goodAnchor = makeAnchorRow({ id: 'good-1', status: 'pending' });
    repo.findPending.mockResolvedValue([badAnchor, goodAnchor]);

    // getReceipt throws for the first txId, returns success for the second
    chain.getReceipt
      .mockRejectedValueOnce(new Error('chain exploded'))
      .mockResolvedValueOnce({ blockNumber: 1n, blockHash: '0xok', status: 'success' });

    await worker.tick();

    // The good row was still processed
    expect(repo.markConfirmed).toHaveBeenCalledWith('good-1', 1n, '0xok');
  });

  it('idempotency: running tick twice for a confirmed row does not re-broadcast or corrupt state', async () => {
    const anchor = makeAnchorRow({ id: 'idem-1', status: 'pending' });

    // Simulate overlapping ticks: findPending returns the row both times
    repo.findPending.mockResolvedValue([anchor]);
    chain.getReceipt.mockResolvedValue({
      blockNumber: 42n,
      blockHash: '0xhash',
      status: 'success',
    });

    await worker.tick();
    await worker.tick();

    expect(chain.broadcast).not.toHaveBeenCalled();
    expect(repo.markConfirmed).toHaveBeenCalledTimes(2);
    // Both calls use the same values — idempotent
    expect(repo.markConfirmed).toHaveBeenCalledWith('idem-1', 42n, '0xhash');
  });
});

// ─── Controller validation ────────────────────────────────────────────────────

describe('controller validation', () => {
  it('version 0 is rejected (boundary below minimum positive integer)', async () => {
    // ASSUMPTION: The controller throws (rejects) for invalid version input rather than
    // returning a response body, consistent with NestJS exception-filter patterns.
    const mockService = {
      anchorDocument: vi.fn(),
      verify: vi.fn(),
    };
    const controller = new AnchoringController(mockService as unknown as AnchoringService);

    await expect(
      controller.anchor({ documentId: 'doc-1', version: '0' } as never, { content: {} } as never),
    ).rejects.toThrow();

    // The service should never have been called
    expect(mockService.anchorDocument).not.toHaveBeenCalled();
  });
});
```
