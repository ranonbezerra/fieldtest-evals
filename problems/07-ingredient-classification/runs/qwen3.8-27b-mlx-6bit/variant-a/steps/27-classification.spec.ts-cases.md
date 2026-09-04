# 27-classification.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/classification.spec.ts` based on the PLAN.md and the implementation files provided. I need to list one line per test case in the specified format, covering behaviors from both the task statement and the plan.

Let me analyze what needs to be tested:

From the task statement (section 4 of variant-a.md):
1. Profile flips a finding
2. Unknown ingredient lowers confidence and is visible
3. Synonym/typo resolves
4. Same product identical across reruns and under shuffled ingredient order
5. Both versions' results coexist

From PLAN.md section 5 (Tests):
1. Profile flips a finding: base rule flags ingredient X as `watch`; profile modifier escalates to `banned` → response shows severity `banned` with the modifier's citation.
2. Unknown ingredient lowers confidence and is visible: product has 5 ingredients, 1 unresolvable → `overallConfidence = 0.8`, `unknownIngredients` contains the raw text, finding has `isUnknown: true`.
3. Synonym/typo resolves: raw text is a seeded OCR typo (e.g., `"gyceryl"` → canonical `"glycerol"`) → finding has `resolvedName: "glycerol"` and the correct rule's flag/severity.
4. Identical across reruns: call `classify` twice for the same product → deep-equal responses (findings array, confidence, disclaimer).
5. Shuffled ingredient order: create product A with ingredients `[a, b, c]` and product B with `[c, a, b]` (same set, different positions) → both responses have identical sets of findings sorted by position; confidence equal.
6. Both versions coexist: publish v1, classify → result stored under v1. Publish v2, re-score → result stored under v2. GET `/products/:id/results` returns entries for both versions; v1 findings are unchanged.

Now let me think about additional cases that the plan says matters but aren't explicitly in the test list:

From the implementation:
- Normalization handles accents (NFD decompose + strip combining marks)
- Case insensitivity
- Whitespace collapsing
- Profile modifier only tightens (escalates), never de-escalates
- If no base rule but modifier exists, modifier is applied (adds new flag)
- Confidence formula: max(0, 1 - 0.1 * unknownCount) — boundary at 0 (10+ unknowns)
- ResourceNotFound for missing product, profile, or active version
- ConflictError for publishing non-existent or already-active version
- Re-scoring is idempotent (upsert)
- Published new version triggers re-scoring of affected products
- Results from previous version remain retrievable
- Disclaimer is always present, no binary safe/toxic

Let me think about what "would have to be broken for it to fail" for each:

1. **Profile escalates a watch finding to banned** — proves the tighten-only precedence: the profile modifier with higher ordinal replaces the base rule's severity/flag/citation. Fails if: modifier ordinal comparison is inverted (e.g., `>` becomes `<`), or the modifier lookup uses the wrong key, or the severity enum ordinal mapping is wrong.

2. **Profile adds a flag where no base rule exists** — proves that a modifier can introduce a new finding for an ingredient that had no rule in the base methodology. Fails if: the code only applies modifiers when a base rule already exists (the `hasBaseRule` check incorrectly gates the "add new" branch).

3. **Profile does NOT de-escalate** — proves tighten-only: a modifier with LOWER ordinal than the base rule leaves the finding unchanged. Fails if: the code applies the modifier unconditionally (replaces severity regardless of ordinal comparison).

4. **Unknown ingredient appears in `unknownIngredients` and finding has `isUnknown: true`** — proves unrecognized ingredients are surfaced, not silently dropped. Fails if: unknown findings are filtered out of the response, or `isUnknown` is not set, or the raw text is lost.

5. **One unknown among five lowers confidence to exactly 0.8** — proves the formula `max(0, 1 - 0.1 * unknownCount)`. Fails if: the divisor is wrong (e.g., 0.2), the count includes known ingredients, or the formula uses percentage instead of fraction.

6. **Ten or more unknowns clamp confidence to 0 (boundary)** — proves the `Math.max(0, ...)` floor. Fails if: the floor is missing and confidence goes negative.

7. **OCR typo "gyceryl" resolves to canonical "glycerol"** — proves the synonym lookup path works for seeded typo fixtures. Fails if: normalization is applied to the synonym table but not the input (or vice versa), or the synonym query uses a different normalization, or the typo isn't in the seed.

