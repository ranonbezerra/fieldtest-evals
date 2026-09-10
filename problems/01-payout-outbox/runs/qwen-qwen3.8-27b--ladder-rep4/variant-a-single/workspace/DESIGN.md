# DESIGN — funds safety

Money is BigInt minor units end to end (bigint in code, BIGINT in Postgres,
decimal strings on the wire); no float ever touches the money path.

1. Reserve, do not debit. Creation moves funds from `settled_balance` to
   `reserved_balance` on the account row plus a double-entry ledger pair
   (credit AVAILABLE / debit RESERVED). The account's settled balance is
   untouched until the provider confirms.
2. One-act check. The reservation is a single conditional UPDATE
   (`SET settled = settled - amt, reserved = reserved + amt WHERE
   settled >= amt`) whose affected-row count the caller reads. Postgres row
   locking serialises racers, so exactly one of two concurrent requests can
   reserve.
3. Atomic outbox. Payout row, account reservation, ledger pair and outbox
   message are written in ONE transaction. There is no window in which a
   payout exists without a queued transfer, or a transfer is queued without
   reserved funds.
4. Idempotent creation. `UNIQUE(account_id, idempotency_key)` plus a
   pre-check: a retry with the same key returns the original payout and
   reserves nothing further, even under a race.
5. At-least-once delivery. The worker claims messages atomically
   (`FOR UPDATE SKIP LOCKED`, stale-PROCESSING re-claim). Redelivery is a
   no-op via guarded status transitions, a `UNIQUE(outbox_id)`
   processed-mark, and `UNIQUE(payout_id, direction, bucket)` ledger pairs —
   double settlement is impossible by constraint, not by timing.
6. Confirm, don't send. `txHash` only moves the payout to SENT/COMPLETED
   (credit RESERVED / debit ONCHAIN). It is when the outcome becomes
   knowable, not when it is known.
7. Uncertainty parks. Timeouts and no-hash errors are counted attempts. On
   exhaustion the payout goes NEEDS_REVIEW and the message ABANDONED; the
   reservation stays in place. Releasing the hold on "failure" would be
   irreversible: the transfer may have landed, and the account would then
   fund a second payout for money already paid out. Over-reserving (cash
   frozen, one human review) is the safe direction; double-paying is not
   reversible. Only a provider-reported *definitive* failure releases the
   hold.
