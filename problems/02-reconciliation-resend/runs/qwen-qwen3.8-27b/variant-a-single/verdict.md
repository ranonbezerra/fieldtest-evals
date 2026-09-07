# Verdict — 02 Reconciliation and resend (hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {state_machine: 3, matching: 3, time_window: 3, tests: 3,
               quality: 1, process: n/a}

typecheck:    failed — 24 of 25 errors are unresolved relative imports
tests:        10 of 11 pass, the best suite result in the campaign

failure_mode: wrong_answer
              # In one reply it chose `moduleResolution: NodeNext`, which requires
              # the `.js` extension, and then wrote 0 of 18 relative imports with it.
              # Behind those unresolved modules, the service calls five repository
              # methods the repository does not define.

revisions:    {self_repairs: 20, dropped_a_requirement: no}
cost:         {wall_minutes: 52 generation, output_tokens: 143289, requests: 8,
               usd: 0.318, asked_again_after_empty: true}
host:         {n/a — the model is not on this machine}

would_merge:  no
headline:     Chose a compiler setting its own imports violate, in the same reply
              that wrote both.

notes: |
  The domain work is the strongest of the campaign on this problem, local or hosted.
  M1 is right where the local run was wrong. `reconcile` gates the absence branch on
  `canProveAbsence` — the publishing lag past — and then, for every stuck order, asks
  whether its txid is in the statement it just read. Present means settled, not
  resent. Absent with attempts exhausted means parked. Absent with attempts left
  stays pending for the next cycle. The local run transitioned to resend without
  consulting the statement at all.
  M2 derives the txid from `${order.id}:${effectiveDate}` through sha256, and the
  resend recomputes the same value rather than minting a new one.
  Eleven tests, ten passing — the best suite result any run has produced. The one
  failure is `re-sends a proven-absent order, reusing the same deterministic txid`,
  asserting one send and getting zero.
  `quality` scores 1 for the reason below, not for the domain design, which would
  score 3 on its own.
```

## Two artifacts of one reply, disagreeing

This shape has no phases. Everything below was written in a single response, and it
contradicts itself twice.

**The compiler settings against the imports.** The `tsconfig.json` it wrote sets
`"moduleResolution": "NodeNext"`, which requires relative imports to carry the `.js`
extension. It then wrote **0 of 18** relative imports with one. Twenty-four of the
run's twenty-five compile errors are that, and nothing else.

The hosted run of problem 01 chose `"Bundler"` and wrote extensionless imports —
internally consistent, and it compiled clean. Same model, same shape, same request an
hour apart: one picked the resolver that matches its habit, the other picked the one
that does not.

**The service against the repository.** Behind the unresolved modules:

| the service calls | the repository defines |
|---|---|
| `findPending` | `create` |
| `findSent` | `findToSend` |
| `findPendingWithAttempts` | `findInFlightAttemptedBefore` |
| `markSettled` | `findUnsettledByTxids` |
| `markManualReview` | `transition` |

Not one name matches. Both files were written in the same reply, minutes apart in the
same generation, describing two different interfaces for the same collaboration.

The compiler never says so: the imports do not resolve, so it never typechecks the
calls behind them. §3.6b, for the third time — and the failing test is the only thing
that reports it, `expected +0 to be 1`, because the suite mocks a repository shaped
like the one the service expects.

## What this settles

`FINDINGS.md` §1.5 recorded seven times a run's artifacts disagreed with each other,
and left open whether the one-file-per-request design was causing it. `SECOND-PASS.md`
names the experiment that would separate them.

**This is the experiment, and the answer is that the design was not the cause.** There
were no phases here. One request, one reply, and the same disagreement — twice, in the
two places that matter most: what the code assumes about its own configuration, and
what one half of it assumes about the other.

The decomposition may still make it *worse*. It is no longer available as the
explanation.

## Twenty repairs is not the model's number

`repairs: 20` includes eight that exited without reaching the model at all: the repair
phase was passing `PLAN.md` as a read, this shape has no plan, and `ft-run` refuses a
reference that does not resolve. That was a harness fault, fixed, and the run was
resumed rather than re-asked. The comparable figure against problem 01's zero is
roughly twelve.
