# Funds-safety design

1. **Atomic, idempotent creation.** `POST /payouts` runs in one transaction: lock the account
   row (`FOR UPDATE`), check `settled_balance - held_amount >= amount`, insert the payout, the
   `HOLD` ledger entry and the outbox message. Unique `idempotency_key` makes retries no-ops:
   no second payout, no double reserve.
2. **No overdraft under concurrency.** The row lock serializes racing requests; each re-checks
   availability after taking the lock, so only as many payouts as fit are created.
3. **Balances move only on provider confirmation.** In-flight funds sit in `held_amount`; a
   confirmed transfer leaves the settled balance in the same transaction as the status change.
   No provider call runs inside a DB transaction; no `SETTLE` is written for an unconfirmed one.
4. **Double-entry ledger.** Every movement is `HOLD`, `SETTLE` or `RELEASE`, in integer minor
   units (BIGINT, never floats), so invariants reconcile independently of the status column.
5. **Idempotent worker over at-least-once delivery.** Claims are conditional updates on message
   status: two workers cannot claim the same message, an already-`done` message can never be
   settled twice, and stale in-flight claims are re-claimed after the processing timeout.
6. **Retry exhaustion is safe, not silent.** Without a definitive outcome we do not guess: the
   payout becomes terminal `needs_review` and the hold is released atomically, so transient
   outages never freeze funds; a human verifies on-chain before any correction, so a double
   payment is impossible without explicit review.
