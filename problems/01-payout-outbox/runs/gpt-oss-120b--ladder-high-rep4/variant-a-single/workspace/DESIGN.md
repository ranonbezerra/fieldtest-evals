# Design – Funds‑Safety Approach

1. **Separate balances** – Each `Account` stores a `settled_balance` (available funds) and a `reserved_balance` (holds for in‑flight payouts). Creating a payout only increments `reserved_balance`; the settled balance changes only after the blockchain provider confirms the transfer.

2. **Atomic reservation** – The reservation and outbox insertion occur in a single PostgreSQL transaction. The reservation uses an optimistic‑concurrency update (`WHERE version = … AND (settled_balance - reserved_balance) >= amount`). The transaction fails if another concurrent request wins the race, forcing a retry.

3. **Idempotent creation** – `idempotency_key` is a unique column on `Payout`. On a duplicate request we simply return the existing payout, guaranteeing no double reservation.

4. **Outbox pattern** – A `Message` row is written inside the same transaction that reserves funds. The worker polls `Message` rows (`status = PENDING`) and atomically changes the status to `PROCESSING` before acting, making duplicate deliveries a no‑op.

5. **At‑least‑once processing safety** – The worker first locks a message (`UPDATE … SET status = PROCESSING WHERE status = PENDING`). If another worker already locked it, the update affects zero rows and the duplicate attempt aborts.

6. **Provider retries** – The worker retries the provider call up to `max_attempts`. Each failure increments `attempts`. When the limit is reached, the payout moves to `NEEDS_REVIEW` and the reservation stays in place, avoiding unsafe reversals.

7. **Double‑entry ledger** – Upon successful provider confirmation we debit `settled_balance`, release the reservation, and create a `LedgerEntry` with a negative amount, ensuring an auditable, double‑entry style record.

8. **All money as `bigint`** – The schema uses PostgreSQL `BigInt` and the service works with native `bigint` values, eliminating floating‑point errors.

9. **No business logic in controllers** – Controllers only validate input and forward to the service; all DB interaction lives in the repository, keeping layers clean.

10. **Deterministic error envelope** – Errors are wrapped in a single JSON envelope (`{ error: { code, message, details } }`), providing a stable contract for callers.
