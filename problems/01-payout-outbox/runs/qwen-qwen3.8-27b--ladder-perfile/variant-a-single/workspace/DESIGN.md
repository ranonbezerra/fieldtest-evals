# DESIGN — funds safety

1. **One atomic reservation.** Available = `settled_balance - reserved_balance`. Creation is a single
   conditional `UPDATE ... WHERE settled_balance - reserved_balance >= :a` and the caller reads the
   affected-row count; Postgres serializes racers on the account row, so two concurrent requests
   can never both win: exactly one reserves, the other gets insufficient funds.
2. **The queue row commits with the hold.** The outbox message is inserted in the same transaction
   as the reservation, so a crash leaves neither an un-executed hold nor a transfer with no hold.
3. **Exactly-once effect.** Workers claim messages with a conditional `pending -> processing`
   update and every payout transition is a conditional status update, so a redelivered message
   is a no-op: one transfer per payout.
4. **Settlement only on confirmation.** A `txHash` means the outcome is knowable, not settled; the
   ledger entry that debits `settled_balance` and releases the hold is written only on confirmation.
5. **Uncertainty parks, never reverts.** The provider is retried a bounded number of times. Only an
   explicit provider rejection is definitive, and only it may release the hold (status `failed`).
   A timeout or unclassified error means the transfer may have landed, so that path never releases
   the hold; on exhaustion the payout goes to `needs_review` with the reservation intact. Parking is
   the safe direction: releasing the hold can pay from funds a landed tx still owes, and retrying
   forever can double-send; parking's worst case is capital in a hold while a human checks the chain.
6. **Integer money.** Minor units as BigInt / bigint columns end to end; no floats.
