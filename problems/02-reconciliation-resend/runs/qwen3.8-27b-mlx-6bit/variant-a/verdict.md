# Verdict — 02 Reconciliation and resend

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided, M6 decided]
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]   # domain only — see below

graded:       {state_machine: 3, matching: 3, time_window: 3, tests: 3,
               quality: 2, process: 2}

failure_mode: reference_gap
              # Every relative import omits the .js extension that "type": "module"
              # + moduleResolution NodeNext requires. tsc reports TS2307 on files
              # that exist; 7 repair rounds never touched it. The same model wrote
              # './payout/payout.module.js' correctly in problem 01, same scaffold.

revisions:    {self_repairs: 7, dropped_a_requirement: no}
cost:         {wall_minutes: 340, output_tokens: 200810, tokens_per_second: 9.9,
               requests: 23,
               output_ceiling_hits: [00-plan, 03-payment.repository.ts,
                                     04-payment.service.ts,
                                     07-payment.spec.ts (already at low)]}
host:         {requests_under_pressure: 0 of 23, ceiling_gib: [37.44, 37.44],
               comparable: yes}
interrupted:  yes — killed mid-gate and resumed at 15:20. meta.yaml timed only the
              segment after the resume and reported 57 minutes and 35,116 tokens.
              The figures above are summed from every request's own usage record.

would_merge:  after_changes
headline:     Gets the hardest reasoning in the set right and ships it in a project
              that does not compile.
notes: |
  Read the gate line carefully: all six must-haves are satisfied in the source, and
  the submission still fails. The domain work is the best in the campaign so far and
  the deliverable is unusable as handed over.
  M1 is exactly right. The only path to resend sits behind two conditions —
  now > endOfDay(date) + publishingLagMs, and the txid absent from that day's
  statement. "Not visible yet" and "absent" are distinct states, which is the trap
  the problem is built on.
  M5 is where it beats problem 01. Four buckets with distinct handling, duplicate
  mapped to success, and a bare catch that routes timeouts to in_doubt rather than
  failure. Problem 01 collapsed this same taxonomy to one bucket by explicit
  decision; here it built all four unprompted.
  Nineteen tests, and they name the traps: "timeout-but-settled, no resend",
  "proven-absent (same txid preserved)", "statement not yet complete leaves in_doubt
  unchanged", "overlapping windows are idempotent". None of them ran — the file does
  not compile either.
  The failure is one systematic lexical habit, repeated in every file. Repairs did
  converge on what they understood: bigint-vs-number was fixed in round 1, which
  surfaced string-vs-OrderStatus, fixed in round 2. TS2307 was in the compiler
  output all seven rounds and was never addressed once.
```

## Why this is not scored as a harness defect

The scaffold is byte-identical to problem 01's, including `"type": "module"` and
`moduleResolution: NodeNext`. Problem 01 compiled on the first attempt under it,
because there the model wrote `'./payout/payout.module.js'`. Nothing about the
environment changed between the two runs; the import style did. A second lexical
error in the same class appears in the tests — `vi.fn<Promise<T>>()` where vitest
wants `vi.fn<() => Promise<T>>()` — which suggests the gap is about the exact shape
of an API signature rather than about ESM specifically.
