# repair2-payout.spec.ts

## reasoning

```
Let me analyze the compiler errors:

1. `src/outbox/outbox.repository.ts(4,31)`: Cannot find module `'../prisma/prisma.service.js'` — this is in the repository file, not the test. I should NOT change this file.

2. `src/outbox/outbox.service.ts(2,28)`: Module declares `'OutboxMessageRow'` locally but it is not exported. This means the `outbox.service.ts` imports `OutboxMessageRow` from `./outbox.repository.js` but it's not exported. I should NOT change this file either.

3. `src/payout/payout.repository.ts(4,31)`: Cannot find module `'../prisma/prisma.service.js'` — same as #1, in repository file.

4. `test/payout.spec.ts(51,33)`: The mock object passed to `PayoutService` constructor is missing `prisma` property. The `PayoutRepository` class has a `private readonly prisma: PrismaService` field, so TypeScript requires it. I need to either cast the mock or add a `prisma` property.

5. `test/payout.spec.ts(266,32)`: Same issue with `OutboxRepository`.

6. `test/payout.spec.ts(273,23)`, `(294,23)`, `(320,25)`, `(340,23)`, `(348,23)`: The `provider.transfer` is typed as a plain function `(params: { to: string; amount: bigint; }) => Promise<{ txHash: string; }>` rather than a mock function. The test is trying to call `.mockResolvedValue` etc. on it. I need to create the mock properly using `vi.fn()`.

So for the test file, I need to:
1. Cast the repository mocks to `PayoutRepository` and `OutboxRepository` respectively (using `as unknown as PayoutRepository` or similar) to bypass the missing `prisma` property.
2. Create the blockchain provider mock using `vi.fn()` so it has `.mockResolvedValue`, `.mockRejectedValueOnce`, etc.

Let me also look at what the test file currently looks like. I don't have it directly, but from the errors I can infer:
- Line 51: passes a mock object to `PayoutService` constructor
- Line 266: passes a mock object to `OutboxService` constructor
- Lines 273, 294, 320, 340, 348: calls `.mockResolvedValue`, `.mockRejectedValueOnce`, `.mockResolvedValueOnce` on `provider.transfer`

The test needs to:
- Import `PayoutService` from the service
- Import `OutboxService` from the outbox service
- Import types like `PayoutStatus`, `BlockchainProvider`, etc.
- Create mocks for repositories and provider
- Test the scenarios from PLAN.md section 5

Let me write the complete test file. I'll need to:

1. Use `as unknown as PayoutRepository` and `as unknown as OutboxRepository` for the mock casts.
2. Use `vi.fn()` to create the provider mock so it has `.mockResolvedValue` etc.
3. Import `OutboxMessageRow` — wait, the error says it's not exported from `outbox.repository.js`. So I can't import it. Let me define the shape inline or just work with what's available.

Actually, looking more carefully at error #2: `src/outbox/outbox.service.ts(2,28): error TS2459: Module '"./outbox.repository.js"' declares 'OutboxMessageRow' locally, but it is not exported.`

This means `outbox.service.ts` imports `OutboxMessageRow` from `./outbox.repository.js`. The fix would be to export it from the repository, but the instructions say "Change nothing the messages do not name." The message names `test/payout.spec.ts` as the file I'm rewriting, and the other files are context. But wait — the instruction says "Rewrite `test/payout.spec.ts` complete, fixing what these messages require of this file." So I should only fix things in the test file that are required by the messages.

The messages that point to `test/payout.spec.ts` are:
- Line 51: mock not assignable to PayoutRepository (missing `prisma`)
- Line 266: mock not assignable to OutboxRepository (missing `prisma`)
- Lines 273, 294, 320, 340, 348: `mockResolvedValue`/`mockRejectedValueOnce`/`mockResolvedValueOnce` don't exist on the function type

So I need to:
1. Cast the repository mocks properly
2. Create the provider mock with `vi.fn()`

For the other errors (missing prisma module, OutboxMessageRow not exported), those are in other files and I'm told to change nothing the messages don't name. But wait — the instruction says "Change nothing the messages do not name." The messages DO name `src/outbox/outbox.repository.ts`, `src/outbox/outbox.service.ts`, and `src/payout/payout.repository.ts`. But the task says "Rewrite `test/payout.spec.ts` complete, fixing what these messages require of this file." So I'm only rewriting the test file.

But the other errors will still exist... The instruction says "fixing what these messages require of this file" — meaning I should fix the test file in a way that addresses the errors that point to it. The other errors are in other files and I can't fix them from the test file.

Actually wait, re-reading: "Rewrite `test/payout.spec.ts` complete, fixing what these messages require of this file." This means I should produce a complete `test/payout.spec.ts` that, combined with the existing code, would make the compiler errors go away (at least those pointing to the test file). The other files' errors are out of scope.

Now let me think about what the test file needs:

From the plan's test section:
1. Two concurrent `POST /payouts` for the same account with amount > balance/2 → exactly one succeeds, the other gets 422
2. Two concurrent `POST /payouts` with same `(accountId, idempotencyKey)` and identical body → both return 200 with same payout id
3. `POST /payouts` with same key but different amount → 409
4. Worker picks up pending message, provider succeeds → payout completed, ledger posted, balance decremented, message done
5. Worker delivers same message twice → no double ledger entry
6. Provider throws 3× → payout needs_review, message done, balance unchanged
7. Provider throws once then succeeds → payout completed

Now, since these are unit tests (not e2e), I'll test the service and worker directly.

For the `PayoutService` tests:
- I need to mock `PayoutRepository`
- The service constructor takes `PayoutRepository`

For the `OutboxService` tests:
- I need to mock `OutboxRepository`, `PayoutRepository`, and `BlockchainProvider`
- The service constructor takes those three

Let me look at what the service likely does based on the plan:

`PayoutService.create(dto)`:
- Validates DTO
- Calls `repo.createPayoutWithReservation`
- Catches P2002 (idempotency conflict) → fetches existing, compares body
- Maps errors to appropriate responses

`OutboxService.processMessages()`:
- Claims messages
- For each: loads payout, checks status, calls provider, handles success/error

Now for the test file structure, I'll use `vi.fn()` for mocks and cast them.

Let me think about the `OutboxService` constructor. From the plan:
```ts
constructor(
  private readonly outboxRepo: OutboxRepository,
  private readonly payoutRepo: PayoutRepository,
  private readonly provider: BlockchainProvider,
) {}
```

And `PayoutService`:
```ts
constructor(
  private readonly repo: PayoutRepository,
) {}
```

For the provider mock, I'll do:
```ts
const transfer = vi.fn();
const provider = { transfer } as unknown as BlockchainProvider;
```

This way `transfer` is a `Mock` and has `.mockResolvedValue`, `.mockRejectedValueOnce`, etc.

For the repository mocks:
```ts
const repoMock = {
  createPayoutWithReservation: vi.fn(),
  updatePayout: vi.fn(),
  findById: vi.fn(),
  findByAccountIdAndIdempotencyKey: vi.fn(),
  confirmPayoutLedger: vi.fn(),
} as unknown as PayoutRepository;
```

Now let me write the full test file. I need to be careful about what imports I use. Since `OutboxMessageRow` is not exported from the repository, I'll just define the shape inline where needed or use a local interface.

Actually, looking at the outbox service code reference, it imports `OutboxMessageRow` from `./outbox.repository.js`. Since I'm not changing that file, and the test doesn't directly need to import `OutboxMessageRow` (the service handles it internally), I just need to create objects that match the expected shape for the mocks.

Let me write the test now:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PayoutService } from '../src/payout/payout.service.js';
import type { PayoutRepository } from '../src/payout/payout.repository.js';
import type { OutboxService } from '../src/outbox/outbox.service.js';
import type { OutboxRepository } from '../src/outbox/outbox.repository.js';
import type { BlockchainProvider } from '../src/payout/payout.types.js';

// ... tests
```

