# Variant C — Household cleaning product checker

An app classifies household cleaning products from their disclosed ingredient
lists. Rule sources: a hazardous-substances list and an indoor-air/skin-contact
watch list, each entry citing its source with severity (restricted / caution /
watch). Household profiles (asthma, pets, small children) tighten rules.

Build in **TypeScript + NestJS + Prisma + Postgres**:

1. Schema: substances + synonyms (chemical name, CAS-style code, trade names),
   rules under immutable methodology versions, products, stored results keyed
   by (product, methodologyVersion).
2. `classify(productId, profileId?)` — normalize/resolve substances (code ↔
   name, casing, typos via synonym fixtures), apply base rules, layer profile
   modifiers with defined precedence. Output: per-substance findings with
   source citations, explicit unknowns with confidence impact, an overall
   summary phrased as findings + disclaimer — no "toxic"/"safe" binary.
3. Publishing a new methodology version re-scores idempotently; previous
   versions' results remain retrievable.
4. Tests: pets profile flips a finding, unknown substance visible and
   confidence-lowering, code synonym resolves, deterministic under shuffled
   ingredient order and reruns, results from two versions coexist.
