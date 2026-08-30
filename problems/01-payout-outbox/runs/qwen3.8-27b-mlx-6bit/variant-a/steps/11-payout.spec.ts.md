# 11-payout.spec.ts

## reply

Let me analyze what's needed here.

I need to write `test/payout.spec.ts` — a Vitest test file for the payout service. The plan specifies tests:

- `concurrent creation against one account`: N racing `createPayout` calls with different idempotency keys against an account holding funds sufficient for exactly K of them → exactly K succeed, N−K throw `insufficient_funds`, and `reserved_amount` == sum of K amounts (no overdraft).
- `duplicate idempotency key`: two `createPayout` with the same key → one creates, the other returns the existing payout; only one payout row and one reservation exist.
- `duplicate message delivery`: `processOneMessage` called twice for the same message → the transfer is debited exactly once (settled_balance drops by `amount` only once), payout reaches `completed`/`sent` exactly once, second call is a no-op.
- `retry exhaustion`: provider always throws; after MAX attempts the message is `dead`, payout is `needs_review`, and the reservation is still held (settled_balance unchanged).
- `transient failure then success`: provider throws once and then succeeds → payout completes, settled_balance debited once, message `done`.
- `insufficient funds on create`: amount > available → `insufficient_funds`, no payout row, reservation unchanged.
- `invalid request`: missing/negative fields → `invalid_request` envelope from the controller.

The manifest says:
```
test/payout.spec.ts | reads: src/payout/payout.service.ts, src/payout/payout.repository.ts, src/payout/provider.types.ts, src/payout/payout.errors.ts | concurrent creation, duplicate delivery, retry exhaustion, transient-then-success
```

Now the tricky part: I don't have a real database. The tests need to test behavior, not implementation. But how do I test concurrency against Postgres without a real DB?

Options:
1. Use real Postgres in the test (DATABASE_URL env var). The plan says config comes from env vars only, and `DATABASE_URL` for Postgres. Tests can run against a real database.
2. Mock the repository.

Hmm. The task says "test behavior, not implementation. Never assert that a call happened." Mocking the repository and asserting calls would be testing implementation. But without a DB, I can't test concurrency behavior at all — the whole point of the concurrent creation test is that two racing requests never overdraft, which depends on the DB's locking/CAS semantics.

Wait — but there's a subtlety here. The reference workspace code shows `payout.repository.ts` using `tx.$queryRaw` with `FOR UPDATE` for reserveFunds. That's real SQL against Postgres. To test that two racing requests never overdraft, I need a real database (or at least a transactional client that serializes).

Given "no tools, no shell, no filesystem" and "everything I can know is above", the tests must be written to run in an environment where Postgres is available via `DATABASE_URL`. That's the defensible reading: the test file creates a PrismaClient from env, seeds an account, and runs tests against it.

Actually, let me think about what's most defensible. The plan says:

- Tests for: concurrent creation against one account, duplicate message delivery, retry exhaustion
- And §5 lists 7 tests.

The manifest line says the test file reads `payout.service.ts`, `payout.repository.ts`, `provider.types.ts`, `payout.errors.ts`. So the test constructs the service with a real repository (real Prisma) and a fake provider. That's behavior testing: real DB, fake provider.

For duplicate message delivery: "processOneMessage called twice for the same message → transfer debited exactly once". But `processOneMessage` is private in the plan. Hmm. The plan says `private processOneMessage(msg: Message)`. In TypeScript, private is compile-time only; in tests we can call it via `(service as any)` or a cast. But "test behavior, not implementation" — the duplicate delivery scenario is really about the worker seeing the same message more than once. The public entry point is `processMessages()`.

How would duplicate delivery manifest through the public API? The worker may see the same message more than once. In this design, `processMessages()` claims pending messages via CAS (`claimMessage` returns false if not pending). So duplicate delivery of an already-processed message: the message status is `done` or `dead`, so `claimNextPendingMessage` won't return it. But at-least-once delivery means the same message could be delivered while still `pending` (e.g., two worker instances, or a redelivery before status update). The CAS handles that: the second claim fails.

So a behavior test for duplicate delivery via `processMessages()`: create a payout, then simulate two concurrent `processMessages()` calls (two workers) → transfer is called exactly once (well, at most… hmm, actually if two workers claim the same message, only one wins the CAS; the other skips. So transfer called exactly once). And settled_balance debited exactly once, payout `sent`/`completed`.

But wait — there's a race: worker A claims message (pending→processing), calls provider, succeeds, marks done. Worker B tries to claim the same message — fails CAS, skips. Good, transfer once.

But there's a nastier duplicate: provider succeeds, DB write fails (crash), message stays `processing`. On restart… the plan doesn't handle stuck `processing` messages (no requeue of stale processing). Hmm, but the test for duplicate delivery in the plan says "processOneMessage called twice for the same message". That's a direct call. Since it's private, the test can call it via a cast. Is that "testing implementation"? The behavior being tested is idempotency of processing a message twice — which is exactly what at-least-once delivery demands. I think the defensible approach: call `processMessages()` concurrently (two in parallel) to simulate duplicate delivery, OR directly invoke the private method via a type assertion.

Hmm, let me think about which is more robust. If I call `processMessages()` twice concurrently:

- Both call `claimNextPendingMessage()` → both get the same message (if both read before either claims).
- Both call `claimMessage(id)` → CAS: one wins, one loses.
- Winner processes: provider.transfer called once, success path: settleOut + status sent + message done.
- Loser skips.

Result: transfer called once, settled debited once, payout sent. This is a clean behavior test of duplicate delivery through the public API.

But there's a timing subtlety: if the first `processMessages()` completes entirely before the second starts, the second sees no pending messages and processes 0. To force overlap, I need both to read the pending message before either claims. With a real DB and async, if I `Promise.all([service.processMessages(), service.processMessages()])`, both start; each does `claimNextPendingMessage` (SELECT). Whether they overlap depends on timing. The SELECTs are fast; the provider call is slow (I can make the fake provider await a delay). But the claim happens before the provider call. So both `claimNextPendingMessage` SELECTs likely execute near-simultaneously, but no guarantee one is before the other's claim.

To make it deterministic, I could have the fake provider's `transfer` delay, but that doesn't help because both claims happen before either transfer. Hmm.

Alternative: use `vi.spyOn` on the repository's `claimNextPendingMessage` to make both return the same message? That's mocking implementation.

Alternative: directly test the duplicate processing behavior by calling the private `processOneMessage` twice on an already-claimed message. The plan literally says: "duplicate message delivery: `processOneMessage` called twice for the same message → transfer debited exactly once (settled_balance drops by `amount` only once), payout reaches `completed`/`sent` exactly once, second call is a no-op."

So the plan explicitly specifies calling `processOneMessage` twice. Since it's private, I'll access it via a cast: `(service as unknown as { processOneMessage(msg: Message): Promise<void> })`. This is the most defensible reading — the plan governs, and it names `processOneMessage`.

Wait, but in the reference workspace snippet, `processOneMessage` begins with "msg is already claimed (processing) by processMessages" and sets payout to processing, calls provider, etc. The workspace snippet is a partial/incomplete draft (has `...` and `wait, updatePayoutStatus doesn't take tx`). The workspace is a reference showing what exists; my test must align with the plan, which governs.

Hmm, but here's the issue: the actual final implementation of `payout.service.ts` is not fully shown — only a fragment. I have to write tests against the plan's signatures:

