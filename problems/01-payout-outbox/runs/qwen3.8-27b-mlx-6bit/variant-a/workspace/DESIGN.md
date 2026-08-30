```markdown
# Design — Fund Safety

- **Atomic reservation.** `createPayoutWithMessage` is one Postgres transaction: lock the
  account row (`SELECT ... FOR UPDATE`), check `settledBalance - reservedAmount`, increment
  the reservation, and insert the payout with its outbox message. The row lock serializes
  concurrent requests so racing payouts can never overdraw, and the outbox row in the same
  transaction guarantees a payout never exists without its message.
- **Idempotency.** A unique index on `(account_id, idempotency_key)` makes client retries a
  no-op: duplicates are rejected and never reserve funds twice.
- **Double-entry ledger.** Every settled-balance change is a `ledger_entries` row
  (CREDIT/DEBIT) in `bigint` minor units — no floats. `settled_balance`/`reserved_amount`
  are cached aggregates updated in the same transaction, re-derivable from the entries.
- **At-least-once, once-effective.** The worker claims a message via a `PENDING → PROCESSING`
  flip under `FOR UPDATE SKIP LOCKED`; the provider call runs outside any DB transaction, so
  a crash causes redelivery, not loss. Terminal states are only reachable from `CREATED`/
  `PROCESSING`, so duplicate delivery posts the ledger entry exactly once.
- **Safe exhaustion.** On bounded retry exhaustion, a definitive failure fails the payout
  and releases the reservation; an ambiguous timeout leaves it `NEEDS_REVIEW` with funds
  reserved and no ledger entry — a timeout may mean the transfer landed on-chain, and
  failing it would risk double-spend.
```
