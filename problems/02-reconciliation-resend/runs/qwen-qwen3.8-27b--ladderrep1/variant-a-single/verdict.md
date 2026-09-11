# Verdict — 02 Reconciliation + safe resend (qwen3.8-27b, **ladder**, rep 1)

```yaml
verdict:      PASS
condition:    {runner: api, spec: ladder, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b, providers pinned}

plan_gate:    n/a — the level-2 specification replaced the plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {state_machine: 3, matching: 3, time_window: 3, tests: 3,
               quality: 3, process: n/a}

typecheck:    1 error at attempt 0, **clean after one set repair**
tests:        **11 of 11 pass**

failure_mode: none

revisions:    {self_repairs: 1, dropped_a_requirement: no}
would_merge:  yes
headline:     The eleven tests are the issue's acceptance criteria written as
              assertions, and they pass.
```

## The tests are the acceptance criteria

The issue closed with six acceptance lines. The suite:

    settles the order and never re-sends it
    re-sends with the same txid and the same amount
    does not re-send while the publishing lag has not elapsed
    is idempotent when run repeatedly over the same window
    parks the order for review once attempts are exhausted, and never reverts
    makes the fifth attempt the last, then parks when it too is proven absent
    routes each outcome to its own state, deriving the txid for every order
    is deterministic per order and effective date, and changes with either
    classifies raw bank responses into the four outcomes
    treats an order as past the lag exactly when the lag has elapsed since …
    maps the scheduled window onto yesterday and today (UTC)

Every acceptance criterion has a test, and five more cover boundaries the issue implied
rather than stated — the exact lag edge, the fifth attempt, the UTC window mapping.

## And the code behind them

**M1** — `payout.service.ts:174`: `// Proven absent: the only situation in which a
re-send is permitted`. The resend path begins at reconciliation and nowhere else.

**M5** — `export type SendOutcome = 'accepted' | 'duplicate' | …`, four buckets, with
`Maps a raw bank response to the four outcomes` above the mapper.

**M3** — `export const MAX_ATTEMPTS = 5` under `Hard cap on bank sends per order; after
it the order …`, and `if (order.attemptCount >= MAX_ATTEMPTS)` parking rather than
reverting, which is **M4**.

## Against the same problem in every earlier condition

| | must-haves | tests |
|---|---|---|
| qwen local, phased | 5 of 6 | — |
| qwen hosted, no issue | 6 of 6 | 10 of 11, typecheck failed on 24 missing `.js` |
| gpt-oss, no issue | **0 of 6** | 2 that assert nothing, over `// Placeholder for resend eligibility logic` |
| Laguna, no issue | 6 of 6 | none written, and `package.json` named a package that does not exist |
| **this run** | **6 of 6** | **11 of 11, clean compile** |

The first run of this problem, in any condition, that compiles and proves what it
claims.
