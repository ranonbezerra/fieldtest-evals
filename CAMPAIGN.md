# Campaign plan

The record of what actually ran is [`CAMPAIGN-LOG.md`](CAMPAIGN-LOG.md), one row
per run, written by `harness/ft-campaign` as each lands.

Written before the first run, so the order is a decision rather than a habit.

## Status

**Reset.** A first campaign of five runs was discarded: it used temperature 0.6 and,
on some phases, reasoning switched off — both wrong, both from misreading the model's
`config.json` class name as its model name. See `FINDINGS.md` §0.

Nothing about the model survives from it. The figures below are from those runs and
are kept only as an order of magnitude for planning; they will be replaced by the
first runs at the correct parameters.

## The arithmetic

**From the discarded campaign.** These are the only figures available and they were
taken at the wrong temperature, so they are an order of magnitude for planning and
nothing more. They will be replaced by the first runs at the correct parameters.

| | measured, at parameters since corrected |
|---|--:|
| plan phase, reasoning off, problem 01 | 4,327 tokens · **7 min** |
| a file phase | 2,361–7,068 tokens · **4–11 min** |
| files problem 01's own plan declared | **14** |
| **one run** | **1.1 – 2.7 h** |

| scope | wall time |
|---|--:|
| variant A of all 18 problems | **19 – 48 h** |
| A and B | 38 – 97 h |
| all 54 | **57 – 145 h** |

The whole acervo does not fit in one sitting, so the order has to earn its place.

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
