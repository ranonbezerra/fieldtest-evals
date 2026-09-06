# Verdict — 14 Code review with planted bugs

```yaml
verdict:      PASS_WITH_NOTES
condition:    {runner: api, spec: model, reasoning_effort: medium}

plan_gate:    [M1 decided, M2 decided, M3 decided, M4 decided, M5 decided, M6 decided]
gate:         [M1 ✓, M2 ✓, M3 ✓, M4 ~, M5 ✓, M6 ✓]

graded:       {recall: 3, mechanism: 3, precision: 3, triage: 1, fixes: 3, process: 2}

manifest:     1 declared, 1 built — REVIEW.md
typecheck:    skipped — no manifest-declared TypeScript. See below; it was not
              skipped at the time, and that is the run's real story.
tests:        n/a

failure_mode: none

revisions:    {self_repairs: 0, dropped_a_requirement: no}
cost:         {wall_minutes: 72, output_tokens: 22104, tokens_per_second: 10.2,
               requests: 6, output_ceiling_hits: []}
host:         {requests_under_pressure: 0 of 6, ceiling_gib: [37.44, 37.44],
               comparable: yes}

would_merge:  yes, as a review
headline:     Finds every critical plant and rates one of them minor.

notes: |
  Recall is complete. All four plants the answer key marks CRITICAL for variant A are
  present: the read-modify-write in the retry path (F1), the lock order taken from
  argument position (F2), the raw connection released only on the success path (F5),
  and the floating promise on the notification (F6).
  M2 and M5 are the strongest cells. Every finding carries a location, a mechanism
  naming the conditions under which it fires, and a fix with code. F2's fix is exactly
  right — sort the two ids and acquire the locks in that order — which is the
  canonical answer and not a restatement of the problem.
  The verdict is **Block**, with a rationale citing F1 as a fund-corruption defect
  reachable on a realistic transient failure, and requiring F2 through F5 in the same
  change set.
  M4 is where it slips, and the rubric's own test is the reason it is `~` rather than
  `✗`. *"The deadlock is not listed below a naming nit"* — it is not; F2 sits at major,
  above the minors, and the verdict blocks on it anyway. But a CRITICAL plant is rated
  **minor**: F6, the floating promise, is the answer key's plant 1, and it sits at the
  bottom tier and outside the blocking set. Three of four criticals are under-ranked;
  the decision compensates for two of them and not for the third.
  Precision holds. Seven findings, at least five mapping to plants, and the style
  observations are quarantined under a separate "Non-blocking observations" heading
  rather than padding the count.
```

## The gate rewrote the code under review

`workspace.json` for this problem reads:

```json
{"_note": "review only — the run produces REVIEW.md, never edits these", …}
```

The model honoured that: its manifest declares one file, `REVIEW.md`, and one file is
what it wrote. **The harness did not.** The gate typechecked the fixture — the code
under review, with its planted bugs — found errors in it, and ran four repair phases:
`repair1-accounts.repository.ts`, `repair1-transfers.service.ts`, and both again in
round two. Two of the three files under review were rewritten by the harness, in a
problem whose M6 is *"the model does not rewrite the codebase"*.

The recorded gate was `passed: false` after four repairs, on planted bugs the model was
asked to describe rather than fix.

*Restored and changed.* The three fixture files are back to their fixture state, and
`meta.yaml` records the gate as skipped with the reason. `ft-go` now derives both the
typecheck's inputs and the repair loop's targets from the manifest: **the gate judges
what the model was asked to produce, and nothing else.** Problem 11 is unaffected — the
files it edits on purpose are in its manifest — and problems 01–08 are unaffected
because everything in those workspaces was model-written.

This is the fourth time the harness has stated an intention in prose and not implemented
it (§4.12), and the first where the omission made a run violate a must-have by
construction. `workspace.json` said *never edits these* in the same file that tells the
harness which fixture to copy.

## Three problems without a boundary, three good results

| | cross-file boundary | outcome |
|---|---|---|
| 08 infra debug | none — five artifacts | PASS, 3 on every criterion |
| 16 migration that lied | none — SQL, shell, markdown | PASS_WITH_NOTES |
| 14 code review | none — one markdown file | PASS_WITH_NOTES |

Against eleven problems that required building across files, of which two compiled and
none passed. The hypothesis problem 08 raised is holding: **what fails is not the
reasoning, it is holding an agreement between artifacts.** These three ask the model to
think about code and write prose, and it does that well.

What would test it properly is the ladder (`--spec ladder`) on a multi-file problem —
design supplied, bodies open. That separates *cannot design* from *cannot assemble*,
and it is in `SECOND-PASS.md`.
