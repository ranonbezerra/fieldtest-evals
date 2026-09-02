# `reasoning_effort`: why the campaign runs at `medium`

The evidence behind [`FINDINGS.md`](../../FINDINGS.md) §6.2 and §0, kept after the runs
it came from were discarded.

## The question

At the model's own default, phase 0 overflowed the server's 16,384-token output ceiling
in **3 of 3 runs**. It returned deliberation and no plan. The harness retried at `low`,
as designed, and that retry became the specification every file phase implemented.

So the campaign was not measuring the model as shipped. It was measuring the model
working from a plan the harness had degraded in order to make it fit. The question was
whether `medium` produces a complete answer inside the same ceiling.

## The method

`harness/ft-effort` replays the phases that overflowed, at a different effort, with
every other axis held: same instruction, same reads, same system message, same
temperature, same ceiling. Nothing is written into a run's workspace.

    ft-effort <run-dir> --effort medium

Reads are filtered to the dependencies that came *earlier* in the manifest, because
those are the only ones that existed when the phase originally ran.

## The result

| phase | at the default | at `medium` | of ceiling |
|---|--:|--:|--:|
| 01 `00-plan` | 16,384 — ceiling | **5,380** | 33% |
| 01 `payout.repository.ts` | 16,384 — ceiling | **10,694** | 65% |
| 01 `payout-worker.service.ts` | 16,384 — ceiling | **6,210** | 38% |
| 01 `payout.controller.ts` | 16,384 — ceiling | **4,362** | 27% |
| 01 `payout.spec.ts-cases` | 16,384 — ceiling | **3,737** | 23% |
| 03 `00-plan` | 16,384 — ceiling | **5,706** | 35% |

Six of six fit. Four further phases of problem 03 were refused when `fileproviderd`
took 130–143% CPU and the harness declined to measure throughput against a loaded host.

**The `medium` plan is shorter than the `low` one** — 5,380 tokens against 7,140 for
problem 01. More deliberation bought a tighter document, not a longer one, which is the
opposite of what was predicted here before it was measured.

## What changed in the content

The two must-haves problem 01 failed were contradictions inside its `low` plan: the
invariant stated in one section, the procedure that breaks it written in another. At
`medium`, both are consistent.

| | `low` (as used) | `medium` |
|---|---|---|
| M4 consumer dedup | §3: *"`WHERE status = 'pending'` so two workers cannot claim"*<br>§4: `UPDATE … WHERE id=? AND status IN ('pending','processing')` | §3: `claimMessages(limit) // FOR UPDATE SKIP LOCKED, PENDING only`<br>§4: *"selects up to 10 PENDING messages with FOR UPDATE SKIP LOCKED"* |
| M7 no revert in uncertainty | §1: *"a human inspects before releasing or confirming"*<br>§4: *"in one transaction → `releaseHold`, `updatePayoutStatus(→ needs_review)`"* | §1: *"keep funds reserved … releasing would risk double-spend"*<br>§4: *"(funds stay reserved)"*<br>§5 test: *"funds remain reserved (not released back)"* |

Problem 03's M1 improves in the half that decides: the hook interface takes
`tx: Prisma.TransactionClient`, which the `low` plan's signature could not carry. The
doc comment above it still reads *"AFTER their transaction commits (same tx in
practice)"*, which is the same muddle.

## What this does not establish

One sample per phase, at temperature 1.0. A second `low` plan might not contradict
itself; a second `medium` plan might. What is not a sampling question is the ceiling:
3 of 3 plan phases overflowed at the default, and 6 of 6 fit at `medium` with a third
of the budget unused.

`xhigh` has not been measured. Neither has the writing pass of the two-pass test phase,
which still runs at `low` because it was designed when test phases overflowed at every
setting tried.

## What is in here

    <problem>/            the medium replay: reply, extracted artifact, usage record
    <problem>-baseline/   the same phases as they ran in the discarded campaign —
                          00-plan (default, cut off), 00-plan-retry (low), and the
                          PLAN.md that was actually used
