# DESIGN — funds safety
Invariant: money moves only inside one atomic Postgres transaction.
- `POST /payouts` reserves, never debits: a guarded debit
  (`WHERE available_minor >= :amount`), the payout row, a balanced
  `reserved` ledger pair and the outbox message commit together. Racers
  serialize on the account row (no overdraw); a racing same-key retry loses
  to the unique index, rolls back and returns the winner's payout.
- The ledger is the source of truth; the account row is a projection.
  Every event posts one debit and one credit. Committed funds (available +
  pending) change only on provider confirmation: `settled` debits the
  reservation to platform cash; a definitive rejection posts `released`
  (net zero).
- Transfers run only in the worker, which claims messages with guarded
  UPDATEs (token + stale re-claim). Status transitions are guarded and
  ledger lines are unique per (payout, event), so duplicate delivery can
  never post twice.
- Retries are bounded; exhaustion without a definitive outcome parks the
  payout in `needs_review` with the reservation kept — releasing could
  double-pay (the timed-out transfer may have gone through) and completing
  could mark as paid money that never moved; a human reconciles on-chain.