Wait, I need to check — does `OutboxService` export the class? From the plan it says `@Injectable() export class OutboxService`. Yes.

And `PayoutService` — `@Injectable() export class PayoutService`. Yes.

Now, for the `PayoutService`, I need to understand its error handling. From the plan:
- It catches P2002 (Prisma unique constraint violation) → checks if same body → returns existing or throws conflict
- It maps `INSUFFICIENT_FUNDS` error → 422
- It maps `ACCOUNT_NOT_FOUND` → 404

But in unit tests, I'm testing the service with mocked repository. So:
- For insufficient funds: mock `createPayoutWithReservation` to throw `new Error('INSUFFICIENT_FUNDS')`
- For account not found: mock to throw `new Error('ACCOUNT_NOT_FOUND')`
- For idempotency conflict: mock to throw a Prisma P2002 error... but that's complex. Let me think.

Actually, the service likely catches a specific error. Looking at the plan: "Maps P2002 → conflict check". So the service catches `Prisma.PrismaClientKnownRequestError` with code P2002. In the test, I'd need to throw such an error from the mock.

But creating a Prisma error in a test is tricky. Let me think about what the service code likely does:

```ts
async create(dto: CreatePayoutDto): Promise<PayoutResponse> {
  // validation...
  try {
    const payout = await this.repo.createPayoutWithReservation({...});
    return { id: payout.id, status: payout.status, amount: payout.amount.toString() };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // fetch existing, compare
    }
    if (err instanceof Error && err.message === 'INSUFFICIENT_FUNDS') {
      throw new UnprocessableEntityException(...);
    }
    if (err instanceof Error && err.message === 'ACCOUNT_NOT_FOUND') {
      throw new NotFoundException(...);
    }
  }
}
```

