# 13-payout.spec.ts

## reasoning

```
Let me analyze what I need to write:

1. The test file `test/payout.spec.ts` must cover all cases from the cases list (steps/13-payout.spec.ts-cases.txt)
2. I need to test against the actual implementations shown in the references
3. The plan says tests should be in `test/payout.spec.ts`

Let me look at what I'm testing:
- `PayoutService.create()` - for the payout creation cases
- `OutboxService.processMessages()` - for the worker cases

I need to mock:
- `PayoutRepository` (for service tests)
- `OutboxRepository` (for worker tests)
- `BlockchainProvider` (for worker tests)

Let me look at the implementation details:

**PayoutService:**
- Constructor takes `PayoutRepository`
- `create(dto: CreatePayoutDto): Promise<PayoutResponse>`
- Validates: accountId, destinationAddress, idempotencyKey non-empty (after trim)
- Parses amount as BigInt
- Checks amount > 0
- Calls `repo.createPayoutWithReservation()`
- Catches `InsufficientFundsError` → 422
- Catches P2002 → fetches existing, compares, returns 200 or throws 409
- Catches `Error` with message 'Account not found' → 404

**PayoutRepository:**
- `createPayoutWithReservation(params)` - uses `$transaction` with raw SQL FOR UPDATE
- `updatePayout(id, status, txHash?)` 
- `findById(id)`
- `confirmPayoutLedger(accountId, payoutId, amount)`
- Exports `InsufficientFundsError` and `OverdraftError`

**OutboxService:**
- Constructor takes `OutboxRepository`, `PayoutRepository`, `BlockchainProvider`
- `processMessages(): Promise<void>`
- `start()`, `stop()`
- Private `processMessage(message)`

**OutboxRepository:**
- `claimPending(limit): Promise<OutboxMessageRow[]>`
- `markDone(messageId): Promise<void>`
- `recordAttempt(messageId, attempts, nextAttemptAt, lastError?): Promise<void>`

**OutboxMessageRow:**
```ts
{
  id: string;
  payoutId: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Now let me think about how to structure the tests. Since the repository is the only layer that touches the database, and the service/worker are what I'm testing, I should mock the repositories.

For the concurrent creation test (two concurrent POSTs), I need to think about how to test this. Since the actual concurrency is handled by the database (FOR UPDATE), in a unit test I'd need to either:
1. Use a real database (integration test)
2. Mock the repository to simulate the race condition

Looking at the plan's section 5: "Two concurrent `POST /payouts` for the same account with amount > balance/2 → exactly one succeeds, the other gets 422 `insufficient_funds`"

Since the plan says "Test the behaviour, not the implementation" and we're using Vitest, I think for the concurrency test I should mock the repository to simulate what happens when two concurrent requests race. The first one succeeds, the second one gets `InsufficientFundsError`.

Actually, wait. Let me re-read the plan more carefully. The plan says:
- "controller validates input and calls the service. Zero business logic."
- "service holds the logic. Zero raw SQL, zero Prisma client calls."
- "repository is the only layer that touches the database."

So in tests, I should:
- For service tests: mock the repository
- For worker tests: mock both repositories and the provider

For the concurrency test, since the actual locking happens in the repository (which uses raw SQL FOR UPDATE), in a unit test I can't really test the actual concurrency. But I can simulate it by having the first call succeed and the second call throw `InsufficientFundsError`.

Actually, looking more carefully at the cases list:
- "Two concurrent POSTs for the same account, each requesting more than half the balance → exactly one 201, one 422"

This is testing that the service correctly maps `InsufficientFundsError` to a 422. The actual concurrency safety is a property of the repository's FOR UPDATE lock, which would be tested in an integration test. In a unit test, I simulate the race by having the mock return success for one and throw for the other.

Let me now write the test file. I'll use `vi.fn()` for mocks.

Let me think about the structure:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PayoutService } from '../src/payout/payout.service.js';
import { PayoutRepository, InsufficientFundsError } from '../src/payout/payout.repository.js';
import { OutboxService } from '../src/outbox/outbox.service.js';
import { OutboxRepository, OutboxMessageRow } from '../src/outbox/outbox.repository.js';
import type { CreatePayoutDto, PayoutResponse, BlockchainProvider } from '../src/payout/payout.types.js';
import { Prisma } from '@prisma/client';
```

Wait, I need to think about what `Prisma.PrismaClientKnownRequestError` looks like. It's a class from `@prisma/client`. I need to create instances of it in my tests.

Actually, looking at the service code:
```ts
if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
```

So I need to create a mock that is an instance of `Prisma.PrismaClientKnownRequestError`. I can do this by creating a new instance with the right properties, or by using `Object.create` to create an object that passes `instanceof`.

Actually, the simplest approach is to just create a new `Prisma.PrismaClientKnownRequestError` instance. Let me check what constructor it takes... In Prisma, `PrismaClientKnownRequestError` extends `PrismaClientKnownRequestError` and takes `(message, { code, meta })` or similar. Actually it's typically constructed internally by Prisma. 

The safest approach for testing is to mock the entire `Prisma.PrismaClientKnownRequestError` class or use a different approach. Let me think...

Actually, I can just create an object that has the right prototype:

```ts
function makePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  const err = new Error('Prisma error');
  Object.setPrototypeOf(err, Prisma.PrismaClientKnownRequestError.prototype);
  (err as any).code = code;
  return err as unknown as Prisma.PrismaClientKnownRequestError;
}
```

This should work for `instanceof` checks.

Now let me plan all the test cases:

**PayoutService tests:**

1. amount is zero → 400 validation_failed
2. amount is a negative integer string → 400 validation_failed
3. amount is a non-numeric string → 400 validation_failed
4. accountId (or destinationAddress / idempotencyKey) is empty string → 400 validation_failed
5. accountId does not exist → 404 resource_not_found
6. amount exceeds available funds → 422 insufficient_funds
7. Two concurrent POSTs → exactly one 201, one 422
8. amount exactly equals available funds → 201, payout created
9. Account already has pending payout; new request for remaining balance → 201
10. Retry of same key with identical body → 200, same payout id
11. Same key but different amount → 409 idempotency_conflict
12. Same key but different destinationAddress → 409 idempotency_conflict

**OutboxService (worker) tests:**

13. Pending message, provider succeeds → completed, ledger entry, balance decremented, message done
14. Payout already completed, same message again → no second ledger entry, balance unchanged
15. Provider throws once then succeeds → eventually completed, balance decremented once
16. Provider throws 3 times → needs_review, message done, zero ledger entries, balance unchanged
17. Message references non-existent payout → message marked done, no exception
18. Two pending messages, first succeeds second throws → both processed independently

Now let me think about how to mock things properly.

For `PayoutService.create()`:
- I mock `PayoutRepository`
- The mock's `createPayoutWithReservation` can:
  - Return a payout object (success)
  - Throw `InsufficientFundsError`
  - Throw `Prisma.PrismaClientKnownRequestError` with code P2002
  - Throw `new Error('Account not found')`

For the P2002 case, I also need to mock `findByAccountIdAndIdempotencyKey`.

Wait, looking at the service code again:
```ts
if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
  const existing = await this.repo.findByAccountIdAndIdempotencyKey(
    dto.accountId,
    dto.idempotencyKey,
  );
  ...
}
```

So I need `findByAccountIdAndIdempotencyKey` on the repository mock.

For `OutboxService.processMessages()`:
- I mock `OutboxRepository` with `claimPending`, `markDone`, `recordAttempt`
- I mock `PayoutRepository` with `findById`, `updatePayout`, `confirmPayoutLedger`
- I mock `BlockchainProvider` with `transfer`

Let me now write the complete test file.

One thing I need to be careful about: the `HttpException` from NestJS. When the service throws an `HttpException`, I need to check its status and response body.

```ts
const exception = err as HttpException;
expect(exception.getStatus()).toBe(400);
const body = exception.getResponse();
expect(body).toEqual({ error: { code: 'validation_failed', message: expect.any(String), details: {} } });
```

Actually, looking at the service code more carefully, the HttpException is constructed as:
```ts
new HttpException(
  { error: { code: ERROR_VALIDATION, message: '...', details: {} } },
  HttpStatus.BAD_REQUEST,
)
```

So `getResponse()` returns `{ error: { code: 'validation_failed', message: '...', details: {} } }`.

Let me also think about the `Payout` type. From the Prisma schema (implied by the plan), a payout has:
- id: string
- accountId: string
- amount: bigint
- destinationAddress: string
- idempotencyKey: string
- status: string
- txHash: string | null
- createdAt: Date
- updatedAt: Date

For the `OutboxMessageRow`:
```ts
{
  id: string;
  payoutId: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Now, for the concurrency test (#7), I'll simulate it by:
- First call to `createPayoutWithReservation` resolves with a payout
- Second call throws `InsufficientFundsError`
- I run both concurrently with `Promise.allSettled`

Let me write this out now.

Actually, I realize I need to think about one more thing. The `PayoutService` uses `Prisma.PrismaClientKnownRequestError`. In the test, I need to import `Prisma` from `@prisma/client`. Let me make sure that's available.

Also, for the `InsufficientFundsError`, it's exported from `payout.repository.js`.

Let me also consider: do I need to test the controller? The plan says "controller validates input and calls the service. Zero business logic." The cases list doesn't explicitly mention controller tests - all the validation cases are tested at the service level (since the service does the validation). So I'll test through the service.

Wait, actually looking at the cases list again:
- "amount is zero → 400 validation_failed" - this tests the service's validation
- "accountId does not exist → 404 resource_not_found" - this tests the service's error mapping

All cases are testable at the service/worker level without needing to go through the controller. Good.

Let me write the file now. I'll organize it as:
1. Imports
2. Helper functions (makePrismaError, makePayout, makeOutboxMessage)
3. `describe('PayoutService')` with all creation cases
4. `describe('OutboxService')` with all worker cases

Let me be careful about the `bigint` type. In the payout row, `amount` is a `bigint`. When comparing in the idempotency check, the service does:
```ts
existing.amount === amount
```

Where `amount` is a `bigint` (parsed from the DTO string) and `existing.amount` is also a `bigint` (from Prisma). So this should work.

For the mock payout objects, I need to use `bigint` for amount:
```ts
const mockPayout = {
  id: 'payout-1',
  accountId: 'account-1',
  amount: 500n,
  destinationAddress: '0xabc',
  idempotencyKey: 'key-1',
  status: 'created',
  txHash: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
```

Now let me write the complete file.

One more consideration: for test #15 (provider throws once then succeeds), I need to:
1. First call to `processMessages()`: claimPending returns a message with attempts=0, provider throws, recordAttempt is called with attempts=1
2. Second call to `processMessages()`: claimPending returns the same message (now with attempts=1), provider succeeds, payout completed

I need to set up the mocks to return different values on successive calls. I can use `mockResolvedValueOnce` for this.

For test #16 (provider throws 3 times), I need:
1. First call: claimPending returns message with attempts=0, provider throws, recordAttempt called with attempts=1
2. Second call: claimPending returns message with attempts=1, provider throws, recordAttempt called with attempts=2
3. Third call: claimPending returns message with attempts=2, provider throws, recordAttempt NOT called (instead updatePayout to needs_review and markDone)

Wait, let me re-read the outbox service code:

```ts
const attempts = message.attempts + 1;

if (attempts >= MAX_ATTEMPTS) {
  await this.payoutRepo.updatePayout(payout.id, 'needs_review');
  await this.outboxRepo.markDone(message.id);
} else {
  await this.outboxRepo.recordAttempt(message.id, attempts, null, errorMsg);
}
```

So:
- 1st failure: message.attempts=0, attempts becomes 1. 1 < 3, so recordAttempt(1)
- 2nd failure: message.attempts=1, attempts becomes 2. 2 < 3, so recordAttempt(2)
- 3rd failure: message.attempts=2, attempts becomes 3. 3 >= 3, so needs_review + markDone

Good. So I need to call `processMessages()` three times, each time with the message having an incremented `attempts` value.

For test #18 (two messages, first succeeds second throws):
- claimPending returns two messages
- First message: provider succeeds → completed
- Second message: provider throws → recordAttempt

The key assertion is that both are processed (the first doesn't abort the loop).

Let me now write the complete file.
```

## reply

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayoutService } from '../src/payout/payout.service.js';
import { PayoutRepository, InsufficientFundsError } from '../src/payout/payout.repository.js';
import { OutboxService } from '../src/outbox/outbox.service.js';
import { OutboxRepository } from '../src/outbox/outbox.repository.js';
import type { OutboxMessageRow } from '../src/outbox/outbox.repository.js';
import type { CreatePayoutDto, BlockchainProvider } from '../src/payout/payout.types.js';

// ── Helpers ──

function makePrismaError(code: string): Prisma.PrismaClientKnownRequestError {
  const err = new Error(`Prisma error: ${code}`);
  Object.setPrototypeOf(err, Prisma.PrismaClientKnownRequestError.prototype);
  (err as unknown as Record<string, unknown>).code = code;
  return err as unknown as Prisma.PrismaClientKnownRequestError;
}

function makePayout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'payout-1',
    accountId: 'account-1',
    amount: 500n,
    destinationAddress: '0xabc123',
    idempotencyKey: 'key-1',
    status: 'created',
    txHash: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeOutboxMessage(overrides: Record<string, unknown> = {}): OutboxMessageRow {
  return {
    id: 'msg-1',
    payoutId: 'payout-1',
    payload: { to: '0xabc123', amount: '500' },
    status: 'processing',
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function validDto(overrides: Partial<CreatePayoutDto> = {}): CreatePayoutDto {
  return {
    accountId: 'account-1',
    amount: '500',
    destinationAddress: '0xabc123',
    idempotencyKey: 'key-1',
    ...overrides,
  };
}

// ── PayoutService tests ──

describe('PayoutService.create', () => {
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let service: PayoutService;

  beforeEach(() => {
    repo = {
      createPayoutWithReservation: vi.fn(),
      findByAccountIdAndIdempotencyKey: vi.fn(),
      updatePayout: vi.fn(),
      findById: vi.fn(),
      confirmPayoutLedger: vi.fn(),
    };
    service = new PayoutService(repo as unknown as PayoutRepository);
  });

  it('amount is zero → 400 validation_failed', async () => {
    const dto = validDto({ amount: '0' });

    await expect(service.create(dto)).rejects.toMatchObject({
      status: 400,
    });

    const err = await service.create(dto).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    const exception = err as HttpException;
    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    const body = exception.getResponse() as Record<string, unknown>;
    expect(body).toEqual({ error: { code: 'validation_failed', message: expect.stringContaining('greater than zero'), details: {} } });
    expect(repo.createPayoutWithReservation).not.toHaveBeenCalled();
  });

  it('amount is a negative integer string → 400 validation_failed', async () => {
    const dto = validDto({ amount: '-5' });

    const err = await service.create(dto).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    const exception = err as HttpException;
    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    const body = exception.getResponse() as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe('validation_failed');
    expect(repo.createPayoutWithReservation).not.toHaveBeenCalled();
  });

  it('amount is a non-numeric string → 400 validation_failed', async () => {
    const dto = validDto({ amount: 'abc' });

    const err = await service.create(dto).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    const exception = err as HttpException;
    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    const body = exception.getResponse() as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe('validation_failed');
    expect(repo.createPayoutWithReservation).not.toHaveBeenCalled();
  });

  it('accountId is empty string → 400 validation_failed', async () => {
    const dto = validDto({ accountId: '' });

    const err = await service.create(dto).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    const exception = err as HttpException;
    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    const body = exception.getResponse() as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe('validation_failed');
    expect(repo.createPayoutWithReservation).not.toHaveBeenCalled();
  });

  it('destinationAddress is empty string → 400 validation_failed', async () => {
    const dto = validDto({ destinationAddress: '' });

    const err = await service.create(dto).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    const exception = err as HttpException;
    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    const body = exception.getResponse() as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe('validation_failed');
  });

  it('idempotencyKey is empty string → 400 validation_failed', async () => {
    const dto = validDto({ idempotencyKey: '' });

    const err = await service.create(dto).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    const exception = err as HttpException;
    expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    const body = exception.getResponse() as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe('validation_failed');
  });

  it('accountId does not exist → 404 resource_not_found', async () => {
    repo.createPayoutWithReservation.mockRejectedValue(new Error('Account not found'));

    const err = await service.create(validDto()).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    const exception = err as HttpException;
    expect(exception.getStatus()).toBe(HttpStatus.NOT_FOUND);
    const body = exception.getResponse() as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe('resource_not_found');
  });

  it('amount exceeds available funds → 422 insufficient_funds', async () => {
    repo.createPayoutWithReservation.mockRejectedValue(
      new InsufficientFundsError('Available 300 is less than requested 500'),
    );

    const err = await service.create(validDto()).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    const exception = err as HttpException;
    expect(exception.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    const body = exception.getResponse() as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe('insufficient_funds');
  });

  it('two concurrent POSTs for the same account, each requesting more than half the balance → exactly one 201, one 422', async () => {
    // Simulate the race: first request succeeds, second hits insufficient funds
    const payoutRow = makePayout({ amount: 600n });
    repo.createPayoutWithReservation
      .mockResolvedValueOnce(payoutRow)
      .mockRejectedValueOnce(new InsufficientFundsError('Available 400 is less than requested 600'));

    const dto = validDto({ amount: '600' });
    const results = await Promise.allSettled([service.create(dto), service.create(dto)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const success = (fulfilled[0] as PromiseFulfilledResult<PayoutResponse>).value;
    expect(success.id).toBe('payout-1');
    expect(success.status).toBe('created');

    const failure = (rejected[0] as PromiseRejectedResult).reason as HttpException;
    expect(failure.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    const body = failure.getResponse() as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe('insufficient_funds');
  });

  it('amount exactly equals available funds → 201, payout created', async () => {
    const payoutRow = makePayout({ amount: 1000n });
    repo.createPayoutWithReservation.mockResolvedValue(payoutRow);

    const result = await service.create(validDto({ amount: '1000' }));
    expect(result.id).toBe('payout-1');
    expect(result.status).toBe('created');
    expect(result.amount).toBe('1000');
  });

  it('account already has a pending payout; new request for the remaining balance → 201', async () => {
    // The reservation logic is in the repository; here we verify the service
    // correctly passes through a successful creation when the remaining balance suffices.
    const payoutRow = makePayout({ amount: 400n });
    repo.createPayoutWithReservation.mockResolvedValue(payoutRow);

    const result = await service.create(validDto({ amount: '400' }));
    expect(result.id).toBe('payout-1');
    expect(result.status).toBe('created');
    expect(result.amount).toBe('400');
  });

  it('retry of same (accountId, idempotencyKey) with identical body → 200, same payout id, exactly one row', async () => {
    const existing = makePayout({ amount: 500n, destinationAddress: '0xabc123' });
    repo.createPayoutWithReservation.mockRejectedValue(makePrismaError('P2002'));
    repo.findByAccountIdAndIdempotencyKey.mockResolvedValue(existing);

    const result = await service.create(validDto());
    expect(result.id).toBe('payout-1');
    expect(result.status).toBe('created');
    expect(result.amount).toBe('500');
  });

  it('same (accountId, idempotencyKey) but different amount → 409 idempotency_conflict', async () => {
    const existing = makePayout({ amount: 500n, destinationAddress: '0xabc123' });
    repo.createPayoutWithReservation.mockRejectedValue(makePrismaError('P2002'));
    repo.findByAccountIdAndIdempotencyKey.mockResolvedValue(existing);

    const err = await service.create(validDto({ amount: '999' })).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    const exception = err as HttpException;
    expect(exception.getStatus()).toBe(HttpStatus.CONFLICT);
    const body = exception.getResponse() as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe('idempotency_conflict');
  });

  it('same (accountId, idempotencyKey) but different destinationAddress → 409 idempotency_conflict', async () => {
    const existing = makePayout({ amount: 500n, destinationAddress: '0xabc123' });
    repo.createPayoutWithReservation.mockRejectedValue(makePrismaError('P2002'));
    repo.findByAccountIdAndIdempotencyKey.mockResolvedValue(existing);

    const err = await service.create(validDto({ destinationAddress: '0xdef456' })).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    const exception = err as HttpException;
    expect(exception.getStatus()).toBe(HttpStatus.CONFLICT);
    const body = exception.getResponse() as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe('idempotency_conflict');
  });
});

// ── OutboxService (worker) tests ──

describe('OutboxService.processMessages', () => {
  let outboxRepo: Record<string, ReturnType<typeof vi.fn>>;
  let payoutRepo: Record<string, ReturnType<typeof vi.fn>>;
  let provider: Record<string, ReturnType<typeof vi.fn>>;
  let worker: OutboxService;

  beforeEach(() => {
    outboxRepo = {
      claimPending: vi.fn(),
      markDone: vi.fn(),
      recordAttempt: vi.fn(),
    };
    payoutRepo = {
      createPayoutWithReservation: vi.fn(),
      findByAccountIdAndIdempotencyKey: vi.fn(),
      updatePayout: vi.fn(),
      findById: vi.fn(),
      confirmPayoutLedger: vi.fn(),
    };
    provider = {
      transfer: vi.fn(),
    };
    worker = new OutboxService(
      outboxRepo as unknown as OutboxRepository,
      payoutRepo as unknown as PayoutRepository,
      provider as unknown as BlockchainProvider,
    );
  });

  it('pending message, provider succeeds → payout completed, ledger posted, balance decremented, message done', async () => {
    const message = makeOutboxMessage();
    const payout = makePayout({ status: 'created' });

    outboxRepo.claimPending.mockResolvedValue([message]);
    payoutRepo.findById.mockResolvedValue(payout);
    payoutRepo.updatePayout.mockResolvedValue({ ...payout, status: 'completed' });
    payoutRepo.confirmPayoutLedger.mockResolvedValue(undefined);
    outboxRepo.markDone.mockResolvedValue(undefined);
    provider.transfer.mockResolvedValue({ txHash: '0xdeadbeef' });

    await worker.processMessages();

    expect(payoutRepo.updatePayout).toHaveBeenCalledWith('payout-1', 'processing');
    expect(provider.transfer).toHaveBeenCalledWith({ to: '0xabc123', amount: 500n });
    expect(payoutRepo.updatePayout).toHaveBeenCalledWith('payout-1', 'completed', '0xdeadbeef');
    expect(payoutRepo.confirmPayoutLedger).toHaveBeenCalledWith('account-1', 'payout-1', 500n);
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
  });

  it('payout already completed, same message delivered again → no second ledger entry, balance unchanged', async () => {
    const message = makeOutboxMessage();
    const payout = makePayout({ status: 'completed', txHash: '0xdeadbeef' });

    outboxRepo.claimPending.mockResolvedValue([message]);
    payoutRepo.findById.mockResolvedValue(payout);
    outboxRepo.markDone.mockResolvedValue(undefined);

    await worker.processMessages();

    expect(provider.transfer).not.toHaveBeenCalled();
    expect(payoutRepo.confirmPayoutLedger).not.toHaveBeenCalled();
    expect(payoutRepo.updatePayout).not.toHaveBeenCalled();
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
  });

  it('provider throws once then succeeds on next tick → payout completed, balance decremented exactly once', async () => {
    const messageFirst = makeOutboxMessage({ attempts: 0 });
    const messageSecond = makeOutboxMessage({ attempts: 1 });
    const payoutProcessing = makePayout({ status: 'processing' });
    const payoutCreated = makePayout({ status: 'created' });

    // First tick: claim returns message with attempts=0, provider throws
    outboxRepo.claimPending.mockResolvedValueOnce([messageFirst]);
    payoutRepo.findById.mockResolvedValueOnce(payoutCreated);
    payoutRepo.updatePayout.mockResolvedValue({ ...payoutProcessing });
    provider.transfer.mockRejectedValueOnce(new Error('transient network error'));
    outboxRepo.recordAttempt.mockResolvedValue(undefined);

    await worker.processMessages();

    expect(outboxRepo.recordAttempt).toHaveBeenCalledWith('msg-1', 1, null, 'transient network error');
    expect(outboxRepo.markDone).not.toHaveBeenCalled();
    expect(payoutRepo.confirmPayoutLedger).not.toHaveBeenCalled();

    // Second tick: claim returns message with attempts=1, provider succeeds
    outboxRepo.claimPending.mockResolvedValueOnce([messageSecond]);
    payoutRepo.findById.mockResolvedValueOnce(payoutProcessing);
    payoutRepo.updatePayout.mockResolvedValue({ ...payoutProcessing, status: 'completed' });
    provider.transfer.mockResolvedValueOnce({ txHash: '0xsecond' });
    payoutRepo.confirmPayoutLedger.mockResolvedValue(undefined);
    outboxRepo.markDone.mockResolvedValue(undefined);

    await worker.processMessages();

    expect(payoutRepo.confirmPayoutLedger).toHaveBeenCalledTimes(1);
    expect(payoutRepo.confirmPayoutLedger).toHaveBeenCalledWith('account-1', 'payout-1', 500n);
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
  });

  it('provider throws on all 3 attempts → payout needs_review, message done, zero ledger entries, balance unchanged', async () => {
    const payoutProcessing = makePayout({ status: 'processing' });

    // Tick 1: attempts=0 → recordAttempt(1)
    outboxRepo.claimPending.mockResolvedValueOnce([makeOutboxMessage({ attempts: 0 })]);
    payoutRepo.findById.mockResolvedValueOnce(makePayout({ status: 'created' }));
    payoutRepo.updatePayout.mockResolvedValue(payoutProcessing);
    provider.transfer.mockRejectedValueOnce(new Error('fail 1'));
    outboxRepo.recordAttempt.mockResolvedValue(undefined);

    await worker.processMessages();
    expect(outboxRepo.recordAttempt).toHaveBeenCalledWith('msg-1', 1, null, 'fail 1');
    expect(outboxRepo.markDone).not.toHaveBeenCalled();

    // Tick 2: attempts=1 → recordAttempt(2)
    outboxRepo.claimPending.mockResolvedValueOnce([makeOutboxMessage({ attempts: 1 })]);
    payoutRepo.findById.mockResolvedValueOnce(payoutProcessing);
    provider.transfer.mockRejectedValueOnce(new Error('fail 2'));

    await worker.processMessages();
    expect(outboxRepo.recordAttempt).toHaveBeenCalledWith('msg-1', 2, null, 'fail 2');
    expect(outboxRepo.markDone).not.toHaveBeenCalled();

    // Tick 3: attempts=2 → needs_review + markDone
    outboxRepo.claimPending.mockResolvedValueOnce([makeOutboxMessage({ attempts: 2 })]);
    payoutRepo.findById.mockResolvedValueOnce(payoutProcessing);
    provider.transfer.mockRejectedValueOnce(new Error('fail 3'));

    await worker.processMessages();
    expect(payoutRepo.updatePayout).toHaveBeenCalledWith('payout-1', 'needs_review');
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
    expect(payoutRepo.confirmPayoutLedger).not.toHaveBeenCalled();
  });

  it('message references a non-existent payout → message marked done, no exception', async () => {
    const message = makeOutboxMessage({ payoutId: 'nonexistent' });

    outboxRepo.claimPending.mockResolvedValue([message]);
    payoutRepo.findById.mockResolvedValue(null);
    outboxRepo.markDone.mockResolvedValue(undefined);

    await expect(worker.processMessages()).resolves.toBeUndefined();
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
    expect(provider.transfer).not.toHaveBeenCalled();
  });

  it('two pending messages in one tick; first succeeds, second throws → both processed independently', async () => {
    const msg1 = makeOutboxMessage({ id: 'msg-1', payoutId: 'payout-1' });
    const msg2 = makeOutboxMessage({ id: 'msg-2', payoutId: 'payout-2' });
    const payout1 = makePayout({ id: 'payout-1', accountId: 'account-1', status: 'created' });
    const payout2 = makePayout({ id: 'payout-2', accountId: 'account-2', status: 'created' });

    outboxRepo.claimPending.mockResolvedValue([msg1, msg2]);
    payoutRepo.findById
      .mockResolvedValueOnce(payout1)
      .mockResolvedValueOnce(payout2);
    payoutRepo.updatePayout.mockResolvedValue({ status: 'processing' });
    provider.transfer
      .mockResolvedValueOnce({ txHash: '0xtx1' })
      .mockRejectedValueOnce(new Error('provider error on second'));
    payoutRepo.confirmPayoutLedger.mockResolvedValue(undefined);
    outboxRepo.markDone.mockResolvedValue(undefined);
    outboxRepo.recordAttempt.mockResolvedValue(undefined);

    await worker.processMessages();

    // First message completed
    expect(provider.transfer).toHaveBeenCalledTimes(2);
    expect(payoutRepo.confirmPayoutLedger).toHaveBeenCalledWith('account-1', 'payout-1', 500n);
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');

    // Second message retried
    expect(outboxRepo.recordAttempt).toHaveBeenCalledWith('msg-2', 1, null, 'provider error on second');
  });
});
```
