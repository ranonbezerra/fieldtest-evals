# Verdict — 01 Payout with outbox + hold (hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✗, M4 ✓, M5 ✓, M6 ✓, M7 ✓, M8 ✓]

graded:       {state_machine: 3, tx_boundaries: 1, errors: 2, tests: 3,
               quality: 2, process: n/a}

typecheck:    passed, 0 repairs — under the tsconfig the model wrote itself
tests:        3 of 8 pass, run against a live Postgres after the fact

failure_mode: wrong_answer
              # The outbox message is created in a second transaction, after the one
              # that reserves the funds and creates the payout has committed. A crash
              # between them leaves money reserved against a payout no worker will
              # ever see — the exact failure the outbox pattern exists to prevent.

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: 30.4, output_tokens: 98581, tokens_per_second: 55.1,
               requests: 1, usd: 0.2963, output_ceiling_hits: []}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     Seven of eight must-haves, the strongest reservation in the campaign,
              and the outbox message lands in its own transaction.

notes: |
  One request, thirty minutes, 98,581 output tokens, thirty cents. It wrote its own
  package.json, tsconfig.json and vitest config, seventeen files in all, and needed no
  second ask.
  M2 is the best answer any run has given. `UPDATE accounts SET reserved_balance =
  reserved_balance + $1 WHERE id = $2 AND settled_balance - reserved_balance >= $1` —
  check and reserve in one statement, which is the form the rubric describes and which
  the local run approximated with a lock plus a separate update.
  M7 makes the distinction the local run got wrong. A definitive provider rejection
  releases the reservation; retry exhaustion under an unknown outcome moves the payout
  to `needs_review` and leaves the money reserved. Two paths, correctly separated.
  M4 claims work with `FOR UPDATE SKIP LOCKED`. M5 has the unique key and a distinct
  duplicate signal that rolls the reservation back. M8 is BigInt throughout, with the
  only `Number()` calls in config parsing.
  **M3 is the one it exists to test, and it fails.** `withTransaction` at line 56
  reserves and creates the payout; `withTransaction` at line 80 creates the outbox
  message and the ledger entries. Two commits. The comment above the second reads
  "Outbox + ledger: the transfer happens asynchronously via the worker" — it knew what
  the outbox is for and put it outside the transaction that makes it necessary.
  Criterion 2 scores 1 for the same reason: the boundaries are drawn deliberately and
  in the wrong place.
```

## What only a database found

Five of its eight tests fail, all on one line of raw SQL:

    ERROR: function make_interval(msecs => bigint) does not exist

`make_interval` is real and takes `years, months, weeks, days, hours, mins, secs` —
verified against the running server's catalogue and against the PostgreSQL 18
documentation. **No version has `msecs`.** The smallest unit is `secs`, `double
precision`, which already carries fractions.

The shape of the error is familiar: a real function, a real calling convention, an
invented parameter name. Locally the same shape produced `productIngredients` against
a schema saying `ingredients`, and `reDeriveWindow` on a repository that does not
declare it. Here it is not between two of its own files but between its code and
PostgreSQL.

Raw SQL is a string, so the typecheck cannot see it. Nothing short of a live server
does. That is `SECOND-PASS.md` §8 again, now with a second run behind it.

## The gate passed, and that is not comparable to the local runs

`gate: {passed: true, repairs: 0}` reads as a clean build. Locally this problem failed
its typecheck after nine repairs.

The two numbers are not measuring the same thing. In this shape the model wrote its own
`tsconfig.json` and chose `moduleResolution: "Bundler"`. Its 28 relative imports carry
no `.js` extension — and under the harness's `NodeNext` the identical workspace
produces **49 errors**.

It did not weaken the check; `strict` stayed `true`. It chose a resolver in which its
own convention is correct, which is what a developer starting a project does. But the
gate and the configuration now belong to the same party, and a clean typecheck here
says less than a clean typecheck there. Recorded as §3.8; the comparison holds on
must-haves, tests and domain reasoning, and not on this axis.

## Against the local run of the same problem

| | local, phased, 6-bit | hosted, single |
|---|---|---|
| requests | 25 | **1** |
| wall | 3.1 h | **30 min** |
| cost | 43 h of a laptop | **$0.30** |
| must-haves | 8 of 8 in source | 7 of 8 |
| M3 outbox in one transaction | ✓ | **✗** |
| M7 no revert in uncertainty | ✗ | **✓** |
| typecheck | failed, 9 repairs | passed, 0 — different config |
| its own tests | 4 of 10 fail | 5 of 8 fail |

Neither is the better run outright. The local one gets the outbox boundary right and
the uncertainty rule wrong; the hosted one is the reverse. What is not close is the
cost of finding that out.