```ts
createPayout(dto: CreatePayoutDto): Promise<PayoutView>;
processMessages(): Promise<number>; // claims + processes all pending, returns count processed
private processOneMessage(msg: Message): Promise<void>;
```

And the repository signatures are fully shown in the reference. Good — I can rely on those.

Now, `PayoutView` has `id, accountId, amount, destinationAddress, idempotencyKey, status, txHash`. Note: `amount` is `bigint`.

For the duplicate delivery test via direct `processOneMessage` call: I need a `Message` object. I can fetch it via the repository… but the repository has no `getMessage` method! Let me check: repository methods: getAccount, reserveFunds, releaseReserved, settleOut, findPayoutByIdempotencyKey, createPayoutWithMessage, getPayout, updatePayoutStatus, incrementPayoutAttempts, claimNextPendingMessage, claimMessage, setMessageStatus, incrementMessageAttempts.

No `getMessage` or `findMessages`. Hmm. So how does the test get a Message to pass to `processOneMessage`? Options:
1. Use `claimNextPendingMessage()` — returns the oldest pending message. That works: after createPayout, the message is pending; `claimNextPendingMessage()` returns it. Then I need to claim it (CAS) to simulate the worker having claimed it, then call `processOneMessage` twice.

So:
```ts
const msg = await repo.claimNextPendingMessage(); // pending message
await repo.claimMessage(msg.id); // pending -> processing (simulate worker claim)
await (service as any).processOneMessage(msg); // first delivery: provider succeeds
await (service as any).processOneMessage(msg); // duplicate delivery: must be no-op
```

What should the second call do? The plan says "second call is a no-op" and "transfer debited exactly once… payout reaches completed/sent exactly once". So on the second call, since the message is already `done` (set by the first call's success path), `processOneMessage` should detect that and skip. Does the plan specify that `processOneMessage` checks message status? The plan's §4: "For each claimed message: run processOneMessage." and the success path marks message `done`. For idempotency against duplicate delivery, `processOneMessage` should check if the message is still `processing` (or if the payout is already terminal) and skip otherwise.

Hmm, but the plan doesn't explicitly say `processOneMessage` re-checks status. The plan's §1 assumption: "at-least-once is handled by idempotent processing keyed on `messageId`, not by distributed locks." So yes — `processOneMessage` must be idempotent: if the message is no longer `processing` (already done/dead), or the payout is already sent/completed, it's a no-op.

Since I can't see the final implementation, I'll write the test to assert the behavior: after two calls, provider.transfer called exactly once, settled_balance decreased by amount exactly once, payout status is terminal success (`sent` or `completed`), message `done`.

Wait — what's the final payout status after success? The plan's state machine: `created → processing → sent → completed`. Hmm, when does `sent` become `completed`? The state machine shows `sent --(committed)--> completed`. That's odd — what does "committed" mean? Maybe `sent` is set when the txHash is received, and `completed` after… hmm.

Looking at the plan's §4 success path: "in one tx: `settleOut` (debit settled), set payout to `sent` with `txHash`, set message to `done`. Commit." So the success path sets payout to `sent` and message to `done`. Then when does it become `completed`? The state machine's arrow `sent --(committed)--> completed` is ambiguous. Maybe the plan intended the success path to set `completed`? Or maybe `sent` is terminal for the happy path and `completed` is… hmm.

The test spec says: "payout reaches `completed`/`sent` exactly once" — the plan itself hedges with "completed/sent". So in my test, I should assert the payout is in a terminal success state: either `sent` or `completed`. To be safe, I'll assert status is one of ['sent', 'completed'] and txHash is set. That matches the plan's own hedge.

Actually, let me reconsider: maybe the design is that the success path sets `sent`, and then… no, there's no subsequent step in the plan. The message is `done`. I think the plan is a bit inconsistent, and the test's hedge "completed/sent" acknowledges that. I'll assert `['sent', 'completed'].includes(status)`.

Hmm wait, but actually let me reconsider whether the success path might set `completed` directly. Plan §4: "set payout to `sent` with `txHash`". That's explicit. And the state machine shows `sent → completed` on "(committed)". Maybe "committed" means the DB transaction commit — i.e., after the tx commits, the status is effectively completed? That's a stretch. Or maybe there's a second phase where `sent` messages are confirmed… no, the plan has no such worker step.

Given the ambiguity, asserting `sent` or `completed` is the defensible reading. I'll do that.

Now, the bigger issue: test infrastructure. How does the test get a PrismaClient and database?

The plan says config is from env vars only, `DATABASE_URL` for Postgres. The test file should create its own PrismaClient:

```ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient(); // reads DATABASE_URL
```

And for each test: create a fresh account (unique id per test), run, and clean up. Since the tests share one DB, I need isolation: use unique account ids per test (e.g., `test-account-${randomUUID()}`), and clean up in afterEach/afterAll (delete messages, payouts, ledger entries, account).

But wait — does the test environment have Postgres? In this eval context, presumably yes (the task is to write tests that will be run). The instructions say "no tools, no shell, no filesystem. Everything I can know is above." So I just write the file; it will be run in an environment with DATABASE_URL set. That's the defensible reading given the plan's env-var-only config and the requirement to test real concurrency (which requires a real DB with row locking).

Alternatively, I could mock the repository entirely — but then "concurrent creation against one account" wouldn't test anything real (mocks don't race), violating "test behavior, not implementation" and the whole point of requirement 3. And "never assert that a call happened" — with a mocked repo, I'd be asserting calls. So: real Prisma + fake provider. The only thing faked is the blockchain provider, which is explicitly an external SDK to be injected (`PAYOUT_PROVIDER` token) — the plan says "NoopProvider/fake is used in tests".

So the test setup:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PayoutService } from '../src/payout/payout.service.js';
import { PayoutRepository } from '../src/payout/payout.repository.js';
import { PayoutError } from '../src/payout/payout.errors.js';
import type { PayoutProvider } from '../src/payout/provider.types.js';
```

Wait — ESM, `"type": "module"`. Do imports need `.js` extensions? In TypeScript with ESM and NodeNext, yes. But what's the tsconfig? Unknown. The plan's manifest shows imports without extensions in the reference files: e.g., `import { PayoutError } from './payout.errors';` — no extension! The reference repository file uses `from './payout.errors'` and `from './payout.types'`. So this codebase uses extensionless imports (probably bundler module resolution or a test runner that handles it — Vitest handles extensionless TS imports fine). So I'll use extensionless imports: `from '../src/payout/payout.service'`.

Vitest by default resolves TS paths without extensions. Good, I'll match the reference style: extensionless.

Now, how to construct the service? `new PayoutService(repo, provider)`. The plan's signature: `constructor(repo: PayoutRepository, provider: PayoutProvider)`. And the repository: `new PayoutRepository(prisma)`.

But wait — in the reference workspace, `processOneMessage` uses `this.prisma.$transaction(...)` — suggesting the service also holds a prisma client? The fragment shows `await this.prisma.$transaction(async (tx) => {...})`. But the plan's service constructor is `constructor(repo: PayoutRepository, provider: PayoutProvider)` — no prisma. Hmm, the fragment is a draft with issues (the `...` and comments indicate incompleteness). The plan governs: service constructor takes repo + provider. But then how does the service run transactions? The plan says: "transactional multi-step methods take a `tx` client passed by the service, so the service owns the boundary." So the service must have access to a transactional client. If the constructor is only (repo, provider), then the repository must expose something like `withTransaction(fn)` or the service gets prisma from somewhere.

Hmm, this is a real gap. Let me re-read the plan:

"**Repository (the only layer that touches Prisma).** All methods async. Transactional multi-step methods take a `tx` client passed by the service, so the service owns the boundary."

And the service signature:
```ts
export class PayoutService {
  constructor(repo: PayoutRepository, provider: PayoutProvider);
  createPayout(dto: CreatePayoutDto): Promise<PayoutView>;
  processMessages(): Promise<number>;
  private processOneMessage(msg: Message): Promise<void>;
}
```

For the service to pass `tx` to repo methods, it needs a PrismaClient (or an interface exposing `$transaction`). The plan's signature omits it, but the reference repository fragment shows `reserveFunds(tx: Prisma.TransactionClient, ...)` — consistent with the service passing tx. And the workspace service fragment shows `this.prisma.$transaction`. So the actual implementation probably has the service holding prisma. But the plan's signature block shows only two constructor args…

The instructions say: "If a symbol you truly need is missing from both the plan and the references, do not guess silently… write the file using the most defensible reading and mark it with a single `// ASSUMPTION:` comment at the point it matters."

