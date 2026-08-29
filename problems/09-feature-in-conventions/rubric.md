# Rubric — 09 Feature inside conventions

## Gate: must-haves (missing any = FAIL)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **Layering respected** | Handlers/controllers never touch the DB or ORM directly; data access only through the repository layer the conventions define. One violation = fail. |
| M2 | **Established patterns reused** | Result/error envelope, module layout, naming, and migration style follow the conventions contract — no parallel invented style. |
| M3 | **Feature complete per spec** | Every acceptance item in the variant implemented and wired end to end (API, and UI slice where asked); no silently dropped requirements. |
| M4 | **No drive-by changes** | Untouched areas of the scaffold stay untouched; no reformatting, renaming, or "improvements" outside the feature's scope. |
| M5 | **Migrations included** | Schema changes ship as migrations in the repo's style; hand-edited schema without migration = fail. |
| M6 | **Tests per repo pattern** | Tests exist for the feature and follow the conventions' test layout/naming. |

## Graded criteria (0–3 each)

1. **Convention fidelity depth** — beyond the letter: does new code *read* like the scaffold's code?
2. **Domain modeling** — entities/invariants sensible for the feature, not CRUD-shaped mush.
3. **Ambiguity handling** — (decisive on variant C) assumptions surfaced and recorded in an ASSUMPTIONS.md or asked; confident guessing scores 0.
4. **Test quality** — behavior-level assertions, edge cases from the spec.
5. **Code quality** — idiomatic TS/NestJS/Drizzle within the imposed style.
6. **Process** — transcript shows the model reading the conventions BEFORE writing code.

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries this problem's must-haves; `graded` carries its graded criteria above.
