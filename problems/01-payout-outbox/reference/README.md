# Reference solution — 01 Payout with outbox + hold

Port of my written reference solution (payout-reference-solution.md) goes here:

- `schema.prisma` — Account with `balance` + `held` (gross balance changes only on
  settlement; available = balance − held), Payout state machine, Message/outbox
  table, Ledger entries
- `payouts.service.ts` — creation transaction: idempotency key, conditional
  reservation (`UPDATE ... WHERE balance - held >= amount`), payout row, outbox
  insert — all atomic
- `payouts.worker.ts` — polling consumer with dedup, provider call outside any DB
  transaction, response classification, bounded retries, terminal review state
- `DESIGN.md` — funds-safety rationale

TODO: paste the reference solution files and wire minimal tests.
