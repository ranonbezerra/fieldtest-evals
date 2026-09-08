# Verdict — 01 Payout with outbox + hold (Laguna S 2.1, hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: poolside/laguna-s-2.1,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 –, M2 –, M3 –, M4 –, M5 –, M6 –, M7 –, M8 –]

graded:       {state_machine: 0, tx_boundaries: 0, errors: 0, tests: 0,
               quality: 0, process: 0}

typecheck:    not reached — `pnpm install` exits 1
tests:        not reached

failure_mode: host_pressure
              # Its own budget, not the machine's. Reasoning took 381,057 of the
              # 490,804 characters generated — 78% — and the reply was cut off at
              # `finish_reason: error`, 126,727 tokens against a 131,072 limit, ending
              # mid-signature at `async findById(tx: TxClient, id: `.

revisions:    {self_repairs: 0, dropped_a_requirement: n/a}
cost:         {wall_minutes: 20.0, output_tokens: 126727, requests: 1}
host:         {n/a — the model is not on this machine}

would_merge:  there is nothing to merge
headline:     It spent 78% of its output budget thinking and ran out of room to
              answer, twenty minutes in, mid-signature.
```

## Where the budget went

    reasoning   381,057 chars   78%
    reply       109,747 chars   22%
    ------------------------------
    total       126,727 tokens  →  finish_reason: error at a 131,072 limit

The reply itself is 2,929 lines carrying 23 `### path` headings for thirteen distinct
paths — the model writes a file's heading, opens a block, closes it, reconsiders, and
starts the same file again. 126 lines of the reply begin with `Wait`, `Actually` or
`Let me`, so some deliberation reaches the output, but the great majority of it is
where it belongs: in the provider's separate `reasoning` field, which is 381 KB.

The question it could not settle, asked and re-asked across both sections:

    Wait, `TransientProviderError` is exported as a class, not as `Trans…`
    Wait, but `Prisma.TransactionClient` extends `PrismaClient`… or does it?
    Actually, since `Prisma.TransactionClient` is a subset of `PrismaCl…`
    Wait, actually, that's not how TypeScript works. TypeScript checks …
    Actually, in Prisma, `TransactionClient` explicitly excludes `$tran…`

The last heading for `payout.service.ts` is at line 9,834 of 12,101 and is followed by
another nine-line fragment. The reply ends `async findById(tx: TxClient, id: `.

## What landed

Thirteen paths were extracted, four of them fragments — `app.module.ts` at 8 lines,
`payout.service.ts` at 9, `prisma.module.ts` at 9, `test/setup.ts` at 7. `pnpm install`
then exits 1 on a dependency that does not exist:

    ERR_PNPM_NO_MATCHING_VERSION  No matching version found for @types/reflect-metadata@^0.2.0

`reflect-metadata` ships its own types. Nothing typechecked and no test ran, so every
must-have is unassessed rather than failed — recorded as `–` rather than `✗`, because a
gate that never ran has no opinion.

## This is the model's allocation, not a limit imposed on it

The hosted conditions run uncapped by design: `FT_MAX_TOKENS` is unset and no
`reasoning` parameter is sent, so the model works at its own default effort with the
provider's full 131,072 output tokens. It chose to spend 78% of them thinking.

That choice is the result. Capping it with `reasoning: {effort: "low"}` would produce a
different number, and it would be the harness's number rather than the model's — the
same reason the 16,384-token ceiling belongs to the local condition and nowhere else.

For scale: gpt-oss-120b answered problem 08 in 2,776 output tokens and problem 01 in
about nine thousand across 21 requests. Laguna spent 126,727 on one attempt at problem
01 and did not finish it.

## A parser change this run triggered, and its correction

The 1,827-line `payout.service.ts` on disk after the run sent me looking for a parser
bug, and there was one adjacent to it — but not this. `extract_files` had been changed
(FINDINGS §4.15) to end a block at the **last** close of its width, which is right for
a markdown deliverable containing ```` ``` ```` blocks and wrong here, where it
swallowed the deliberation between two code blocks.

Trying "largest block" next was worse: it landed a `prisma` schema inside
`payout.service.ts`. The rule is now the literal contract — **markdown ends at the last
close, source ends at the first** — because a reply that deliberates between blocks has
no deliverable to recover, and choosing among its fragments invents one.

That is the honest reading of this run: the artifact is missing because the model never
wrote it, not because the harness failed to read it.
