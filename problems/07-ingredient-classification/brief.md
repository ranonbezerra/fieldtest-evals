# 07 — Versioned rules engine: product-safety classification

## The real situation

A consumer scanner app classifies products (cosmetics, food, cleaning) by their
ingredient lists so families can decide what to buy. Planning this product
surfaced constraints that reshape the whole engine — and that most naive
implementations get wrong:

- **The verdict is a legal surface.** Calling a listed product "toxic" without
  nuance invites lawsuits from manufacturers. The output cannot be a binary
  green/red judgment; it must be objective flags tied to citable sources
  ("contains X, restricted by regulator list Y, updated 2021"), with severity
  levels and disclaimers — findings, not accusations.
- **The methodology IS the product — and it changes.** The rule list (which
  ingredients are flagged, at what severity, for whom) evolves. A score shown to
  a user last month must be explainable: results carry the methodology version
  that produced them, and a methodology update triggers idempotent re-scoring,
  never silent mutation of history.
- **Context changes the verdict.** A family profile (infant, pregnancy, specific
  sensitivities) layers contextual modifiers over the base classification: the
  same product can be "fine for the adult, avoid for the baby". Base rules and
  contextual rules must compose deterministically.
- **Unknown ≠ safe.** Ingredient databases are incomplete. An ingredient the
  engine doesn't recognize must surface as *unknown*, lowering confidence — a
  scanner that defaults unknowns to "clean" is a false-safety machine.
- **Matching is messy.** The same ingredient appears under multiple names
  (INCI name, trade name, translations, typos from OCR'd labels). Normalization
  and synonym resolution come before any rule applies.

This tests data modeling + deterministic rules + versioning discipline — the
kind of "boring" domain engine most products live or die on.

## Stack

TypeScript, NestJS, Prisma, PostgreSQL. Rule data seeded via fixtures; no
external APIs required.
