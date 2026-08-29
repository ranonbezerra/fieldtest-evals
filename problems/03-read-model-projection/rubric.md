# Rubric — 03 Read-model projection

## Gate: must-haves (missing any = FAIL)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **Projection updated atomically with the write** | Projection upsert happens in the same DB transaction as the source write (service-level hook). Async-only maintenance without justification = fail. |
| M2 | **Rebuildable from source of truth** | A re-derivation routine reconstructs any projection window purely from source tables; running it is idempotent (upsert, not append). |
| M3 | **Drift repair** | A scheduled reconciliation compares/re-derives recent windows; drift cannot persist silently. |
| M4 | **Hot query hits only the projection** | The dashboard query reads projection tables exclusively; no joins back into source tables on the hot path. |
| M5 | **Concurrent-write correctness** | Two transactions updating the same aggregate row do not lose updates (atomic increments or serialized upsert, not read-modify-write). |
| M6 | **Indexes match the query** | Index design (composite/covering) matches the actual dashboard filters and sort; no "index everything" scatter. |

## Graded criteria (0–3 each)

1. **Schema design** — projection granularity fits the questions asked; summary vs row-level separation.
2. **Rebuild story** — projection versioning or documented procedure for when projection logic changes.
3. **Trade-off articulation** — DESIGN.md explains why sync hooks vs event bus vs matview, and read-your-own-writes.
4. **Tests** — write→read consistency in one transaction scope, concurrent increments, drift repair converging.
5. **Code quality** — clean SQL/DDL, sane Prisma usage, no N+1 in maintenance.
6. **Process** — transcript shows the model interrogating the query shape before designing indexes.

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries this problem's must-haves; `graded` carries its graded criteria above.
