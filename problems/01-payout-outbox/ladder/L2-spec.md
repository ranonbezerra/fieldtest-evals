# Issue #412 — Payouts can overdraw an account and can pay twice

**Repo:** `payouts-service` · **Labels:** `bug` `money` `blocker`
**Reported by:** finance-ops · **Diagnosed by:** platform

---

## What is happening

Two incidents last week, same root, different symptoms.

**Monday.** A seller with 40.00 USDC available received two payouts of 30.00 within
the same second. Both API calls passed the balance check before either wrote its
reservation, so both saw 40.00 and both proceeded. The account went to −20.00.

**Thursday.** A client retried `POST /payouts` after a gateway timeout. The first
request had already succeeded; the retry created a second payout with a second
on-chain transfer. The seller was paid twice and we ate the difference.

There is a third failure we have not been bitten by yet and will be: the provider
call `provider.transfer({to, amount}) -> {txHash}` can time out **after** the chain
has accepted the transfer. Today nothing distinguishes "it failed" from "we do not
know", and the worker's error path reverses the reservation. That reversal is the
one that loses real money, because the transfer may still land.

## What we need

A payout path where **funds safety does not depend on timing**. Concretely:

### 1. Reserve, do not debit

An account's settled balance must not move when a payout is created. Creation
reserves; settlement debits. Model the two separately — a held/reserved column
beside the settled one, or a hold entity — so that a payout in flight is visible as
an obligation without having been paid.

### 2. The check and the reservation are one act

The Monday incident is a read-then-write race. Making it impossible is not a matter
of ordering the statements more carefully — the check and the decrement have to be a
single atomic operation the database serialises, and the code has to observe whether
it won. A conditional update that only applies when the funds are there, and a caller
that reads how many rows it changed, is the shape we want. Two concurrent requests
against one account must result in exactly one reservation.

### 3. The queue row is written in the transaction that reserves

The transfer must not happen inside the HTTP request. Use a message table in
Postgres and a polling worker (`processMessages()` on an interval).

The message row must be inserted **inside the same database transaction** as the
reservation. Not after it, not in a callback, not in an `afterCommit` hook. If the
process dies between the two, we get a reserved payout nobody will ever execute, or
a queued transfer against funds nobody reserved — and both have happened at other
companies for exactly this reason.

### 4. The worker is safe against redelivery

Delivery is at-least-once; the worker will see the same message more than once. Make
the second delivery a no-op: a processed-messages record, a status transition guarded
by a conditional update, or a unique constraint the second attempt violates. Choose
one and make it the only path.

### 5. Creation is idempotent on the client's key

`idempotencyKey` in the request body. A retry with the same key returns the original
payout and reserves nothing further. This is the Thursday fix.

### 6. Settlement happens on confirmation, never on send

The ledger entry that moves settled balance is written when the provider confirms.
`txHash` in hand is not confirmation of settlement in our model — it is the point at
which the outcome becomes knowable, not known.

### 7. Uncertainty parks; it never reverts

Retry the provider a bounded number of times. When the attempts are exhausted without
a definitive outcome, move the payout to a terminal state that a human looks at, and
leave the reservation in place. Do not release the hold, do not refund, do not
retry forever. Write down in `DESIGN.md` why that is the safe direction — one
paragraph is enough, and we want the reasoning on record for the next incident review.

### 8. Money is integer

Minor units, `BigInt` or an integer column, end to end. No `number` in the money
path, no `parseFloat`, no `toFixed`.

## Acceptance

- `POST /payouts` with body `{ accountId, amount, destinationAddress, idempotencyKey }`
- Two concurrent creations against one account with funds for one → exactly one payout
- The same `idempotencyKey` twice → one payout, one reservation, the same response
- The same message delivered twice → one transfer
- Retry exhaustion → terminal review state, reservation intact, nothing reversed
- Settled balance moves only after provider confirmation

## Deliverables

Prisma schema and migration · NestJS module (controller, service, worker) ·
tests for concurrent creation, duplicate delivery and retry exhaustion ·
`DESIGN.md`, 10–20 lines, on the funds-safety approach.

## Notes

The provider SDK is `provider.transfer({to, amount}) -> {txHash}` and it may throw,
time out, or succeed slowly. Assume nothing else about it.

Stack is fixed: TypeScript, NestJS, Prisma, PostgreSQL.
