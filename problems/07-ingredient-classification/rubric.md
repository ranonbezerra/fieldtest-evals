# Rubric — 07 Versioned classification engine

## Gate: must-haves (missing any = FAIL)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **Versioned methodology** | Rules belong to an immutable methodology version; every stored result records the version that produced it. Mutating rules in place = fail. |
| M2 | **Reproducibility** | Re-running classification for (product, version) yields identical output; history is never silently rewritten by rule changes. |
| M3 | **Unknown ≠ safe** | Unrecognized ingredients surface explicitly as unknown and affect confidence; defaulting unknowns to clean/pass = fail. |
| M4 | **Findings with sources, not accusations** | Output is per-ingredient flags with severity + citable source reference and an overall disclaimer; a bare binary "toxic/safe" label = fail. |
| M5 | **Deterministic contextual layering** | Profile modifiers (infant, pregnancy, sensitivity) compose over base rules by defined precedence; same input → same output, order-independent. |
| M6 | **Normalization before rules** | Ingredient matching goes through canonical normalization + synonym resolution; raw-string equality against rule names = fail. |

## Graded criteria (0–3 each)

1. **Schema design** — ingredients, synonyms, rules, methodology versions, results modeled with sane relations; re-scoring job idempotent (upsert by product+version).
2. **Rule semantics** — severity scale and rule types (banned-by-list, restricted-above-context, watch) expressed as data, not if/else chains.
3. **Confidence model** — coverage of recognized vs unknown ingredients reflected in an explicit confidence output.
4. **Tests** — same product across two methodology versions (both results retrievable), profile changes verdict, unknown ingredient path, synonym/typo resolution, determinism (shuffle input order).
5. **Code quality** — engine pure and injectable; persistence at the edges.
6. **Process** — transcript shows the model catching the legal-surface constraint (flags vs verdicts) rather than being told.

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries this problem's must-haves; `graded` carries its graded criteria above.
