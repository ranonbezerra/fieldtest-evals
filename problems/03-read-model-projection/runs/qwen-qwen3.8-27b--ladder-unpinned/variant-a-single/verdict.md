# Verdict — 03 Read model projection (qwen3.8-27b, hosted, **ladder**)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: ladder, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               upstream_provider: Parasail}

plan_gate:    n/a — the level-2 specification replaced the plan phase
gate:         [M1 ✓, M2 ✗, M3 ~, M4 ✓, M5 ✓, M6 ✓]

graded:       {schema_design: 3, rebuild_story: 0, tradeoffs: 3, tests: 0,
               quality: 1, process: n/a}

typecheck:    failed after 6 repairs — 10 errors
tests:        8 skipped — the suite does not compile

failure_mode: reference_gap
              # `drift-repair.service.ts` calls `projectionService.rederiveWindow()`
              # under a comment assuming it exists. `ProjectionService`, written by
              # the same reply, exposes `onOrderCreated` and `onOrderStatusChanged`
              # and nothing else.

revisions:    {self_repairs: 6, dropped_a_requirement: no}
cost:         {output_tokens: 65536 + 86604, requests: 8, usd: 0.4287}
host:         {n/a — the model is not on this machine}

harness_note: |
  The first attempt was cut at **exactly 65,536** tokens with 100% reasoning and no
  reply — a backend's ceiling, not the model's. The retry ran to 86,604 and completed
  on **Parasail**, which `ft-run` now records. Judged on the retry.

would_merge:  no
headline:     The transaction boundary both earlier conditions missed is here and
              correct — and the rebuild routine is called by name and written nowhere.
```

## M1 is right, and it is the one that mattered

Both earlier conditions failed this must-have. The `model` axis wrote the hooks and
placed them outside the writing transaction; the gpt-oss run gave the hook service its
own `PrismaClient`, which makes joining a caller's transaction impossible.

The issue's §1 says the hooks run inside the transaction that writes the source row,
and says why the alternatives fail the read-your-own-writes constraint. What came back,
in `order.service.ts`:

    /**
     * Every write runs in one database transaction that (1) mutates the source row
     * and (2) applies the matching projection hook, so the write and its projection
     * commit or roll back together.
     */
    return this.orders.withTransaction(async (tx) => {
      …
      await this.projections.onOrderCreated(tx, { … });
      …
      await this.projections.onOrderStatusChanged(tx, { … });

The hook signature takes `Prisma.TransactionClient`. There is no way to call it outside
a transaction, which is the property worth having.

**M5** is a guarded conditional update — `tx.paymentOrder.updateMany` under
"Guarded status transition: only orders still in…". **M6** is the best index of any run
on this problem: `@@index([companyId, status, occurredAt desc, id desc])`, a covering
index matching the dashboard's filter, sort and tiebreak. **M4** reads the projection.
`DESIGN.md` is 129 lines.

## And M2 does not exist

`src/drift-repair/drift-repair.service.ts`, line 5:

    // ASSUMPTION: ProjectionService exposes rederiveWindow(from: Date, to: Date):
    // Promise<void> as referenced by the DriftRepairRepository documentation comment.

    await this.projectionService.rederiveWindow(from, to);

`src/projection/projection.service.ts`, written by the same reply, exposes exactly two
methods: `onOrderCreated` and `onOrderStatusChanged`.

The re-derivation routine — §3 of the issue, and a must-have — was never written. It is
referenced, assumed to exist, and cited to a documentation comment in a *third* file as
though that were evidence. **M3 fails with it**: `repairWindow(from, to)` is
implemented and its body delegates to the routine that does not exist.

This is the fifth time in this repository a model has hedged with an `ASSUMPTION`
against a file it wrote itself, and the second time the assumption was wrong.

## The ladder axis, two problems in

| | problem 01 | problem 03 |
|---|---|---|
| the must-have the `model` axis missed | M3 — **fixed** | M1 — **fixed** |
| must-haves met | 8 of 8 | 4 of 6 |
| what fails it | repository against its own schema | service against its own service |
| errors | 25 | 10 |

Both times the specification supplied the decision the model could not make on its own,
and both times the delivery broke on the model disagreeing with itself about an
interface it had just written.

**The pattern is holding: hand over the design and the design gets built. The drift is
untouched, because the drift is not in the design.**

## Provider ceiling

The first attempt returned **exactly 65,536** completion tokens, all reasoning, no
reply. Problem 02 of this axis died at exactly 32,768 the same way. Neither is this
model's limit — it returned 99,903 on problem 01 and 103,242 on the `model` axis's
problem 03. OpenRouter routes across upstream providers with different output caps, and
`ft-run` now records which one served each request. This retry was Parasail.