For my test file, what do I need? I need to construct `PayoutService`. If its constructor is `(repo, provider)`, then `new PayoutService(repo, provider)`. If it's `(repo, provider, prisma)` or `(prisma, repo, provider)`, my construction breaks.

Hmm. The test file's manifest reads: `payout.service.ts, payout.repository.ts, provider.types.ts, payout.errors.ts` — no mention of a prisma import in the manifest's "reads" (though the manifest's reads list is about source files read, not imports). The test needs PrismaClient regardless (for seeding/cleanup).

Most defensible reading: follow the plan's signature exactly — `new PayoutService(repo, provider)`. But then how does the service get a tx client? Maybe via `repo.withTransaction`? That's not in the repository signature shown. Or maybe the service receives prisma as a third arg and the plan's signature block is abbreviated.

Actually wait — let me look at the workspace service fragment again: `await this.prisma.$transaction(async (tx) => {`. So the implemented service has `this.prisma`. That means the constructor includes prisma. The plan's signature block is idealized/abbreviated. Since the workspace fragment is what will actually be run against my test (the test must pass against the real implementation), I should construct the service in a way that works with the real implementation.

But I don't know the exact constructor parameter order of the real implementation! The fragment doesn't show the constructor. Ugh.

Let me think about what's most defensible. The plan is "my own spec and governs." The plan says `constructor(repo: PayoutRepository, provider: PayoutProvider)`. I'll follow the plan. If the real implementation has an extra prisma param, then… hmm.

Actually, wait. Let me reconsider. Maybe the service gets prisma via the repository? No — the repository is "the only layer that touches the database", and the service must not touch Prisma directly ("service holds logic. No raw SQL, no Prisma client calls."). Oh! That's a hard constraint from the conventions: "service holds logic. No raw SQL, no Prisma client calls." So the service cannot hold a PrismaClient and call `$transaction` — that's a Prisma client call!

But the plan says "transactional multi-step methods take a `tx` client passed by the service, so the service owns the boundary." For the service to pass a tx client without calling Prisma… the repository must expose a transaction helper. Like:

```ts
// in repository
async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return this.prisma.$transaction(fn);
}
```

And the service calls `this.repo.withTransaction(async (tx) => { await this.repo.reserveFunds(tx, ...); ... })`. That satisfies both: the service owns the boundary (decides what's in the tx), and only the repository touches Prisma.

But `withTransaction` is not in the plan's repository signature list! The plan lists specific methods. Hmm, but the plan's signature block might not be exhaustive — it says "repository (the only layer that touches Prisma)" and lists methods. The `withTransaction` helper is a natural addition.

OK, here's the crux: for my test file, I don't actually need to know how the service gets its tx client. I just need to construct the service. The question is purely: what arguments does `new PayoutService(...)` take?

Given the plan governs and says `(repo, provider)`, I'll write `new PayoutService(repo, provider)`.

Hmm, but wait. Let me reconsider the workspace fragment once more. It shows `this.prisma.$transaction` inside the service. If that's the actual implementation, `new PayoutService(repo, provider)` would leave `this.prisma` undefined and tests would fail. But the fragment is explicitly a messy draft (contains `...`, "wait, updatePayoutStatus doesn't take tx", "or dead?"). It's shown as a reference to the workspace state, not the final implementation. The instructions say the plan governs. And the conventions forbid Prisma calls in the service. So the final implementation probably routes transactions through the repository.

I'll go with `new PayoutService(repo, provider)` per the plan, and add an ASSUMPTION comment if needed. Actually — do I need an ASSUMPTION comment? The rule: "If a symbol you truly need is missing from both the plan and the references, do not guess silently… mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point it matters."

The service constructor signature is in the plan. So I'm not guessing — I'm following the plan. No ASSUMPTION needed for that.

What about `processOneMessage` being private? The plan explicitly names it as the unit for duplicate delivery testing. Accessing a private method from a test via a cast is a standard technique. I'll use a typed helper:

```ts
type PayoutServiceInternals = { processOneMessage(msg: Message): Promise<void> };
const internals = service as unknown as PayoutServiceInternals;
await internals.processOneMessage(msg);
```

I need the `Message` type — from `@prisma/client`. The plan's types don't define Message; the repository uses `Message` from `@prisma/client`. So I'll import types from `@prisma/client`: `import type { Message } from '@prisma/client';` — wait, do I need it? For the cast signature, yes, or I could use a looser type. Actually, `claimNextPendingMessage()` returns `Promise<Message | null>` where Message is from @prisma/client. So the variable already has that type; I just need to pass it to the cast function. The cast's parameter type can be `Message` imported from '@prisma/client'. That's clean.

Now, the test details:

**Setup:**
```ts
const prisma = new PrismaClient();

function makeProvider(impl: PayoutProvider['transfer']): PayoutProvider {
  return { transfer: impl };
}
```

For each test, create a service with a fresh repository? The repository holds prisma; sharing one is fine. I'll create one prisma, one repo, and per-test services with different fake providers.

Account seeding:
```ts
async function seedAccount(settledBalance: bigint): Promise<string> {
  const id = `acct-${randomUUID()}`;
  await prisma.account.create({ data: { id, settledBalance, reservedAmount: 0n } });
  return id;
}
```

Wait — the account model: `id` String PK, `settled_balance` BigInt default? The plan says `settled_balance` BigInt — no default mentioned. `reserved_amount` BigInt. `created_at` DateTime default now. So create with `data: { id, settledBalance, reservedAmount: 0n }`. Does the schema have defaults for these? The plan doesn't say default for balances, so I'll pass them explicitly.

Hmm, one concern: BigInt in Prisma create data — yes, Prisma supports `bigint` fields with JS `BigInt`. Good.

Cleanup: after each test, delete the account's data. Order matters for FKs: messages → payouts (messages reference payouts; ledger entries reference payouts) → ledger_entries → payouts → account. Let me define:

```ts
async function cleanupAccount(accountId: string): Promise<void> {
  const payouts = await prisma.payout.findMany({ where: { accountId } });
  const payoutIds = payouts.map(p => p.id);
  await prisma.message.deleteMany({ where: { payoutId: { in: payoutIds } } });
  await prisma.ledgerEntry.deleteMany({ where: { accountId } });
  await prisma.payout.deleteMany({ where: { accountId } });
  await prisma.account.delete({ where: { id: accountId } });
}
```

I'll track created account ids in a set and clean up in afterEach. Or simpler: each test creates its own account id, pushes to an array, and afterEach cleans up all. Let me do:

```ts
const accountIds: string[] = [];
afterEach(async () => {
  for (const id of accountIds.splice(0)) await cleanupAccount(id);
});
afterAll(async () => { await prisma.$disconnect(); });
```

Actually, a helper `createAccount(balance)` that registers the id for cleanup:

```ts
async function createAccount(settledBalance: bigint): Promise<string> {
  const id = `acct-${randomUUID()}`;
  accountIds.push(id);
  await prisma.account.create({ data: { id, settledBalance, reservedAmount: 0n } });
  return id;
}
```

**Test 1: concurrent creation against one account.**

Account with funds sufficient for exactly K of N. Say N=5 racing requests, each 1000n, account settled 3000n → exactly 3 succeed, 2 fail with insufficient_funds. reserved_amount == 3000n.

```ts
it('concurrent creation against one account never overdrafts', async () => {
  const provider = makeProvider(async () => ({ txHash: '0xnever' })); // never called; creation doesn't transfer
  const service = new PayoutService(repo, provider);
  const accountId = await createAccount(3000n);

  const results = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      service.createPayout({
        accountId,
        amount: 1000n,
        destinationAddress: `dest-${i}`,
        idempotencyKey: `key-${randomUUID()}`,
      }),
    ),
  );

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');
  expect(fulfilled.length).toBe(3);
  expect(rejected.length).toBe(2);
  for (const r of rejected) {
    expect(r.reason).toBeInstanceOf(PayoutError);
    expect((r.reason as PayoutError).code).toBe('insufficient_funds');
  }

  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  expect(account.reservedAmount).toBe(3000n);
  expect(account.settledBalance).toBe(3000n); // settled unchanged until provider confirms
});
```

Wait — is `Promise.allSettled` with 5 concurrent real-DB transactions enough to actually race? Each createPayout runs a transaction: SELECT ... FOR UPDATE on the account row, check, increment. The FOR UPDATE serializes them. With 5 concurrent, exactly 3 get through (each holds 1000; 3000 available). This is deterministic regardless of interleaving because the lock serializes and each re-reads after acquiring the lock (the SELECT FOR UPDATE happens inside the tx, so each transaction reads the latest committed reserved_amount after acquiring the lock). Yes — deterministic: 3 succeed, 2 fail.

One caveat: Prisma's interactive transactions and `$queryRaw` with FOR UPDATE — the SELECT FOR UPDATE must be within the same transaction as the update. The reference repository does `tx.$queryRaw` then `tx.account.update` — same tx. Good.

Another caveat: Prisma interactive transactions have a default timeout (5s). 5 serialized txs will be fast. Fine.

Also: should I assert that the fulfilled payouts are distinct (different ids)? Yes, good behavior assertion:

```ts
const ids = fulfilled.map(r => (r.value as PayoutView).id);
expect(new Set(ids).size).toBe(3);
```

And each fulfilled view has status 'created'. Good.

Also, the plan says "exactly K succeed, N−K throw insufficient_funds, and reserved_amount == sum of K amounts (no overdraft)". My assertions cover that.

**Test 2: duplicate idempotency key.**

```ts
it('duplicate idempotency key returns the existing payout without double-reserving', async () => {
  const service = new PayoutService(repo, makeProvider(async () => ({ txHash: '0x' })));
  const accountId = await createAccount(5000n);
  const dto = { accountId, amount: 1500n, destinationAddress: 'dest', idempotencyKey: `key-${randomUUID()}` };

  const first = await service.createPayout(dto);
  const second = await service.createPayout(dto);

  expect(second.id).toBe(first.id);

  const payouts = await prisma.payout.findMany({ where: { accountId } });
  expect(payouts).toHaveLength(1);

  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  expect(account.reservedAmount).toBe(1500n);

  const entries = await prisma.ledgerEntry.findMany({ where: { accountId, type: 'reserve' } });
  expect(entries).toHaveLength(1);
});
```

The plan says: "two createPayout with the same key → one creates, the other returns the existing payout; only one payout row and one reservation exist." My assertions: same id, one payout row, reservedAmount == 1500n (not 3000n), one reserve ledger entry.

Note: the plan's error list includes `duplicate_idempotency_key` (409 on create) — but the requirement says "retrying with the same idempotencyKey must not create a second payout or double-reserve funds", and plan §5 says the duplicate returns the existing payout. There's a slight tension: the error code exists but the behavior per §5 is to return the existing. I'll follow §5 (return existing). The `duplicate_idempotency_key` error is probably for… hmm, actually maybe not used, or for a different case. I'll follow §5's test spec.

**Test 3: duplicate message delivery.**

Per plan: "processOneMessage called twice for the same message → transfer debited exactly once (settled_balance drops by amount only once), payout reaches completed/sent exactly once, second call is a no-op."

```ts
it('duplicate message delivery debits the ledger exactly once', async () => {
  const transfer = vi.fn(async () => ({ txHash: '0xdup' }));
  const service = new PayoutService(repo, { transfer });
  const accountId = await createAccount(4000n);

  const payout = await service.createPayout({ accountId, amount: 1200n, destinationAddress: 'dest', idempotencyKey: `key-${randomUUID()}` });

  const msg = await repo.claimNextPendingMessage();
  expect(msg).not.toBeNull();
  expect(await repo.claimMessage(msg!.id)).toBe(true); // simulate worker claim

  const internals = service as unknown as { processOneMessage(m: Message): Promise<void> };
  await internals.processOneMessage(msg!);
  await internals.processOnMessage... 
```

Wait, careful: after the first `processOneMessage` succeeds, the message is `done`. The second call must be a no-op. But does `processOneMessage` re-read the message status? It takes `msg` (the stale object with status 'processing'). The implementation must re-check the DB state (message status or payout status) to be idempotent. The plan's §1: "at-least-once is handled by idempotent processing keyed on messageId". So yes.

Assertions after two calls:
- `transfer` called exactly once: `expect(transfer).toHaveBeenCalledTimes(1)`. Hmm — "never assert that a call happened" — but here the assertion is about the count of side effects (exactly-once debit), which is behavior. The transfer call count is a proxy for "how many times did we ask the provider to move money" — that's the real behavior concern (double transfer = double payment!). Combined with the DB assertion (settled dropped exactly once), it's a behavior assertion, not a mere call spy. I think it's justified: the plan literally says "transfer debited exactly once". Actually, the DB assertion alone (settledBalance == 4000n - 1200n) proves exactly-once debit. The transfer call count proves we didn't ask the provider twice (which would be a real double-payment even if the ledger guarded it). Both are behavior. I'll keep both, but anchor on DB state.

- settledBalance == 2800n (4000 - 1200).
- reservedAmount: what should it be after success? Success path: `settleOut` (debit settled). What about the reservation? At create, we reserved 1200. On success, the funds are actually gone — settled debited by 1200. If we also release the reservation (decrement reserved by 1200), then available = settled - reserved = 2800 - 0 = 2800. Correct. If we don't release, available = 2800 - 1200 = 1600 — wrong, funds double-counted as unavailable.

The workspace fragment shows the success path doing both `releaseReserved` and `settleOut`. And the plan's §4 says "success: in one tx: settleOut (debit settled), set payout to sent with txHash, set message to done". Hmm — the plan's §4 success path doesn't mention releaseReserved! But the workspace fragment does. And logically, we must release the reservation on success (the reservation was a hold; now it's actually debited from settled).

Wait, let me think about the accounting. At create: reserved += 1200. Available = settled - reserved. On success: we want the account to lose 1200 of available funds permanently. If we only do settleOut (settled -= 1200): available = (4000-1200) - 1200 = 1600. But the account actually has 4000 - 1200 = 2800 of real funds. So available should be 2800 → we must also release the reservation. Yes: success = settleOut + releaseReserved. The workspace fragment confirms: `releaseReserved` then `settleOut`.

So after success: settledBalance = 2800n, reservedAmount = 0n.

Plan §4 omits releaseReserved in the success path description, but the fragment shows it, and accounting demands it. My test asserts settledBalance 2800n and reservedAmount 0n. Is that "following the plan"? The plan's §1 assumption: "available balance = settled_balance − reserved_amount". For the system to be correct, success must release. I'm confident: assert both.

Hmm, wait. Actually let me double-check with the retry exhaustion test spec: "after MAX attempts the message is dead, payout is needs_review, and the reservation is still held (settled_balance unchanged)". So on exhaustion, reserved stays at amount, settled unchanged. Consistent with my model.

And "transient failure then success: payout completes, settled_balance debited once, message done". Settled debited by amount. Reserved should be released (else available is wrong). I'll assert settled and message done; for reserved, I'll assert 0n in the success tests since it's behaviorally required.

- Payout status: `['sent', 'completed']` and txHash == '0xdup'.
- Message status: 'done'.

**Test 4: retry exhaustion.**

Provider always throws. MAX attempts — plan says `PAYOUT_MAX_ATTEMPTS` env, default 3. How does the service read config? The plan's worker uses ConfigService; the service… the plan's service constructor is (repo, provider) — no config. Hmm! How does the service know MAX attempts?

Options: env var read directly in the service (`process.env.PAYOUT_MAX_ATTEMPTS`), or a constructor param. The plan's signature shows no config param. So the service probably reads `process.env.PAYOUT_MAX_ATTEMPTS ?? '3'` internally, or the default 3 is baked in.

For my test: I should not rely on env being set; the default is 3 per plan. I can set `process.env.PAYOUT_MAX_ATTEMPTS = '3'` in the test to be explicit… but if the service reads env at construction time, setting it before constructing the service works. If the service reads env at call time, also fine. Setting it explicitly in the test makes the test deterministic regardless of ambient env. That's good practice. I'll set it in that test (and maybe beforeAll for all tests to pin behavior).

Hmm, but if the implementation hardcodes 3 and ignores env? Then setting env is harmless. If the implementation reads env with default 3, setting to '3' matches. Either way, my test with MAX=3 works. I'll set `process.env.PAYOUT_MAX_ATTEMPTS = '3'` in beforeAll and note it. Actually — is that overreach? The plan says the retry policy is env-configurable with default 3. Pinning it in tests is standard. I'll do it in beforeAll.

Wait, but there's a subtlety: if the service captures the config value at construction (e.g., `constructor { this.maxAttempts = Number(process.env.PAYOUT_MAX_ATTEMPTS ?? 3) }`), then I must set env before constructing the service. Setting in beforeAll (before any test constructs a service) handles that.

Exhaustion flow: message claimed → attempt 1 fails → attempts=1 < 3 → back to pending. Next processMessages: claim → attempt 2 fails → attempts=2 <3 → pending. Claim → attempt 3 fails → attempts=3 >= 3 → dead + needs_review.

So I need to call `processMessages()` 3 times (each processes the pending message once, since after each failure it goes back to pending until the last). Or call `processOneMessage` directly 3 times? But `processOneMessage` on a `pending` message — the worker claims first. If I call processOneMessage directly without claiming, does it work? The plan says the worker claims then processes. For the exhaustion test via public API, `processMessages()` × 3 is cleaner and tests the real loop.

```ts
it('retry exhaustion marks the message dead and the payout needs_review, holding the reservation', async () => {
  const transfer = vi.fn(async () => { throw new Error('provider down'); });
  const service = new PayoutService(repo, { transfer });
  const accountId = await createAccount(2000n);
  await service.createPayout({ accountId, amount: 800n, destinationAddress: 'dest', idempotencyKey: `key-${randomUUID()}` });

  // MAX attempts = 3 (PAYOUT_MAX_ATTEMPTS pinned in beforeAll)
  await service.processMessages();
  await service.processMessages();
  const processed = await service.processMessages();
  expect(processed).toBe(1);

  expect(transfer).toHaveBeenCalledTimes(3);

  const payout = await prisma.payout.findUniqueOrThrow({ where: { idempotencyKey: ... } });
```

Hmm, I need the payout id — capture from createPayout's return. `const payout = await service.createPayout(...)`.

```ts
  expect(payout.status).toBe('needs_review');
  const msg = await prisma.message.findUniqueOrThrow({ where: { payoutId: payout.id } });
  expect(msg.status).toBe('dead');
  expect(msg.attempts).toBe(3);

  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  expect(account.settledBalance).toBe(2000n); // unchanged — no definitive success
  expect(account.reservedAmount).toBe(800n);   // reservation still held
});
```

Wait — the plan says "after MAX attempts the message is dead". And §4: "if attempts >= MAX → set message to dead, payout to needs_review". With MAX=3: attempt 3 is the third and final; after it fails, attempts=3 >= 3 → dead. So 3 processMessages calls total, transfer called 3 times. The third call returns processed=1 (it did process the message — to dead). The fourth would return 0. I'll assert the third returns 1; maybe also a fourth returning 0 to show it's terminal? That's a nice behavior assertion: "dead messages are not reprocessed". Let me add `expect(await service.processMessages()).toBe(0)`.

Hmm wait, actually — is `processed` counting messages that were claimed? Plan: "processMessages(): claims + processes all pending, returns count processed". The third call claims the message (pending→processing), processes to dead → counted. Fourth: no pending → 0. Good.

Also the payout status transition on failure: plan says "payout stays/returns to processing" on retry, and `needs_review` on dead. I won't assert intermediate status (implementation detail); final state is what matters.

One concern: `vi.fn` for transfer — "never assert that a call happened" — again, `toHaveBeenCalledTimes(3)` is asserting the retry count behavior (bounded retries = exactly MAX provider calls). That's a core requirement ("retry a bounded number of times"). Combined with DB state assertions, it's fine.

**Test 5: transient failure then success.**

```ts
it('transient provider failure is retried and then completes', async () => {
  let calls = 0;
  const transfer = vi.fn(async () => {
    calls++;
    if (calls === 1) throw new Error('timeout');
    return { txHash: '0xok' };
  });
  const service = new PayoutService(repo, { transfer });
  const accountId = await createAccount(2500n);
  const payout = await service.createPayout({ accountId, amount: 900n, destinationAddress: 'dest', idempotencyKey: `key-${randomUUID()}` });

  await service.processMessages(); // attempt 1 fails -> back to pending
  await service.processMessages(); // attempt 2 succeeds

  expect(transfer).toHaveBeenCalledTimes(2);
  expect(payout.status).toBe('sent' or 'completed');
```

Capture fresh: `const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });`
- after.status in ['sent','completed'], txHash '0xok'
- message done, attempts 2
- settled 1600n, reserved 0n

**Test 6: insufficient funds on create.**

```ts
it('create with amount above available balance is rejected without side effects', async () => {
  const service = new PayoutService(repo, makeProvider(...));
  const accountId = await createAccount(100n);
  await expect(service.createPayout({ accountId, amount: 101n, ... })).rejects.toMatchObject({ code: 'insufficient_funds' });
  // no payout row, reservation unchanged
  expect(await prisma.payout.count({ where: { accountId } })).toBe(0);
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  expect(account.reservedAmount).toBe(0n);
});
```

Also available = settled - reserved: account with settled 1000, reserved 900 (via a prior successful create of 900), then a new request for 150 → available 100 < 150 → insufficient. That tests the reserved portion specifically. The plan's test list says "amount > available → insufficient_funds, no payout row, reservation unchanged". I could do the simple version (fresh account, amount > settled). But testing that reserved funds are not double-spent is more behaviorally meaningful. Hmm, let me keep it focused: the plan says "amount > available". I'll do: settled 1000n, first create 900n (succeeds), second create 150n → rejected. That directly proves available = settled − reserved. And assert reservation unchanged (still 900n), no second payout row.

**Test 7: invalid request → controller envelope.**

The plan lists this in §5, but the task line says: "This file: concurrent creation, duplicate delivery, retry exhaustion, transient-then-success". Hmm! The task explicitly scopes the file to those 4 (+ maybe). Let me re-read:

"Write exactly one file: `test/payout.spec.ts`
`PLAN.md` above is your own spec and governs. This file: concurrent creation, duplicate delivery, retry exhaustion, transient-then-success"

So the required tests are those 4. The manifest says: "concurrent creation, duplicate delivery, retry exhaustion, transient-then-success". The plan's §5 has 7 tests including duplicate idempotency key, insufficient funds, invalid request.

"Implement exactly what the plan specifies for this file." — The plan specifies 7 tests in §5, but the task line and manifest narrow it to 4. Which governs? The instructions say PLAN.md governs, but the task line explicitly enumerates what "this file" is. The manifest (part of PLAN.md) says the test file covers exactly those 4. So the plan's own manifest for this file lists 4 tests. The §5 list is the overall test plan; the manifest allocates to this file: concurrent creation, duplicate delivery, retry exhaustion, transient-then-success.

Hmm, but "duplicate idempotency key" is also core requirement 1 (idempotent creation)… The task line is explicit: "This file: concurrent creation, duplicate delivery, retry exhaustion, transient-then-success". I'll include exactly those 4 as the main tests. Should I add the others? "Do not add exports, features, or files the plan does not name." — adding extra tests is adding beyond the named scope. The manifest names 4 test areas for this file. I'll stick to 4 `it` blocks…

Hmm, wait. But let me reconsider: "duplicate message delivery" is one of the 4. And "concurrent creation" — the plan's §5 concurrent creation test is about racing requests with different keys. The duplicate idempotency key test is separate in §5. Since the task line doesn't list it, I'll leave it out. Strictly: 4 tests.

Hmm, actually, let me reconsider once more. The instruction: "Implement exactly what the plan specifies for this file." Plan §5 specifies 7 tests total; the manifest specifies this file covers 4. The task line confirms 4. So: 4 tests. I'm confident.

Now — do I need the controller test (invalid request)? No, not in scope. Good, that also avoids needing to instantiate the controller/HTTP layer.

**Now, the `processMessages` loop concern:** The plan's processMessages: "claims + processes all pending, returns count processed". Reference fragment: loop `claimNextPendingMessage` until null, CAS claim, process. In the exhaustion test, one message per call. Fine.

But wait — a subtle issue with the fragment's loop: after processing a message that fails and goes back to `pending`, the loop calls `claimNextPendingMessage` again → gets the same message → claims it → processes again (attempt 2) in the same processMessages call! So one `processMessages()` call could exhaust all retries (looping until no pending). Hmm! If that's the implementation, then in my exhaustion test, a single `processMessages()` call would do all 3 attempts and end dead.

But the plan says: "processMessages(): claims + processes all pending, returns count processed". If a failed message returns to pending, is it "processed" in this call? The fragment's loop would re-claim and re-process within the same call (infinite retry until dead or success — dangerous: a permanently-failing provider would spin the loop 3 times then dead; that's bounded, OK).

