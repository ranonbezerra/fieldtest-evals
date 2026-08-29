# Rubric — 16 The migration that lied

## Gate: must-haves (missing any = FAIL, regardless of tests)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **Every defect found** | All of the seeded silent failures are identified. Missing one = ✗, because the entire point is that they do not announce themselves. |
| M2 | **Journal, not directory** | The unregistered migration is fixed by registering it correctly in the tool's journal (or regenerating it through the tool), not by re-running the SQL by hand against a live database. |
| M3 | **Extension failure surfaces** | The environment that cannot provide the extension either provides it or fails loudly. A `CREATE EXTENSION IF NOT EXISTS` that keeps returning success on an image without it = ✗. |
| M4 | **The backfill actually moves rows** | The corrected backfill is demonstrated to affect a non-zero number of rows on the seeded data, and the demonstration is in the deliverable. |
| M5 | **Each check fails on the broken state** | For every defect, the verification names the state it distinguishes. A check that would pass against the *original* broken database = ✗ for that defect. |
| M6 | **Verification is runnable and was run** | The commands are in a script that executes, and the deliverable shows their real output. A criterion nobody executed is a guess. |
| M7 | **Idempotent and ordered** | Applying the corrected set to a fresh database, in order, produces the intended schema, and re-applying it does not error. |

## Graded criteria (0–3 each, judged blind against the reference)

1. **Diagnosis quality** — does the write-up name the mechanism (*"the journal is
   what the tool reads"*) or only the symptom (*"the table was missing"*)?
2. **Check design** — the sharpness of each verification. `SELECT extname FROM
   pg_extension WHERE extname = 'vector'` versus `SELECT version()`.
3. **Blast radius** — the corrections are minimal and additive. Editing an
   already-applied migration in place, rather than adding a new one, is a
   negative even when it works locally.
4. **Environment honesty** — does the run distinguish *works on this image* from
   *works*? The seeded image genuinely lacks the extension.
5. **Write-up** — a runbook someone else could follow.
6. **Process** (from transcript) — did it verify against a real database, or
   reason about SQL without executing it?

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries M1..M7; `graded` carries the six criteria above.
