# The paired judging — does the issue buy quality, when it does not buy compilation?

> **This is the plan, written mid-campaign on 2026-09-12, and its numbers are a
> snapshot.** At the time the model axis was three rounds in: 50/59 against 38/49,
> p = 0.456. The closed grid is 51/60 against 48/60, p = 0.632 — the same null result
> on a full grid. `PAIRED-SUMMARY.md` carries the final figures and supersedes every
> number below. The reasoning that selected the four problems is unchanged.


The four-round comparison answered one question and left the important one open.

    LADDER 50/59 = 85%     MODEL 38/49 = 78%     Fisher p = 0.456

No detectable difference in the rate at which the two axes compile. The jump from the
earlier campaigns' 25% came from pinning the provider and repairing the file set, not
from the level-2 issue. More repetitions will not change this: even if every remaining
run came back clean the p-value would rise, not fall.

So the issue is not buying **compilation**. The open question is whether it buys
**delivery** — whether the tests that pass prove what the issue asked for.

There is already reason to think it might. The ladder verdicts on 02, 09 and 12 found
suites whose test names are the issue's acceptance criteria written as assertions:

    writes NOTHING when the line-item insert fails mid-transaction      (12, ladder)
    answers a non-member with the same not-found as a missing trip      (09, ladder)
    parks the order for review once attempts are exhausted              (02, ladder)

The 12 case is the sharpest: two failure injections at two different points, each
asserting the absence of every write. **No earlier condition on that problem produced
it**, and gpt-oss wrote `// Placeholder for resend eligibility logic` where 02 needed
the same kind of proof.

What is missing is the other half of each pair. A model-axis run that compiles may
deliver the same thing, or may deliver a happy-path test that asserts the rows exist.
`tsc` cannot tell the two apart. Only the rubric can.

## The four problems, and why these four

| problem | ladder | model | why |
|---|---|---|---|
| 03 read-model-projection | 1/4 | 4/4 | the largest gap, favouring **model** |
| 12 orm-migration | 4/4 | 1/3 | the largest gap, favouring **ladder** |
| 09 feature-in-conventions | 4/4 | 2/3 | ladder verdict already written; a leak the issue names explicitly |
| 02 reconciliation-resend | 3/4 | 3/4 | **tied** — the control. If the issue buys quality, it should show here too |

Two extremes and a control. If quality tracks the issue rather than the axis's compile
rate, 02 is where it has to show, because the compile rate is identical there.

## Method

For each of the four, judge one clean run per axis against the problem's own rubric,
scoring the same fields already used in every verdict in this repository. The axis is
recorded but the rubric does not change: the question is what was delivered, not which
condition delivered it.

Judge the **model** side first on each problem, before re-reading the ladder verdict.
The ladder verdicts are already written and mostly favourable, and reading them first
would set the bar in the direction of the result I am hoping for.

Eight readings, no API cost.

## The confound that has to stay in the record

Three things changed between the earlier campaigns and this one: the level-2 issue,
provider pinning, and the schema-aware set repair. The paired design controls for the
last two, because both axes ran in the same harness. It does **not** control for
anything about the problems themselves, and the four chosen here were chosen *after*
seeing their compile rates. That is acceptable for a question about delivery, which the
compile rate does not measure, but it would not be acceptable for re-litigating the
rate.
