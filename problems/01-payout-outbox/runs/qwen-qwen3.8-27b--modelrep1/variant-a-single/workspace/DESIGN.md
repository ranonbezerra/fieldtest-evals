# DESIGN — funds safety

- One Postgres transaction per mutation: payout row, account balance, ledger
  entries, and outbox message commit together — no half-written money state.
- Racing creations serialize on `SELECT ... FOR UPDATE` of the account row; the
  `settled - held >= amount` guard runs under that lock, so no overdraft.
- `(account_id, idempotency_key)` is unique and checked under the same lock, so
  a retried request returns the existing payout and reserves nothing extra.
- Creation only moves funds available → held (debit `user_available`, credit
  `user_held`); the settled balance is debited only when the provider confirms
  (debit `user_held`, credit `payouts_sent`). Every group is balanced (debits = credits).
- The outbox is at-least-once, but the transfer is gated by the conditional
  `CREATED → PROCESSING` transition; a redelivery while already `PROCESSING`
  (unknown prior outcome) escalates to `needs_review`. The provider is never
  called twice for one payout.
- Retries are bounded (default 3); exhaustion without a definitive outcome goes
  to `needs_review` with the hold retained — releasing or retrying could both
  double-pay. A human reconciles with the provider first.
- Amounts are BigInt minor units in code and `BIGINT` in Postgres; no floats.