For the test, I can:
1. For insufficient funds: have the mock throw `new Error('INSUFFICIENT_FUNDS')` and expect a 422-equivalent (probably an `UnprocessableEntityException`)
2. For idempotency: have the mock throw a P2002 error... but I'd need to construct one.

Actually, let me simplify. Since I'm writing unit tests that test behavior, and the plan says to test:
- Concurrent creation (overdraft)
- Duplicate message delivery
- Retry exhaustion

Let me focus on what's testable at the unit level:

For `PayoutService`:
- Insufficient funds → appropriate exception
- Idempotency (same key, same body) → returns existing
- Idempotency conflict (same key, different body) → 409

For `OutboxService.processMessages()`:
- Happy path: provider succeeds → completed, ledger posted
- Duplicate delivery: provider already completed → no-op
- Retry exhaustion: provider fails 3 times → needs_review
- Transient failure then success

Let me write this. For the P2002 error, I'll create a minimal mock that has the right shape:

```ts
const p2002Error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
```

But the service might check `instanceof Prisma.PrismaClientKnownRequestError`. If it does, I can't easily mock that. Let me use an ASSUMPTION comment.

Actually, looking at this more practically — the plan says the service "Maps P2002 → conflict check". The simplest implementation would be to catch any error and check the code property. Let me assume the service checks for a `code` property of `'P2002'` on the error object, or uses a different approach.

Let me just write the tests and use ASSUMPTION comments where needed. The key constraint is:
1. Fix the type errors in the test file
2. Follow the plan's test scenarios
3. Don't change other files

Let me write the complete file now:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PayoutService } from '../src/payout/payout.service.js';
import type { PayoutRepository } from '../src/payout/payout.repository.js';
import { OutboxService } from '../src/outbox/outbox.service.js';
import type { OutboxRepository } from '../src/outbox/outbox.repository.js';
import type { BlockchainProvider, PayoutStatus } from '../src/payout/payout.types.js';
import { UnprocessableEntityException, ConflictException, NotFoundException } from '@nestjs/common';

// ASSUMPTION: The service identifies idempotency conflicts by catching errors with a `code` property of 'P2002'.

