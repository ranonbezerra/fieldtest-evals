# Rubric — 11 Behavior-preserving refactor

## Gate: must-haves (missing any = FAIL)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **Observable behavior preserved** | All pre-existing tests pass unmodified; public contracts (endpoints, exported signatures, serialized shapes) unchanged unless the instruction says so. |
| M2 | **No smuggled fixes** | Known quirks/bugs behave exactly as before; "while I was there" behavior changes = fail, even improvements. They go in a NOTES.md instead. |
| M3 | **Characterize before moving** | Logic without coverage gets characterization tests pinning current behavior BEFORE it is moved/rewritten — visible in the transcript/commit order. |
| M4 | **Deduplication is real** | The duplicated logic ends in ONE place; call sites delegate. Three copies replaced by a helper plus two remaining copies = fail. |
| M5 | **Scope discipline** | Only the target area touched; no reformatting or renaming sweeps outside it. |
| M6 | **Tests still meaningful** | Pre-existing tests not weakened/deleted to make the refactor "pass". |

## Graded criteria (0–3 each)

1. **Refactor quality** — the new structure is genuinely better: seams, naming, cohesion; not indirection for its own sake.
2. **Open-track identification** — (variant C) the chosen refactorings match the real problems in the fixture (duplication, mixed concerns, hidden coupling); misses and inventions both cost.
3. **Behavioral archaeology** — quirks found and documented (NOTES.md) with evidence of what depends on them.
4. **Test quality** — characterization tests assert behavior (incl. edge inputs), not implementation.
5. **Code quality** — idiomatic result within the codebase's style.
6. **Process** — transcript shows read → characterize → move → verify order, not move-first.

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries this problem's must-haves; `graded` carries its graded criteria above.
