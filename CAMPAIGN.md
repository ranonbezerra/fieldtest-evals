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

**Measured, at the correct parameters, on the first three runs.** These replace the
discarded campaign's estimates, which were roughly a third of the truth.

| run | requests | output tokens | generation |
|---|--:|--:|--:|
| 01 payout outbox | 15 | 146,619 | **4.2 h** |
| 02 reconciliation resend | 23 | 200,810 | **5.7 h** |
| 03 read model projection | 37 | 272,380 | **7.6 h** |

Throughput is flat across all three — 9.8, 9.9, 10.0 tok/s — so a run's length is
almost entirely a function of how many tokens it takes, and that ranges over 2× for
problems of comparable size.

The repair loop is most of the spread. Problem 01 compiled on the first attempt and
spent **nothing** on repairs. Problems 02 and 03 each spent **33% of their output** on
them — 1.9 h and 2.5 h — and both still failed the gate. Budget a third of a run for
repairs that may not repair anything.

| scope | wall time |
|---|--:|
| variant A of all 18 problems | **76 – 137 h** |
| A and B | 152 – 274 h |
| all 54 | **228 – 411 h** |

The earlier projection said 19–48 h for variant A. It was built from phase timings taken
before the gate could fire, and the gate is what doubles a run.

The whole acervo does not fit in one sitting, so the order has to earn its place.

## The configuration is fixed for all eighteen

Every run in this pass uses the same generation parameters and leaves
`reasoning_effort` at the model's default. If a better setting is found partway
through — and `medium` is being measured precisely because it might be — **it does not
get applied to this pass.** Eighteen problems measured under two configurations are
not a set, and the earlier campaign was discarded for exactly that reason.

A better setting is an argument for a second pass against a first one that is
internally consistent.

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
