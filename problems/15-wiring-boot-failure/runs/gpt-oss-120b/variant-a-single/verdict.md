# Verdict — 15 Compiles clean, fails at boot (gpt-oss-120b, hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✗, M6 ~, M7 ✓]

graded:       {diagnosis_depth: 0, fix_structure: 3, boot_proof: 2,
               restraint: 3, quality: 3, process: n/a}

typecheck:    passed on attempt 0 — zero repairs
tests:        2 of 2 pass — the fixture's own

failure_mode: dropped_a_requirement
              # Every defect is fixed, correctly and in the right place, and
              # `DIAGNOSIS.md` was never written. Item 3 of the task asks for it by
              # name: "for each defect, what was unresolvable, why neither tsc nor
              # the unit suite could see it, and the minimal fix".

revisions:    {self_repairs: 0, dropped_a_requirement: yes}
cost:         {wall_minutes: ~2, requests: 1, usd: 0.0040}
host:         {n/a — the model is not on this machine}

would_merge:  the code, yes; the task is not complete without the write-up
headline:     All three defects fixed in the file the key names, nothing silenced,
              a clean compile in one request — and no diagnosis at all.
```

## The fixes are the reference fixes

**Defect 1, the import cycle.** The key's expected fix: "Move `QUEUES` and `QueueName`
into `src/jobs/queues.ts`, a file that **imports nothing**." What was delivered:

    src/jobs/queues.const.ts
    /** Queue name constants shared across the application. */
    export const QUEUES = {

A leaf file with no imports. `notifications.service.ts` now takes the constant from
there rather than from `jobs.module.ts`, so the module-evaluation cycle is gone.

**Defect 2**, `DeliveryRepository` never registered:

    providers: [NotificationsService, DeliveryRepository],

**Defect 3**, `ExportService` in providers but not exported:

    exports: [UsersService, ExportService],

M7 is clean: no `forwardRef`, no `@ts-ignore`, no stub, and the only occurrence of the
string `any` in `src` is the word in a comment. The cycle was broken structurally,
which is what the variant asks for and what it warns against faking.

M2, M3 and M4 follow from those three edits. `tsc --noEmit (attempt 0) -> 0`, zero
repairs, and the fixture's two tests still pass.

Seven files delivered, four of them edits to the real application at `src/` — not to a
`fixtures/api/` tree of its own, which is where the blind Qwen run put everything.

## And nothing explains it

There is no `DIAGNOSIS.md` in the workspace. The task's item 3:

    Write `DIAGNOSIS.md`: for each defect, what was unresolvable, why neither `tsc`
    nor the unit suite could see it, and the minimal fix.

M5 is that requirement — "the written diagnosis says *which* provider was
unresolvable and why" — and there is nothing to read. `diagnosis_depth: 0`. On a
problem whose whole subject is a failure invisible to the compiler, the explanation is
half the deliverable.

M6 is partial. `src/wiring/wiring-check.service.ts` throws
`Wiring check failed: could not resolve provider …` at startup, which is a real boot
guard and is the right idea. But it is a runtime assertion inside the application, not
a check anything runs: the suite is the fixture's `counts users` and `finds by email`.
The task asks for "a check that **fails when the wiring is wrong**", and nothing in
this repository would have failed before the fixes.

## Against Qwen3.8-27B on the same problem

| | Qwen3.8-27B (blind) | gpt-oss-120b (fixture visible) |
|---|---|---|
| defects fixed | in a `fixtures/api/` tree it created | **in the application** |
| the real app after the run | untouched, still broken | **fixed** |
| `QUEUES` extraction | correct, wrong directory | correct |
| DIAGNOSIS.md | present, and good — named the temporal dead zone | **absent** |
| `forwardRef` refused with reasons | yes, in a section of its own | n/a, no write-up |
| verdict | FAIL | FAIL |

A clean inversion. Qwen understood the failure and explained it well, then applied the
cure to a copy. This run applied the cure to the patient and wrote nothing down.

Between the two there is one complete answer to problem 15, and neither model produced
it alone.
