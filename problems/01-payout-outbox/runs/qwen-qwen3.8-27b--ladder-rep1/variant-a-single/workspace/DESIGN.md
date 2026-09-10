# DESIGN — funds safety

- **Reserve, do not debit.** Creation is one transaction: a conditional
  `UPDATE ... WHERE available_minor_units >= :amount` (check and decrement are
  one atomic act; the caller reads the changed-row count), plus the payout row,
  the outbox message, and the balanced ledger legs
  (`customer_funds -a / payouts_pending +a`). Racers serialize on the row lock;
  exactly one reserves.
- **Idempotency** is the unique `(account_id, idempotency_key)` constraint in the
  same transaction: a retry rolls its work back and returns the original payout;
  a different payload on the same key is a 409.
- **The outbox row is in the reservation transaction**: no transfer is ever
  queued without funds reserved, and no funds are reserved without a transfer.
- **Redelivery is a no-op by construction.** Messages are claimed with
  `WHERE status = 'pending'` and every payout transition is guarded by the
  current status; a redelivery that finds an attempt still `in_flight` parks the
  payout for human review instead of calling the provider again.
- **Settlement is exactly-once and confirmation-driven.** A resolved
  `provider.transfer` only records the `txHash` (status `sent`); a separate step
  moves `sent -> completed` and, in one transaction, debits settled/reserved
  balance and posts `payouts_pending -a / paid_out +a`. The guarded transition
  is the exactly-once token, so the settled balance moves only on confirmation.
- **Uncertainty parks, never reverts.** Failures retry a bounded number of
  times; exhaustion without a confirmed outcome moves the payout to
  `needs_review` with the reservation intact. Releasing the hold could free
  funds that a landed transfer still claims — a real overdraft; parking only
  hides funds briefly, which a human can always resolve forward.
- **Money is integer**: `bigint` columns and `bigint` in TypeScript, decimal
  strings at the API edge. No `number`, `parseFloat` or `toFixed` in the path.
