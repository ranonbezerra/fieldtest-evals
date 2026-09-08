# Verdict — 03 Read model projection (Laguna S 2.1, hosted, default effort)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: poolside/laguna-s-2.1,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 –, M2 –, M3 –, M4 –, M5 –, M6 –]

graded:       {schema_design: 0, rebuild_story: 0, tradeoffs: 0, tests: 0,
               quality: 0, process: 0}

typecheck:    not reached
tests:        not reached

failure_mode: host_pressure
              # Its own budget. 108,795 output tokens, `finish_reason: error`, and
              # `content_chars = 0`: **100% of the generation was reasoning and the
              # reply is empty.**

revisions:    {self_repairs: 0, dropped_a_requirement: n/a}
cost:         {wall_minutes: 20.0, output_tokens: 108795, requests: 1}
host:         {n/a — the model is not on this machine}

would_merge:  there is nothing to merge
headline:     436,435 characters of reasoning in twenty minutes and not one line of
              answer.
```

## The measurement

    reasoning_chars   436,435
    content_chars           0
    completion_tokens 108,795
    finish_reason     error
    wall              20.0 min

The step file ends:

    For the concurrency, each `approveOrder` call starts a separate transaction. The database
    ```

    ## reply

    (empty)

The reasoning is cut mid-sentence by the output limit. There is no reply section
because the model never began one.

Within that reasoning: **732 lines beginning `Wait`, `Actually`, `Let me` or `Hmm`**,
and 18 `### path` headings — the model planned the file layout inside its reasoning and
ran out of budget before writing any of it.

`ft-go` did what a person would and asked again; the campaign was stopped during that
second attempt, so only the first is recorded.

## The axis this run establishes

Three problems at this model's default effort:

| | reasoning | reply | outcome |
|---|---|---|---|
| 01 payout outbox | 77.6% | 109,747 chars, truncated mid-signature | FAIL, nothing installable |
| 02 reconciliation | 80.4% | 94,256 chars, complete | **PASS_WITH_NOTES, 6 of 6, clean compile** |
| 03 read model | **100%** | **0 chars** | FAIL, no artifact |

All three hit `finish_reason: error` against the provider's 131,072-token output limit.
**The model's default reasoning effort consumes the budget it needs to answer**, and
whether a run produces anything depends on where the truncation lands.

Problem 02 is the reason this is worth separating rather than dismissing: when the
reply fits, it is the best work any model in this repository has produced on that
problem — six of six must-haves and the only clean typecheck. The capability is there
and the allocation is not.

## Why the campaign was stopped here

Continuing at default effort would have produced fifteen more runs at twenty minutes
each, an unknown fraction of them empty, and a set of verdicts about termination rather
than engineering. Three runs are enough to establish the allocation, and they are kept
as the `default effort` axis.

A second campaign runs the same eighteen problems with `reasoning: {effort: "medium"}`,
recorded under `runs/poolside-laguna-s-2.1--effort-medium/`. That is a **configured
condition**, not a correction: the other two hosted campaigns sent no reasoning
parameter, and comparing a capped Laguna against an uncapped Qwen would measure the
harness. The two axes stand side by side, and the honest summary of this one is that at
its own defaults this model does not reliably finish.