Hmm, this is a real ambiguity: does one `processMessages()` call retry the same message multiple times (loop until terminal), or does it process each pending message once per call?

The fragment shows a `for(;;)` loop that re-fetches pending after each process. If processOneMessage on failure sets the message back to `pending`, the next iteration fetches it again. So yes, the fragment would retry within one call.

But wait — would that be a hot loop? For a failing provider: claim, process (fail), pending, claim, process (fail), pending, … 3 times → dead. Bounded by MAX attempts. OK, not infinite.

For my test robustness: I should write the exhaustion test to work with either semantics. Approach: call `processMessages()` repeatedly until it returns 0, with a safety bound, then assert final state. But asserting "transfer called exactly 3 times" holds under either semantics (total attempts = 3 regardless of how calls are batched). And final state: dead + needs_review. So:

```ts
let total = 0;
for (let i = 0; i < 10; i++) {
  const n = await service.processMessages();
  total += n;
  if (n === 0) break;
}
```

Then assert transfer called 3 times, message dead, payout needs_review. This is robust to both loop semantics. But hmm, `total` — under within-call retry semantics, the first call might return 3 (processed 3 times) or 1… depends on whether "processed" counts attempts or messages. I won't assert `total`; I'll just drain until 0.

Actually wait, is draining "testing behavior"? Yes: "keep polling until the queue settles; the message ends dead after exactly MAX provider attempts". That's the behavior. Good.