8. **Accented input "Phénoxyéthanol" resolves to "phenoxyethanol"** — proves NFD decomposition + combining-mark stripping handles accented characters. Fails if: normalization doesn't strip diacritics, or the canonical name is stored with accents.

9. **Case-insensitive resolution: "GLYCERIN" resolves to "glycerol"** — proves lowercasing in normalization. Fails if: the query is case-sensitive.

10. **Two consecutive classify calls return deep-equal responses** — proves idempotency of the upsert and determinism of the logic. Fails if: the stored result mutates between calls (e.g., timestamp is included in the response), or findings order is non-deterministic.

11. **Shuffled ingredient order produces identical finding sets** — proves order-independence of classification logic (findings sorted by position, but the set is the same). Fails if: findings are returned in insertion order rather than position order, or the logic depends on array index.

12. **Both methodology versions' results coexist after publish** — proves that publishing v2 doesn't overwrite v1's stored result. Fails if: the upsert key is only `productId` (missing version), or re-scoring deletes old results.

13. **Publishing a non-existent version raises ResourceNotFound / ConflictError** — proves the error path for invalid publish. Fails if: the code silently succeeds or returns a different error shape.

14. **Publishing an already-active version raises ConflictError** — proves the "already active" guard. Fails if: the check is missing and it silently re-activates (though idempotent, the contract says conflict).

15. **Classify with a non-existent product raises ResourceNotFound** — proves the error path for missing product. Fails if: it returns a 200 with empty findings, or throws a generic error.

16. **Classify with a non-existent profile raises ResourceNotFound** — proves the error path for missing profile. Fails if: it silently ignores the profileId.

17. **No active methodology version raises ResourceNotFound** — proves the guard when no version is published. Fails if: it returns an empty classification or crashes with an unhandled null.

18. **Re-scoring after publish is idempotent (calling rescoreAll twice yields same stored rows)** — proves the upsert semantics. Fails if: it inserts duplicate findings or the confidence differs.

19. **Disclaimer is present and identical in every response** — proves the "no binary safe/toxic" contract: a fixed string accompanies all outputs. Fails if: the disclaimer is conditional on findings, or omitted when no flags exist.

20. **Unrecognized but valid ingredient (resolved, no rule) appears with null flag/severity** — proves that "recognized but unflagged" is distinct from "unknown". Fails if: ingredients without a rule are treated as unknown, or the response omits them.

