# Variant A — Cosmetics ingredient scanner

A scanner app classifies cosmetics from their INCI ingredient lists. Rule
sources: a regulator's restricted list and a curated watch list, each entry with
a source citation and severity (banned / restricted / watch). Users maintain
family profiles (e.g., child under 3, pregnancy) that tighten certain rules.

Build in **TypeScript + NestJS + Prisma + Postgres**:

1. Schema: ingredients + synonyms, rules grouped under immutable methodology
   versions, products with ingredient lists, stored classification results
   keyed by (product, methodologyVersion).
2. `classify(productId, profileId?)` — normalizes and resolves each listed
   ingredient (synonyms, case, accents, common OCR typos via provided synonym
   fixtures), applies the active methodology's base rules, then the profile's
   contextual modifiers by defined precedence. Output: per-ingredient findings
   (flag, severity, source citation), unrecognized ingredients listed as
   unknown, an overall confidence, and a disclaimer — no binary safe/toxic.
3. Publishing a new methodology version triggers idempotent re-scoring of
   affected products; results from the previous version remain retrievable.
4. Tests: profile flips a finding, unknown ingredient lowers confidence and is
   visible, synonym/typo resolves, same product identical across reruns and
   under shuffled ingredient order, both versions' results coexist.
