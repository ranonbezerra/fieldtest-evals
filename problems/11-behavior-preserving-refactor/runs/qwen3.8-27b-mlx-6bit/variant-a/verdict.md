# Verdict — 11 Behavior-preserving refactor

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, reasoning_effort: medium}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided, M6 decided]
gate:         [M1 vacuous, M2 ✓, M3 ✗, M4 ✗, M5 ✗, M6 ✓ (vacuous)]

graded:       {dedup_quality: 0, characterization: 1, scope: 1, tests: 2,
               code_quality: 2, process: 1}

manifest:     6 declared, 6 built, not truncated
typecheck:    failed after 8 repairs — every error TS2835, the `.js` extension
tests:        12 of 12 pass

failure_mode: wrong_answer
              # The task is to end three copies of one mapper in one place. All three
              # copies are byte-identical to the fixture. It wrote a fourth
              # implementation and redirected two of the five call sites to it.

revisions:    {self_repairs: 8, dropped_a_requirement: yes}
cost:         {wall_minutes: 63, output_tokens: 38725, tokens_per_second: 10.2,
               requests: 16, output_ceiling_hits: []}
host:         {requests_under_pressure: 0 of 16, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  no
headline:     Turns three copies into four, and the suite stays green because the
              tests still point at the copies it left alone.

notes: |
  The fixture carries the same mapper three times: `src/orders/orders.status.ts`,
  `src/payouts/payouts.status.ts`, and `scripts/reporting.ts`. M4 asks for those three
  to end in one place with the call sites delegating.
  All three are byte-identical to the fixture after the run. What the model added is a
  fourth: `src/shared/payment-status-mapper.ts`, which `orders.service.ts` and
  `payouts.service.ts` — both genuinely edited in place — now call. The originals are
  untouched, still exported, still imported by their own tests.
  `scripts/reporting.ts` got the treatment problem 10 gave the detail screen: rather
  than edit it, the model wrote a parallel `src/reporting/reporting.service.ts` and
  left the script where it was. That is M5 as well as M4 — a new module in a task
  whose whole point is removing code.
  **The green suite is the finding, not the consolation.** Twelve of twelve pass, and
  `test/orders.status.spec.ts` and `test/payouts.status.spec.ts` import
  `../src/orders/orders.status.js` and `../src/payouts/payouts.status.js` — the copies
  the refactor did not reach. The tests are green because they are testing the code
  that was not changed.
  M1 and M6 are marked vacuous for the same reason. Behaviour is preserved and no test
  was weakened, both because the tested paths were never touched.
  M3 fails outright: `scripts/reporting.ts` had no coverage, and no characterization
  test was written to pin its behaviour before a parallel replacement was introduced.
  M2 passes and is worth crediting — no quirk was quietly corrected along the way.
```

## A refactor is the one task where adding code is the failure

Every other problem in this campaign rewards construction. This one rewards deletion,
and the model's instinct ran the wrong way: it built the correct shared mapper, wired
two call sites to it competently, and then left every original in place.

Count the mapper implementations before and after:

| | before | after |
|---|--:|--:|
| implementations of the mapper | 3 | **4** |
| call sites reading a local copy | 3 | 1 (`scripts/reporting.ts`) |
| test files pinned to a local copy | 2 | 2 |

The refactor's own artifact is fine. `payment-status-mapper.ts` is a single clean home
and the two services delegate to it properly. It is the removal half that never
happened.

## Same shape as problem 10, one problem later

| | 10 adapt existing screen | 11 behavior-preserving refactor |
|---|---|---|
| what it built | a working feature, correct in isolation | a correct shared mapper |
| what it edited | nothing | two of five call sites |
| what it left | the original screen, still routed | all three original copies |
| how it reads | dead code beside a live app | a fourth copy beside three |

Both are the boundary failure §10 named: **the model's references into its own new
code are reliable, and its references into code it did not write are where the work
stops.** Problem 11 is the sharper case, because here the pre-existing code was not
merely un-referenced — it was the thing it was asked to remove.

## Eight repairs, all of them the same

Every remaining error is `TS2835` — *Relative import paths need explicit file
extensions in ECMAScript imports. Did you mean './x.js'?* — in a fixture whose own
files carry the extension everywhere, including the tests the model read.

The compiler names the fix in the message text. Eight repair phases received that
message and none of them applied it. That is §3.6 in its purest form: the run is one
mechanical edit from compiling, and thirty-eight thousand tokens of repair did not
make it.
