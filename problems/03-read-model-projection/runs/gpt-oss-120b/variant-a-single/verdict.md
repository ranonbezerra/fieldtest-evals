# Verdict — 03 Read model projection (gpt-oss-120b, hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✗, M2 ✗, M3 ✗, M4 ~, M5 ✗, M6 ✓]

graded:       {schema_design: 2, rebuild_story: 0, tradeoffs: 1, tests: 0,
               quality: 1, process: n/a}

typecheck:    failed after 15 repairs — 10 errors, eight of them the model
              disagreeing with its own schema
tests:        1 of 1 passes — `compiles and runs a dummy test`

failure_mode: dropped_a_requirement
              # `rederive()` is a placeholder that lists the three steps it would
              # perform. `repairDrift()` delegates to it. And the projection hook
              # holds `private readonly prisma = new PrismaClient()`, so it can
              # never join the writer's transaction.

revisions:    {self_repairs: 15, dropped_a_requirement: yes}
cost:         {wall_minutes: ~10, requests: 16, usd: 0.0111}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     A correct schema, a good index, three services with the right names —
              and the two that matter are a stub and a delegate to that stub.
```

## What holds

The schema is valid — `prisma generate -> 0`, where Qwen3.8-27B's failed on five
one-sided relations. The separation is right too: `OperationProjection` and
`CompanyTotals` as distinct models, source `Order` / `Event` / `Worker` beside them.

M6 is the best of the run: `@@index([company_id, status, created_at])` covers the
dashboard's filter and sort in one.

The file layout reads like someone who knows the pattern: `operations.hooks.service`,
`operations.rederivation.service`, `operations.drift.service`, each named for the part
of the rubric it answers.

## What does not

**M1.** The projection must be updated inside the transaction that writes the source
row. Line 55 of the hooks service:

    private readonly prisma = new PrismaClient();

A service holding its own client cannot participate in a caller's transaction, by
construction. `$transaction` appears nowhere in `src`. `handleOrderApproved` reaches
for `upsert` with `increment`, which buys idempotency and not atomicity.

**M2.**

    async rederive(companyId, startDate, endDate): Promise<void> {
      this.logger.log(`Re-deriving operations for company ${companyId} …`);

      // Placeholder for future implementation.
      // In production this would:
      // 1. Delete existing projection rows for the company/date range.
      // 2. Pull source events (orders, payments, etc.) from the write models.
      // 3. Insert freshly calculated rows into the projection table.
    }

Three correct steps, written as a comment. **M3** fails with it: `repairDrift` is
implemented, and what it does is `await this.rederivationService.rederive(start, end)`.

## The errors are the model against its own schema

    src/operations/operations.repository.ts(58,24)
      Property 'operations' does not exist on type …
    src/operations/operations.repository.ts(68,24)
      Property 'company_totals' does not exist on type … Did you mean …?

Its own `schema.prisma` declares `model OperationProjection` and `model CompanyTotals`,
which Prisma exposes as `prisma.operationProjection` and `prisma.companyTotals`. The
repository addresses them by SQL table names it chose in a different file. Three more
errors are `Object literal may only specify known properties` in the hooks service —
the upsert payload against fields the same reply defined.

This is problem 01's `OutboxMessage` / `Message` again, in a second problem: **the
model writes a schema and then writes against a remembered version of it.**

## Against Qwen3.8-27B on the same problem

| | Qwen3.8-27B | gpt-oss-120b |
|---|---|---|
| must-haves | 2 of 6 | 1 of 6 |
| `prisma generate` | **failed** — 5 one-sided relations | 0 |
| M1 in-transaction hooks | ✗ — written, placed wrong | ✗ — a service with its own client |
| M2 rebuild | called, never written | written as a comment |
| errors | 36, most cascading from no client | 10, eight against its own schema |
| tests | none ran | one that asserts nothing |
| cost | $0.383 | $0.0111 |

Neither model does this problem. The 27B failed by breaking the client and hiding
everything behind it; the 120B failed by leaving the two hard parts unwritten and
naming the easy parts well.

Three problems in, the 120B's pattern is consistent and is not the 27B's: it produces
a clean, well-organised skeleton quickly, and stops at the point where the work would
have to be done.
