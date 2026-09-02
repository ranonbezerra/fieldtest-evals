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
