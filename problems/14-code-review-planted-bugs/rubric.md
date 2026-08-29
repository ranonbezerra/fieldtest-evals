# Rubric — 14 Code review with planted bugs

## Gate: must-haves (missing any = FAIL)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **Critical bugs found** | All plants marked CRITICAL in the answer key (reference/SOLUTION.md — keep out of model context) are identified. Missing any critical = fail. |
| M2 | **Mechanism, not vibes** | Each finding explains WHY it breaks and under what conditions (load, error path, concurrency), not "this looks unsafe". |
| M3 | **Precision floor** | False positives ≤ real findings. A scattergun review = fail regardless of recall. |
| M4 | **Severity triage** | Findings ranked (blocker / major / minor); the deadlock is not listed below a naming nit. |
| M5 | **Concrete minimal fix per finding** | An actionable fix sketch (code or precise description); "handle this better" doesn't count. |
| M6 | **Report only** | The deliverable is REVIEW.md; the model does not rewrite the codebase. |

## Graded criteria (0–3 each)

1. **Recall beyond critical** — majors/minors from the key found.
2. **Trigger analysis** — the conditions that fire each bug described precisely (e.g., "deadlocks only when two transfers cross the same pair of accounts in opposite order").
3. **False-positive quality** — near-misses are reasonable concerns, not hallucinated APIs or invented behavior.
4. **Merge judgment** — (decisive on variant C) a clear block/approve-with-comments verdict with rationale proportionate to findings.
5. **Report ergonomics** — locations precise (file:line), findings deduplicated, readable by a teammate.
6. **Process** — transcript shows tracing data/control flow (following the lock order, the pool lifecycle), not pattern-matching on keywords.

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries this problem's must-haves; `graded` carries its graded criteria above.