Similarly for transient-then-success: drain until 0; assert transfer called twice, final state sent/completed + done.

And duplicate delivery: I'm calling processOneMessage directly (per plan), so no loop concern.

Hmm, but actually — for the duplicate delivery test, should I use processMessages instead? The plan explicitly says "processOneMessage called twice for the same message". I'll follow the plan: direct call via cast.

But wait, there's a wrinkle: for processOneMessage to be called twice on the same message, the first call must leave the message in a state where the second call is a no-op. First call: message claimed (processing) → provider succeeds → tx: settleOut, releaseReserved, payout sent, message done. Second call with the same (stale) msg object: implementation must detect "already done" and skip. How? Re-read message from DB: status 'done' → skip. Or check payout status terminal → skip. Either way, no-op. My test asserts: transfer total 1, settled debited once, payout terminal success once (status sent/completed, txHash set), message done.

But hmm — what if the implementation's idempotency is via CAS on payout status (e.g., updateMany where status='processing')? Still no-op. The behavior assertions hold regardless of mechanism.

One risk: what if the implementation's processOneMessage doesn't re-check and just re-runs (double debit)? Then my test fails — correctly, because that violates the plan ("at-least-once is handled by idempotent processing"). Good — the test enforces the plan.

**Now, getting a Message object.** `repo.claimNextPendingMessage()` returns the oldest pending message. In the duplicate delivery test, there's exactly one pending message (from my createPayout). But — other tests' messages? Each test creates its own account and payout; but `claimNextPendingMessage` is global (any pending message in the table)! If tests run sequentially and each cleans up, there should be no leftover pending messages. But within the duplicate delivery test, after createPayout, my message is pending; if a previous test left a pending message (e.g., transient-then-success drained to done — fine; exhaustion drained to dead — fine), there's a risk. To be safe, I should scope: fetch the message by payoutId. But the repository has no getMessage!

