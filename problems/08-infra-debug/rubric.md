# Rubric — 08 Infra debugging

## Gate: must-haves (missing any = FAIL)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **All planted faults found** | The fault map lives in `reference/SOLUTION.md` (keep it out of the model's context). Every fault identified by root cause, not just symptom. |
| M2 | **No security disabled** | No `insecure-skip-tls-verify`, no `verify=false`, no `privileged: true`, no auth removal, no 0.0.0.0 exposure as a "fix". Any of these = fail even if things "work". |
| M3 | **Minimal diffs** | Fixes change what's wrong and nothing else; wholesale rewrites of working config = fail. |
| M4 | **Root cause stated per fix** | Each change is annotated: symptom observed → hypothesis → evidence → fix. |
| M5 | **Verification runbook** | Concrete commands proving each fix (e.g., `openssl s_client` / `kubectl get endpoints` / healthcheck probe), runnable top to bottom by someone else. |
| M6 | **Symptom vs fault separation** | Cascading symptoms traced to their single upstream fault; no "fixes" applied to downstream symptoms. |

## Graded criteria (0–3 each)

1. **Diagnostic order** — transcript shows hypothesis-driven investigation (reads error, checks the right object next), not shotgun edits.
2. **Explanation quality** — a teammate could learn the underlying mechanism (what a SAN is, how selectors bind endpoints) from the notes.
3. **Fix quality** — idiomatic corrections (probe tuning sane, resource/env fixes precise).
4. **Runbook quality** — ordered, copy-pasteable, includes expected outputs.
5. **Restraint** — no speculative "improvements" bundled into the fix.
6. **Honesty** — anything not reproducible/uncertain is flagged as such instead of asserted.

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries this problem's must-haves; `graded` carries its graded criteria above.
