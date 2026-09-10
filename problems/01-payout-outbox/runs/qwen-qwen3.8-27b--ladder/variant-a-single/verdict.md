# Verdict — 01 Payout with outbox + hold (qwen3.8-27b, hosted, **ladder**)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: **ladder**, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — the level-2 specification replaced the plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓, M7 ✓, M8 ✓]

graded:       {state_machine: 3, tx_boundaries: 3, errors: 2, tests: 1,
               quality: 1, process: n/a}

typecheck:    failed after 18 repairs — 25 errors, **22 of them in one file, all of
              it the repository disagreeing with the schema the same reply wrote**
tests:        5 skipped — the suite does not compile

failure_mode: reference_gap
              # The schema declares `enum PayoutStatus { CREATED PROCESSING SENT
              # COMPLETED FAILED NEEDS_REVIEW }`. The repository writes
              # `status: 'created'`, `'pending'`, `'processing'`, `'done'` — lower
              # case, and two of those are not values of the enum at all. It also
              # reads `retryCount`, `maxRetries` and `nextAttemptAt`, three fields
              # its own schema does not declare.

revisions:    {self_repairs: 18, dropped_a_requirement: no}
cost:         {wall_minutes: 31.9 generation, output_tokens: 99903, requests: 19,
               usd: 0.4409}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     Eight of eight must-haves — including the one it got wrong when it
              designed this itself — and it still cannot compile against its own
              schema.
```

## The specification fixed the design, exactly

**M3 is the one that matters here.** On the `model` axis, where this model wrote its
own plan, M3 was the single must-have it missed on this problem: it wrote the outbox
hooks and put them outside the transaction that reserves. The issue's §3 says the
message row goes in the same transaction, and says why — "if the process dies between
the two, we get a reserved payout nobody will ever execute". What came back:

    /**
     * Reserve the funds, write the payout, and queue the outbox message in ONE
     */
    return this.prisma.$transaction(async (tx) => {
      …
      // message, no message without its reserve.
      await tx.outboxMessage.create({

**M2** is a real compare-and-swap, and `DESIGN.md` explains it in the terms the issue
asked for: "the balance check and reservation are one conditional UPDATE
(`WHERE settled - reserved >= amount`) whose affected row count…". The issue described
the shape without naming the operation; the model wrote it.

M1 `settled` and `reserved` as separate `BigInt` columns. M4 `claimMessage` flips
status under a guard and returns whether it won. M5 idempotency on the client's key.
M6 "Provider confirmed — settle the ledger entry". M7 parks in needs-review, with the
comment "before deciding to release or confirm". M8 `BigInt` throughout.

**Eight of eight.** This model has not scored eight of eight on this problem in any
other condition.

## And the specification did nothing for the other half

    src/payout/payout.repository.ts(154,11)
      Type '"created"' is not assignable to type 'PayoutStatus'
    src/payout/payout.repository.ts(188,28)
      Property 'retryCount' does not exist on type '{ … }'

Its own `schema.prisma`:

    enum PayoutStatus { CREATED PROCESSING SENT COMPLETED FAILED NEEDS_REVIEW }

Its own repository, in the same reply:

    status: 'created'   status: 'pending'   status: 'processing'   status: 'done'

Lower case where the enum is upper, and `'pending'` and `'done'` are not values of it
in any case. Plus `retryCount`, `maxRetries` and `nextAttemptAt` — three fields read
from a model that does not declare them.

**22 of the 25 remaining errors are in that one file, and every one is the repository
against the schema it shipped with.** Eighteen repair rounds did not converge, because
each repair sees one error's worth of context and the disagreement is systemic.

## What this run establishes

This is the first result on the axis the repository was built to measure and had never
run, and on one problem it separates the two halves cleanly:

| | `model` axis | `ladder` axis |
|---|---|---|
| M3 — outbox in the transaction | **✗** | **✓** |
| must-haves met | 7 of 8 | **8 of 8** |
| errors remaining | 28 | 25 |
| what the errors are | interface drift | interface drift |
| repairs | 20 | 18 |

**Handing over the design fixed the design.** The must-have it could not decide, it
implemented when told.

**Handing over the design did nothing for the drift.** An issue cannot stop a model
from writing an enum and then writing against a different one thirty lines later,
because the issue is not where either of them is.

The obvious next question is whether a feedback loop closes it. Every one of these 25
errors is what `tsc` prints on the first run — `Type '"created"' is not assignable` is
not a subtle failure, it is a mechanical one, and a model that could read it would fix
it. This run had eighteen repair attempts and each was handed a slice; none was handed
the file and the schema together.

## Cost

$0.4409 and 19 requests for one problem, against $3.46 for the entire 18-problem
`model` campaign. The generation alone was 99,903 output tokens in 31.9 minutes; the
prompt grew from 1,385 to 2,700 tokens with the specification in it. At this rate the
axis costs roughly $8 for eighteen — inside the ceiling, and worth recording next to
the result.