Options:
1. Use prisma directly in the test to fetch the message (tests can touch prisma for setup/assertions — tests are not bound by layer rules; they're the harness). Yes! The test file can use prisma freely for seeding and assertions. So: `const msg = await prisma.message.findUniqueOrThrow({ where: { payoutId: payout.id } });` — wait, is `payoutId` unique on messages? Plan: "payout_id String, FK → payouts.id, unique". Yes! So `findUnique({ where: { payoutId } })`.

2. Then claim it via `repo.claimMessage(msg.id)` (CAS pending→processing) to simulate the worker's claim, then call processOneMessage twice.

Using prisma in the test for reads is fine and avoids global-queue coupling.

Similarly, in the exhaustion/transient tests, I could drive via processMessages (public API) — but the global queue issue: if a pending message from another test lingers, processMessages would process it too. With proper cleanup and draining in each test, there's no leftover pending. But to be extra safe, I could drain the queue in beforeEach? That would call processMessages with a service whose provider is… hmm, needs a service instance. Simpler: rely on each test draining its own queue and cleanup removing rows. Tests in Vitest run sequentially within a file by default (no concurrency unless configured). So no cross-test interference as long as each test ends with no pending messages:
- Concurrent creation test: creates payouts (pending messages!) but never processes them. Uh oh! Those pending messages linger unless cleaned up. My afterEach cleanup deletes them (deleteMany by payoutId). So after the test, no pending rows. But during that test, if I called processMessages, it would be fine — I don't call it there. OK.
- Exhaustion test: drains to dead. Cleanup removes.
- So as long as cleanup is thorough, sequential tests are isolated.

But wait — the concurrent creation test leaves 3 pending messages until afterEach cleanup. If a later test's processMessages runs before that cleanup… no, cleanup is in afterEach, runs before the next test. Fine.

Alternatively, I could make the concurrent creation test also process… no, keep it scoped: creation only.

**Now, `PayoutView.amount` is bigint.** In assertions comparing views, I can use `.toBe(1000n)`. Fine.

**Prisma BigInt columns in assertions:** `account.reservedAmount` is `bigint`. `expect(x).toBe(3000n)` works.

**Now, service construction and the provider token.** The plan says the provider is injected via `PAYOUT_PROVIDER` token in the Nest module. In tests, I construct the service directly (unit/integration level), passing the fake provider. That's consistent with the plan's constructor signature. No Nest testing module needed — simpler and more behavior-focused. The manifest doesn't list controller/module as reads for the test, confirming direct construction.

**Imports from @prisma/client:** `PrismaClient`, and types `Message` (for the cast). Also `Payout`? I use findUniqueOrThrow which returns typed. I need `Message` type explicitly for the internals cast. Import: `import { PrismaClient, type Message } from '@prisma/client';` — hmm, does the generated client export `Message`? The model name is `Message` (table @@map("messages")). Yes, the generated client exports `Message`.

Wait — one concern: is the Prisma client generated in the test environment? The migration exists; presumably `prisma generate` runs. I'll assume so (the reference code imports from '@prisma/client').

**Env pinning:** `process.env.PAYOUT_MAX_ATTEMPTS = '3'` in beforeAll. Should I also pin `PAYOUT_POLL_MS`? The worker isn't started in tests (I don't instantiate PayoutWorker). The plan's worker starts with the Nest lifecycle; my tests construct the service directly, no worker. Good — no timer interference.

