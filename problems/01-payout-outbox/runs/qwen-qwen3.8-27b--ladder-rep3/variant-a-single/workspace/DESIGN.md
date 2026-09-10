# Design — how funds stay safe

- Money is integer minor units (BigInt in code, BIGINT in Postgres) end to end; no float or `number`.
- Reserve, don't debit: `accounts.settled` moves only at settlement; creation bumps `accounts.reserved` (available = settled − reserved), so in-flight payouts are visible obligations.
- Check-and-reserve is one conditional UPDATE (`reserved += ? WHERE settled − reserved >= ?`); Postgres serializes racers on the account row and re-checks the predicate, so the loser gets 0 rows and is rejected.
- Payout row, reservation, balanced ledger pair, and outbox message commit in one transaction: no crash can leave funds reserved-but-unqueued.
- Transfers run in a polling worker (`processMessages()` on an interval), never in the HTTP request; one outbox row per payout.
- Redelivery is a no-op: claiming the message, recording the txHash, and settling are guarded conditional transitions; once a txHash exists the provider is never called again for that payout.
- Uncertainty parks, never reverts. A provider timeout means "we do not know", so we retry a bounded number of times (MAX_PROVIDER_ATTEMPTS), then park the payout in NEEDS_REVIEW with the hold intact.
  Releasing the hold is the unsafe direction: the transfer may still land on-chain and the freed funds could be spent again while the payment is in flight.
  A duplicate payment is recoverable by a human; a double-spend of the seller's balance is not — so we hold and escalate.
- Settlement (settled −= amount, reserved −= amount) commits in the same transaction as the guarded SENT → COMPLETED transition, paired in the ledger (DEBIT PAID_OUT / CREDIT HELD).
