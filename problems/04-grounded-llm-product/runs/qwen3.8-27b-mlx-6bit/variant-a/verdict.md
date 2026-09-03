# Verdict — 04 Grounded LLM product

```yaml
verdict:      PASS_WITH_NOTES
condition:    {runner: api, spec: model, reasoning_effort: medium}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided, M6 decided]
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓]

graded:       {judge_prompt: 2, grounding_mechanics: 1, harness_ergonomics: 2,
               failure_coverage: 3, quality: 3, process: 2}

typecheck:    passed after 4 repairs
tests:        12 of 15 pass

failure_mode: none
              # All six must-haves hold and the project compiles. Three of its own
              # tests fail, none of them on a must-have's structure.

revisions:    {self_repairs: 4, dropped_a_requirement: no}
cost:         {wall_minutes: 143, output_tokens: 82510, tokens_per_second: 9.6,
               requests: 18, output_ceiling_hits: 2}
host:         {requests_under_pressure: 0 of 18, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  after_changes
headline:     Builds the eval architecture correctly and then evaluates the answer
              after its own filter has already removed the lie.

notes: |
  The first run in the campaign to pass its gate on the must-haves, and the
  architecture is the reason. M2 is `Math.min(helpfulness.score,
  faithfulness.score)` with the two judges given different inputs — helpfulness sees
  the expected facts, faithfulness sees the sources and the planted false facts.
  That is exactly the construction the rubric asks for, and it is the one most
  submissions get wrong by handing a single judge everything.
  M1 holds: `faithfulnessJudge(answer, sources, plantedFalseFacts)` receives the
  documents. M3 splits into sentences and scores bigram overlap of content words per
  sentence. M4 plants "5 Ember Orbs" and "5 shards" as facts that are not true. M5
  refuses with "not covered by my sources" when no sentence survives the gate. M6 is
  a redaction over the finished answer, not a second generation.
  The failures are all in mechanics. Two are the redaction: it leaves a quantity the
  question never mentioned ("6"), and it fails to strip a location phrase ("in Ember
  Sanctum"). Both are `redactForHint` under-matching, and both are the kind of defect
  that makes a hint mode leak the answer it exists to withhold.
  The third is the one worth reading. Its own test feeds a source saying "4 shards"
  and an answer saying "5 shards", and expects faithfulness below the threshold. It
  scores exactly 1.0 — no penalty at all.
```

## The eval judges what the filter left behind

The scoring is `Math.max(0, 1 - penalty)` with `penalty += 0.25` per conflict, so a
single detected quantity conflict would score 0.75 and fail the 0.8 threshold. The
score was 1.0, which means no conflict was found — not that one was found and
weighted too lightly.

The judge's quantity check is sound: it pulls `(\d+)\s+([a-z]+)` from the answer and
searches each source for the same noun with a different number. Against "5 shards" and
a source reading "4 shards" it would fire. It did not fire, which leaves one
explanation — the judged text no longer contained "5 shards".

That follows from the pipeline. `answer()` gates sentences, keeps only the grounded
ones, joins those into `text`, and the harness judges `result.text`. A sentence the
grounding gate removed cannot be scored unfaithful by a judge reading what remains.

Both readings of that are defensible. Judging the delivered answer is the honest
measure of what a user receives; judging the raw generation is what tells you the
model lied. The model implemented the first and wrote a test asserting the second.

The practical consequence is worth stating plainly, because it generalises past this
run: **a grounding filter in front of an eval makes the eval blind to exactly what
the filter catches.** Faithfulness reads 1.0 on a pipeline that silently dropped the
model's claim, and the only signal left is helpfulness falling because the answer no
longer says anything. The `min()` may still fail the scenario — for the wrong reason,
through the wrong channel, and with a faithfulness score that says the model behaved.

## Fourth instance of one pattern

| run | stated right in | violated in |
|---|---|---|
| 01 at `low` | the plan's ordering rules | the plan's control flow |
| 01 at `medium` | the plan's design | the plan's manifest |
| 02 at `medium` | the test suite | the implementation |
| 04 at `medium` | the test suite | the pipeline the test measures |

Every one is an internally coherent artifact disagreeing with another artifact from
the same run, and in every one of them at least one side is right.

## Import convention, tracked

22 of 22 relative imports carry the `.js` extension. Running tally at `medium`:
problem 01 at 26 of 26, problem 04 at 22 of 22, problem 03 at 2 of 13. Problem 03
remains the only run to drift, and it is the largest — 19 files across four modules.