Hmm wait — should I test the worker at all? The task's 4 tests don't include the worker. The manifest doesn't list the worker as a read for the test. So no worker in tests. `processMessages()` is the public entry I drive manually. Good.

**Error assertion style:** `rejects.toMatchObject({ code: 'insufficient_funds' })` — PayoutError has `code`. Works. Or catch and check instanceof + code. I'll use toMatchObject for brevity in the insufficient-funds test… wait, that test isn't in scope! The 4 tests: concurrent creation (which includes insufficient_funds rejections as part of the race), duplicate delivery, retry exhaustion, transient-then-success. The insufficient-funds assertion appears within the concurrent creation test (the 2 rejected ones). Good.

**Let me also double-check the concurrent creation test's determinism with Prisma interactive transactions.** `createPayout` runs one transaction: findPayoutByIdempotencyKey (findUnique on idempotency key), then reserveFunds (SELECT FOR UPDATE + check + update + ledger insert), then createPayoutWithMessage. 5 concurrent txs: each blocks on FOR UPDATE until the previous commits, then reads fresh values. 3 succeed (3000 total reserved), 2 fail with insufficient_funds. Deterministic.

One risk: Prisma's `$transaction` default timeout 5000ms; if the test DB is slow, a tx waiting on the lock might time out. 5 serialized fast txs — fine in practice.

Another risk: the idempotency findUnique inside the tx — with different keys, no conflict. Fine.

**Now, the `createPayout` DTO field names:** `accountId, amount, destinationAddress, idempotencyKey`. Amount is bigint. Good.

**PayoutView return:** `createPayout` returns PayoutView with status 'created'. I'll assert status 'created' in the concurrent test's fulfilled results.

**Let me also think about whether `processOneMessage` expects the message to already be claimed (processing).** The plan: worker claims then processes. In my duplicate delivery test, I claim via `repo.claimMessage` first (asserting it returns true), then call processOneMessage twice. This matches the plan's flow ("msg is already claimed (processing) by processMessages" per the fragment).

**What if processOneMessage on an orphan/missing payout marks done?** Not in scope; skip.

**Now let me write the file.** Structure:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Message } from '@prisma/client';
import { PayoutService } from '../src/payout/payout.service';
import { PayoutRepository } from '../src/payout/payout.repository';
import { PayoutError } from '../src/payout/payout.errors';
import type { PayoutProvider, PayoutView } from '../src/payout/payout.types';
```

Wait — `PayoutProvider` is in `provider.types.ts`, and `PayoutView` is in `payout.types.ts`. Per the plan:
- provider.types.ts: PayoutProvider interface + PAYOUT_PROVIDER token.
- payout.types.ts: status/type unions, DTOs, PayoutView.

So:
```ts
import type { PayoutProvider } from '../src/payout/provider.types';
import type { CreatePayoutDto, PayoutView } from '../src/payout/payout.types';
```

Do I need CreatePayoutDto? For typing the dto object — I can inline it; TS will infer. Using the type is cleaner: `const dto: CreatePayoutDto = {...}`. I'll import it.

Do I need PayoutView? For typing the fulfilled results: `results.filter(...).map(r => r.value as PayoutView)`. PromiseAllSettled's fulfilled value is already typed as PayoutView (since createPayout returns Promise<PayoutView>). So no cast needed. I might not need to import PayoutView at all. Keep imports minimal: PayoutProvider (for fake typing), CreatePayoutDto (maybe), Message (for internals cast), PayoutError (for instanceof check).

Fake provider helper:
```ts
function fakeProvider(transfer: PayoutProvider['transfer']): PayoutProvider {
  return { transfer };
}
```

Test harness:

```ts
const prisma = new PrismaClient();
const repo = new PayoutRepository(prisma);

const accountIds: string[] = [];

