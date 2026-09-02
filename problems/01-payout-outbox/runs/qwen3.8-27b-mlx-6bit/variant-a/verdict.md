# Verdict — 01 Payout with outbox + hold

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, reasoning_effort: medium}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided,
               M6 decided, M7 decided, M8 decided]
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓, M7 ✓, M8 ✓]

graded:       {state_machine: 2, tx_boundaries: 2, errors: 0, tests: 3,
               quality: 2, process: 2}

failure_mode: reference_gap
              # All eight must-haves are satisfied and the project does not compile.
              # PLAN.md designs every repository around `PrismaService` — it appears
              # in two constructors — and never declares src/prisma/prisma.service.ts
              # in its manifest. No phase was asked to write it, so every phase
              # imported a file that does not exist. Six errors survive: 2 for that
              # missing file, 3 untyped `tx` callback parameters, and one typo,
              # `UneprocessableEntityException`.

revisions:    {self_repairs: 9, dropped_a_requirement: no}
cost:         {wall_minutes: 190, output_tokens: 110036, tokens_per_second: 9.7,
               requests: 25, output_ceiling_hits: []}
host:         {requests_under_pressure: 0 of 25, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  after_changes
headline:     Satisfies every must-have, including both it failed at low effort, and
              imports a file its own plan forgot to commission.

notes: |
  This is the first run at `reasoning_effort: medium`, and the two must-haves the
  discarded low-effort run got wrong are both right here — not by luck, but by the
  mechanism the replay predicted.
  M4 is `FOR UPDATE SKIP LOCKED` with `WHERE status = 'pending'`, the canonical
  outbox claim and genuinely exclusive. The low plan had written the same statement
  as `status IN ('pending','processing')`, which two workers can both satisfy.
  M7 marks `needs_review` and stops. There is no `releaseHold` anywhere in the
  exhaustion path — funds stay reserved when the provider outcome is unknown, which
  is what its plan argued for and its predecessor contradicted.
  M1 is a computed hold rather than a column: `balance − SUM(amount) WHERE status IN
  ('created','processing','sent')`, read under a `FOR UPDATE` on the account row, so
  two concurrent creates serialise on the same lock and the second sees the first.
  M5 is the strongest in the set — it catches P2002, re-reads the existing payout,
  and checks the amount and destination match before returning it. A reused key with
  a different body is a conflict, not a silent success, and there is a test for it.
  What it did not fix is the error taxonomy. The `catch` is bare, nothing is
  classified, and `'failed'` exists in the status union with no path that reaches it.
  Criterion 3 scores 0 for the second run running. The settlement path is also three
  sequential awaits rather than one transaction, so a crash between the first two
  leaves a payout marked completed with no ledger entry.
  Ten tests, and they name the traps: concurrent overdraft, at-least-once
  redelivery, retry exhaustion to needs_review, recovery on a later tick.
```

## What changed against the discarded run, measured

| | at `low` (discarded) | at `medium` |
|---|---|---|
| output ceiling hits | 5 of 11 phases | **0 of 25** |
| tokens | 146,619 | 110,036 |
| relative imports carrying `.js` | 14 of 14 | **26 of 26** |
| M4 consumer dedup | ✗ `IN ('pending','processing')` | ✓ `FOR UPDATE SKIP LOCKED` |
| M7 no revert in uncertainty | ✗ releases the hold | ✓ keeps funds reserved |
| test file | empty — the cases phase overflowed | 10 cases |
| gate | passed, 0 repairs | failed, 9 repairs |

The last row is the one that matters against the others. The low run compiled and
was wrong about money; this one is right about money and does not compile. Judged on
the rubric rather than on `tsc`, that is a large move in the right direction — but it
is still a FAIL, and a developer handed this branch gets a red build.

## The new failure mode

`reference_gap` here is not the model losing track of an import style. It is a
manifest that does not list a file the design depends on. The plan describes
`PrismaService` as the injected dependency of both repositories, and its manifest —
the machine-readable list of files the harness turns into phases — never names it.
Everything downstream is consistent with a file nobody was asked to write.

The finer decomposition is what exposed it. The low plan wrapped Prisma inline in
fewer, coarser files; this one separates `outbox/` from `payout/`, adds
`provider.interface.ts` and `payout.types.ts`, and reaches for the idiomatic NestJS
service wrapper — then omits it from the one list that turns designs into work.

A rule the harness could check before phase 1, mechanically: **every type named in a
constructor signature must resolve to a file the manifest declares.** That is the same
shape as the plan-consistency check §1.3 argues for, and it is the second time the
plan has been the place to catch a failure that only shows up in the code.
