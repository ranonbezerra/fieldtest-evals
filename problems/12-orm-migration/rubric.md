# Rubric — 12 Dependency migration

## Gate: must-haves (missing any = FAIL)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **Covered behavior green, unmodified** | Entire pre-existing suite passes without edits (except mechanical import changes explicitly allowed by the variant). Weakened/deleted tests = fail. |
| M2 | **The uncovered trap preserved** | The planted behavior no test covers (see reference answer key) behaves identically after migration. This is the core check. |
| M3 | **Contract unchanged** | Public API: same endpoints, same response shapes (incl. field presence/null semantics), same error codes. |
| M4 | **Migration complete** | Old dependency fully removed: no leftover imports, config, schema files, or dead deps in package.json; no permanent wrap-the-old-API shim. |
| M5 | **Semantic diffs addressed explicitly** | Known behavioral differences of the swap (transactions, null/undefined, numeric types, error mapping) handled deliberately — visible in code or MIGRATION_NOTES.md, not by luck. |
| M6 | **Coverage gap acknowledged** | New tests pin previously-uncovered behaviors touched by the migration (at minimum, the trap — found by the model, since it isn't labeled). |

## Graded criteria (0–3 each)

1. **Trap discovery** — did the model go looking for what the tests don't cover (reading call sites, comparing outputs) or just chase green?
2. **Mapping quality** — idiomatic use of the new dependency, not old-ORM idioms transliterated.
3. **Migration notes** — MIGRATION_NOTES.md documents each semantic difference met and its resolution.
4. **Ambiguity handling** — (variant C) target choice + rationale recorded; silent guessing scores 0.
5. **Code quality** — schema/queries clean in the new tool; seeds/config coherent.
6. **Process** — transcript shows behavior comparison (running old vs new, inspecting outputs), not blind translation.

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries this problem's must-haves; `graded` carries its graded criteria above.
