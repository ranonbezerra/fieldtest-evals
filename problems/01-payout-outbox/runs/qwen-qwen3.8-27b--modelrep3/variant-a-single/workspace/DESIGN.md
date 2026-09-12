# DESIGN — funds safety

1. **Atomic reserve, no overdraw.** Payout insert (unique `idempotency_key`) and a conditional
   `UPDATE accounts SET held = held + a WHERE settled - held >= a` commit in one transaction; the
   row lock serializes racers. A duplicate key aborts the tx (no second reserve) and replays it.
2. **Settled balance changes only on confirmation.** Requests only move funds from available to
   on-hold (`settled_minor` untouched); confirmation debits settled+hold together; a definitive
   failure releases the hold. `needs_review` changes nothing.
3. **Double-entry ledger.** Balanced postings per transition: reserve `settled:{acct}->held:{acct}`,
   complete `held:{acct}->transfers_out`, release `held:{acct}->settled:{acct}`; the ledger always
   sums to zero and a unique `(payout, action, account)` makes double-posting impossible.
4. **Outbox + at-least-once.** Payout and queue message commit together; the worker claims messages
   exclusively and every state change is a guarded UPDATE, so redelivered messages no-op and a
   crash between *sent* and *completed* is repaired by finalizing from `tx_hash`.
5. **Bounded retries, safe on unknown.** Definitive rejections fail the payout and release the
   hold; unknown outcomes retry with backoff, then escalate to `needs_review` **keeping the hold** —
   releasing could double-spend the customer if the transfer landed, so a human reconciles on-chain.
6. **Known trade-off.** The assumed `transfer({to, amount})` SDK has no client idempotency key, so a
   retry after a timeout can in principle double-send; bounded attempts contain the blast radius.
