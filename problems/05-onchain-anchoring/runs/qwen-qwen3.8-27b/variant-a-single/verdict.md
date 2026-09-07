# Verdict — 05 On-chain anchoring (hosted, single request)

```yaml
verdict:      PASS_WITH_NOTES
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {state_machine: 3, recovery: 3, verification: 3, tests: 1,
               quality: 3, process: n/a}

typecheck:    passed on attempt 0 — zero repairs
tests:        11 of 15 pass, against a real PostgreSQL 14
              # run retroactively with ft-test; the campaign's test step has no
              # database, and this run's global-setup correctly refuses to run
              # without one rather than testing nothing.

failure_mode: none
              # All four failures are defects in the model's own tests. In each one
              # the assertion immediately before the failure proves the production
              # code did the right thing.

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: 13.6, output_tokens: —, requests: 1, usd: 0.221}
host:         {n/a — the model is not on this machine}

would_merge:  yes, after fixing four assertions
headline:     Fifteen files, one request, clean compile, six of six must-haves, and a
              recovery design that is the best engineering in either campaign — with
              a red suite that is entirely the tests' fault.

notes: |
  M1 the anchor row carries the signed transaction and is written before broadcast.
  M2 `@@unique([documentId, version])`. M3 five states, including the one most
  designs omit: `broadcast_unknown` distinct from `broadcast_sent`. M4 the sweep
  queries the chain before it does anything else. M5 `canonicalizeJson` with the
  serialization rules written out — sorted keys, compact scalars, canonical numbers.
  M6 no key material anywhere in `src`; the chain client is an injected abstraction
  with a scriptable fake.
  Graded `tests: 1` is not about coverage — the scenarios are excellent, including a
  genuine crash between broadcast and confirmation across two app instances against
  one database. It is about four of them being wrong.
```

## The suite is red and the code is right

    ✗ persists the anchor intent before broadcasting, then confirms
    ✗ recovers a broadcast timeout that DID land, by confirming from the receipt
    ✗ survives a process crash between broadcast and confirmation
    ✗ returns the anchoring proof for matching content

Four failures, four test defects:

**Two are an assertion that can never pass.**

    expect(confirmedRow.blockNumber).toBeInstanceOf(BigInt);   // 1000n

`typeof 1000n === 'bigint'`, and a primitive bigint is not an instance of the `BigInt`
wrapper. The value is correct; the check is impossible. And the line above each one —
`expect(confirmedRow.status).toBe('confirmed')` — **passed**. The test proves the
feature works and then fails on the next line for a reason unrelated to the feature.

**One is an option the model uses correctly twice and forgets once.**

The sweep only picks up rows older than `ANCHOR_STUCK_AFTER_MS`, which is right: you
do not sweep a record another process may still be working. Two tests know this and
pass `stuckAfterMs: 0`. The crash-recovery test builds its second app without it, so
the row is milliseconds old, `findStuck` returns nothing, and the sweep correctly does
nothing. The test at line 282 — which *does* set it — reaches
`expect(row.status).toBe('confirmed')` and passes. **The recovery routine works, and
one of its own tests is configured so it cannot observe that.**

**One is 201 against 200**, the model's controller against the model's assertion.

## This is the same finding as 02 and 04, now three problems deep

Problem 02 hosted established that intra-run artifact disagreement survives a single
request. Problem 04 showed it one word wide — `several` against `Several`. Here it is
four times in one file, and each time the disagreement is between a test and the
code sitting beside it in the same reply.

**The model writes better production code than it writes assertions about that code.**
Its `tests` grade is dragged down by its own tooling, not by its design.

## Against the local run of the same problem

| | local, phased | hosted, single |
|---|---|---|
| must-haves | 6 of 6 | 6 of 6 |
| graded design | 3/3/3 state, recovery, verification | 3/3/3 |
| typecheck | **FAILED** — 17 errors after 13 repairs | **attempt 0, no repairs** |
| what failed it | all 17 were a missing `.js` on a relative import | — |
| wall clock | 2 h 54 min | 13.6 min |
| verdict | FAIL | PASS_WITH_NOTES |

This is the cleanest natural experiment the campaign has produced. The same model
solved the same problem to the same design standard in both conditions. Locally it
failed on seventeen missing file extensions spread across eighteen files written in
eighteen separate requests. Asked for all fifteen files in one reply, where it can see
its own import statements as it writes them, it made the mistake **zero** times.

`reference_gap` is not a property of this model. It is a property of asking this model
for one file at a time.

> **Corrected after judging problem 09.** That last sentence is too strong. Problem 09
> hosted lost the same convention on sixteen imports inside a single reply. Across the
> thirteen hosted runs that chose NodeNext: six — this one among them — held the
> convention across 145 relative imports with zero misses; one chose the wrong
> convention and applied it uniformly; four lost it partway through the reply. The
> single request does not remove the defect. It changes its rate. Locally this problem
> lost the extension on seventeen of eighteen files, uniformly, because no request
> could see the one before it. **The decomposition converted an occasional drift into a
> certainty; the drift itself is the model's.**