Now let me also think about what I'm NOT testing:
- HTTP layer / controller validation (we're testing service-level behavior)
- Database connection failures
- Concurrency (two simultaneous publishes) — hard to test deterministically at this level, and the plan says "manual retry is idempotent"
- The actual SQL migration correctness (covered by schema tests implicitly)

Let me format these properly. I'll aim for the most important and distinct cases, making sure each has a clear "what would have to break" condition.

Let me refine and consolidate. Some of these overlap. Let me pick the clearest set:

1. Profile escalates watch→banned (tighten works)
2. Profile does NOT de-escalate (watch stays watch if modifier is lower)
3. Profile adds new flag where no base rule exists (the "add" branch)
4. Unknown ingredient visible with isUnknown:true in findings AND in unknownIngredients array
5. Confidence = 0.8 for 1 unknown of 5 (formula correctness)
6. Confidence clamped to 0 at boundary (≥10 unknowns)
7. OCR typo "gyceryl" → "glycerol" via synonym table
8. Accented/case/whitespace normalization (e.g., "  PHÉNOXYETHANOL  " → phenoxyethanol)
9. Two reruns deep-equal (idempotency + determinism)
10. Shuffled order → same finding set, sorted by position
11. Both versions coexist after publish (v1 unchanged)
12. Publish triggers re-score: new version's results stored for all products with ingredients
13. Re-score idempotent (run twice, same rows)
14. Missing product → ResourceNotFound
15. Missing profile → ResourceNotFound
16. No active version → ResourceNotFound
17. Publishing already-active version → ConflictError
18. Recognized ingredient with no rule: finding present, flag/severity null, NOT in unknownIngredients
19. Disclaimer always present (even with zero findings / zero flags)

That's 19 cases. Let me write them up in the required format.
```

## reply

- Profile escalates a watch finding to banned — proves the tighten-only precedence actually replaces severity, flag, and citation with the modifier's values. Fails if the ordinal comparison is inverted (`>` vs `<`), the modifier is looked up by the wrong key, or the SEVERITY_ORDINAL map has wrong values.
- Profile does NOT de-escalate an existing finding — proves a modifier with a lower ordinal than the base rule leaves the finding untouched. Fails if the code applies the modifier unconditionally, skipping the ordinal guard.
- Profile adds a flag where no base rule exists — proves the "add new" branch: an ingredient recognized by name but absent from the methodology's rules still receives the modifier's flag/severity/citation. Fails if the `hasBaseRule` check gates the add-branch (i.e., modifiers only apply when a rule already exists).
- Unknown ingredient is visible in both `findings` (with `isUnknown: true`) and the top-level `unknownIngredients` array — proves unresolvable raw text is surfaced, not silently dropped. Fails if unknown findings are filtered out of the response, or `isUnknown` is left `false`, or the raw text is lost.
- One unknown among five ingredients yields `overallConfidence` of exactly 0.8 — proves the formula `max(0, 1 − 0.1 × unknownCount)` uses the correct coefficient and counts only unknowns. Fails if the divisor is wrong, known ingredients are counted, or the result is a percentage.
- Ten or more unknowns clamp confidence to 0 — proves the `Math.max(0, …)` floor. Fails if the floor is absent and confidence goes negative.
- Seeded OCR typo "gyceryl" resolves to canonical "glycerol" via the synonym table — proves the normalize-then-lookup path hits the synonym row. Fails if normalization is applied to one side but not the other, or the typo fixture is missing from the seed.
- Accented, mixed-case, extra-whitespace input (e.g. "  PHÉNOXYÉTANOL ") resolves to the canonical form — proves NFD decomposition + combining-mark stripping + lowercasing + whitespace collapse all execute. Fails if any single step is missing from the normalize function.
- Two consecutive `classify` calls on the same product return deep-equal responses — proves idempotency of the stored upsert and determinism of the in-memory logic. Fails if a mutable field (timestamp, array-order instability) leaks into the response, or the upsert creates divergent rows.
- Two products with the same ingredient set in shuffled positions yield identical finding sets sorted by position — proves classification is order-independent and output is stable. Fails if findings are returned in insertion/iteration order rather than `position` order, or logic depends on array index.
- After publishing v2, both v1 and v2 results for a product are retrievable and v1's findings are unchanged — proves the composite key `(product_id, methodology_version_id)` is honoured and re-scoring does not delete prior rows. Fails if the upsert key omits the version, or re-scoring does a delete-then-insert that wipes v1.
- Publishing a new version triggers re-scoring: every product with ≥ 1 ingredient gains a stored result under the new version — proves `rescoreAll` iterates all affected products, not just a subset. Fails if `listWithIngredients` filters incorrectly, or the loop skips products with no matching rules.
- Running `rescoreAll` twice for the same version produces identical stored rows — proves upsert semantics (no duplicate findings, same confidence). Fails if the second run inserts additional finding rows or recomputes a different confidence.
- Classify with a non-existent product id raises `ResourceNotFound` — proves the product-existence guard. Fails if it returns a 200 with an empty findings array, or throws a generic unhandled error.
- Classify with a non-existent profile id raises `ResourceNotFound` — proves the profile-existence guard. Fails if a bad `profileId` is silently ignored and base rules are returned as if no profile was requested.
- Classify when no methodology version is active raises `ResourceNotFound` — proves the active-version guard. Fails if it returns an empty classification, or crashes on a null `getActive()` result.
- Publishing an already-active version raises `ConflictError` — proves the idempotency guard rejects a no-op publish per the API contract. Fails if the check is missing and it silently re-sets `is_active = true` (returning 204 where a 409 is expected).
- A recognized ingredient with no rule in the active methodology appears in findings with `flag: null`, `severity: null`, and is NOT listed in `unknownIngredients` — proves "recognized but unflagged" is distinct from "unknown". Fails if ingredients without a rule are misclassified as unknown, or omitted from the findings array.
- The disclaimer string is present and identical in every response, including one with zero flagged findings — proves the "no binary safe/toxic" contract: the disclaimer is unconditional. Fails if it is conditional on finding count, or omitted when no flags exist.

Deliberately not testing: HTTP/controller-layer validation (wrong body shapes, non-numeric ids), database connection or transaction-rollback behaviour, concurrent publish races (the plan defers this to a manual idempotent retry), and the raw SQL migration file correctness (implicitly covered by every Prisma query executing against it).
