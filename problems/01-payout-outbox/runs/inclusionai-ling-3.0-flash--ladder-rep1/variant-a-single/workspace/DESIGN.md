Funds-safety approach

1. Reserve, don't debit. Account has settledBalance and reservedBalance.
   Creating a payout reserves (increments reservedBalance), never touches settled.
   Settled moves only on provider confirmation.

2. Atomic check-and-reserve. The conditional UPDATE (settled - reserved >= amount
   then reserved += amount) is a single database statement serialised by row
   locking. The caller checks affected rows: 0 means a concurrent request won.
   Two races against one account yield exactly one reservation.

3. Transaction boundary. The reservation, payout row, and message row are
   inserted in one Prisma $transaction. If the process dies, either all three
   persist (reservation + payout + queue) or none do. No orphaned reservation,
   no queue entry without a reservation.

4. Worker dedup via conditional update. A message transitions PENDING →
   PROCESSING only via UPDATE … WHERE status = PENDING. Two deliveries of the
   same message: only one lock succeeds; the other is a no-op. Stuck
   PROCESSING messages are reset on the next poll cycle.

5. Idempotency key. A unique constraint on payout.idempotencyKey ensures
   duplicate client retries return the original payout.

6. Settlement is confirmation-gated. settledBalance is decremented only after
   provider.confirm() returns true. txHash alone is not sufficient.

7. Uncertainty parks. After MAX_RETRY_ATTEMPTS (3) without a definitive
   outcome, payout → NEEDS_REVIEW with the reservation intact. We do not
   release the hold or reverse it: the transfer may have landed on-chain, and
   releasing would risk paying twice. A human reviews.

8. All money is bigint in minor units end-to-end. No floats.
