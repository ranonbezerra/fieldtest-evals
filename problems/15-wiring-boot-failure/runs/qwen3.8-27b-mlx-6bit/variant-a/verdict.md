# Verdict — 15 Wiring boot failure

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, reasoning_effort: medium}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided,
               M6 decided, M7 decided]
gate:         [M1 ✗, M2 ✗, M3 ✗, M4 ✓, M5 ✓, M6 ~, M7 ✓]

graded:       {diagnosis: 3, fix_quality: 1, proof_design: 2, restraint: 2,
               code_quality: 1, process: 2}

manifest:     10 declared, 10 built, not truncated
typecheck:    failed after 10 repairs
tests:        2 of 2 pass in one file; `test/wiring.spec.ts` could not load

failure_mode: wrong_answer
              # Two of three planted defects diagnosed correctly and precisely. The
              # fixes restructure instead of repairing: a new `src/export/` directory
              # where the fixture has `src/exports/`, and `DeliveryRepository` still
              # absent from `notifications.module.ts` providers — the defect it never
              # named.

revisions:    {self_repairs: 10, dropped_a_requirement: yes}
cost:         {wall_minutes: 73, output_tokens: 44170, tokens_per_second: 10.1,
               requests: 22, output_ceiling_hits: []}
host:         {requests_under_pressure: 0 of 22, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  no
headline:     Diagnoses the wiring correctly and then builds a new module rather than
              fixing the one that is broken.

notes: |
  `DIAGNOSIS.md` is the best artifact in the run and would score 3 on its own. Two
  defects, each under four headings: *what was unresolvable*, *why `tsc` could not see
  it*, *why the unit suite could not see it*, *minimal fix*. Those middle two are M5
  and M6's whole point, and it wrote them unprompted.
  Defect 1 — an import cycle through the `QUEUES` constant, read at module scope, so
  the binding is in its temporal dead zone at boot — matches the answer key's plant 1
  exactly, including the mechanism. It fixed it correctly, by moving the constant into
  a new `src/common/queues.ts` that neither side imports back.
  Defect 2 — `ExportService` registered but not exported across the module boundary —
  matches plant 3, also exactly.
  **It missed plant 2 entirely.** `DeliveryRepository` is never in
  `notifications.module.ts` providers, and the model rewrote that file without adding
  it. Worse, the rewrite *dropped* the `exports: [NotificationsService]` the fixture
  had. The graph cannot resolve, so M1 fails and M2 with it.
  M6 is `~`. It wrote `test/wiring.spec.ts` — a boot check rather than a compile
  check, which is the right instrument and the thing the rubric is asking for. It
  cannot load: `@nestjs/testing` is not in the scaffold, and one assertion uses
  `toBeFrozen`, a matcher vitest does not have.
  M7 holds. No `any`, no `@ts-ignore`, no `forwardRef` papering over the cycle — it
  broke the cycle properly instead, which is the harder and correct answer.
```

## Right diagnosis, wrong repair — for the third time

Its fix for `ExportService` is a new `src/export/export.module.ts` importing
`./export.service.js`. The fixture has neither. It has `src/exports/exports.module.ts`
and `src/exports/exports.controller.ts`, and the service lives at
`src/users/export.service.ts` — which is *the entire defect*: a provider used outside
the module that owns it.

The answer is two lines in files that already exist: add `ExportService` to
`UsersModule.exports`, import `UsersModule` into `ExportsModule`. The model understood
that — it says so in `DIAGNOSIS.md` — and then created a third directory instead.

The manifest shows it committing to the invented shape before writing a line:

    src/export/export.module.ts   <- reads: ['src/export/export.service.ts']

It declared a read on a file at a path that does not exist. `ft-go` filters reads to
files that are present, so the phase received nothing and was never told why.

| run | diagnosed correctly | and then |
|---|---|---|
| 10 adapt existing screen | the feature it needed to build | built it beside the app, wired to nothing |
| 11 behavior-preserving refactor | one mapper, three copies | wrote a fourth and removed none |
| 15 wiring boot failure | a provider not exported across a boundary | created a new module rather than exporting it |

Three problems with existing code, three correct diagnoses, three repairs that add
structure beside the defect instead of changing it. **The model can see what is wrong
and reaches for a new file rather than an edit.**

## `@nestjs/testing`, third run

Problems 06, 12 and 15 have now lost their suites to a package the cheatsheet's stack
implies and the scaffold does not supply. Here it costs more than elsewhere: the suite
*is* M6's deliverable, the proof-of-boot the problem exists to demand, and it cannot
run. `SECOND-PASS.md` §7, deferred by decision, and this is the third invoice.