async function createAccount(settledBalance: bigint): Promise<string> {
  const id = `acct-${randomUUID()}`;
  accountIds.push(id);
  await prisma.account.create({ data: { id, settledBalance, reservedAmount: 0n } });
  return id;
}

async function cleanupAccount(accountId: string): Promise<void> {
  const payouts = await prisma.payout.findMany({ where: { accountId }, select: { id: true } });
  const payoutIds = payouts.map((p) => p.id);
  if (payoutIds.length > 0) {
    await prisma.message.deleteMany({ where: { payoutId: { in: payoutIds } } });
    await prisma.payout.deleteMany({ where: { id: { in: payoutIds } } });
  }
  await prisma.ledgerEntry.deleteMany({ where: { accountId } });
  await prisma.account.delete({ where: { id: accountId } });
}

beforeAll(() => {
  process.env.PAYOUT_MAX_ATTEMPTS = '3';
});

afterEach(async () => {
  while (accountIds.length > 0) {
    await cleanupAccount(accountIds.pop()!);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

Hmm — `process.env.PAYOUT_MAX_ATTEMPTS = '3'` — if the service reads env at construction, beforeAll runs before tests construct services. Good. But what if the implementation reads `PAYOUT_MAX_ATTEMPTS` with a different default or name? The plan says `PAYOUT_MAX_ATTEMPTS`, default 3. Pinning to '3' matches the default; even if the implementation ignores env, default 3 → same. Safe.

Wait, actually — should I pin it at all? If the implementation reads env per call and the ambient env has some other value… pinning makes it deterministic. Keep it.

Now the tests:

```ts
describe('payout service', () => {

  it('concurrent creation against one account never overdrafts', async () => {
    const service = new PayoutService(repo, fakeProvider(async () => ({ txHash: '0xunused' })));
    const accountId = await createAccount(3_000n);

    const attempts = Array.from({ length: 5 }, (_, i) =>
      service.createPayout({
        accountId,
        amount: 1_000n,
        destinationAddress: `0xdest${i}`,
        idempotencyKey: `key-${randomUUID()}`,
      }),
    );
    const settled = await Promise.allSettled(attempts);

    const created = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const rejected = settled.filter((r) => r.status === 'rejected');

    expect(created).toHaveLength(3);
    expect(new Set(created.map((p) => p.id)).size).toBe(3);
    for (const payout of created) {
      expect(payout.status).toBe('created');
      expect(payout.amount).toBe(1_000n);
    }
    expect(rejected).toHaveLength(2);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(PayoutError);
      expect((r.reason as PayoutError).code).toBe('insufficient_funds');
    }

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.reservedAmount).toBe(3_000n); // exactly the created payouts, no more
    expect(account.settledBalance).toBe(3_000n); // settled only moves on provider confirmation
  });
```

Wait — `r.value` for fulfilled: TS narrows on `r.status === 'fulfilled'`. In the `.map((r) => r.value)` after filter — does TS narrow in filter? `settled.filter((r) => r.status === 'fulfilled')` returns `PromiseSettledResult<PayoutView>[]` (no narrowing without a type predicate). So `r.value` is `PayoutView | undefined`. I need a cast or a type predicate. Use:

```ts
const created = settled.filter((r): r is PromiseFulfilledResult<PayoutView> => r.status === 'fulfilled').map((r) => r.value);
const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
```

Need to import `PromiseFulfilledResult` type? It's a global TS type (lib es2015.promise? Actually `PromiseFulfilledResult` is in lib.es2015.promise.d.ts — available). Or simpler:

```ts
const created: PayoutView[] = [];
const rejected: unknown[] = [];
for (const r of settled) {
  if (r.status === 'fulfilled') created.push(r.value);
  else rejected.push(r.reason);
}
```

Cleaner, no type gymnastics. I'll do that. Then I need to import PayoutView. OK, import it.

For rejected reasons: `expect(reason).toBeInstanceOf(PayoutError)` then `expect((reason as PayoutError).code).toBe('insufficient_funds')`.

  it('duplicate message delivery debits the ledger exactly once', async () => {
    const transfer = vi.fn(async () => ({ txHash: '0xdup' }));
    const service = new PayoutService(repo, { transfer });
    const accountId = await createAccount(4_000n);

    const payout = await service.createPayout({
      accountId,
      amount: 1_200n,
      destinationAddress: '0xdest',
      idempotencyKey: `key-${randomUUID()}`,
    });

    // Simulate the worker having claimed the message (pending -> processing).
    const msg = await prisma.message.findUniqueOrThrow({ where: { payoutId: payout.id } });
    expect(await repo.claimMessage(msg.id)).toBe(true);

    const internals = service as unknown as { processOneMessage(message: Message): Promise<void> };
    await internals.processOneMessage(msg);
    // At-least-once delivery: the same message arrives again.
    await internals.processOneMessage(msg);

    // The provider was asked exactly once; the ledger moved exactly once.
    expect(transfer).toHaveBeenCalledTimes(1);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.settledBalance).toBe(2_800n); // 4000 - 1200, debited once
    expect(account.reservedAmount).toBe(0n);     // reservation released on confirmation

    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(['sent', 'completed']).toContain(after.status);
    expect(after.txHash).toBe('0xdup');

    const done = await prisma.message.findUniqueOrThrow({ where: { payoutId: payout.id } });
    expect(done.status).toBe('done');

    // Ledger is balanced: one reserve, one release, one settle_out.
    const entries = await prisma.ledgerEntry.findMany({ where: { accountId } });
    expect(entries).toHaveLength(3);
  });
```

Hmm — `expect(['sent','completed']).toContain(after.status)` — fine. Or `expect(['sent', 'completed'] as const).toContain(...)`. Keep simple.

Ledger entries assertion: reserve (create) + release + settle_out (success) = 3. That's a nice double-entry check ("keep a double-entry style ledger"). The plan says the ledger exists; asserting 3 entries with types is behavior. Maybe assert the types:

```ts
const byType = Object.fromEntries(entries.map((e) => [e.type, e.amount]));
```

Overkill. I'll assert length 3 and maybe the sum of settle_out. Keep: length 3. Actually, let me assert types explicitly — it verifies the ledger records each transition:

```ts
const types = entries.map((e) => e.type).sort();
expect(types).toEqual(['release', 'reserve', 'settle_out']);
```

That's a solid behavior assertion on the ledger. I'll include it.

  it('retry exhaustion marks the payout needs_review and holds the reservation', async () => {
    const transfer = vi.fn(async () => {
      throw new Error('provider unavailable');
    });
    const service = new PayoutService(repo, { transfer });
    const accountId = await createAccount(2_000n);

    const payout = await service.createPayout({
      accountId,
      amount: 800n,
      destinationAddress: '0xdest',
      idempotencyKey: `key-${randomUUID()}`,
    });

    // Drain the queue until nothing pending remains (message retries back to pending).
    for (let i = 0; i < 10; i += 1) {
      if ((await service.processMessages()) === 0) break;
    }

    // Bounded retries: exactly PAYOUT_MAX_ATTEMPTS provider attempts.
    expect(transfer).toHaveBeenCalledTimes(3);

    const after = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(after.status).toBe('needs_review');

    const msg = await prisma.message.findUniqueOrThrow({ where: { payoutId: payout.id } });
    expect(msg.status).toBe('dead');
    expect(msg.attempts).toBe(3);

    // No definitive success: settled balance untouched, reservation still held.
    const account = await prisma.account.findUniqueOrThrow({ where:
