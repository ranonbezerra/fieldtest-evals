# Verdict — 02 Reconciliation and resend

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, reasoning_effort: medium}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided, M6 decided]
gate:         [M1 ✗, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {state_machine: 2, matching: 2, time_window: 3, tests: 3,
               quality: 3, process: 2}

typecheck:    passed after 5 repairs
tests:        13 of 14 pass — the failure is the model's own test for M1

failure_mode: wrong_answer
              # reconcile() has two phases. The match phase reads the statement; the
              # absence phase does not. It re-queries findInFlight and transitions
              # every remaining order past the publishing lag to PENDING, without
              # ever asking whether that order's txid is in the statement it just
              # read. An order the bank settled for a mismatched amount is skipped
              # by the match phase — correctly, with the comment "requires manual
              # investigation" — and then queued for resend by the next loop.

revisions:    {self_repairs: 5, dropped_a_requirement: no}
cost:         {wall_minutes: 101, output_tokens: 58593, tokens_per_second: 9.7,
               requests: 14, output_ceiling_hits: []}
host:         {requests_under_pressure: 0 of 14, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  no
headline:     Writes the test that catches its own bug, and ships the bug.

notes: |
  This is the first run in the campaign to compile, and its own test suite is what
  fails it. The gate typechecks; it does not execute. Run the tests and 13 of 14
  pass, the fourteenth being `amount mismatch: order is NOT settled and NOT treated
  as absent` — a case the model chose to write, named precisely, and then violated
  twenty lines above.
  M1 is the whole problem and the defect is one missing condition. The absence loop
  gates on `isPastPublishingLag` and on the attempt count, and never on
  `statementMap.has(order.txid)`. Absence is assumed from "still IN_FLIGHT and the
  lag has passed" rather than proven from the statement in hand.
  Everything around it is good work. M5 is a discriminated union — `accepted`,
  `duplicate` with `originalAcceptedAt`, `transient` with a reason,
  `permanent_rejection` with a code — switched on with distinct handling, which is
  a stronger construction than the string enum the discarded run used. M2 derives
  the txid from `orderId:date` and, on resend, reuses the stored one via
  `order.txid ?? derive(...)`, so a duplicate reaches the bank as a duplicate.
  M4 holds: a network error on send is treated as a timeout and moves the order to
  IN_FLIGHT rather than failing it, and there is a test for that.
  Criterion 3 is the strongest cell. `effectiveDate + 24h + 30min` models the
  statement's publishing lag explicitly, and "not yet past lag leaves the order
  untouched" is its own test.
```

## The gate typechecks and does not run

This run is the case for changing that. `tsc` passed after five repairs and the
deliverable is wrong about the one thing the problem exists to test. The evidence was
sitting in the workspace the whole time, in a file the model wrote, and nothing in the
harness executed it.

The tests are not a formality here: they were scored 3 on their own merits before they
were run, because they name the traps — timeout-but-settled, proven-absent with the
txid retained, attempt exhaustion, not-yet-past-lag, second reconcile yields zero
counts. Running them cost ninety seconds.

Recorded as the strongest candidate for the second pass, with §1.3's plan-consistency
check and §01's manifest check. The configuration is fixed for this pass, and this is a
change to what the gate does rather than to how the model is run — but it would change
what a run means, so it waits.

## Third instance of one pattern

| run | the model stated it right in | and violated it in |
|---|---|---|
| 01 at `low` | the plan's ordering rules | the plan's control flow |
| 01 at `medium` | the plan's design | the plan's manifest |
| 02 at `medium` | the test suite | the implementation |

Each artifact is internally coherent. What fails is the agreement between two things
the model wrote in the same run, and in every case one of them is right. Nothing here
needs the model to know something it does not know.
