# Design — funds safety

- Guarded atomic reservation: one `UPDATE` sets `reserved_balance += :amt` under `WHERE id = :id AND settled_balance - reserved_balance >= :amt`; the row lock plus the in-statement check make overdraw under racing requests impossible (losers get `insufficient_funds`), and CHECK constraints on the balance columns are the DB backstop.
- `payouts.idempotency_key` is UNIQUE and the reservation, payout, outbox message and ledger entries commit in one transaction, so a replay rolls back and never reserves twice.
- The worker claims messages with `FOR UPDATE SKIP LOCKED`; every handler is a compare-and-set on `payouts.status`, so a redelivered message is a no-op once the payout resolved.
- The provider SDK has no idempotency key, so a payout in `processing` with no recorded outcome is never re-attempted and moves to `needs_review` (fail-closed), ruling out double payment after a crash.
- Funds are released only on a definitive provider rejection; timeouts, worker errors and retry exhaustion keep them reserved in `needs_review` — freezing money is safer than releasing it and double-paying.
- Every event writes paired debit/credit entries moving funds available → reserved → in_transit → settled_out; both sides sum equally per payout, and the reserved bucket's net always equals `accounts.reserved_balance`.
- `settled_balance` changes only at `sent`, i.e. when the provider confirms the transfer; `needs_review` payouts are resolved by an operator after reconciling with the provider.
- Retries use exponential backoff (`PAYOUT_RETRY_BASE_MS * 2^n`, capped at 15 min) bounded by `PAYOUT_MAX_ATTEMPTS` (default 3).
- Env: `DATABASE_URL` (required), `PROVIDER_ENDPOINT`, `PROVIDER_TIMEOUT_MS`, `PAYOUT_MAX_ATTEMPTS`, `PAYOUT_RETRY_BASE_MS`, `WORKER_INTERVAL_MS`, `WORKER_LEASE_MS`, `WORKER_BATCH_SIZE`, `PORT`.
