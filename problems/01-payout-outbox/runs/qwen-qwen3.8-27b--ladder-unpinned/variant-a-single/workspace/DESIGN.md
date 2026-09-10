# DESIGN — funds safety

`payout_accounts` carries `settled` and `reserved` in integer minor units (BigInt end to end). Creating a
payout moves funds from available into `reserved` and never touches `settled`, so an in-flight payout is
always a visible obligation and spendable funds can never be double-booked. The balance check and the
reservation are one conditional UPDATE (`WHERE settled - reserved >= amount`) whose affected-row count the
caller reads; Postgres serialises racers on the account row, so exactly one of two concurrent requests can
win. The payout row, the reserve, and the outbox message commit in a single transaction: no payout without
its message, no message without its reserve. The worker claims each message with a guarded PENDING→IN_FLIGHT
flip, making a redelivered message a no-op, and a stored `tx_hash` guarantees `transfer` is never called
twice for one payout. Ledger pairs that debit `settled` are written only when the chain confirms; holding a
txHash parks the payout in SENT with the hold intact. Provider errors are "unknown" unless an adapter
proves a definitive rejection; after three attempts the payout goes to NEEDS_REVIEW with the reservation
left in place. Parking is the safe direction: it can only over-hold a seller's own funds, which a human can
reverse, whereas releasing a hold for a transfer that may still land spends the seller's money
irreversibly. Every movement is a balanced debit/credit pair in `ledger_entries`.

Tests run against Postgres (DATABASE_URL) with the migration applied.
