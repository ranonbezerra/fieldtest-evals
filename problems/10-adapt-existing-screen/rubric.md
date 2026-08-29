# Rubric — 10 Adapt an existing screen

## Gate: must-haves (missing any = FAIL)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **It's an edit, not a rewrite** | Existing components modified in place; wholesale rewrites of working screens/components = fail even if the result works. The diff is the artifact. |
| M2 | **Regression list intact** | Every existing behavior listed in the variant still works (manually verifiable + covered where tests exist). |
| M3 | **State management consistent** | New server state goes through the app's existing mechanism (react-query patterns, existing hooks); no parallel fetch layer, no duplicated queries for data already available in the tree. |
| M4 | **Real wiring** | New UI is connected to real API calls (against the provided mock server/handlers) — no dead buttons, no hardcoded data. |
| M5 | **Loading & error states** | New async surfaces handle pending/error like the app already does (reuse its primitives). |
| M6 | **No drive-by changes** | No restyling, renaming, or refactoring outside the task's scope. |

## Graded criteria (0–3 each)

1. **Component placement** — new state/logic lives at the right level (lifted where shared, local where not); context used like the app uses it.
2. **UX fidelity** — matches the mockup/description including edge states (empty, long text, permission-gated).
3. **Ambiguity handling** — (decisive on variant C) open decisions recorded in ASSUMPTIONS.md or asked; silent guessing scores 0.
4. **Tests** — new behavior covered in the app's existing testing style; regression list encoded where practical.
5. **Code quality** — idiomatic React/TS within the app's established patterns.
6. **Process** — transcript shows the model reading the existing screens/hooks before writing.

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries this problem's must-haves; `graded` carries its graded criteria above.
