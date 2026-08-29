# Reference solution — annotated core

## Crux 1: projection DDL — covering the query, not the world

```sql
CREATE TABLE operation_projection (
  company_id  uuid        NOT NULL,
  occurred_at timestamptz NOT NULL,
  operation_id uuid       NOT NULL,
  status      text        NOT NULL,
  amount      bigint      NOT NULL,
  -- denormalized display columns so the hot path never joins back
  worker_name text        NOT NULL,
  event_name  text        NOT NULL,
  PRIMARY KEY (company_id, occurred_at, operation_id)
) PARTITION BY RANGE (occurred_at);

-- The dashboard filters (company, status, date range) + sorts (recency):
CREATE INDEX ON operation_projection (company_id, status, occurred_at DESC)
  INCLUDE (amount, worker_name, event_name);   -- covering: index-only scan
```

Separate `operation_summary_company(company_id, day, total bigint, count int)`
for the totals widget.

## Crux 2: in-transaction hook (fast path)

```ts
// Called by every write service, INSIDE its existing transaction.
async projectOperation(tx: Tx, op: OperationWrite) {
  await tx.$executeRaw`
    INSERT INTO operation_projection (...) VALUES (...)
    ON CONFLICT (company_id, occurred_at, operation_id)
    DO UPDATE SET status = EXCLUDED.status, ...`;      // M1: same tx, M2: upsert

  // M5: atomic increment — never read-modify-write for aggregates.
  await tx.$executeRaw`
    INSERT INTO operation_summary_company (company_id, day, total, count)
    VALUES (${op.companyId}, ${op.day}, ${op.amount}, 1)
    ON CONFLICT (company_id, day)
    DO UPDATE SET total = operation_summary_company.total + ${op.delta},
                  count = operation_summary_company.count + ${op.countDelta}`;
}
```

## Crux 3: re-derivation (the guarantee)

```ts
// Rebuild a window purely from source tables. Idempotent: DELETE+INSERT the
// window (or upsert every row + delete orphans). Safe to run any time.
async rederive(window: DateWindow) {
  await this.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM operation_projection
                         WHERE occurred_at >= ${window.from} AND occurred_at < ${window.to}`;
    await tx.$executeRaw`INSERT INTO operation_projection (...)
                         SELECT ... FROM payment_order po JOIN ... WHERE ...`;
    // summary rebuilt as GROUP BY over the fresh projection
  });
}
```

Safety net = 1-minute repair job (recent slice) + daily job re-deriving the last
7 days. Hooks make it fast; re-derivation makes it *correct by construction*.

## Common wrong answers

- **Materialized view + REFRESH** — loses read-your-own-writes; full refresh
  doesn't scale; `CONCURRENTLY` still batch-lagged.
- **Redis cache with TTL** — approximate financial totals; invalidation guesswork.
- **Async event bus as the only maintenance** — lag visible to operators; and
  without re-derivation, one lost event = permanent drift.
- **`total = total_read + x` in app code** — lost updates under concurrency.
