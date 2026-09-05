# Verdict — 10 Adapt existing screen

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, reasoning_effort: medium}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided, M6 decided]
gate:         [M1 ✗, M2 vacuous, M3 ✓, M4 ✗, M5 ✓, M6 ✓ (vacuous)]

graded:       {convention_fidelity: 1, domain_modeling: 2, ambiguity_handling: 1,
               test_quality: 3, code_quality: 2, process: 1}

manifest:     7 declared, 7 built, not truncated
typecheck:    failed after 3 repairs — one error, an unused import
tests:        12 of 15 pass

failure_mode: wrong_answer
              # The task is to adapt an existing screen. It modified no existing file.
              # Five new files were written, wired to each other, and connected to
              # nothing the application runs.

revisions:    {self_repairs: 3, dropped_a_requirement: yes}
cost:         {wall_minutes: 101, output_tokens: 62359, tokens_per_second: 10.3,
               requests: 13, output_ceiling_hits: []}
host:         {requests_under_pressure: 0 of 13, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  no
headline:     Builds the whole feature correctly beside the application and never
              connects it to anything.

notes: |
  Not one file in the scaffold was modified. Verified by diffing every `.ts` and
  `.tsx` in `scaffold/src` against the workspace: zero differences.
  What it wrote instead is an island. `authenticated-layout.tsx` mounts
  `<ActiveSessionBar />`, and nothing imports `authenticated-layout.tsx` — the
  scaffold's root is `main.tsx` and it was never touched. `session-detail.tsx` is a
  full rewrite of the detail screen under a new name, and nothing imports that
  either; the app still routes to `SessionDetailScreen.tsx`, byte-identical to the
  scaffold.
  So M1 fails twice over: the existing screen was not edited, and the rewrite that
  replaced it was never substituted for it. M4 fails outright — there is no wiring to
  a real API call because there is no wiring at all.
  M2 and M6 are marked vacuous rather than passed. Every existing behavior still
  works and nothing was restyled or renamed, both because nothing was touched. A
  must-have satisfied by inaction is not evidence of care.
  The parts, judged alone, are decent. `use-active-session.ts` goes through
  `useQuery`/`useMutation` with the app's query client, which is M3. Loading and error
  states are handled where async surfaces exist, which is M5. Fifteen tests, twelve
  passing, and the three that fail are real behaviour: Resume does not navigate,
  navigates when `active` is null, and an invalid ISO date renders `NaNs`.
  It also chose kebab-case — `session-detail.tsx`, `active-session-bar.tsx` — in a
  codebase whose components are `SessionDetailScreen.tsx`, `OrdersListScreen.tsx`,
  `SessionsListScreen.tsx`. Convention fidelity scores 1 for that alone.
```

## One error, and it is not the interesting one

    src/features/sessions/session-detail.tsx(5,1): error TS6133:
      'Session' is declared but its value is never read.

That is the entire typecheck failure — an unused import, under `noUnusedLocals`. By
error count this is the closest any run has come to compiling.

It is also the most misleading number in the campaign so far. The submission compiles
in one deletion and still does not do the task, because a typecheck cannot ask whether
the code it accepts is reachable from the application. Dead code typechecks perfectly.

Problem 07 showed an error count understating a run because errors suppressed each
other (§3.6b). This is the other direction: **an error count overstating how close a
run is, because the thing that is wrong is not the kind of thing a compiler asks
about.**

## What it says about the model

Seven system-design problems produced a consistent story: it designs well and loses the
result between files. Problem 08, with no files to lose anything between, passed
cleanly. This one sharpens it.

Given an existing application and told to adapt it, the model built the feature
correctly — hooks through the right state mechanism, loading and error states, fifteen
tests — as a **parallel structure**, and never made the join. Every one of its files
references its other files correctly. The single reference it needed to get right was
outward, into code it did not write, and that is the one it did not make.

The failure is not in what it builds. It is at the boundary between what it builds and
what already exists.
