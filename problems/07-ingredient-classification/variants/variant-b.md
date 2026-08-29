# Variant B — Food label allergen & additive checker

A grocery app classifies packaged foods from their ingredient labels. Rule
sources: an additive list (each with source citation and severity: restricted /
controversial / watch) and allergen groups. Users maintain household profiles
(lactose intolerance, nut allergy, infant) that tighten or add rules.

Build in **TypeScript + NestJS + Prisma + Postgres**:

1. Schema: ingredients + synonyms (E-numbers, trade names, translations), rules
   under immutable ruleset versions, products, stored results keyed by
   (product, rulesetVersion).
2. `classify(productId, profileId?)` — normalize/resolve ingredients (E-number
   ↔ name, case/accents, label typos via synonym fixtures), apply base rules,
   layer profile rules with defined precedence (an allergen match for the
   profile outranks base severity). Output: per-ingredient findings with source
   citations, unknowns explicitly listed with confidence impact, disclaimer —
   never a bare "safe/unsafe" verdict.
3. Ruleset updates create a new version and idempotently re-score; older
   results stay retrievable for audit ("why did it say X last month?").
4. Tests: profile adds a finding base rules don't have, unknown ingredient
   visible and confidence-lowering, E-number synonym resolves, determinism
   under shuffled input, two versions' results coexist for one product.
