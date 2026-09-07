# Verdict — 14 Code review with planted bugs (hosted, single request)

```yaml
verdict:      PASS_WITH_NOTES
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ~, M5 ✓, M6 ✓]

graded:       {recall_beyond_critical: 3, trigger_analysis: 3,
               false_positive_quality: 3, merge_judgment: 3,
               report_ergonomics: 1, process: 0}

typecheck:    n/a — the deliverable is one markdown file
tests:        n/a

failure_mode: harness_artifact
              # The run is not a code review. The model was never given the code.

revisions:    {self_repairs: 0 by the model, dropped_a_requirement: no}
cost:         {wall_minutes: —, output_tokens: —, requests: 1, usd: —}
host:         {n/a — the model is not on this machine}

harness_note: |
  Two defects, both fixed today, and this run was hit by all three of the campaign's.
  (1) `reads=[variant]` — the fixture was never handed over. (2) `extract_files`
  matched only three-backtick fences, and the reply opened its deliverable with
  ````markdown, which is correct for a file containing code blocks — so the run
  committed a workspace with no REVIEW.md in it, and the 179-line deliverable was
  recovered from the transcript for this judgement. (3) With no deliverable to scope
  to, the gate took the whole workspace and its four repair rounds rewrote
  `transfers.service.ts` and `accounts.repository.ts` — the files `workspace.json`
  calls `review only … never edits these`. Both restored.

would_merge:  the review would be useful to a team; the run does not measure review
headline:     Seven findings, seven planted bugs, no false positives, correct
              mechanisms and correct fixes — written by a model that says, in its own
              first paragraph, that it was never shown the code.

notes: |
  M1 all four answer-key CRITICALs appear: the retry path's read-modify-write balance,
  the lock order, the raw-connection `release()` on the success path only, and the
  floating notification promise. M2 every finding carries a `**Mechanism**` and a
  `**Conditions**` line naming the concurrent or error shape that fires it. M3 seven
  findings, seven plants, **zero false positives** — the precision floor is not close.
  M5 each finding ends in a code sketch. M6 the model wrote exactly one file.
  M4 is partial: the deadlock is ranked BLOCKER, which is what M4 checks for, but the
  floating notification promise is ranked MAJOR where the key has it CRITICAL.
```

## What it got right, blind

Finding 3, on a file it could not open:

    **Mechanism.** The lock helper issues `SELECT … FOR UPDATE` on the debit account
    first, then the credit account.
    **Conditions.** Two or more concurrent transfers sharing an account pair in
    opposite directions.
    **Minimal fix.** Acquire both locks in a fixed canonical order independent of
    request shape.

The fixture, restored:

    // locks are taken in request order — a crossing receiver→sender transfer deadlocks
    await this.accounts.lockAccount(sender, tx);

Mechanism, trigger and fix all correct. The same holds for the other six.

## Why that is less than it looks

The variant's closing paragraph is this:

    Areas worth tracing (not a bug list): promise handling on the notification path,
    lock acquisition order across account pairs, the client lifecycle in the
    raw-connection branch, money serialization on the audit-log branch, the query
    pattern inside the statement builder, the balance update in the retry path, and
    what happens inside vs outside the transaction boundary.

Seven areas. Seven planted bugs. **One to one, in the answer key's order.** The
model's own reasoning enumerates them back as a numbered list and then writes one
finding per item.

`recall_beyond_critical: 3` is honest — the findings are there and they are right —
but this run measured what the model knows about payment-service failure modes, not
whether it can find them in code. Told "lock acquisition order across account pairs",
any competent engineer names the deadlock. That is the knowledge, not the review.

`process: 0` and `report_ergonomics: 1` are where the blindness shows:

    `transfers.service.ts:~131`   the notification send is at line 90
    `transfers.service.ts:~108`   the transaction opens at line 28
    `serializer.ts:~42`           the audit-log stringify is transfers.service.ts:78

Every location is invented, marked with a `~` the model added itself. M5 asks for
`file:line`; what is here is a guess with a tilde in front of it.

## The honesty is worth recording

The deliverable's second paragraph, unprompted:

    **Grounding.** `// ASSUMPTION:` the fixture source was not included in the
    material I was given

`single-shot.md` asks for exactly one `ASSUMPTION` comment when a needed symbol is
absent, and the model applied that rule to the largest absence possible — the entire
subject of the task — and then did the most useful thing available to it.

Compare problem 13, run under the same blindness on the same day: there it invented a
module, wrote 53 assertions about its invention, and reported six findings in the
register of discovered fact. **Same defect, two responses: one declared the gap and
worked around it, the other papered over it.**

Whatever this run says about reviewing code, that difference is real and it is the
model's.

## This problem should be re-run

With the fixture supplied, the parser fixed and the gate scoped, problem 14 becomes
answerable as designed. It should also lose the "areas worth tracing" paragraph, or
keep it only for a variant that is explicitly about triage rather than discovery — as
written, it hands over the answer key in prose.
