# Verdict — 14 Code review with planted bugs (gpt-oss-120b, hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: openai/gpt-oss-120b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ✓, M5 ✓, M6 ✓ — on content that was never written]

graded:       {recall_beyond_critical: 2, trigger_analysis: 3,
               false_positive_quality: 3, merge_judgment: 2,
               report_ergonomics: 3, process: n/a}

typecheck:    n/a — the deliverable is one markdown file
tests:        n/a

failure_mode: wrong_answer
              # The run produced no deliverable. `single-shot.md` requires a `###
              # path` heading "immediately followed by one fenced block"; the model
              # wrote `### REVIEW.md` and then the review, unfenced. Nothing was
              # extracted, twice, and the workspace was committed without it.

revisions:    {self_repairs: 0 by the model, dropped_a_requirement: yes}
cost:         {wall_minutes: ~2, requests: 2 + 4 gate repairs, usd: 0.0028}
host:         {n/a — the model is not on this machine}

harness_note: |
  With no extracted files, `ft-go`'s gate fell back to the whole workspace and its
  repair rounds rewrote `transfers.service.ts` and `accounts.repository.ts` — the code
  `workspace.json` calls `review only … never edits these`. Both restored from the
  fixture. The gate is scoped to the reply's paths when there are any; the empty case
  should skip the gate rather than fall back, and is recorded in SECOND-PASS.
  The review below was recovered from `steps/00-solution-retry.md` for judging.

would_merge:  the review would be useful; the run delivered nothing
headline:     A review with real line numbers and correct mechanisms, five of seven
              plants, written in a format the harness cannot read and therefore
              never written at all.
```

## The review is good, and it is good because it could see the code

Eight findings in a ranked table with `File:Line`, `Severity`, `Mechanism &
Conditions` and `Minimal Fix` columns. The first:

    | 1 | src/transfers.service.ts:31-35 | blocker | Deadlock risk – two concurrent
        transfers that involve the same pair of accounts in opposite directions …

Lines 31–35 of the file:

    const from = await this.accounts.lockAccount(tx, fromAccountId);
    const to   = await this.accounts.lockAccount(tx, toAccountId);

Exactly right, and cited exactly. Compare the blind Qwen run on this problem, which
put the notification send at `~131` when it is at line 90 and marked every location
with a tilde it added itself. `report_ergonomics: 3` against Qwen's 1 — that difference
is the fixture being visible.

Against the answer key:

| planted | found |
|---|---|
| CRITICAL lock order → deadlock | **#1 blocker** ✓ |
| MAJOR audit-log `JSON.stringify` on BigInt | **#2 blocker** ✓ |
| CRITICAL floating notification promise | **#3 major** ✓ |
| CRITICAL raw-connection `release()` on success only | **#4 major** ✓ |
| CRITICAL retry read-modify-write balance | **#5 major** ✓ |
| MAJOR statement builder N+1 | **missed** |
| MAJOR provider HTTP call inside `$transaction` | **missed** |

All four answer-key CRITICALs found, so M1 holds. `recall_beyond_critical: 2` — both
misses are the majors, and neither the phrase "N+1" nor any mention of an external call
inside a transaction appears in the report.

Findings 6, 7 and 8 are the extras: a generic `Error` where a typed one belongs, a
missing existence check, and a possible month-filter misuse. All minor, all defensible
by tracing — M3's precision floor is met, not scattergun.

## And none of it exists

`single-shot.md` is explicit:

    For each file, a level-3 heading holding **only its repository-relative path**,
    immediately followed by one fenced block holding **only that file's content**.
    Nothing outside that pattern is read.

The first attempt used `# REVIEW.md` — level one. The retry corrected the heading level
and still wrote the review directly beneath it with no fence. Both extractions returned
nothing, and the run committed a workspace containing the fixture and no deliverable.

This is the model's error, not the harness's: the contract was stated, and the same
contract was met by every other run in this campaign. But it is a different *kind* of
failure from the other thirteen — the work was done and the envelope was wrong.

## Against Qwen3.8-27B on the same problem

| | Qwen3.8-27B (blind) | gpt-oss-120b (fixture visible) |
|---|---|---|
| plants found | 7 of 7 — from the brief's list of seven areas | 5 of 7 |
| line numbers | invented, marked `~` | **accurate** |
| mechanisms | correct | correct |
| deliverable written | recovered after a parser fix | **not written; format contract broken** |
| verdict | PASS_WITH_NOTES | FAIL |

Qwen scored higher on recall and could not have earned it — the variant's closing
paragraph lists seven "areas worth tracing", one per plant, and it was working from
that list alone. This run had the code and found five by reading it, with locations
that check out. The recall gap is real; so is the difference in what the two reviews
are evidence of.

Problem 14 should still lose that paragraph before it is run again.
