# Issue #319 — The scanner says "safe" and cannot say why, and old results change under us

**Repo:** `cosmetics-scanner` · **Labels:** `feature` `compliance` `blocker`
**Reported by:** product + regulatory · **Diagnosed by:** platform

---

## What is happening

Three problems, and they share a cause: rules live in code and results are computed
on read.

**Regulatory cannot defend an output.** A user screenshots "safe" next to an
ingredient a regulator restricts, and we cannot say which rule fired, from which
source, or which version of our rule set was in effect. There is no citation and no
version.

**Old results change silently.** We updated the watch list in March. Results a user
saw in February now render differently, because they are recomputed from whatever
rules are current. For a compliance product that is the wrong default: a stored
result must remain retrievable as it was.

**Unrecognized ingredients disappear.** An INCI string we cannot resolve — an OCR
typo, a synonym we do not have, a novel ingredient — is skipped. The output looks
just as confident as one where we recognised everything, which is the most dangerous
shape this product can take.

## What we need

### 1. Methodology versions are immutable, and results carry theirs

Rules — from the regulator's restricted list and the curated watch list, each with a
**source citation** and a severity of banned / restricted / watch — are grouped under
a methodology version. A published version never changes.

A stored classification result is keyed by **(product, methodologyVersion)**. Publishing
a new version re-scores affected products into new rows; the previous version's results
remain retrievable exactly as they were.

Re-scoring must be idempotent: running it twice for the same version produces the same
rows, not duplicates.

### 2. Normalize before matching, and say when you could not

`classify(productId, profileId?)`:

1. **Normalize and resolve** each listed ingredient — case, accents, synonyms, common
   OCR typos, from the provided synonym fixtures. Matching raw INCI strings against
   rule names is the bug that makes the watch list look empty.
2. Apply the active methodology's **base rules**.
3. Apply the profile's **contextual modifiers** — child under 3, pregnancy — by a
   precedence you define and write down. Two modifiers touching one ingredient must
   resolve the same way every time, so the order cannot be whatever the iteration
   happens to produce.

### 3. Unknown is a first-class outcome

An ingredient we could not resolve is **listed as unknown in the output** and **lowers
the overall confidence**. It is never dropped and never treated as clean.

### 4. Findings, not a verdict

Per ingredient: the flag, the severity, and the **source citation**. Plus an overall
confidence reflecting how much of the list we recognised, and a disclaimer.

**No binary safe/toxic field anywhere.** Not in the API, not in the database. The
product's job is to show what the rules say and where they come from.

### 5. Deterministic

The same product classified twice gives an identical result. The same product with its
ingredient list shuffled gives an identical result. If either differs, something is
depending on order that should not be.

## Acceptance

- A profile flips a finding that the base rules alone would not have flagged
- An unrecognized ingredient appears as unknown **and** the confidence drops
- A synonym and an OCR typo both resolve to the canonical ingredient
- Same product, two runs → identical output
- Same product, shuffled ingredient order → identical output
- After publishing v2, both v1 and v2 results are retrievable for the same product

## Deliverables

Prisma schema for ingredients, synonyms, rules under methodology versions, products,
and results keyed by (product, version) · `classify(productId, profileId?)` · the
re-scoring path · the tests above · the modifier precedence written down.

## Notes

Stack is fixed: TypeScript, NestJS, Prisma, PostgreSQL. Synonym and typo fixtures are
provided.
