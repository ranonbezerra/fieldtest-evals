# Verdict — 09 Feature inside conventions (qwen3.8-27b, **ladder**, rep 1)

```yaml
verdict:      PASS
condition:    {runner: api, spec: ladder, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b, providers pinned}

plan_gate:    n/a — the level-2 specification replaced the plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {convention_fidelity: 3, domain_modeling: 3, ambiguity: n/a,
               test_quality: 3, quality: 3, process: n/a}

typecheck:    clean at attempt 0 — no repair
tests:        **19 of 19 pass**

failure_mode: none

revisions:    {self_repairs: 0, dropped_a_requirement: no}
would_merge:  yes
headline:     Nineteen green tests including the one that distinguishes "not yours"
              from "not there" — the leak the issue was written to close.
```

## The test that matters

    ✓ answers a non-member with the same not-found as a missing trip

The issue said a non-member "gets the same response a nonexistent trip gets", and
explained why 403 is the wrong answer: it tells the caller the resource exists. The
model wrote the assertion that proves the two paths are indistinguishable.

The rest cover the feature as specified: the creator becoming an owner member, a trip
read back with its members and only its **pending** invites, the owner inviting by
email and receiving a pending invite with a token. The scaffold's own `users` tests
still pass unmodified, which is M-scope holding.

## Against the same problem in earlier conditions

| | must-haves | tests | convention |
|---|---|---|---|
| qwen local, phased | 5 of 6 | — | — |
| qwen hosted, blind | 3 of 6 | 11 of 14 | `.js` on 37, missing on 16 |
| gpt-oss, fixture visible | 5 of 6 — M5 failed | 3 of 10 | 58 with `.js`, 0 without |
| **this run** | **6 of 6** | **19 of 19** | clean |

gpt-oss, given the same fixture, matched the import convention perfectly and then
invented `.isOk` on the scaffold's `ApiResult`. This run matches the convention **and**
uses the type as it is defined.
