# 14-DESIGN.md

## reasoning

```
The task is to write a `DESIGN.md` file that explains the funds-safety approach in 10-20 lines. This is a design document, not code, so it should be in Markdown format. Let me review what the plan specifies for this file:

From the manifest: `DESIGN.md | reads: - | Funds-safety explanation (10–20 lines)`

The design should explain the funds-safety approach based on the plan. Key safety mechanisms from the plan:

1. Row-level locking (SELECT ... FOR UPDATE) on the account row during payout creation
2. Reservation-based available balance calculation (balance minus sum of in-flight payouts)
3. Idempotency via unique constraint on (account_id, idempotency_key)
4. Outbox pattern for at-least-once delivery
5. Ledger entries only posted on confirmed transfer (double-entry)
6. Bounded retries with safe failure (needs_review, not double-spend)
7. FOR UPDATE SKIP LOCKED for message claiming
8. Balance decrement guarded by WHERE balance >= amount

Let me write this in 10-20 lines of Markdown, explaining the funds-safety approach clearly.
```

## reply

```markdown
# Design: Funds Safety

## Reservation at creation
Payout creation runs in a single database transaction that acquires a row-level lock
(`SELECT … FOR UPDATE`) on the account, computes `available = balance − Σ(in-flight payouts)`,
and rejects the request if `available < amount`. The lock serialises concurrent requests so
two racing calls can never both pass the balance check. The payout row is inserted with
status `created` in the same transaction, making it visible to subsequent `available` sums
immediately after commit.

## Idempotency
A unique index on `(account_id, idempotency_key)` guarantees at most one payout per key.
A retry that hits the index returns the existing row (200) or a conflict (409) without
re-reserving funds.

## Double-entry ledger, posted only on confirmation
The account's settled balance is decremented and a debit ledger entry is inserted only in
the confirmation transaction, which fires after the provider returns a definitive `txHash`.
Until that point the funds are merely reserved; the ledger is untouched.

## At-least-once outbox with safe redelivery
The worker claims messages via `FOR UPDATE SKIP LOCKED`, so a message is in-flight for at
most one worker. If the same message is redelivered after a successful confirmation the
payout is already `completed`; the worker marks the message `done` and returns without
posting a second ledger entry or decrementing balance again.

## Bounded retries and the safe-failure path
The provider is called at most `MAX_ATTEMPTS` (3) times. If all attempts fail without a
definitive outcome the payout is marked `needs_review` and the message is closed. We do
not assume the transfer failed (it may have hit-chain) and we do not retry (risk of
double-spend). A human reconciles against the chain before any further action, which is
the only choice that cannot silently lose or duplicate funds.

## Guard on the decrement
The confirmation `UPDATE accounts SET balance = balance − amount` carries a
`WHERE balance >= amount` guard. Even under an unexpected sequence the database will not
drive the balance negative; the affected-row count of zero is treated as an error.
```
