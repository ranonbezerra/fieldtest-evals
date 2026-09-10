# Verdict — 02 Reconciliation + safe resend (qwen3.8-27b, hosted, **ladder**)

```yaml
verdict:      VOID
condition:    {runner: api, spec: ladder, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b}

gate:         [M1 –, M2 –, M3 –, M4 –, M5 –, M6 –]
graded:       not assessed

typecheck:    1 error — against a deliverable that is 12 scaffolding files
tests:        none written

failure_mode: harness_artifact
              # The reply was cut off by the provider, twice, and what reached disk
              # is the opening of an answer rather than an answer.

cost:         {output_tokens: 32768 + 37171, requests: 6, usd: 0.0821}

would_merge:  n/a — this run is not evidence about the model
headline:     Void. Both attempts were truncated upstream; the run measures a
              backend's output ceiling, not the model.
```

## Why this is void rather than a failure

    attempt 1   32,768 tokens   finish: length   reasoning 100%, content 0
    retry       37,171 tokens   finish: error    reasoning  95%, content 6,628 chars

Twelve files landed — `app.module.ts`, `main.ts`, the prisma module, the configs, the
schema and its migration. No service, no controller, no repository, no test. The one
remaining typecheck error is `src/bank/bank.module.ts` importing `./bank.service.js`,
a file the reply never reached.

That is the shape of a truncated answer, not of a model that stopped early.

## The ceiling was not the model's

The same model, on the same axis, returned **99,903** tokens on problem 01 and
**103,242** on problem 03 of the `model` axis. It is not constrained to 32,768.

Across this campaign the truncations land on **32,768** and **65,536** — powers of two,
which is a backend's `max_completion_tokens` rather than a model property. OpenRouter
routes one model across several upstream providers and they do not share a ceiling.

The `model` axis run of this same problem shows the difference plainly: its first
attempt also died at exactly 32,768 with pure reasoning, and its **retry ran to 76,725
and completed**, producing the six-of-six delivery that verdict judged. Same model,
same day, same problem — a different backend on the retry.

`ft-run` now records `upstream_provider` for every hosted request, so this is
distinguishable going forward. It was not recorded when this run was made.

## What happens to it

Re-run at the end of the campaign and judge that. Until then this directory holds a
truncation, and a verdict drawn from it would be a verdict about routing.
