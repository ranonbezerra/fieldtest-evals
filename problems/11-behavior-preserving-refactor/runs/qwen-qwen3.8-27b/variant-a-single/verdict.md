# Verdict — 11 Behavior-preserving refactor (hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✗, M5 ✗, M6 ✓]

graded:       {refactor_quality: 2, open_track: n/a, archaeology: 3,
               test_quality: 3, quality: 1, process: n/a}

typecheck:    passed on attempt 0 — zero repairs
tests:        22 of 22 pass, 5 files

failure_mode: wrong_answer
              # It extracted the mapper, pointed two call sites at it, wrote a third
              # script that also uses it — and left the third *existing* call site,
              # `scripts/reporting.ts`, byte-identical with its own copy of the
              # switch. Its NOTES.md states that all three now delegate.

revisions:    {self_repairs: 0, dropped_a_requirement: yes}
cost:         {wall_minutes: —, output_tokens: —, requests: 1, usd: —}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     The only run in either campaign where everything compiles and every test
              passes, and it fails on the one thing it was hired to do: there are
              still two copies of the mapper.

notes: |
  The extraction itself is good work. `src/shared/payment-status-mapper.ts` covers the
  union of provider codes; `orders.service.ts` and `payouts.service.ts` delegate to it.
  M2 the reporting quirk survives as an explicit constructor option — the code says
  `Reporting-only quirk, preserved on purpose` — rather than being tidied away. M3 is
  honoured in the right order: `test/reporting.spec.ts` is new, and it pins the copy
  that had no coverage. M1 and M6 hold — the fixture's `orders.status.spec.ts` and
  `payouts.status.spec.ts` are untouched and green.
  `archaeology: 3` is earned. NOTES.md tabulates the three copies, their divergent
  behaviour on unknown codes, and closes with `This divergence is intentional. Do NOT
  unify it without confirming all three` — which is exactly the judgement the problem
  is testing for.
```

## Two copies, not one

M4 is the point of the problem: *the duplicated logic ends in ONE place; three copies
become one.* On disk:

    src/shared/payment-status-mapper.ts       the extraction        ← delegated to by
    src/orders/orders.service.ts                                       orders ✓
    src/payouts/payouts.service.ts                                     payouts ✓
    scripts/generate-status-report.ts         written by the model     ✓
    scripts/reporting.ts                      byte-identical to the fixture

`scripts/reporting.ts` is the third call site. It still carries its own switch:

    switch (code) {
      case 'PENDING':
      case 'AWAITING_PAYMENT':
      case 'AUTHORIZED':
      …

The model did not edit it. It wrote a **new** script under a different name that does
delegate, and left the original in place — so the file the CSV consumers actually run
is the one that was never refactored.

And its own NOTES.md says otherwise:

    | 3 | reporting script | `scripts/generate-status-report.ts` | `REVERSED` emitted as uppercase
    All three call sites now delegate to `src/shared/payment-status-mapper.ts`,

The table names a file the model created as though it were the one it found. **The
prose describes a migration that the artifact did not perform**, and it describes it
confidently enough that a reviewer reading the notes would not check.

## And it built an application nobody asked for

The fixture is ten files: two services, two status modules, a reporting script, two
specs, and config. The task is to extract one mapper.

The reply delivered, beyond the refactor: `src/app.module.ts`, `src/main.ts`,
`orders.controller.ts`, `orders.module.ts`, `orders.repository.ts`, the same three for
payouts, `prisma/schema.prisma`, a migration, and an exception filter. A NestJS
application with a database, wrapped around a ten-file fixture that has neither.

M5 asks for scope discipline — "only the target area touched; no reformatting or
renaming sweeps outside it". This is not a sweep; it is a new codebase built around
the target.

## The most instructive result in the campaign

Everything here is green. `tsc --noEmit (attempt 0) -> 0`. `vitest run -> 0`,
22 of 22. No repairs. If the gate were the verdict, this would be the campaign's
strongest run by a distance.

It fails because a gate cannot see the thing that matters: whether the change asked
for was made. The duplication is still there, in the file that was always there, and
the notes say it is not.

**A green pipeline on a task like this measures whether the code the model wrote works.
It cannot measure whether the model did the job.** That is the argument for judging
every run against a rubric by hand, and this run is the evidence for it.