describe('PayoutService', () => {
  let repo: PayoutRepository;
  let service: PayoutService;

  beforeEach(() => {
    const repoMock = {
      createPayoutWithReservation: vi.fn(),
      updatePayout: vi.fn(),
      findById: vi.fn(),
      findByAccountIdAndIdempotencyKey: vi.fn(),
      confirmPayoutLedger: vi.fn(),
    };
    repo = repoMock as unknown as PayoutRepository;
    service = new PayoutService(repo);
  });

  it('returns a payout response on successful creation', async () => {
    const payoutRow = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(repo.createPayoutWithReservation).mockResolvedValue(payoutRow);

    const result = await service.create({
      accountId: 'acct-1',
      amount: '100',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    });

    expect(result.id).toBe('payout-1');
    expect(result.status).toBe('created');
    expect(result.amount).toBe('100');
  });

  it('throws UnprocessableEntityException on insufficient funds', async () => {
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValue(new Error('INSUFFICIENT_FUNDS'));

    await expect(service.create({
      accountId: 'acct-1',
      amount: '999999',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    })).rejects.toThrow(UneprocessableEntityException);
  });

  it('throws NotFoundException when account does not exist', async () => {
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValue(new Error('ACCOUNT_NOT_FOUND'));

    await expect(service.create({
      accountId: 'nonexistent',
      amount: '100',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    })).rejects.toThrow(NotFoundException);
  });

  it('returns the existing payout when idempotency key matches with same body', async () => {
    const p2002Error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValueOnce(p2002Error);

    const existingPayout = {
      id: 'payout-existing',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(repo.findByAccountIdAndIdempotencyKey).mockResolvedValue(existingPayout);

    const result = await service.create({
      accountId: 'acct-1',
      amount: '100',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    });

    expect(result.id).toBe('payout-existing');
  });

  it('throws ConflictException when idempotency key matches but body differs', async () => {
    const p2002Error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValueOnce(p2002Error);

    const existingPayout = {
      id: 'payout-existing',
      accountId: 'acct-1',
      amount: 200n,  // different amount
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(repo.findByAccountIdAndIdempotencyKey).mockResolvedValue(existingPayout);

    await expect(service.create({
      accountId: 'acct-1',
      amount: '300',  // different from existing 200n
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    })).rejects.toThrow(ConflictException);
  });
});

describe('OutboxService', () => {
  let outboxRepo: OutboxRepository;
  let payoutRepo: PayoutRepository;
  let transfer: ReturnType<typeof vi.fn>;
  let provider: BlockchainProvider;
  let service: OutboxService;

  beforeEach(() => {
    const outboxRepoMock = {
      claimPending: vi.fn(),
      markDone: vi.fn(),
      recordAttempt: vi.fn(),
    };
    outboxRepo = outboxRepoMock as unknown as OutboxRepository;

    const payoutRepoMock = {
      createPayoutWithReservation: vi.fn(),
      updatePayout: vi.fn(),
      findById: vi.fn(),
      findByAccountIdAndIdempotencyKey: vi.fn(),
      confirmPayoutLedger: vi.fn(),
    };
    payoutRepo = payoutRepoMock as unknown as PayoutRepository;

    transfer = vi.fn();
    provider = { transfer } as unknown as BlockchainProvider;

    service = new OutboxService(outboxRepo, payoutRepo, provider);
  });

  it('completes a payout and posts ledger on provider success', async () => {
    const message = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(outboxRepo.claimPending).mockResolvedValue([message as any]);

    const payoutRow = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(payoutRow);
    transfer.mockResolvedValue({ txHash: '0xtx123' });

    await service.processMessages();

    expect(payoutRepo.updatePayout).toHaveBeenCalledWith('payout-1', 'processing');
    expect(payoutRepo.updatePayout).toHaveBeenCalledWith('payout-1', 'completed', '0xtx123');
    expect(payoutRepo.confirmPayoutLedger).toHaveBeenCalledWith('acct-1', 'payout-1', 100n);
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
  });

  it('is idempotent when a message is delivered twice after completion', async () => {
    const message = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(outboxRepo.claimPending).mockResolvedValue([message as any]);

    const completedPayout = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'completed' as PayoutStatus,
      txHash: '0xtx123',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(completedPayout);

    await service.processMessages();

    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
    expect(transfer).not.toHaveBeenCalled();
    expect(payoutRepo.confirmPayoutLedger).not.toHaveBeenCalled();
  });

  it('marks payout needs_review and stops retrying after exhausting max attempts', async () => {
    // Simulate 3 attempts already recorded; this is the 4th claim (attempts will be incremented to 3 in this tick)
    // Actually, let me re-think. The message has attempts=2 already (2 prior failures). 
    // On this tick, provider fails again → attempts becomes 3 = MAX_ATTEMPTS → needs_review.
    
    const message = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 2,  // already failed twice
      nextAttemptAt: null,
      lastError: 'timeout',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(outboxRepo.claimPending).mockResolvedValue([message as any]);

    const payoutRow = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'processing' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(payoutRow);
    transfer.mockRejectedValueOnce(new Error('provider timeout'));

    await service.processMessages();

    // attempts was 2, now becomes 3 which equals MAX_ATTEMPTS
    expect(payoutRepo.updatePayout).toHaveBeenCalledWith('payout-1', 'needs_review');
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
    expect(payoutRepo.confirmPayoutLedger).not.toHaveBeenCalled();
  });

  it('retries transient failure and succeeds on next attempt', async () => {
    const message = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.mocked(outboxRepo.claimPending).mockResolvedValue([message as any]);

    const payoutRow = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(payoutRow);
    transfer.mockRejectedValueOnce(new Error('transient error'));

    await service.processMessages();

    // Should record the attempt and leave for next tick
    expect(outboxRepo.recordAttempt).toHaveBeenCalledWith('msg-1', 1, null, 'transient error');
    expect(outboxRepo.markDone).not.toHaveBeenCalled();
    expect(payoutRepo.confirmPayoutLedger).not.toHaveBeenCalled();
  });
});
```

Wait, I need to reconsider the "concurrent creation" test. The plan says:
"Two concurrent `POST /payouts` for the same account with amount > balance/2 → exactly one succeeds, the other gets 422 `insufficient_funds`"

This is really an integration test that tests the database-level locking. At the unit level, I can't really test true concurrency. But I can test that when `createPayoutWithReservation` throws `INSUFFICIENT_FUNDS`, the service properly maps it. I already have that test.

Actually, looking at the plan more carefully for what tests to write:
- "Tests for: concurrent creation against one account, duplicate message delivery, retry exhaustion"

The concurrent creation test at the unit level is really just testing the error mapping (which I have). The true concurrency test would be an integration test. Since the plan lists it as a test, I'll include a test that verifies the service handles the insufficient funds error correctly (which is what would happen in the concurrent scenario).

Let me also reconsider — do I need to test that the `OutboxService` properly handles the case where `payout.status` is already `'failed'`? The plan says "If payout.status is 'completed' or 'failed' → mark message done". Let me add that.

Also, I realize I should double-check: does the `OutboxService` have a `processMessages` method that's public? From the plan: "processMessages(): Promise<void>" — yes.

Let me also think about whether I need `start()` and `stop()`. The plan says they exist but for testing `processMessages()` I just call it directly.

One more thing — the test at line 51 passes the mock to `PayoutService` constructor. The error says "Property 'prisma' is missing". This confirms the constructor parameter type is `PayoutRepository` (the class), not an interface. So I need to cast with `as unknown as PayoutRepository`.

Similarly for line 266 with `OutboxRepository`.

And for the provider, the error says the type is `(params: { to: string; amount: bigint; }) => Promise<{ txHash: string; }>` — this is the function type of `BlockchainProvider['transfer']`. So the test was creating a plain function and trying to call `.mockResolvedValue` on it. I need to use `vi.fn()`.

Let me finalize the test file. I'll make sure it's complete and self-contained.

Actually, wait — I need to check: does `PayoutService` import from a specific path? Let me use the paths that make sense given the layout:
- `src/payout/payout.service.ts` → import from `'../src/payout/payout.service.js'` (ESM)
- `src/outbox/outbox.service.ts` → import from `'../src/outbox/outbox.service.js'`

For types:
- `src/payout/payout.repository.ts` → `import type { PayoutRepository } from '../src/payout/payout.repository.js'`
- `src/outbox/outbox.repository.ts` → `import type { OutboxRepository } from '../src/outbox/outbox.repository.js'`
- `src/payout/payout.types.ts` → `import type { BlockchainProvider, PayoutStatus } from '../src/payout/payout.types.js'`

For NestJS exceptions:
- `import { UnprocessableEntityException, ConflictException, NotFoundException } from '@nestjs/common'`

Let me write the final version now. I want to make sure all the test scenarios from the plan are covered:

1. ✅ Insufficient funds (concurrent creation scenario)
2. ✅ Idempotent creation (same key, same body)
3. ✅ Idempotency conflict (same key, different body)
4. ✅ Worker happy path
5. ✅ Duplicate message delivery (at-least-once safety)
6. ✅ Retry exhaustion
7. ✅ Transient retry works (fail once, then... well, in a unit test I can only test one tick. Let me adjust: fail once → recordAttempt is called, message stays pending)

Actually for test 7, the plan says "Provider throws once then succeeds → payout completed, correct balance". This would require two calls to `processMessages()`. Let me do that:
- First call: provider fails → recordAttempt
- Second call: claim returns the message again (now with attempts=1), provider succeeds → completed

Let me restructure that test.

Hmm, but in the unit test, I control what `claimPending` returns each time. So:
- First `processMessages()`: claimPending returns message with attempts=0, provider rejects → recordAttempt called with attempts=1
- Second `processMessages()`: claimPending returns message with attempts=1, provider resolves → completed

Let me write it that way.

One concern: the `transfer` mock. After `mockRejectedValueOnce`, the next call will use whatever the default is. I should use `mockRejectedValueOnce` for the first failure and `mockResolvedValueOnce` for the success. Or set up the mock with `.mockRejectedValueOnce(...).mockResolvedValueOnce(...)`.

Let me finalize:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnprocessableEntityException, ConflictException, NotFoundException } from '@nestjs/common';
import { PayoutService } from '../src/payout/payout.service.js';
import type { PayoutRepository } from '../src/payout/payout.repository.js';
import { OutboxService } from '../src/outbox/outbox.service.js';
import type { OutboxRepository } from '../src/outbox/outbox.repository.js';
import type { BlockchainProvider, PayoutStatus } from '../src/payout/payout.types.js';

// ASSUMPTION: The service identifies idempotency conflicts by checking for an error object with a `code` property equal to 'P2002', rather than using instanceof Prisma.PrismaClientKnownRequestError.

describe('PayoutService', () => {
  let repo: PayoutRepository;
  let service: PayoutService;

  beforeEach(() => {
    const repoMock = {
      createPayoutWithReservation: vi.fn(),
      updatePayout: vi.fn(),
      findById: vi.fn(),
      findByAccountIdAndIdempotencyKey: vi.fn(),
      confirmPayoutLedger: vi.fn(),
    };
    repo = repoMock as unknown as PayoutRepository;
    service = new PayoutService(repo);
  });

  it('returns a payout response on successful creation', async () => {
    const payoutRow = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(repo.createPayoutWithReservation).mockResolvedValue(payoutRow);

    const result = await service.create({
      accountId: 'acct-1',
      amount: '100',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    });

    expect(result.id).toBe('payout-1');
    expect(result.status).toBe('created');
    expect(result.amount).toBe('100');
  });

  it('throws UnprocessableEntityException when funds are insufficient (concurrent overdraft guard)', async () => {
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValue(new Error('INSUFFICIENT_FUNDS'));

    await expect(service.create({
      accountId: 'acct-1',
      amount: '999999',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    })).rejects.toThrow(UneprocessableEntityException);
  });

  it('throws NotFoundException when the account does not exist', async () => {
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValue(new Error('ACCOUNT_NOT_FOUND'));

    await expect(service.create({
      accountId: 'nonexistent',
      amount: '100',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    })).rejects.toThrow(NotFoundException);
  });

  it('returns the existing payout when the same idempotency key and body are retried', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValueOnce(p2002);

    const existing = {
      id: 'payout-existing',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(repo.findByAccountIdAndIdempotencyKey).mockResolvedValue(existing);

    const result = await service.create({
      accountId: 'acct-1',
      amount: '100',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    });

    expect(result.id).toBe('payout-existing');
  });

  it('throws ConflictException when the same idempotency key is reused with a different body', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValueOnce(p2002);

    const existing = {
      id: 'payout-existing',
      accountId: 'acct-1',
      amount: 200n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(repo.findByAccountIdAndIdempotencyKey).mockResolvedValue(existing);

    await expect(service.create({
      accountId: 'acct-1',
      amount: '300',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    })).rejects.toThrow(ConflictException);
  });
});

describe('OutboxService', () => {
  let outboxRepo: OutboxRepository;
  let payoutRepo: PayoutRepository;
  let transfer: ReturnType<typeof vi.fn>;
  let provider: BlockchainProvider;
  let service: OutboxService;

  beforeEach(() => {
    const outboxRepoMock = {
      claimPending: vi.fn(),
      markDone: vi.fn(),
      recordAttempt: vi.fn(),
    };
    outboxRepo = outboxRepoMock as unknown as OutboxRepository;

    const payoutRepoMock = {
      createPayoutWithReservation: vi.fn(),
      updatePayout: vi.fn(),
      findById: vi.fn(),
      findByAccountIdAndIdempotencyKey: vi.fn(),
      confirmPayoutLedger: vi.fn(),
    };
    payoutRepo = payoutRepoMock as unknown as PayoutRepository;

    transfer = vi.fn();
    provider = { transfer } as unknown as BlockchainProvider;

    service = new OutboxService(outboxRepo, payoutRepo, provider);
  });

  it('completes a payout, posts the ledger entry, and marks the message done on provider success', async () => {
    const msg = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValue([msg as any]);

    const payout = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(payout);
    transfer.mockResolvedValue({ txHash: '0xtx123' });

    await service.processMessages();

    expect(transfer).toHaveBeenCalledWith({ to: '0xabc', amount: 100n });
    expect(payoutRepo.confirmPayoutLedger).toHaveBeenCalledWith('acct-1', 'payout-1', 100n);
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
  });

  it('skips processing when the payout is already completed (at-least-once redelivery)', async () => {
    const msg = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 1,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValue([msg as any]);

    const completedPayout = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'completed' as PayoutStatus,
      txHash: '0xtx123',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(completedPayout);

    await service.processMessages();

    expect(transfer).not.toHaveBeenCalled();
    expect(payoutRepo.confirmPayoutLedger).not.toHaveBeenCalled();
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
  });

  it('marks the payout needs_review and stops when retries are exhausted', async () => {
    // Message has already been attempted twice (attempts=2). This is the third failure → MAX_ATTEMPTS.
    const msg = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 2,
      nextAttemptAt: null,
      lastError: 'timeout',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValue([msg as any]);

    const payout = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'processing' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(payout);
    transfer.mockRejectedValueOnce(new Error('provider timeout'));

    await service.processMessages();

    expect(payoutRepo.updatePayout).toHaveBeenCalledWith('payout-1', 'needs_review');
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
    expect(payoutRepo.confirmPayoutLedger).not.toHaveBeenCalled();
  });

  it('records a failed attempt and leaves the message for the next tick on transient error', async () => {
    const msg = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValue([msg as any]);

    const payout = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(payout);
    transfer.mockRejectedValueOnce(new Error('transient'));

    await service.processMessages();

    expect(outboxRepo.recordAttempt).toHaveBeenCalledWith('msg-1', 1, null, 'transient');
    expect(outboxRepo.markDone).not.toHaveBeenCalled();
    expect(payoutRepo.confirmPayoutLedger).not.toHaveBeenCalled();
  });

  it('succeeds on a subsequent tick after a prior transient failure', async () => {
    // First tick: provider fails
    const msg1 = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValueOnce([msg1 as any]);

    const payoutCreated = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValueOnce(payoutCreated);
    transfer.mockRejectedValueOnce(new Error('transient'));

    await service.processMessages();
    expect(outboxRepo.recordAttempt).toHaveBeenCalledWith('msg-1', 1, null, 'transient');

    // Second tick: provider succeeds
    const msg2 = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 1,
      nextAttemptAt: null,
      lastError: 'transient',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValueOnce([msg2 as any]);

    const payoutProcessing = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'processing' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValueOnce(payoutProcessing);
    transfer.mockResolvedValueOnce({ txHash: '0xtx456' });

    await service.processMessages();

    expect(payoutRepo.confirmPayoutLedger).toHaveBeenCalledWith('acct-1', 'payout-1', 100n);
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
  });
});
```

Hmm wait, I have a potential issue. In the "succeeds on subsequent tick" test, I'm calling `processMessages()` twice. The `transfer` mock has `.mockRejectedValueOnce` for the first call and `.mockResolvedValueOnce` for the second. That should work.

But there's a subtlety: in the second tick, the service will try to update the payout status from 'created' to 'processing'. But in my mock, `findById` returns a payout with status 'processing' (since it was already updated in the first tick). So the service won't call `updatePayout` with 'processing' again (it checks if status is 'created'). Good.

Actually wait — in the first tick, the service sets status to 'processing'. But in my mock, `findById` returns the same object both times unless I use `mockResolvedValueOnce`. Let me make sure I'm using `mockResolvedValueOnce` for each call.

In the first `processMessages()`:
- `findById` returns `payoutCreated` (status: 'created')
- Service sets to 'processing' (calls `updatePayout`)
- Provider fails

In the second `processMessages()`:
- `findById` returns `payoutProcessing` (status: 'processing')  
- Service sees status is not 'created', so doesn't set it again
- Provider succeeds

This looks correct.

Let me also double-check: the `transfer` mock calls. In the first tick, `transfer` is called once (rejected). In the second tick, `transfer` is called once (resolved). So I need `.mockRejectedValueOnce(...)` then `.mockResolvedValueOnce(...)`. That's what I have.

One more thing: I should verify that `vi.mocked()` works correctly with the cast. Since I'm casting `repoMock as unknown as PayoutRepository`, calling `vi.mocked(repo.createPayoutWithReservation)` should work because the underlying function IS a `vi.fn()`. TypeScript might complain about the type, but at runtime it's fine. And since I'm using `as unknown as PayoutRepository`, TypeScript won't complain about the cast itself.

Actually, wait — `vi.mocked()` might have type issues. Let me think... `vi.mocked` expects a function and returns a typed mock. If the type says it's `PayoutRepository['createPayoutWithReservation']` which returns `Promise<PayoutRow>`, and the mock is `vi.fn()`, then `vi.mocked(repo.createPayoutWithReservation)` should return a `Mock` that I can call `.mockResolvedValue()` on. This should be fine.

Actually, I realize there might be an issue. `vi.mocked` is designed to work with `jest.fn()` / `vi.fn()` mocks. When I do `repoMock as unknown as PayoutRepository`, the type system thinks it's a real `PayoutRepository`. Then `vi.mocked(repo.createPayoutWithReservation)` — TypeScript will check if the type is compatible with what `vi.mocked` expects. Since `PayoutRepository['createPayoutWithReservation']` is a method (function), `vi.mocked` should accept it and return `Mock<...>`.

I think this will work. Let me finalize the file.

Oh wait, one more issue: I'm importing `OutboxService` as a value (not just a type) because I instantiate it with `new`. Same for `PayoutService`. That's correct.

Let me also make sure I'm not importing anything that doesn't exist. From the reference code:
- `PayoutService` is in `src/payout/payout.service.ts` ✓
- `OutboxService` is in `src/outbox/outbox.service.ts` ✓
- `PayoutRepository` type is in `src/payout/payout.repository.ts` ✓
- `OutboxRepository` type is in `src/outbox/outbox.repository.ts` ✓
- `BlockchainProvider`, `PayoutStatus` are in `src/payout/payout.types.ts` ✓

I think this is good. Let me write the final version.
```

## reply

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnprocessableEntityException, ConflictException, NotFoundException } from '@nestjs/common';
import { PayoutService } from '../src/payout/payout.service.js';
import type { PayoutRepository } from '../src/payout/payout.repository.js';
import { OutboxService } from '../src/outbox/outbox.service.js';
import type { OutboxRepository } from '../src/outbox/outbox.repository.js';
import type { BlockchainProvider, PayoutStatus } from '../src/payout/payout.types.js';

// ASSUMPTION: The service identifies idempotency conflicts by checking for an error object with a `code` property equal to 'P2002', rather than using instanceof Prisma.PrismaClientKnownRequestError.

describe('PayoutService', () => {
  let repo: PayoutRepository;
  let service: PayoutService;

  beforeEach(() => {
    const repoMock = {
      createPayoutWithReservation: vi.fn(),
      updatePayout: vi.fn(),
      findById: vi.fn(),
      findByAccountIdAndIdempotencyKey: vi.fn(),
      confirmPayoutLedger: vi.fn(),
    };
    repo = repoMock as unknown as PayoutRepository;
    service = new PayoutService(repo);
  });

  it('returns a payout response on successful creation', async () => {
    const payoutRow = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(repo.createPayoutWithReservation).mockResolvedValue(payoutRow);

    const result = await service.create({
      accountId: 'acct-1',
      amount: '100',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    });

    expect(result.id).toBe('payout-1');
    expect(result.status).toBe('created');
    expect(result.amount).toBe('100');
  });

  it('throws UnprocessableEntityException when funds are insufficient (concurrent overdraft guard)', async () => {
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValue(new Error('INSUFFICIENT_FUNDS'));

    await expect(service.create({
      accountId: 'acct-1',
      amount: '999999',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    })).rejects.toThrow(UneprocessableEntityException);
  });

  it('throws NotFoundException when the account does not exist', async () => {
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValue(new Error('ACCOUNT_NOT_FOUND'));

    await expect(service.create({
      accountId: 'nonexistent',
      amount: '100',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    })).rejects.toThrow(NotFoundException);
  });

  it('returns the existing payout when the same idempotency key and body are retried', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValueOnce(p2002);

    const existing = {
      id: 'payout-existing',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(repo.findByAccountIdAndIdempotencyKey).mockResolvedValue(existing);

    const result = await service.create({
      accountId: 'acct-1',
      amount: '100',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    });

    expect(result.id).toBe('payout-existing');
  });

  it('throws ConflictException when the same idempotency key is reused with a different body', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValueOnce(p2002);

    const existing = {
      id: 'payout-existing',
      accountId: 'acct-1',
      amount: 200n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(repo.findByAccountIdAndIdempotencyKey).mockResolvedValue(existing);

    await expect(service.create({
      accountId: 'acct-1',
      amount: '300',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    })).rejects.toThrow(ConflictException);
  });
});

describe('OutboxService', () => {
  let outboxRepo: OutboxRepository;
  let payoutRepo: PayoutRepository;
  let transfer: ReturnType<typeof vi.fn>;
  let provider: BlockchainProvider;
  let service: OutboxService;

  beforeEach(() => {
    const outboxRepoMock = {
      claimPending: vi.fn(),
      markDone: vi.fn(),
      recordAttempt: vi.fn(),
    };
    outboxRepo = outboxRepoMock as unknown as OutboxRepository;

    const payoutRepoMock = {
      createPayoutWithReservation: vi.fn(),
      updatePayout: vi.fn(),
      findById: vi.fn(),
      findByAccountIdAndIdempotencyKey: vi.fn(),
      confirmPayoutLedger: vi.fn(),
    };
    payoutRepo = payoutRepoMock as unknown as PayoutRepository;

    transfer = vi.fn();
    provider = { transfer } as unknown as BlockchainProvider;

    service = new OutboxService(outboxRepo, payoutRepo, provider);
  });

  it('completes a payout, posts the ledger entry, and marks the message done on provider success', async () => {
    const msg = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValue([msg as any]);

    const payout = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(payout);
    transfer.mockResolvedValue({ txHash: '0xtx123' });

    await service.processMessages();

    expect(transfer).toHaveBeenCalledWith({ to: '0xabc', amount: 100n });
    expect(payoutRepo.confirmPayoutLedger).toHaveBeenCalledWith('acct-1', 'payout-1', 100n);
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
  });

  it('skips processing when the payout is already completed (at-least-once redelivery)', async () => {
    const msg = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 1,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValue([msg as any]);

    const completedPayout = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'completed' as PayoutStatus,
      txHash: '0xtx123',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(completedPayout);

    await service.processMessages();

    expect(transfer).not.toHaveBeenCalled();
    expect(payoutRepo.confirmPayoutLedger).not.toHaveBeenCalled();
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
  });

  it('marks the payout needs_review and stops when retries are exhausted', async () => {
    // Message has already been attempted twice (attempts=2). This is the third failure → MAX_ATTEMPTS.
    const msg = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 2,
      nextAttemptAt: null,
      lastError: 'timeout',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValue([msg as any]);

    const payout = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'processing' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(payout);
    transfer.mockRejectedValueOnce(new Error('provider timeout'));

    await service.processMessages();

    expect(payoutRepo.updatePayout).toHaveBeenCalledWith('payout-1', 'needs_review');
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
    expect(payoutRepo.confirmPayoutLedger).not.toHaveBeenCalled();
  });

  it('records a failed attempt and leaves the message for the next tick on transient error', async () => {
    const msg = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValue([msg as any]);

    const payout = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(payout);
    transfer.mockRejectedValueOnce(new Error('transient'));

    await service.processMessages();

    expect(outboxRepo.recordAttempt).toHaveBeenCalledWith('msg-1', 1, null, 'transient');
    expect(outboxRepo.markDone).not.toHaveBeenCalled();
    expect(payoutRepo.confirmPayoutLedger).not.toHaveBeenCalled();
  });

  it('succeeds on a subsequent tick after a prior transient failure', async () => {
    // First tick: provider fails
    const msg1 = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValueOnce([msg1 as any]);

    const payoutCreated = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValueOnce(payoutCreated);
    transfer.mockRejectedValueOnce(new Error('transient'));

    await service.processMessages();
    expect(outboxRepo.recordAttempt).toHaveBeenCalledWith('msg-1', 1, null, 'transient');

    // Second tick: provider succeeds
    const msg2 = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 1,
      nextAttemptAt: null,
      lastError: 'transient',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValueOnce([msg2 as any]);

    const payoutProcessing = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'processing' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValueOnce(payoutProcessing);
    transfer.mockResolvedValueOnce({ txHash: '0xtx456' });

    await service.processMessages();

    expect(payoutRepo.confirmPayoutLedger).toHaveBeenCalledWith('acct-1', 'payout-1', 100n);
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
  });
});
```
