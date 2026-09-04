# Campaign plan

The record of what actually ran is [`CAMPAIGN-LOG.md`](CAMPAIGN-LOG.md), one row
per run, written by `harness/ft-campaign` as each lands.

Written before the first run, so the order is a decision rather than a habit.

## Status

**Reset.** A first campaign of five runs was discarded: it used temperature 0.6 and,
on some phases, reasoning switched off — both wrong, both from misreading the model's
`config.json` class name as its model name. See `FINDINGS.md` §0.

Nothing about the model survives from it. The figures below are no longer its — they
are measured from the first three runs at the corrected parameters.

## The arithmetic

**Measured on seven runs at `reasoning_effort: medium`.** These replace the estimates
from the discarded campaigns, which were built from phase timings taken before the gate
could fire.

| run | requests | output tokens | generation | gate |
|---|--:|--:|--:|:-:|
| 02 reconciliation resend | 14 | 58,593 | **1.7 h** | passed |
| 04 grounded llm product | 18 | 82,510 | **2.4 h** | passed |
| 05 on-chain anchoring | 25 | 100,054 | **2.9 h** | failed |
| 01 payout outbox | 25 | 110,036 | **3.1 h** | failed |
| 06 multi-tenant isolation | 51 | 163,945 | **4.8 h** | failed |
| 07 ingredient classification | 69 | 218,160 | **6.3 h** | failed |
| 03 read model projection | 54 | 269,975 | **7.7 h** | failed |
| **total** | **256** | **1,003,273** | **28.9 h** | 2 of 7 |

Throughput is flat at **9.5–9.6 tok/s in every run**, so a run's length is entirely a
function of how many tokens it takes. The spread is the repair loop, and the ordering
above is almost exactly the ordering by repair count: 5, 4, 13, 9, 26, 40, 30.

| scope | wall time |
|---|--:|
| variant A of all 18 problems | **~74 h** (range 31–139) |
| A and B | ~148 h |
| all 54 | **~223 h** |

The whole acervo does not fit in one sitting, so the order has to earn its place.

## The configuration is fixed for all eighteen, at `reasoning_effort: medium`

Every run in this pass uses the same generation parameters and **`medium`**. That
setting was measured into place, not chosen: at the model's own default, phase 0
overflowed the 16,384-token ceiling in **3 of 3 runs** and returned deliberation
instead of a plan. The harness fell back to `low`, so every run was governed by a
low-effort specification — and the must-haves those runs failed are defects in those
specifications, not in the code that implemented them. Replayed at `medium`, 6 of 6
phases fit, using a median of 36% of the ceiling. See FINDINGS §1.3 and §6.2.

**The first three runs are discarded** rather than compared against runs at `medium`.
Problems 01, 02 and 03 were judged and their verdicts written; they measured the model
working from a plan the harness had degraded to make it fit, which is a property of the
harness and not an answer to the question this repository asks. Eighteen problems
measured under two configurations are not a set, and three runs is the cheapest this
correction will ever be — at problem thirteen it would cost a hundred hours.

What those runs established about the model, the machine and the instruments is kept
in FINDINGS and stands, because a plan that contradicts itself is no less contradictory
for having been written at the wrong setting.

If a better setting is found partway through this pass — `xhigh` has not been measured —
**it does not get applied to it.** That is an argument for a second pass against a first
one that is internally consistent.

The line that decides what may change mid-campaign: **observation can be added,
intervention cannot.** Running the test suite a model wrote changes only what is known
about a run, so it was added partway and applied backwards to runs already judged
(FINDINGS §3.7). Repairing against that suite changes the artifact, so it waits.
Everything the first pass has earned and cannot use is written down in
[`SECOND-PASS.md`](SECOND-PASS.md) as it is found.

## Order

**Pass 1 — variant A of every problem, 01 through 18.**
One data point per problem before a second on any. Breadth first, because the
question the repository answers is *what class of work can this model take*, and
that needs eighteen problems at depth one, not one problem at depth three.

**Pass 2 — variant B.** Consistency. Solving A and failing B on the same problem is
the finding; a single variant cannot show it.

**Pass 3 — variant C.** From problem 09 on these are deliberately underspecified, and
what is judged is assumption-surfacing rather than design. A different capability,
worth isolating.

**Pass 4 — the ladder,** on whatever failed. `--spec ladder` replaces the model's own
plan with the reference's level-2 spec. It separates *cannot design this* from *cannot
implement this*, which is the most actionable cell in the results table, and it is only
worth spending on a problem that actually failed.

## What each run produces, in the problem's own directory

```
problems/NN-slug/runs/<model>/variant-a/
  PLAN.md        the model's own specification, written before any code
  workspace/     the code exactly as it left it — committed, browsable in the repo
  steps/         every request: its reasoning, its reply, its counters
  transcript.md  all of it, nothing elided
  GATE.md        typecheck output for every attempt, revisions included
  meta.yaml      wall time, tokens, tok/s, revisions, failures, host pressure
```

The workspace is committed. Reading what the model actually wrote is the point, and a
verdict nobody can check against the code is an opinion.

## What runs unattended, and what does not

`harness/ft-campaign` waits out host pressure rather than aborting, restarts the server
when it dies or hangs, flushes between runs, and commits each run as it lands — a
campaign that writes at the end loses everything when it is interrupted.

It does **not** judge. Judging is blind, needs `harness/ft-anon` and a frontier model,
and happens after. It does not run the deliverables' tests either: those are the
operator's step, and a model that runs its own acceptance criteria verifies nothing.

## Known per-problem wrinkles

| Problem | Wrinkle |
|---|---|
| 08 infra-debug | Deliverable is a diagnosis, corrected config and a runbook — verify by following the runbook, not by running tests |
| 13 characterization tests | The deliverable **is** the test suite; run it against the untouched fixture |
| 14 code review | Deliverable is `REVIEW.md`; score against the answer key, and count findings that are not in it |
| 16 migration | Needs Docker **to verify**, never to generate. Start it after the run, stop it after |
| 09–16 | Seeded from a scaffold or fixture; `workspace.json` says which per variant |

## What this campaign cannot tell you

It measures one runner (`api`) and one spec source (the model's own plan). The `aider`
and `chat` conditions, and the ladder, are separate passes against the same problems —
see [`harness/conditions.md`](harness/conditions.md).

And it cannot measure **what the model chooses to read**. The harness hands it exactly
the files its own plan declared, deliberately, because letting it hunt is what inflates
context until the problem statement is trimmed away.

That gap is designed out in [`docs/reading-phase.md`](docs/reading-phase.md): give it
the file tree with no contents, let it request what it needs, give it exactly that.
One request in, one list out — no loop, nothing to trim — and it measures recall,
precision, ordering and calibration against a reference that already names the files a
correct solution must have read. Not built yet.
