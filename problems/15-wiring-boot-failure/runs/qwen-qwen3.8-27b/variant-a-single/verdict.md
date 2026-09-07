# Verdict — 15 Compiles clean, fails at boot (hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✗, M2 ~, M3 ~, M4 ✓, M5 ✓, M6 ~, M7 ✓]

graded:       {diagnosis_depth: 3, fix_structure: 3, boot_proof: 1,
               restraint: 3, quality: 2, process: n/a}

typecheck:    passed on attempt 0 — zero repairs
tests:        2 pass, 1 file fails to load — the wiring check the task asked for

failure_mode: harness_artifact
              # The workspace was seeded from `fixtures/api` **into its root**, so the
              # broken application is at `workspace/src/`. The model, never shown it,
              # followed the brief's phrase "in `fixtures/api/`" and wrote 20 files
              # into `workspace/fixtures/api/src/`. The application it was asked to
              # fix is byte-identical to the fixture and still does not boot.

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: —, output_tokens: —, requests: 1, usd: —}
host:         {n/a — the model is not on this machine}

harness_note: |
  Blind run. `ft-go`'s single shape passed only the variant brief; the seeded
  application was never handed over. Fixed today — the single request now carries
  every seeded file. This run should be repeated before it is read as a result.

would_merge:  no — the application that was given still does not start
headline:     It diagnosed the boot failure correctly, prescribed the right structural
              fix, refused the wrong one and explained why — and applied all of it to
              a copy of the app it built itself, one directory below the real one.
```

## The diagnosis is right

    ## 1. `QUEUES` circular import caused a temporal-dead-zone ReferenceError
    `dist/notifications/notifications.service.js` referenced `QUEUES` before the
    module that declares it finished evaluating.
    ### Why `tsc` and the unit suite could not see it

Against the answer key: `QUEUES` is declared in `jobs.module.ts`; `notifications.
service.ts` imports it from there; the cycle is real and it fires at module-evaluation
time, before Nest logs anything. The model names the mechanism — temporal dead zone —
and explains why a typecheck and a faked-repository unit test both miss it. That is
M5 in full.

The fix is the structurally correct one: it moved the constant into
`src/queue/queue.constants.ts`, a file with no module imports. The key's expected fix
is `src/jobs/queues.ts`, "a file that imports nothing". Same move, different name.

M7 is honoured deliberately, not by accident. No `any`, no `@ts-ignore`, no stub, and
a section headed **`## Why forwardRef was not used`** — which is exactly what the
brief asked for when it said "do not reach for `forwardRef` unless the cycle is
genuine, and say why if you do".

## And none of it touches the application

    workspace/src/                   the seeded app — byte-identical to fixtures/api,
                                     still holding all three defects
    workspace/fixtures/api/src/      20 files the model wrote

`workspace.json` seeds `fixtures/api` **into the workspace root**. The brief says the
service "is in `fixtures/api/`", which is true of the problem repository and false of
the workspace the model's files land in. Never having been shown either, the model
used the path it was given.

M1 asks that the application boot. The application boots no better than before, and
`notifications.module.ts` in the real tree still lists
`providers: [NotificationsService, NotificationsRepository]` with `DeliveryRepository`
absent — answer-key defect 2, untouched.

M6 asks for a check that fails when the wiring is wrong. The model wrote one —
`test/wiring.spec.ts`, which boots the Nest application context — and it fails to
load, from a directory the app does not live in. **The right check, aimed at nothing.**

## What this run does and does not measure

The brief hands over a great deal: the exact `ReferenceError`, the file and line it
came from, the observation that Nest logged nothing first, and the three merged
features that map one-to-one onto the three planted defects. As with problem 14, that
converts discovery into elaboration.

What remains genuinely the model's, and is good: knowing that a `ReferenceError` before
any framework log means module-evaluation order rather than dependency injection;
knowing that the fix is to move the constant to a leaf file rather than to reach for
`forwardRef`; and writing down why `tsc` cannot see it.

The blindness is the harness's and is fixed. **This problem should be re-run**, and it
is the one most likely to change verdict when it is: everything needed for a pass is
present in this reply except a correct path.
