# Verdict — 01 Payout with outbox + hold (qwen3.8-27b, **ladder**, provider pinned)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: ladder, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               upstream_provider: Parasail (pinned), repair reads the schema}

plan_gate:    n/a — the level-2 specification replaced the plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓, M7 ✓, M8 ✓]

graded:       {state_machine: 3, tx_boundaries: 3, errors: 2, tests: 2,
               quality: 1, process: n/a}

typecheck:    failed after 19 repairs — 21 errors, **all of them TS2307**: the `.js`
              extension missing from relative imports under NodeNext
tests:        **6 of 6 fail — and they run.** The suite compiled.

failure_mode: reference_gap
              # Moved, not removed. The enum drift is gone; the method drift is not.
              # `payout.repository.ts` defines twelve methods.
              # `payout.service.ts` calls two: `createPayoutWithReservation` and
              # `findPayoutByAccountAndIdempotencyKey`. Neither exists. The nearest
              # is `createPayout`.

revisions:    {self_repairs: 19, dropped_a_requirement: no}
cost:         {output_tokens: 38854 + 85695, requests: 21, usd: 0.4084}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     Giving the repair the schema removed the entire class of error it could
              not solve, and the drift reappeared where the schema cannot reach.
```

## The two changes, isolated

This run differs from the same problem on `--ladder-unpinned` in exactly two ways: the
provider is pinned to `fp8` endpoints, and the repair loop now reads
`prisma/schema.prisma`. The effect is measurable and specific.

| | `model` | `ladder-unpinned` | **`ladder` (pinned + schema)** |
|---|---|---|---|
| must-haves met | 7 of 8 | 8 of 8 | **8 of 8** |
| errors | 28 | 30 | **21** |
| enum-literal errors | present | **present** | **zero** |
| what remains | schema + extension | schema + extension | **extension only** |
| tests | did not run | 5 skipped | **6 ran, 6 failed** |

**The enum drift is gone.** `Type '"created"' is not assignable to type 'PayoutStatus'`
does not appear once. Nineteen repairs had the schema in hand and used it, where
eighteen without it did not converge.

**And the suite executes**, which is the first time in this axis. That is a difference
in kind: there is now evidence about behaviour rather than about compilation.

## What the schema could not reach

`payout.repository.ts` defines twelve methods:

    createPayout   getDueMessages   markMessageProcessing   markMessageProcessed
    incrementMessageAttempts   updatePayoutStatus   settlePayout
    releaseReservation   markNeedsReview   findPayoutById   createAccount   getAccount

`payout.service.ts`, from the same reply, calls two:

    repository.createPayoutWithReservation
    repository.findPayoutByAccountAndIdempotencyKey

Neither exists. This compiles — the service types its repository loosely enough — and
fails at runtime, which is what the tests now report:

    × returns the existing payout on duplicate idempotency key
      → this.repository.findPayoutByAccountAndIdempotencyKey is not a function

A schema declares models and enums. It says nothing about what methods a repository
has, so handing it over could not have prevented this, and did not.

The other two failures are a real defect the tests found because they ran:
`Do not know how to serialize a BigInt` — M8's integer money meeting `JSON.stringify`
in the audit path.

## And nineteen repairs did not fix a missing file extension

All 21 remaining errors are `TS2307` on relative imports without `.js`. The repair
receives the failing file and the compiler's exact message, and for this error it needs
nothing else — TypeScript even names the fix in the sibling diagnostic TS2835.

Nineteen rounds did not converge, and the reason is structural: **the repair fixes one
file at a time and the convention is global.** Each round corrects the imports in the
file it was handed, and the next file arrives with the same mistake, unchanged, because
nothing told that file's author what the first one learned.

That sharpens the conclusion this axis was built to test. It is not "the model needs a
loop". It is:

**the model needs a loop that sees the set.** A per-file repair with a per-file error
slice cannot fix a convention, and a convention is what is left once the design is
supplied and the definitions are readable.

## Design, once more, is not the problem

Eight of eight, including M3 — the outbox row written inside the transaction that
reserves, the must-have this model missed when it designed the problem itself. Three
`$transaction` blocks, `settledBalance` as `bigint`, a bounded retry parking in
needs-review.

Three conditions on this problem now, and the design has been correct in the two that
supplied it. What fails is always the same thing, and it has now been narrowed twice:
first to interface drift, and now to the part of interface drift that a per-file view
cannot see.
