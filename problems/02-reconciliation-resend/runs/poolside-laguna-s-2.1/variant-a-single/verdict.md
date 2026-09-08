# Verdict — 02 Reconciliation + safe resend (Laguna S 2.1, hosted, single request)

```yaml
verdict:      PASS_WITH_NOTES
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: poolside/laguna-s-2.1,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {state_machine: 3, matching: 3, time_window: 3, tests: 0,
               quality: 2, process: n/a}

typecheck:    **0 errors** — with one nonexistent dependency removed. As run, the gate
              never reached `tsc`: `pnpm install` exits 1.
tests:        none written

failure_mode: none
              # The deliverable is correct and does not install. `package.json`
              # declares `"nest": "^10.2.4"`; the package is `@nestjs/cli`.

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: 20.0, output_tokens: 129215, requests: 1}
host:         {n/a — the model is not on this machine}

verification: run by the judge. Workspace copied, `"nest"` removed from package.json,
              `pnpm install` → 0, `prisma generate` → 0, `tsc --noEmit` → **0 errors**.

would_merge:  after one line of package.json and a test suite
headline:     Six of six must-haves and a clean compile, behind a manifest that names
              a package which does not exist.
```

## The design is right, and right where it is hardest

**M5** is four explicit buckets, not a boolean:

    switch (result.status) {
      case 'accepted':
      case 'duplicate':
      case 'transient_error':
        // Send failed or timed out — we cannot know if the bank received it.
      case 'permanent_rejection':

That comment is **M4** stated in the place it has to be true. Nothing on the transient
path releases or refunds; the order moves to `AWAITING_RECONCILE` and waits for
evidence.

**M1** — the must-have most implementations get wrong — holds structurally. The only
call to `markForResend` in the codebase is inside `reconcile()`, reached through
`findAwaitingReconcileEligible(window, cutoff)`, under the comment *"Proven absent past
the publishing lag."* There is no resend path that does not begin with reconciliation.

**M3** is bounded and terminal:

    if (order.attemptCount >= this.maxAttempts) {
      await this.payoutRepository.markFailed(order.id, now);
    } else {
      await this.payoutRepository.markForResend(order.id);
    }

**M6** is rerunnable by construction — an order whose txid is already in the statement
is skipped before the decision, so a second pass over the same window changes nothing.

**M2** derives the external id with `createHash('sha256')` over the order id and
effective date, documented as *"Same order + same effective date always yields the same
txid."*

Six states, `attemptCount`, and `@@index([status])` on the schema.

## And it does not install

    ERR_PNPM_NO_MATCHING_VERSION  No matching version found for nest@^10.2.4

The NestJS CLI is `@nestjs/cli`. `nest` is the binary it installs, not a package. The
gate stops there, so as executed this run produced no typecheck and no test result at
all — the same shape as problem 01, where `@types/reflect-metadata@^0.2.0` does not
exist either. **Two runs, two invented dependencies, both in the first ten lines of a
`package.json`.**

Removing that one line: `pnpm install` succeeds, `prisma generate` succeeds, and
`tsc --noEmit` reports **zero errors** across seventeen files. That is the only clean
compile any model has produced on this problem.

No tests were written. `tests: 0`.

## Against the other two models on the same problem

| | Qwen3.8-27B | gpt-oss-120b | Laguna S 2.1 |
|---|---|---|---|
| must-haves | **6 of 6** | 0 of 6 | **6 of 6** |
| the deliverable | complete | placeholders where the logic goes | complete |
| typecheck | 25 errors, 24 of them a missing `.js` | 3 errors | **0** |
| tests | 10 of 11 real tests passing | 2 that assert nothing | none |
| installs | yes | yes | **no** |
| verdict | FAIL | FAIL | **PASS_WITH_NOTES** |

Three models, three different single points of failure on a problem all three
understood. Qwen wrote the whole thing and could not resolve its own imports. gpt-oss
wrote the scaffolding and left `// Placeholder for resend eligibility logic` where the
answer goes. Laguna wrote it correctly and named a package that does not exist.

## The cost of getting there

129,215 output tokens, `finish_reason: error`, twenty minutes — and **80% of that was
reasoning**, 386,826 characters of it against 94,256 characters of reply. The answer
survived the truncation because the reply happened to finish; problem 01's did not.

A correct answer that takes twenty minutes and arrives at the edge of the model's
output limit is a different proposition from the same answer in two thousand tokens.
That is a property of this model at its default effort, and it belongs in the record
next to the six must-haves.
