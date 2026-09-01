# Verdict — 03 Read model projection

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided, M6 decided]
gate:         [M1 ✗, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {schema_design: 3, rebuild_story: 3, tradeoffs: 3, tests: 3,
               quality: 1, process: 1}

failure_mode: wrong_answer
              # PLAN.md:271 "WritesService.createOrder opens a Prisma transaction",
              # :273 "all inside the transaction", :277 "Commit transaction".
              # writes.service.ts opens none: create() commits, then
              # applyOrderCreated() runs in its own transaction.

revisions:    {self_repairs: 9, dropped_a_requirement: yes}
cost:         {wall_minutes: 172, output_tokens: 104583, tokens_per_second: 10.1,
               output_ceiling_hits: [test/operations.spec.ts-cases,
                                     test/operations.spec.ts]}
host:         {pressure_samples: 0 of 2, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  no
headline:     Writes an excellent design document, then builds drift repair to paper
              over the atomicity it forgot to implement.

notes: |
  M1 is the point of this problem and the only must-have it missed. The plan says
  the projection upsert belongs in the source write's transaction, in three separate
  places. The code awaits the source write, lets it commit, then awaits the
  projection. A crash in between leaves the read model permanently behind.
  The compensation is already in the box: a @Cron(EVERY_5_MINUTES) drift repair and
  a rederive routine. Both are good work, and both exist to clean up a window that
  M1 would have closed. The model built the cure and skipped the prevention.
  What it got right is the hard part elsewhere. M5 is a real atomic increment —
  ON CONFLICT ... DO UPDATE SET approved_total_cents =
  company_financial_totals.approved_total_cents + ${approved} in raw SQL, because
  Prisma cannot express it. Same instinct as problem 01's SELECT ... FOR UPDATE:
  when the ORM runs out, it reaches for SQL and gets it right.
  DESIGN.md weighs six alternatives — triggers, CDC, event sourcing, matviews,
  cache, direct optimization — and says why each loses. Criterion 3 is the strongest
  score in the campaign.
  transitionOrder also reads, checks order.status === newStatus, and updates with no
  lock: check-then-act on the source row, a lost-update race the plan did not
  mention either way.
```

## The import inconsistency, measured

23 of the 32 remaining compile errors are TS2307 on modules that exist. The cause is
the same missing `.js` extension that sank problem 02, but here the run contradicts
itself file by file, and the split follows the phase order exactly:

| phases | files | extension |
|---|---|---|
| 02–05 | `projections/*` | none |
| 06–09 | `operations/*` | `.js` |
| 10 | `writes.service.ts` | none |
| 11 | `writes.module.ts` | `.js` |
| 12–14 | `drift-repair/*`, `app.module.ts` | none |

Each file is an independent request. The convention holds inside a run of phases and
resets between them, because nothing carries the previous file's import style
forward. Problem 01 compiled because its coin came up `.js` every time; problem 02
failed because it never did.

`drift-repair.processor.ts` makes the misdiagnosis explicit. The model wrote
`// ASSUMPTION: ../projections/projections.service ... cannot be resolved` above its
own unresolvable import — it saw the symptom and attributed it to the workspace
rather than to the specifier it was writing.
