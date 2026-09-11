# Transcript — 07-ingredient-classification / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution-retry

## reasoning

```
Let me carefully parse the task.

What's given to me:
1. Variant A description: a scanner app classifies cosmetics from INCI ingredient lists. Rule sources: regulator's restricted list and a curated watch list. Each entry has a source citation and a severity (banned / restricted / watch). Users maintain family profiles (e.g., under 3, pregnancy) that tighten specific rules.

Requirements:
1. Schema: ingredients + synonyms, rules grouped under immutable methodology versions, products with ingredient lists, stored classification results keyed by (product, methodologyVersion).
2. `classify(productId, profileId?)` — normalizes and resolves each listed ingredient (synonyms, case, accents, common OCR typos via provided synonym fixtures), applies the active methodology's base rules, then the profile's context modifiers with defined priority. Output: per-ingredient findings (flag, severity, source citation), unrecognized ingredients listed as unknown, overall confidence, disclaimer — no binary safe/toxic judgment.
3. Publishing a new methodology version triggers idempotent re-scoring of affected products; previous version results remain retrievable.
4. Tests: a profile flips a finding, an unknown ingredient lowers confidence and is visible, synonym/typo resolution, the same product is identical across re-runs and across shuffled ingredient orders, results from both versions coexist.

2. The L2 spec (Issue #319) — this is the detailed spec. Deliverables:
- Prisma schema for ingredients, synonyms, rules under methodology versions, products, and results keyed by (product, version)
- `classify(productId, profileId?)`
- Re-scoring path
- The above tests
- Write down the modifier priority

Stack: TypeScript, NestJS, Prisma, PostgreSQL. Vitest. ESM. pnpm.

Environment: config from env vars only. `DATABASE_URL` for Postgres.

Now the important constraint: "Synonym and typo fixtures are provided." — but no fixtures are provided in the task text. No files are shown in the codebase. The task says "if files are given above the task, they are the existing codebase" — no files were given. So I'm building from scratch, and I need to invent the fixtures myself with a `// ASSUMPTION` marker.

Wait — "the block above is reference material. Rely on it, never reproduce it, never rewrite it." So I shouldn't reproduce the variant/ladder documents, but I should follow them.

Format: for each file, a level-3 heading containing only the repo-relative path, immediately followed by one fenced block containing only that file's contents. Nothing else may be read outside that pattern.

Let me design the solution.

## File layout (following repo conventions)

```
package.json
tsconfig.json
vitest.config.ts
.env.example (maybe — but "no secrets in the repo"; DATABASE_URL is env config; .env.example is fine but maybe not needed. Task says "don't create files not called for." Hmm. I think package.json and tsconfig are needed for the project to be real. The task says "build the complete solution in a single reply" and "deliver all files the solution needs." So package.json, tsconfig, vitest config, prisma schema, migrations, src files, tests.

The discipline clause: "Do exactly what the task asks. Don't create files not called for, don't improve code you weren't asked to change." — but since no codebase exists, I have to create the entire project. "All files the solution needs" — the complete solution includes package.json, tsconfig, etc. Since no existing repo is shown, I'll include the minimum set of infra files: package.json, tsconfig.json, vitest.config.ts, prisma/schema.prisma, prisma/migrations/... (migrations are called for: "all schema changes ship with migrations"), src files, test files.

Now let me think about whether tests can run without a real Postgres. Vitest tests… Prisma + Postgres. Tests will need a database. Common approach: tests use a real Postgres (via testcontainers or a local DB) — but I don't have tools, so I'll write tests that use the Prisma client directly against `DATABASE_URL`. The test file `test/classification.spec.ts` would use the PrismaClient with DATABASE_URL from the environment. That's standard in this kind of repo: set up the schema via migrations, or `prisma db push`. I'll write the tests assuming Postgres is available at DATABASE_URL (documented in code comments). That's the most defensible reading given "Vitest for tests" and the Postgres requirement. I can note with a `// ASSUMPTION` comment.

Alternatively, mock the repository layer. But the tests need to verify: idempotent re-scoring, version coexistence, determinism — these are best done against the real DB. The repo conventions say "repository is the only layer that touches the database" and "zero Prisma client calls" in services. Tests should test behavior. A full-stack test using PrismaClient for seeding and the NestJS app (or direct service calls) is behavior-focused.

Design decisions:

### Domain model

**MethodologyVersion**: id, name/slug, status (draft/published), createdAt. Immutable once published. Enforce in service: once published, rules cannot be added/changed? "Published versions never change." Enforce in the repository/service: no rule modifications after publication.

**Ingredient**: canonical ingredient. id, canonicalName (unique, normalized form?), inciName. Actually let me think: "ingredients + synonyms." So a canonical ingredient entity (e.g., PARABEN "methylparaben") and synonyms (e.g., "methyl paraben", "metylparaben" OCR typo).

Normalization pipeline:
1. Trim, collapse whitespace.
2. Lowercase, NFD normalize to strip diacritics (accents).
3. Remove punctuation? INCI lists are comma-separated; individual ingredient strings might have things like "(and)"… I'll keep: lowercase, strip accents, trim, collapse whitespace.
4. Look up canonical ingredients by normalized canonical name.
5. Look up synonyms by normalized synonym text.
6. OCR typos: "common OCR typos via provided synonym fixtures" — typos are covered by the synonym fixtures (e.g., "lysolecithin" is a common typo for "lecithin"?). Actual common OCR typos in INCI: "lactid acid" vs "lactic acid"? Classic: "linalool" vs "linaloole"? Hmm. Well-known OCR confusions: 'l' vs 'I', '0' vs 'O', 'rn' vs 'm' (e.g., "geraniol" → "geraniol"? No, that's a substitution). "tocopherol" → "tocophero1"? Let me keep it simple: the fixtures will contain an explicit list of (typo → canonical) pairs. E.g.:
   - "vitamin e" → tocopherol
   - "vit e" → tocopherol
   - "l-ascorbic acid" → ascorbic acid
   - "ascorbyl palmitate" — no, that's a different ingredient.
   Common real-world INCI typos: "aqua" vs "water"; "e200" (E-number) vs "sorbic acid"; "bht" vs "butylated hydroxytoluene"; "bha" vs "butylated hydroxyanisole".

Since fixtures are "provided" but actually absent, I'll create a fixtures file `src/ingredient-classification/fixtures/synonyms.fixture.ts` (or `prisma/seed`-like data) with `// ASSUMPTION` comments indicating the fixture contents are our own. The spec says "synonym and typo fixtures are provided." Since they're missing, I'll create them and mark the assumption.

Where do fixtures go? Rules must come from the database (methodology versions). But synonyms/ingredients can be seeded from fixtures into the DB, or matched in memory. The spec says "normalize and resolve each listed ingredient — case, accents, synonyms, common OCR typos, from the provided synonym fixtures." I think the fixtures should be seed data for ingredients + synonyms in Postgres. That keeps the data model consistent: canonical ingredients + synonyms in the DB, seeded from fixture files. Then `classify` reads them via the repository.

But tests need data — tests would seed via a fixture module. I'll create `src/ingredient-classification/fixtures/ingredients.fixture.ts` exporting canonical ingredients and synonym/typo mappings, and use it both in a seeder (Prisma `prisma/seed.ts`? not called for… hmm, "publishing a new methodology version triggers idempotent re-scoring of affected products" — publishing happens via an endpoint or a service call. Tests will publish via the service).

Simpler: fixtures export typed data; a "bootstrap" service/repository method `seedFromFixtures()` that upserts ingredients, synonyms, rule sets for v1 and v2. Tests call it to set up. This keeps everything behavior-testable and idempotent (upsert).

**Rule**: id, methodologyVersionId, ingredientId (canonical), severity (banned/restricted/watch), source (citation, e.g., "EC 1223/2009 Annex II, entry 13"), note? (developer-facing). Also **modifier** rules: profile context modifiers. How to model "context modifiers that tighten specific rules with defined priority"?

Example: profile "under 3" tightens a "restricted" rule to "banned" or adds a new flag on an ingredient that's otherwise clean. "A profile flips a finding that the base rules alone wouldn't flag" — so a modifier can introduce a new finding (e.g., "fragrance" is clean in the base, but profile under-3 flags it as restricted). And priority: two modifiers hitting the same ingredient must resolve identically — defined priority: severity order banned > restricted > watch; among modifiers of the same severity… hmm, "priority" is probably about which modifier applies when multiple profiles are combined? "The profile's context modifiers — under 3, pregnancy — with priority you define and write down. Two modifiers hitting the same ingredient must resolve identically, so ordering can't be whatever iteration happens to produce."

So: a profile can have multiple modifier entries (or the profile itself is a combination, e.g., a family profile with flags childUnder3 + pregnancy). Priority definition:
1. Start from the base rule severity for the canonical ingredient (if any) in the active methodology version.
2. Apply modifiers: each modifier targets an ingredient (canonical name) and has a profile context (child_under_3 | pregnancy) and a severity.
3. Priority: banned > restricted > watch (highest severity wins). When modifiers of the same severity hit, prefer the more specific context: child_under_3 > pregnancy (write it down and fix the order).

Actually, a cleaner definition: modifiers are evaluated in a fixed, documented order; the resulting severity is the maximum of base and all applicable modifier severities (max severity wins). If the max is a tie, the source citation comes from the rule with the fixed priority: base rule citation is preserved if base is max? Let me define:

**Priority (written down in code comments + a doc file?):**
- Effective severity = max(base severity, applicable modifier severities) where banned=3, restricted=2, watch=1, no rule=0.
- Citation: if max is tied at the base severity, keep the base citation; if a modifier exceeds base, use the highest-priority modifier: child_under_3 before pregnancy (fixed constant order).

This is deterministic regardless of DB iteration order (I'll also sort in the repo by a stable key to be safe).

Where do modifiers live? Under a methodology version too? "The profile's context modifiers — under 3, pregnancy — with priority you define and write down." Modifiers are tied to profiles; but the profile is user data ("users maintain family profiles"). Modifiers define how a profile context tightens rules. I think modifiers belong to the methodology version (they're rule data with citations and severity), keyed by profile context (e.g., `child_under_3`, `pregnancy`). And a Profile (user data) has one or more contexts (e.g., a family profile has flags: childUnder3: true, pregnancy: true).

So:
- **ProfileContext** enum: CHILD_UNDER_3, PREGNANCY.
- **Profile**: id, name, contexts (a list of ProfileContext, e.g., a json array or a separate model). Use a separate model `ProfileContext` (profileId, context) or a Json field. In Prisma, a Json field is easiest: `contexts ProfileContext[]`? With Postgres + Prisma, an enum array: Prisma supports native enum arrays? Not directly — Prisma doesn't support Postgres enum arrays; use a Json column or String[] (does Prisma support String[] on Postgres? Yes, Postgres supports String[] in Prisma). Actually, does Prisma support `String[]` on PostgreSQL? Yes, native arrays of scalar types (String[], Int[]) work on PostgreSQL. I'll use `contexts String[] @default([])`.

- **ProfileModifierRule** (or just "Modifier" as a rule type): id, methodologyVersionId, context (String or enum), ingredientId, severity, source citation. A modifier says: "In methodology version X, for context C, ingredient I has severity S with source."

**Rule model**: to keep it simple, one table `rule` with: id, versionId, ingredientId, severity (String enum: BANNED/RESTRICTED/WATCH), source (citation string), kind: BASE | PROFILE_MODIFIER, context (nullable, only for modifiers). Or two models: `BaseRule` and `ProfileModifier`. One model with kind+context is simpler and fine. Let's go with one model `Rule` with fields: `kind RuleKind (BASE | CONTEXT)`, `context String?`, `severity RuleSeverity (BANNED | RESTRICTED | WATCH)`, `source String`, `ingredientId`, `methodologyVersionId`.

**Product**: id, name, brand?, ingredients — "products with ingredient lists." The order of the ingredient list in the DB matters for the shuffling test: "same product, shuffled ingredient order → identical output." So the stored list has an order (position), and the service must not depend on it. Model `ProductIngredient`: productId, position Int, rawInci String. Unique on (productId, position). Or store as a String[] on Product. A separate table is more normalized and better for the shuffling test (reordering rows). I'll use `ProductIngredient` with a `position`.

**ClassificationResult**: keyed by (productId, methodologyVersionId, profileId?) — wait. The spec says "stored classification results keyed by (product, methodologyVersion)." Re-scoring "into a new row" on publishing. Is the profile part of the key? `classify(productId, profileId?)` — profile is an optional parameter. If a result is keyed only by (product, version), then classifying with different profiles would overwrite. Hmm. "Stored classification results keyed by (product, methodologyVersion)" — I'll take that literally: the stored row's key is (productId, methodologyVersionId). Profile modifiers: classify applies the profile, but where are profiled results stored?

Options:
1. The stored result is the base (no profile) classification; profile is applied in the `classify` output without storing (or stored under a different key).
2. The stored row includes profileId as part of the key (null if none).

The spec's acceptance criteria: "after publishing v2, both v1 and v2 results are retrievable for the same product." The variant says "stored classification results keyed by (product, methodologyVersion)." I'll take it literally: the stored result row's key = (product, version). The profile is applied on read/classify time: `classify(productId, profileId?)` computes base findings from the version's rules, then applies the profile modifiers, and returns findings. Does classify persist? Re-scoring persists results on publish. What does `classify` return — the computed one, or the stored one?

Design: `classify(productId, profileId?)` returns the current classification: load stored result for (product, activeVersion)? No wait — re-scoring happens on publish, so a stored result exists for each product for each published version. `classify` should return the stored result for the active version (so that "old results don't silently change" — the stored row is immutable), then apply profile modifiers on top to produce the response. This fits: "a stored result must remain retrievable as it was." Profile modifiers are deterministic functions; applying them on read is fine. Because the stored base result is immutable and modifiers are part of the same version… hmm, but modifiers are tied to methodology version. If profile modifiers are per-version, applying them at classify time is deterministic given (version, profile).

But wait — should profiled results also be stored? The spec says results are keyed by (product, methodologyVersion). No mention of profile in the key. So: store base results; apply profile at classify time. Let's go with that. But then re-scoring = compute base findings for each product for the new version and store the row. Idempotent: upsert by (productId, versionId).

Actually, is there a need to store the base separately and compute at classify time? Simpler alternative: `classify(productId, profileId?)` always recomputes from the rules and returns, and separately, on publish, persist a stored snapshot keyed by (product, version). "Old results don't silently change" — the stored snapshot is what remains retrievable. The API endpoint for "get result for product+version" returns the stored snapshot. `classify` returns the computed result (which, for the active version, equals the stored one if re-scoring ran).

Hmm, but for strict consistency: stored result = computed result at publish time. classify computes fresh with the active version's rules. Rules within a published version are immutable, so computed == stored. Fine.

But to keep it safe and simple: `classify` reads the stored result for the product's active methodology version (the most recently published), applies profile modifiers, and returns. If no stored result exists for the active version (e.g., product created after publish), compute and store (lazy re-score of that product). This is clean: the stored row is the source of truth, profile is applied in memory.

Actually, I think computing from the rules at classify time and storing on publish is more robust. Let me decide:

**Approach:**
- `methodology.repository`: versions, rules, modifiers.
- `classification.service.classify(productId, profileId?)`:
  1. Resolve the active methodology version (the most recently published).
  2. Load product ingredients (raw strings).
  3. Load canonical ingredients + synonyms (normalized lookup map).
  4. For each raw ingredient: normalize → resolve to canonical or unknown.
  5. Load base rules + context modifiers for the active version.
  6. Per-ingredient findings: base severity/citation; apply modifiers for the profile's contexts by priority (max severity; tie-break by fixed context order).
  7. Unknown ingredients: flag 'unknown', no severity, no citation, counts against confidence.
  8. Confidence: recognized/total, with penalty; defined formula: `confidence = recognized / total` scaled; e.g., 100% when all recognized. Let me define: base confidence 1.0; multiply by (recognized/total). Or `confidence = (recognizedCount / totalCount)` rounded to 4 decimals. If total is 0 → confidence 0? Or 1? Empty product: define confidence 0 with a note? Hmm, "overall confidence reflecting how much of the list we recognized." Empty list — no recognition data; define confidence 0.0? I'd rather 0 with a reason "no ingredients to evaluate." Actually, an empty ingredient list is suspicious (data quality), so low confidence makes sense. Let's go: total = 0 → confidence = 0.
  9. Deterministic ordering: findings sorted by canonicalName (or raw value) ascending — not by input order. The output must be identical even when ingredients are shuffled. So sort findings by a stable key: canonical name, then raw value. Unknowns also in the sorted output.
  10. Disclaimer: fixed string. E.g., "This classification is informational only and is not a safety verdict…" no binary safe/toxic anywhere.
- Stored result row: JSON of the base (no-profile) classification, plus per-ingredient entries. Key (productId, versionId) unique.

**Re-scoring path**: `methodology.service.publish(versionId)`:
- Mark version as published (idempotent: already published → no-op, or error? "Idempotent" is about re-scoring. Publishing the same version twice: second time is a no-op).
- For each product (all products are "affected products"? or only those with ingredients?): compute base classification for that version, upsert the result row. "Re-scoring of affected products" — affected = all products (any product can be affected by new rules). Rescore all products with at least… all products, including empty? Products with zero ingredients: store a row with empty findings, confidence 0? I'll store for all products.
- Idempotent: same rows (upsert by unique (productId, versionId)), deterministic content (same JSON). Running twice → same rows, no duplicates.

Immutability of published versions: `rules` cannot be modified after a version is published — enforce in a repository/service method (`addRule` throws if version is published). Tests might not test this, but the spec says "published versions never change" — enforce in the code path where rules are added (a `methodology.repository.createRule` that checks the version status). Since fixtures seed rules into a draft and then publish, that's consistent.

**Endpoints** (NestJS controller): the spec calls for `classify(productId, profileId?)`, the re-scoring path (publish), and retrievable results. Minimal API:
- `POST /products/:productId/classify?profileId=...` or `GET /products/:productId/classification?profileId=`. Kebab-case plural endpoints per convention: "endpoints: kebab-case, plural." So routes like `/products`, `/classification-results`, `/methodology-versions`.

Endpoints:
- `GET /products/:id/classifications?profileId=` → classify. But "plural, kebab-case" — hmm, `:id` segments are fine. Let me define:
  - `POST /products` — create product with ingredients (needed for tests via API? Tests can use the service directly; but a product-creation endpoint is part of a complete solution. The task asks for: schema, classify, publish+re-score, tests, priority. Endpoints: classify must be exposed (it's an API method). I'll add the minimum:
    - `POST /products` (create with ingredient list)
    - `GET /products/:productId/classifications` (query param profileId optional) → classify
    - `POST /methodology-versions/:versionId/publish` → publish + re-score
    - `GET /products/:productId/classifications/:methodologyVersionId`? For "previous version results remain retrievable": `GET /products/:id/classification-results?methodologyVersionId=` returns stored result. Hmm, two similar routes. Let me make it:
    - `GET /products/:productId/classification-results/:methodologyVersionId`? Or query param. I'll use: `GET /products/:productId/classification-results?methodologyVersionId=v1` returning the stored snapshot (base, no profile). And `GET /products/:productId/classification` returns classify's output (active version + profile).

Wait — maybe I'm overthinking the endpoints. The graded artifacts are: schema, classify, re-scoring, tests, priority. The controller must exist per the layer convention (controller validates input, calls service). I'll implement a minimal but complete set:

`classification.controller.ts`:
- `POST /products` (name, brand?, ingredients: string[])
- `GET /products/:productId/classification?profileId=` → `classify(productId, profileId?)`
- `GET /products/:productId/classification-results` (query `methodologyVersionId`) → stored result
- `POST /methodology-versions/:versionId/publish` → publish
- `GET /profiles/:profileId/classification`? No — profile is a parameter on classify.
- Profile creation: `POST /profiles` (name, contexts: string[]). Needed for tests? Tests will call the service directly, but the API should be complete. I'll include `POST /profiles` and maybe `GET /profiles`. Minimum: `POST /profiles`.

Hmm, "don't create files not called for." But an API solution needs these; the spec's "deliverables" include classify + re-scoring path, which implies endpoints. I'll keep the controller lean.

**Error envelope**: `{ error: { code, message, details } }` — need an exception filter. `src/common/exception-filter.ts`? Convention doesn't specify a common folder, but one envelope is required. I'll add `src/common/all-exceptions.filter.ts` and error codes: `resource_not_found`, `invalid_input`, `conflict` (publishing a version with missing rules?), `methodology_immutable`.

**Confidence**: defined in code: `confidence = recognized / total` (0..1), rounded to 4 decimals? Rounding could differ… no, same input gives same rounding, deterministic. I'll round to 4 decimals for cleanliness. Unknown ingredients lower it — yes: 2 of 4 unknown → 0.5.

**Disclaimer**: constant string, always present.

**Findings shape** (per ingredient):
```ts
{
  raw: "Methyl Paraben",
  canonicalName: "methylparaben" | null,
  status: "flagged" | "unflagged" | "unknown",  // flag
  severity: "banned" | "restricted" | "watch" | null,
  source: string | null,          // citation
  note?: string
}
```
"No binary safe/toxic" — `status: 'unflagged'` is fine (no rule hit), not a "safe" verdict. Maybe `status: "no_rule" | "flagged" | "unknown"`. Use: `flag: null | { severity, source, kind }`? Let me keep it simple: each finding has: `raw`, `canonical` (string|null), `recognized` (bool), `severity` (string|null), `source` (string|null), `flagged` (bool), `modifierApplied`? Hmm. The spec: "per ingredient: flag, severity, source citation." So: `flag` (true/false/unknown?), severity, source. Let me define:

```ts
interface Finding {
  raw: string;
  canonical: string | null;      // resolved canonical name, null if unknown
  flag: 'none' | 'banned' | 'restricted' | 'watch' | 'unknown';
  severity: 'banned' | 'restricted' | 'watch' | null;
  source: string | null;
  matchedVia: 'canonical' | 'synonym' | null; // how it was resolved (nice for debugging)
}
```
Hmm, flag = severity or 'unknown' or 'none'. That encodes the flag. OK.

**Overall result shape:**
```ts
interface ClassificationOutput {
  productId: string;
  methodologyVersion: string;   // e.g., "v1" or id
  profile: string | null;       // profile id or null
  generatedAt: string;          // ISO — wait, determinism! "Classify the same product twice → identical output." A generatedAt timestamp breaks that.
```

Critical: determinism test — two runs must give identical output. If I include a timestamp in the API response, they differ. So: no timestamp in the classify output, or the test ignores it. Safer: exclude `generatedAt` from the output. The stored row has createdAt (DB), but the result JSON payload itself has no timestamp. Actually the stored snapshot content must also be identical across re-runs for idempotency ("same rows"). If the stored JSON has a timestamp, re-score twice → different rows (not idempotent). So: no timestamp in the stored result JSON. The row can have its own `createdAt` column that's not part of the "same row"… hmm, "produces the same rows, not duplicates." I'll interpret "same row" = same key + same payload. To be safe, I'll also avoid timestamp differences: on upsert, don't update `createdAt` if it exists (preserve on conflict). Actually, simplest: `createdAt` on the result table is set on insert, and on conflict, `DO UPDATE SET payload = ...` but keep createdAt. And the payload JSON has no timestamp. The test compares payloads and row count.

Hmm, but the test "same product, two runs → identical output" — if the output includes createdAt, it fails. So the classify output: no timestamp. Stored payload: no timestamp.

**Determinism details**:
- Findings sorted by `canonical ?? raw` — but if two unknown raws share the same normalized key? Sort by raw. Sort key: `[canonical ?? '', raw]` lexicographic, using locale-independent comparison (plain JS `<` on normalized strings — I'll sort by the normalized raw to be accent-insensitive? Plain string compare on `canonical + ' ' + rawNormalized`). Deterministic either way.
- Severity priority is fixed.
- Confidence: pure function.
- JSON key order: I'll build the object with a fixed key insertion order — JSON.stringify on the same-shaped object is stable. The test compares deep equality anyway.

**Normalization function** (`ingredient-normalization.ts` or inside service):
```ts
export function normalizeInci(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
```
Maybe also strip common punctuation like parentheses/commas? INCI: "tocopherol (vitamin e)" — the parenthetical is a synonym. Hmm — that's a real INCI pattern. But scope: fixtures cover synonyms; I'll keep normalization to case/accents/whitespace. OCR typos handled by synonym fixture entries (e.g., 'linallool' → 'linalool'? Let me pick realistic ones).

Wait, "common OCR typos via provided synonym fixtures" — typos are just entries in the synonym fixture. Good, one mechanism: synonym lookup handles both synonyms and typo variants.

**Fixtures** (I'll invent, marked ASSUMPTION). Canonical ingredients and rules:

Let me design rule data that supports all the test scenarios:
1. A profile flips a finding that base wouldn't flag: e.g., ingredient `citral` — base: no rule (unflagged). Modifier: context PREGNANCY, severity RESTRICTED, source "Watch list: endocrine concern in pregnancy." So base: unflagged; with pregnancy profile: flagged restricted.
2. Unknown ingredient: product contains "zinc gluconate" (not in ingredient DB) → unknown, confidence drops.
3. Synonym resolution: product lists "water" → canonical "aqua". And a typo: "parfume" (OCR typo for "fragrance"? Actually "parfum" is INCI for fragrance in some regions). Let me do: "paraben" hmm.

Concrete canonical ingredient set (small but meaningful):
- `aqua` (synonyms: "water", "eau")
- `fragrance` (synonyms: "parfum", "aroma"?)
- `methylparaben` (typo synonym: "methyl paraben" (space), "metylparaben" (OCR typo l→y? hmm "metyl" is a plausible typo))
- `linalool` (synonym/typo: "linaloole"? Let me use "linaloll" as OCR typo? Meh. Real OCR confusion: "linalool" → "linarool" (a/l swap is a known typo). Use "linarool".)
- `tocopherol` (synonyms: "vitamin e", "vit e")
- `citral` (synonym: "lemon grass oil"? no, citral is from lemongrass; synonym: "citral (lemon)"? I'll keep "citral" simple, maybe a synonym "geranyl acetate"? No, different compound. Keep: no synonyms, or "dihydrocitronellal"? no.)
- `hydroquinone` (banned)
- `formaldehyde` (restricted/banned)
- `oxybenzone`?
- `retinyl palmitate` (watch in pregnancy? Real: retinoids are contraindicated in pregnancy — good for the pregnancy modifier)
- `methylchloroisothiazolinone` (watch; under 3: restricted — real: MCI is restricted for under-3 in EU? Actually MCI/MCK are banned for leave-on for under 3 in EU? Something like that.)

Let me pick a small, consistent set:

Canonical ingredients:
1. `aqua` — synonyms: `water`, `eau`
2. `fragrance` — synonyms: `parfum`, `parfume` (OCR typo: 'parfume' → 'fragrance')
3. `methylparaben` — synonyms: `methyl paraben` (spaced), `metylparaben` (OCR typo)
4. `linalool` — synonyms: `linarool` (OCR typo)
5. `tocopherol` — synonyms: `vitamin e`, `vit e`
6. `citral` — synonyms: none (clean under base; restricted in pregnancy modifier)
7. `hydroquinone` — synonyms: `benzoquinol` (real synonym/old name)
8. `methylchloroisothiazolinone` — synonyms: `mci`, `methylchloro isothiazolinone`
9. `retinyl palmitate` — synonyms: `retinol palmitate`? (slightly different but close enough as a fixture), `vitamin a palmitate`

Rules for methodology v1 (BASE):
- `hydroquinone` — BANNED — source "EC 1223/2009 Annex II, 246"
- `formaldehyde`? I didn't include formaldehyde as canonical. Let me add: `formaldehyde` — RESTRICTED — "EC 1223/2009 Annex III, 16"
- `methylparaben` — WATCH — "Curated watch list: paraben review, 2024"
- `linalool` — WATCH — "EU Annex III, 683 (sensitization)"
- `methylchloroisothiazolinone` — RESTRICTED — "EU Annex V, 34 (leave-on ≤0.0015%)"
- `fragrance` — WATCH — "Curated watch list: undisclosed allergens"

Modifiers (CONTEXT) for v1:
- context `child_under_3`, `methylchloroisothiazolinone`, BANNED, "EU: MCI prohibited for under 3 (leave-on)"
- context `child_under_3`, `hydroquinone`? already banned. Maybe under-3 modifier for `fragrance`: RESTRICTED "avoid fragrance under 3."
- context `pregnancy`, `citral`, RESTRICTED, "watch list: avoid high-dose citral in pregnancy"
- context `pregnancy`, `retinyl palmitate`, BANNED? Retinoids in pregnancy: "avoid" — RESTRICTED with source "curated watch list: retinoids and pregnancy." Let me make it RESTRICTED (BANNED is too strong) — fine.
- Also test "two modifiers hitting the same ingredient": under-3 + pregnancy both hit `fragrance`: under-3 RESTRICTED, pregnancy WATCH → max = RESTRICTED, tie-break: child_under_3 before pregnancy (only matters if same severity; if both RESTRICTED, pick child_under_3's citation). I'll add: context `pregnancy`, `fragrance`, WATCH "…". And context `child_under_3`, `fragrance`, RESTRICTED "…". Profile with both contexts → RESTRICTED with under-3 citation (priority: max severity; tie → fixed context order child_under_3, pregnancy).

v2 rules (for the coexistence test): v2 = v1 rules + change: e.g., `methylparaben` from WATCH to RESTRICTED (new regulation), or a new banned ingredient. The coexistence test: a product classified under v1 shows methylparaben as watch; under v2 as restricted. "Both v1 and v2 results are retrievable for the same product" — fetch stored results for both versions.

**Bootstrap/seed**: I'll create a service or repository method to create methodology versions + rules from the fixture. Where? A `fixtures` module exporting data + a `methodology.service.createVersionFromFixture(slug, rules)`? Hmm — simpler: a dedicated `bootstrap.service.ts`? The spec doesn't call for an API to create rule versions… but tests need to seed. The cleanest thing within the layers: `methodology.service` with methods:
- `createVersion(slug, name)` → draft
- `addRule(versionId, ingredientId, severity, source, kind, context?)`
- `publish(versionId)` → publish + re-score all products
And a fixture file exports `buildV1Rules()` etc. Tests: create version, add rules (loop), publish. This is behavior-level seeding. But tests become verbose. Alternatively, a `seed` script + fixture-driven `ingestFixture` method.

Actually, the cleanest way for "fixtures are provided": the fixture is the rule data. A `MethodologyService.seedMethodology(fix)` that ingests a full version (rules included) from the fixture in one call: create version, upsert canonical ingredients/synonyms, add rules, optionally publish. Idempotent via upsert by (versionSlug, ingredient, kind, context) keys.

Let me define the fixture shape:

```ts
export interface RuleFixture {
  ingredient: string;        // canonical name
  severity: RuleSeverity;
  source: string;
  kind: 'base' | 'context';
  context?: ProfileContext;
}
export interface MethodologyFixture {
  slug: string;   // 'v1'
  name: string;
  rules: RuleFixture[];
}
```

And a canonical ingredient fixture:
```ts
export const INGREDIENT_FIXTURE: { name: string; synonyms: string[] }[] = [...]
```

Repository `ingestIngredients(fixture)` upserts canonical + synonyms (synonyms need a unique normalized key across the DB: unique on normalized text, pointing at a canonical ingredient).

**Synonym model**: id, text (original), normalized (unique), ingredientId. Two different canonicals shouldn't share a normalized synonym — enforced by the unique constraint; ingest upserts deterministically.

Wait — should the canonical name itself be a lookup key? Yes: the ingredient's normalized canonical name is also a key. I'll do this in the repository: build the lookup map from both ingredients (normalized canonical name) and synonyms (normalized), in one query. Resolution: normalized raw → if it matches a canonical name → matchedVia 'canonical'; else if it matches a synonym → 'synonym'; else unknown.

Hmm: "methyl paraben" is a synonym of methylparaben; raw "Methyl Paraben" normalizes to "methyl paraben" → synonym match. Raw "methylparaben" → canonical match.

**Priority written down** — where? "The modifier priority is written down" as a deliverable. I'll write it in a code constant with a thorough comment in the classification service, and also in a `README.md`? "Don't create files not called for" — a README is defensible as "writing it down." But the format is mechanically parsed as files; a README.md is a legitimate file. Hmm. Let me write it primarily in the service comment block (that's where the logic lives) — that's the most defensible place; I could also add a short `docs/`… no. Just the comment, and maybe the test name references it. Actually, the deliverable is explicit: "the modifier priority is written down." A comment at the point where the logic lives + a named constant `MODIFIER_PRECEDENCE = ['child_under_3', 'pregnancy']` with a doc comment satisfies this. I'll add a clear, numbered comment block. I think that's right; adding a README risks violating the "don't create files not called for" discipline more than it helps. Hmm, but it is called for: "the modifier priority is written down." A comment block inside the service is "written down." OK.

**Module structure** (single feature "ingredient-classification"? or a feature like "classification" with several controllers). Convention: `src/<feature>/<feature>.module.ts`, `.controller.ts`, `.service.ts`, `.repository.ts`. One feature per file set. I have multiple concerns: products, profiles, methodology, classification. Options: one feature `classification` containing all four (module, controller, service, repository) — the convention implies one controller/service/repository per feature; multiple features would be more files but cleaner. The convention shows `src/<feature>/<feature>.module.ts` etc. I could do:

- `src/classification/classification.module.ts`
- `src/classification/classification.controller.ts`
- `src/classification/classification.service.ts`
- `src/classification/classification.repository.ts`
- Plus a `prisma.service.ts`? Need a Prisma client provider. Convention: repository is the only layer touching the DB. Shared `PrismaService` in `src/common/prisma.service.ts` provided by a `PrismaModule`? That's extra files but standard and necessary (NestJS DI). I'll include `src/common/prisma.service.ts` and `src/common/prisma.module.ts`. Hmm — or put the PrismaService provider in the classification module directly. To keep files minimal but correct: `src/common/prisma.module.ts` (module, global) + `src/common/prisma.service.ts`. Also `src/common/all-exceptions.filter.ts` for the error envelope. Also a normalizer `src/classification/ingredient-normalizer.ts`? A pure function — could live in the service file, but a separate file is fine and testable. Convention names files `<feature>.role.ts`… additional role files like `.normalizer.ts` might break the naming convention? The convention is illustrative, not exhaustive; "TS file: kebab-case.role.ts." `ingredient-normalizer.ts` is kebab-case without a role… Let me put the normalizer function in `classification.repository.ts`? No — normalization is logic, belongs in the service layer. Let me export `normalizeInci` from `classification.service.ts`? Tests import it — fine. Or keep a small helper inside the service file. To keep files minimal, I'll define it as a module-level function in `classification.service.ts`.

Wait — actually, let me reconsider: maybe I should split features for clarity: `products`, `profiles`, `methodology`, `classification`. That's 4 modules/controllers/services/repositories = 16+ files. The repo convention layout shows a generic single feature; the task is one cohesive feature ("ingredient classification"). I'll go with one feature folder `classification` with 4 files (module, controller, service, repository) + fixtures file + common (prisma module/service, exception filter) + app files (main.ts, app.module.ts) + prisma schema + migration + tests + config files (package.json, tsconfig, vitest config). That's a complete, tight solution.

Hmm, but the controller has endpoints for products, profiles, versions, classification — one controller for the whole feature is acceptable (feature = ingredient classification scanner). OK.

**Now, the DB schema (Prisma):**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model MethodologyVersion {
  id        String   @id @default(cuid())
  slug      String   @unique
  name      String
  status    VersionStatus @default(DRAFT)
  publishedAt DateTime?
  createdAt DateTime @default(now())
  rules     Rule[]
  results   ClassificationResult[]

  @@map("methodology_versions")
}

enum VersionStatus { DRAFT PUBLISHED }
```

Prisma enums map to Postgres enums — fine. Or a String field. Enums are fine. But the stored payload uses lowercase severities 'banned' etc.; the enum RuleSeverity { BANNED RESTRICTED WATCH } maps to 'BANNED' in the DB; in the output, map to lowercase. Fine.

```prisma
model Ingredient {
  id        String @id @default(cuid())
  name      String @unique        // canonical name as displayed, e.g., "Methylparaben"
  normalized String @unique       // normalized key
  synonyms  Synonym[]
  rules     Rule[]
  @@map("ingredients")
}

model Synonym {
  id         String @id @default(cuid())
  text       String
  normalized String @unique
  ingredientId String
  ingredient Ingredient @relation(...)
  @@map("synonyms")
}

model Product {
  id          String @id @default(cuid())
  name        String
  brand       String?
  createdAt   DateTime @default(now())
  ingredients ProductIngredient[]
  results     ClassificationResult[]
  @@map("products")
}

model ProductIngredient {
  id         String @id @default(cuid())
  productId  String
  position   Int
  raw        String
  product    Product @relation(fields:[productId], ...)
  @@unique([productId, position])
  @@map("product_ingredients")
}

model Profile {
  id       String @id @default(cuid())
  name     String
  contexts String[] @default([])
  createdAt DateTime @default(now())
  @@map("profiles")
}

model Rule {
  id          String @id @default(cuid())
  versionId   String
  ingredientId String
  kind        RuleKind
  context     String?
  severity    RuleSeverity
  source      String
  version     MethodologyVersion @relation(...)
  ingredient  Ingredient @relation(...)
  @@unique([versionId, ingredientId, kind, context])  // context is nullable — Postgres treats NULL as distinct! Problem with unique including a nullable column.
}
```

Problem: `@@unique([versionId, ingredientId, kind, context])` with nullable context — in Postgres, NULLs are distinct in unique indexes (Postgres 15+ has NULLS NOT DISTINCT but Prisma doesn't expose it). For idempotent ingestion (upsert), I need a deterministic unique key. Options: use a non-null sentinel `context String?` → store `context: ''` for base rules (empty string, non-null). Then the unique constraint works. I'll do that: `context String @default("")` — BASE rules have context "". Cleaner for upsert.

```prisma
model ClassificationResult {
  id          String @id @default(cuid())
  productId   String
  versionId   String
  payload     Json
  createdAt   DateTime @default(now())
  product     Product @relation(...)
  version     MethodologyVersion @relation(...)
  @@unique([productId, versionId])
  @@map("classification_results")
}
```

**Migration**: "all schema changes ship with migrations." I have to provide a migration SQL file: `prisma/migrations/20250101000000_init/migration.sql` (and `migration_lock.toml`). I'll hand-write the SQL to match the Prisma schema. This is required. I need to be careful that the SQL matches what `prisma migrate diff` would generate (not strictly required — but must be valid and consistent).

Let me write the migration SQL:

```sql
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "RuleKind" AS ENUM ('BASE', 'CONTEXT');
CREATE TYPE "RuleSeverity" AS ENUM ('BANNED', 'RESTRICTED', 'WATCH');

CREATE TABLE "methodology_versions" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "methodology_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "methodology_versions_slug_key" ON "methodology_versions"("slug");

CREATE TABLE "ingredients" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalized" TEXT NOT NULL,
  CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ingredients_name_key" ON "ingredients"("name");
CREATE UNIQUE INDEX "ingredients_normalized_key" ON "ingredients"("normalized");

CREATE TABLE "synonyms" (
  "id" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "normalized" TEXT NOT NULL,
  "ingredient_id" TEXT NOT NULL,
  CONSTRAINT "synonyms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "synonyms_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "synonyms_normalized_key" ON "synonyms"("normalized");

CREATE TABLE "products" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "brand" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_ingredients" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "raw" TEXT NOT NULL,
  CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_ingredients_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "product_ingredients_product_id_position_key" ON "product_ingredients"("product_id", "position");

CREATE TABLE "profiles" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "contexts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rules" (
  "id" TEXT NOT NULL,
  "version_id" TEXT NOT NULL,
  "ingredient_id" TEXT NOT NULL,
  "kind" "RuleKind" NOT NULL,
  "context" TEXT NOT NULL DEFAULT '',
  "severity" "RuleSeverity" NOT NULL,
  "source" TEXT NOT NULL,
  CONSTRAINT "rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rules_version_id_fkey" ... REFERENCES "methodology_versions" ON DELETE CASCADE,
  CONSTRAINT "rules_ingredient_id_fkey" ... REFERENCES "ingredients" ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "rules_version_id_ingredient_id_kind_context_key" ON "rules"("version_id", "ingredient_id", "kind", "context");

CREATE TABLE "classification_results" (
  "id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "version_id" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ... FKs ON DELETE CASCADE
);
CREATE UNIQUE INDEX "classification_results_product_id_version_id_key" ON "classification_results"("product_id", "version_id");
```

Also a `migration_lock.toml`: `provider = "postgresql"`.

Prisma 5/6 note: `Json` type → JSONB. Default generator "prisma-client-js" (the prisma 6 default) — I'll use `prisma-client-js` for compatibility.

**Now the service logic.**

`classification.repository.ts` — all Prisma access:

```ts
@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ingredients
  async ingestCanonicalIngredients(entries: {name, synonyms[]}[]): Promise<void>
  async findResolutionMap(): Promise<Map<string, {ingredientId, canonicalName, via: 'canonical'|'synonym'}>>
  // products
  async createProduct(name, brand, ingredients: string[]): Promise<Product>
  async findProduct(id): Promise<Product | null>
  async listProducts(): Promise<Product[]>
  // profiles
  async createProfile(name, contexts: string[]): Promise<Profile>
  async findProfile(id): Promise<Profile | null>
  // methodology
  async createVersion(slug, name): Promise<MethodologyVersion>
  async findVersionBySlug / findById / activeVersion (the latest published by publishedAt desc)
  async markPublished(id): Promise<...>
  async upsertRule(versionId, ingredientName, severity, source, kind, context): upserts rule by unique key (needs ingredient id — resolve first)
  async findRules(versionId): Promise<Rule[]>
  // results
  async upsertResult(productId, versionId, payload)
  async findResult(productId, versionId)
}
```

Hmm — `upsertRule` needs ingredientId; the fixture references by canonical name. Repository method `findIngredientByName(name)`.

Wait, "service: zero Prisma client calls. repository: the only layer touching the DB." OK.

`classification.service.ts`:

```ts
@Injectable()
export class ClassificationService {
  constructor(private readonly repo: ClassificationRepository) {}

  readonly DISCLAIMER = "This output lists which rules fired and where they come from. It is not a safety verdict, and the absence of a flag is not a claim of safety.";

  async classify(productId: string, profileId?: string): Promise<ClassificationOutput> {
    const product = await this.repo.findProduct(productId);
    if (!product) throw new NotFoundException('resource_not_found')...
    let profile = null;
    if (profileId) { profile = await this.repo.findProfile(profileId); if (!profile) throw ... }
    const version = await this.repo.findActiveVersion();
    if (!version) throw new BadGateway/ServiceUnavailable? — "methodology_missing"
    
    // ensure a stored result exists for (product, active version)
    let stored = await this.repo.findResult(product.id, version.id);
    if (!stored) { stored = await this.rescoreProduct(product, version); }
    
    const payload = stored.payload as StoredPayload;
    const findings = applyModifiers(payload.findings, version.rulesContextModifiers, profile?.contexts ?? []);
    return { productId, methodologyVersion: version.slug, profile: profile?.id ?? null, findings, confidence: payload.confidence, disclaimer: DISCLAIMER };
  }
```

Hmm wait — should classify read the stored result or compute? If I compute fresh: base findings come from the current rules of the active version. Since the active version is published and immutable, computing fresh == stored. Reading the stored row demonstrates "results don't change under the reader" and the version-key storage. But a subtle point: the stored result for the active version might not exist for a product created after publish (the lazy path handles it). Let me go with read-stored (with lazy compute) — that directly implements "stored result keyed by (product, version)" and the re-scoring path writes these rows.

Hmm but wait: does classify store a profiled result? No — the profile is applied in-memory; the stored row is base. The output includes the profile id so consumers can see which modifiers were applied.

**Modifier application:**

```ts
// Priority (written down):
// 1. Start from the base severity of the active methodology version.
// 2. A context modifier only raises the severity (banned > restricted > watch); it never lowers it or clears a flag.
// 3. The effective severity is the maximum of the base and all modifiers that apply to the profile's contexts.
// 4. When two or more modifiers tie at the effective severity, the citation comes from the earliest context in MODIFIER_PRECEDENCE = ['child_under_3', 'pregnancy'].
// 5. Modifiers never change a result for an unknown (unresolved) ingredient.
const MODIFIER_PRECEDENCE: string[] = ['child_under_3', 'pregnancy'];
const SEVERITY_RANK = { watch: 1, restricted: 2, banned: 3 };
```

`applyModifiers(findings, modifiers, contexts)`:
- If no contexts, or no modifiers: return findings as-is (map base).
- For each finding with a canonical name and recognized:
  - applicable = modifiers.filter(m => m.ingredient === canonical && contexts.includes(m.context))
  - effective = base severity; best = { severity: base, source: baseSource, context: null }
  - Sort applicable by (rank desc, precedence index asc, ingredient? no) and pick the first that beats current: iterate in that sort order and take the first with rank > current rank → that's the winner (max severity; tie → earliest precedence). Deterministic.
  - Actually cleaner: candidates = [{severity: base, source: baseSource, context: null}, ...applicable]; sort by rank desc, then context precedence (base first? if base and a modifier tie at the same severity — base wins: tie-break order: base (null context) first, then MODIFIER_PRECEDENCE order). Winner = first after sort.

Wait, "a profile flips a finding that the base rules alone wouldn't flag" — base severity null (no base rule), modifier RESTRICTED → flagged. Yes, covered: candidates include base null rank 0; modifier wins.

"Two modifiers hitting the same ingredient resolve identically every time": fixed sort → deterministic. ✓

**Unknown ingredient handling**:
- Finding: { raw, canonical: null, recognized: false, severity: null, source: null, flag: 'unknown' }
- Confidence: recognized/total.

**Confidence definition** (written down in a comment):
`confidence = recognizedCount / totalCount`, rounded to 4 decimals; if total is 0 → 0. Hmm, all recognized → 1.0. 3/4 → 0.75. "Unknown ingredient lowers confidence and is visible" ✓.

**Determinism**: findings are sorted by `[canonical ?? '\uFFFF' + raw?]`… let me define: sortKey = (canonical ?? rawNormalized), secondary raw. Two unknowns with the same raw can't happen (the same raw string — could a product list the same ingredient twice? possible; sort by raw, stable). I'll use: findings.sort((a,b) => (a.sortKey).localeCompare?) — no, localeCompare is locale-dependent (could differ across environments → non-deterministic across hosts). Use plain `a.key < b.key ? -1 : ...` code-unit comparison. Deterministic across runs and platforms. I'll compute the key at build time.

JSON payload: fixed key order in the object literal — same shape every time. ✓

**Re-scoring path**:

```ts
async publish(versionId: string): Promise<{ version, rescored: number }> {
  const version = await this.repo.findVersion(versionId);
  if (!version) throw notFound;
  if (version.status === 'PUBLISHED') return { version, rescored: 0 }? or re-run rescoring idempotently? "Publishing a new methodology version triggers idempotent re-scoring." Re-publishing an already-published version: no-op (idempotent). I'll: if published → return { rescored: 0 } without re-scoring? But "re-scoring must be idempotent: running twice for the same version produces the same rows." — re-scoring twice for the same version (e.g., re-publish call, or an explicit re-score) → same rows. Let me make a separate `rescore(versionId)` service method (idempotent, callable), and `publish` = markPublished + rescore. publish on an already-published version → just rescore again (harmless, idempotent) or no-op. Let me have publish → if DRAFT, mark as published; then always rescore(version). rescore upserts per product → idempotent. This makes publish idempotent overall. Good.
}

async rescore(versionId):
  const version = find; (must exist; draft OK? rescoring a draft is harmless — results keyed by that version; but classify uses active (published) — rescoring a draft is harmless. Allow, but publish is the trigger.)
  for (const product of await repo.listProducts()) {
    const payload = computeBasePayload(product, version);
    await repo.upsertResult(product.id, version.id, payload);
  }
```

`computeBasePayload(product, version)`:
- rawIngredients = product.ingredients sorted by position (DB order)
- resolutionMap = repo.findResolutionMap() — hmm, compute per product or once per rescore? Once per rescore (pass as parameter). classify lazy path also needs it. OK, I'll pass the map.
- rulesByIngredient = group version's base rules by canonical name
- Per raw: normalize → look up map → canonical or unknown; apply base rule (if any) → severity/source
- findings sorted by key
- confidence
- payload = { findings, confidence, recognized, total } — plus a schema version for the payload shape: `schema: 1`.

**Now the API/controller:**

```ts
@Controller()
export class ClassificationController {
  @Post('products') createProduct(@Body() dto)
  @Get('products/:productId/classification') classify(@Param, @Query('profileId')?)
  @Get('products/:productId/classification-results') getResult(@Param, @Query('methodologyVersionId') required)
  @Post('methodology-versions/:versionId/publish') publish
  @Post('profiles') createProfile
  @Get('methodology-versions') list? maybe skip.
}
```

Validation: the controller validates input — for product creation: name is a non-empty string, ingredients is an array of strings (non-empty strings); for profile: name + contexts ⊆ allowed; for classify: profileId is optional string; for result: methodologyVersionId is a non-empty string (slug or id? — let me accept slug for friendliness; the spec says keyed by methodologyVersion — I'll accept a slug and resolve). The controller "validates input and calls the service. Zero business logic." Input shape checks (typeof) in the controller, or a small DTO validation helper. Without class-validator (could add the dep but keep it light), I'll write simple guard checks in the controller that throw BadRequestException with the envelope code via the filter. Hmm — the error envelope is handled by a global exception filter that maps exceptions to `{error:{code,message,details}}`. Let me create custom error classes:

`src/common/api-error.ts`:
```ts
export class ApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly details: Record<string, unknown> = {}) { super(message); }
}
export const Errors = {
  resourceNotFound: (what, id) => new ApiError('resource_not_found', 404, `${what} '${id}' was not found.`, { id }),
  invalidInput: (message, details) => new ApiError('invalid_input', 400, message, details),
  ...
}
```
And a filter `AllExceptionsFilter` implementing `ExceptionFilter`: catch any exception → if ApiError, use it; if HttpException, map (404→resource_not_found? careful: better to always throw ApiError from the controller/service, and treat HttpException as a fallback map: status→code, generic: 400 invalid_input, 404 resource_not_found, 409 conflict, 500 internal_error; others: 500 internal_error). Response: `{ error: { code, message, details } }` with details always an object (default {}).

Services throw ApiError (business logic) — that's fine; the controller just passes through.

**Now, Prisma module/service:**

```ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy { ... }
@Global() @Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

app.module.ts: imports [PrismaModule, ClassificationModule], APP_FILTER provider for the exception filter.

main.ts: create app, listen on PORT env (default 3000). `app.setGlobalPrefix`? No prefix needed.

**Config**: "config only from env vars. DATABASE_URL for Postgres." PrismaClient reads DATABASE_URL via env in the schema. main.ts: `const port = Number(process.env.PORT ?? 3000)`.

**package.json**: deps: @nestjs/common, @nestjs/core, @nestjs/platform-express, @prisma/client, reflect-metadata, rxjs; devDeps: @nestjs/testing, @prisma/client (also dev? no), typescript, ts-node? (not needed if vitest), vitest, prisma, @types/node, @types/express, maybe tsx for the seed. ESM: `"type": "module"`. NestJS + ESM is tricky! NestJS with `"type": "module"` requires specific setup (NestJS 10+ supports ESM with caveats; typically you use `--experimental-specifier-resolution`… hmm). The repo convention says ESM, "type": "module". In this kind of task, the convention is what I should follow. With Vitest + NestJS: tests can use NestFactory.create with the module and override providers. Vitest handles TS + ESM fine. The NestJS app runtime (main.ts) with ESM: NestJS supports ESM from v10/v11 with the `import { NestFactory } from '@nestjs/core'` style — actually NestJS works with ESM if you compile to ESM and import with proper extensions… TypeScript ESM + NestJS requires `"module": "nodenext"` or custom. This can get gnarly.

Given the tests are the graded part (Vitest), I'll write:
- tsconfig: `"module": "NodeNext"` / `"moduleResolution": "NodeNext"`, target ES2022, strict, experimentalDecorators, emitDecoratorMetadata (needed for NestJS DI).

Hmm, emitDecoratorMetadata + ES2022 + NodeNext — works in TS 5.

But ESM imports require file extensions in TS source under NodeNext (`import { X } from './y.service.js'`). That's the standard way for a NestJS ESM repo. Vitest handles `.js`→`.ts` resolution? Vitest (via vite) resolves `./foo.js` to `./foo.ts`? Yes — Vite/Vitest resolves TS-style `.js` specifiers to `.ts` files (it supports the TS ESM convention). I believe Vitest handles this correctly (it maps .js imports to .ts). Yes, vite-node resolves `./x.js` to `./x.ts`.

Alternatively, to reduce risk, tests don't need the HTTP layer at all: instantiate the service directly with the repository wired to a real PrismaClient. That avoids NestFactory in tests. But "controller validates input" — I can test the controller's validation too via a NestJS test app. Keep tests focused on behavior through the service (behavior-level), plus maybe one controller-level check? Spec's test list:
1. A profile flips a finding the base rules alone wouldn't flag
2. An unrecognized ingredient shows up as unknown and confidence drops
3. Synonyms and OCR typos both resolve to the canonical ingredient
4. Same product, two runs → identical output
5. Same product, shuffled ingredient order → identical output
6. After publishing v2, both v1 and v2 results are retrievable for the same product
Plus idempotency of re-scoring ("running twice for the same version produces the same rows") — I'll add a test: rescore twice → same row count + identical payloads.

I'll test through the service (with the real DB via Prisma). This is behavior-level (the output is the behavior). I'll write `test/classification.spec.ts` (convention: `test/<feature>.spec.ts` → `test/classification.spec.ts`).

Test DB: use `DATABASE_URL` env; before all: run `prisma db push`? I can't run it. The test setup will assume migrations are applied (documented in a header comment: `// Requires a PostgreSQL database at DATABASE_URL with the schema applied (pnpm prisma migrate deploy)`). In `beforeAll`, create a clean state: wipe tables (delete in FK order) then seed fixtures. Use `prisma.$executeRawUnsafe('TRUNCATE ... RESTART IDENTITY CASCADE')`? Wiping is a Prisma call in the test — fine (tests are outside the layer constraint? The convention probably applies to src; tests can use prisma directly for seeding).

Seeding in the test: use the fixture-driven service method:
- `svc.ingestIngredientFixtures()` — upserts canonical ingredients + synonyms from the fixture.
- `svc.createMethodologyVersion(slug, name)`, `svc.addRule(...)` — or a single `svc.seedVersion(fix)`. Let me add a service method `seedMethodology(fix: MethodologyFixture)` that upserts a version + rules (idempotent). Tests: `seedMethodology(METHODOLOGY_V1_FIXTURE)`.

Hmm — but is `seedMethodology` part of the product, or a test-only helper? "Rules — from the regulator's restricted list and the curated watch list" — the app must be seeded with rule data somewhere. In the real world, an ops script. A service method that ingests a version from a fixture is a legitimate "load rule data" path (the regulator publishes a version). I'll name it `ingestMethodology(fix)` and also expose a `POST /methodology-versions` endpoint that takes the fixture shape? That might be over-building the API. I'll keep `ingestMethodology` as a public service method (used by tests + an optional endpoint `POST /methodology-versions` that takes a fixture body). That's actually useful and small. Hmm, "don't create files not called for" — the endpoint is in an existing controller; fine.

Actually, let me reconsider — keep the API surface: products (create), profiles (create), methodology-versions (create from body, publish), classification (classify, get stored result). That's a complete CRUD-ish surface. OK.

**Fixture data** — final:

Canonical ingredients (name + synonyms):
1. Aqua — ["water", "eau"]
2. Fragrance — ["parfum", "parfume", "fragrance oil"]
   - "parfume" is the OCR typo entry.
3. Methylparaben — ["methyl paraben", "metylparaben"]
4. Linalool — ["linarool"]
5. Tocopherol — ["vitamin e", "vit e"]
6. Citral — []
7. Hydroquinone — ["benzoquinol"]
8. Methylchloroisothiazolinone — ["mci", "methylchloroisothiazolinon"] (typo missing 'e')
9. Retinyl palmitate — ["retinol palmitate"]
10. Formaldehyde — ["methanal"]

v1 rules (BASE):
- hydroquinone: BANNED, "EC 1223/2009, Annex II, 246"
- formaldehyde: RESTRICTED, "EC 1223/2009, Annex III, 16"
- methylparaben: WATCH, "Curated watch list v1: paraben review pending"
- linalool: WATCH, "EC 1223/2009, Annex III, 683"
- methylchloroisothiazolinone: RESTRICTED, "EC 1223/2009, Annex V, 34"
- fragrance: WATCH, "Curated watch list v1: undisclosed allergens"

v1 CONTEXT modifiers:
- child_under_3 / methylchloroisothiazolinone: BANNED, "EC 1223/2009, Annex V, 34.1 (under 3)"
- child_under_3 / fragrance: RESTRICTED, "Curated watch list v1: fragrance and under 3"
- pregnancy / citral: RESTRICTED, "Curated watch list v1: citral in pregnancy"
- pregnancy / retinyl palmitate: RESTRICTED, "Curated watch list v1: retinoids in pregnancy"
- pregnancy / fragrance: WATCH, "Curated watch list v1: fragrance in pregnancy"
  (this gives the two-modifier-tie-break material: profile with both contexts on fragrance → child_under_3 RESTRICTED beats pregnancy WATCH.)

v2 rules: same as v1 except:
- methylparaben: RESTRICTED (upgraded), source "EC 1223/2009, Annex III, 33 (updated 2025)"
- new base rule: citral: WATCH, "Curated watch list v2: sensitization"
- modifiers same as v1? or add pregnancy/retinyl palmitate BANNED? Let me keep modifiers the same, and add one new: pregnancy / linalool: WATCH? Not necessary. Keep modifiers the same; changes: methylparaben upgrade + citral new watch. The coexistence test: the product has methylparaben → v1 stored: watch; v2 stored: restricted. And citral in a product: v1 base: no flag; v2: watch. Good.

Wait, but v1 already has a pregnancy modifier for citral (RESTRICTED). The v2 base adds a watch for citral — fine, no contradiction (max wins).

**Test scenarios mapping:**

Test 1 (profile flip): product "P-Fragrance-Citral" with ingredients: [Fragrance, Citral, Water]? Base classify (no profile): fragrance WATCH (flagged!), citral unflagged, water unflagged. With pregnancy profile: citral → RESTRICTED (flip: base unflagged → flagged). Assert: base: citral severity null; with pregnancy: severity 'restricted', source watch list. ✓ (The flip = a finding the base rules alone wouldn't flag.) Also check fragrance under both-contexts profile: RESTRICTED with under-3 citation (tie-break test, maybe in a separate assertion/test).

Test 2 (unknown): product with ["Water", "Zinc Gluconate", "Aqua"?] — "zinc gluconate" is not in fixtures → unknown. Compare confidence with and without unknown: e.g., product A: [Water, Tocopherol] → confidence 1. Product B: [Water, Tocopherol, Zinc Gluconate] → 2/3 ≈ 0.6667. Assert: output.findings contains an unknown entry (flag 'unknown', recognized false), and confidence_B < confidence_A. Also unknowns are "visible": listed in the findings (and maybe a top-level `unknownIngredients` list? "unrecognized ingredients listed as unknown" — they're in the findings with flag 'unknown'. Should I also add a convenience field `unknown: string[]`? The spec says "unrecognized ingredients listed as unknown in the output." Findings with flag 'unknown' satisfy it. I'll also include a top-level `unknownIngredients: string[]` for clarity — hmm, extra surface. Keep: findings carry it; I could also add `summary: { total, recognized, unknown }`. Confidence is derived from those counts. I'll include `summary` — helps the test assert visibility. OK: output = { productId, methodologyVersion, profile, findings[], confidence, summary: { total, recognized, unknown }, disclaimer }.

Test 3 (synonym + typo): product ["Water", "Parfume", "Metylparaben", "Vitamin E"] → canonical: aqua, fragrance, methylparaben, tocopherol; all recognized; matchedVia: aqua canonical, fragrance synonym (parfume), methylparaben synonym (metylparaben typo), tocopherol synonym. Assert canonical names + confidence 1.

Test 4 (re-run identical): classify twice, deep equal. ✓ (stored payload + same modifiers → equal; no timestamp in output.)

Test 5 (shuffle): create product with ingredients [A,B,C,D]; create product2 with the same set shuffled; classify both → deep equal findings (and confidence). Even better: mutate the same product's ingredient positions? "Same product with shuffled ingredient list" — same product, re-order the stored list. I'll implement it by creating a second product with shuffled order (the product's list is its data; "same product" = same set of ingredients). Hmm — "same product, shuffled ingredient order" literally: the product's ingredient rows are re-ordered. My service reads ingredients from the DB sorted by position; shuffling positions must not change output. Test: create product, classify; then update positions (swap), classify again → identical. This is the strongest reading. I'll do it in the test with direct prisma updates (a repository method `setProductIngredients(productId, raws)`? — I'll add `replaceProductIngredients` in the repo to reorder). Actually, simpler: `repo.updateProductIngredientPositions(productId, orderedRawList)` — map raw→position. Or just: create two products. Let me add a repository method `reorderProductIngredients(productId, orderedRaws: string[])` used by the test (and maybe an API? no). Hmm, is a repo method for test convenience OK? It's a legitimate operation ("user edits ingredient list"). I'll expose `PUT /products/:id/ingredients`? Over-building… I'll keep the repo method and use it directly from the test. Fine.

Test 6 (version coexistence): seed v1, publish (re-scores product), get result (product, v1) → methylparaben watch. Seed v2, publish, get (product, v2) → restricted; get (product, v1) again → still watch (unchanged). Also idempotency: publish v2 twice → same number of result rows for v2, identical payloads.

Also "previous version results remain retrievable exactly as they were" — compare v1 payload before and after v2 publish: deep equal. ✓

**Active version**: the latest published by publishedAt (or createdAt). Tie → slug? To be deterministic, use `publishedAt desc, createdAt desc, id desc`? Let me do: order publishedAt DESC, then slug? publishedAt precision… set publishedAt = now() on publish. If both v1 and v2 are published at different times, fine. If same millisecond (fast test!), tie. Add secondary sort: version.sequence? Add an integer `sequence` that auto-increments on publish? Simpler: order by `publishedAt DESC, createdAt DESC, id ASC`? cuid ids are not chronological (cuid is time-sortable-ish — cuid() is lexicographically time-sortable! cuid generates ids starting with a time base36 → lexicographic order ≈ chronological). So `createdAt DESC`? createdAt is the draft creation time — v1 created before v2 → v2 is newer → v2 is active. Use order: `publishedAt DESC, createdAt DESC` — deterministic in the test (v1 created and published first, v2 after). If publishedAt is the same ms, createdAt breaks the tie (v2's createdAt > v1's).

Hmm, but createdAt in the payload is… not in the payload. Fine.

Actually — let me make it simpler and more robust: `version.sequence Int @default(0)`? Set sequence = max+1 on publish. Meh, an extra field; I'll go with publishedAt DESC, createdAt DESC.

Wait, one more: the classify "active methodology" — the most recent published. ✓

**Confidence rounding**: `Math.round(x * 10000) / 10000` → 2/3 = 0.6667. Deterministic. ✓

**Sort findings**: key = recognized ? canonical : raw normalized; secondary = raw normalized; tertiary = original raw. Implementation:

```ts
findings.sort((a, b) => {
  const ka = `${a.canonical ?? ''}\u0000${norm(a.raw)}\u0000${a.raw}`;
  const kb = ...;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
});
```
For unknown, canonical '' → sorts before recognized?? '' < anything → unknowns first. Is that OK? Either way, deterministic. Hmm, maybe better to sort unknowns last (a "clean first" read). Use key = recognized ? (canonical) : `\uFFFF${norm(raw)}` → unknowns last, among unknowns alphabetical. Nice: recognized by canonical name, then unknowns alphabetically. Let me define sortKey:
```ts
const sortKey = finding.canonical !== null ? `0\u0000${finding.canonical}` : `1\u0000${norm(finding.raw)}\u0000${finding.raw}`;
```
Deterministic and stable. ✓

**Storing the payload JSON**: payload = { schema: 1, findings, confidence, summary }. Findings entries: { raw, canonical, recognized, severity, source, flag, matchedVia }. flag value: 'unknown' | severity | 'none'. Actually, is `flag` redundant with severity+recognized? flag: unknown → severity null; severity set → flagged; neither → 'none'. I'll keep both (spec: "flag, severity, source citation").

**Now "idempotent" ingestion details**:
- `upsertIngredient(name)`: findUnique by normalized → create if not exists.
- synonyms: upsert by normalized → { update: {}, create: {ingredientId} }. Conflict: a synonym's normalized matches another ingredient's canonical — edge case, ignore (fixture doesn't do this).
- rules: upsert by (versionId, ingredientId, kind, context).
- version: upsert by slug.
- publish: update status → PUBLISHED, publishedAt now (only if DRAFT).
- result: upsert by (productId, versionId) { update: { payload }, create: {...} } — idempotent: same payload → same row. ✓ (createdAt preserved on update.)

**Now let me write all the files.**

File list:
1. `package.json`
2. `tsconfig.json`
3. `vitest.config.ts`
4. `prisma/schema.prisma`
5. `prisma/migrations/20250101000000_init/migration.sql`
6. `prisma/migrations/migration_lock.toml`
7. `src/main.ts`
8. `src/app.module.ts`
9. `src/common/prisma.service.ts`
10. `src/common/prisma.module.ts`
11. `src/common/api-error.ts`
12. `src/common/all-exceptions.filter.ts`
13. `src/classification/classification.module.ts`
14. `src/classification/classification.controller.ts`
15. `src/classification/classification.service.ts`
16. `src/classification/classification.repository.ts`
17. `src/classification/fixtures.ts` (ingredidents + methodology fixtures) — name `classification.fixtures.ts`? The naming convention kebab-case.role.ts… `fixtures` is not a role. Let me put fixtures in `src/classification/fixtures/ingredients.fixture.ts` + `methodology.fixture.ts`? Two files. Hmm. Or a single `src/classification/fixtures.ts`. Let me go with a single `src/classification/fixtures.ts` — a data file; the convention is about role files for module/controller/service/repository. OK.
18. `test/classification.spec.ts`
19. `README.md`? — for the priority… I decided in-code. Hmm, let me reconsider: the deliverable is "the modifier priority is written down." A code comment + a named constant is written down. I'll skip the README. Actually… a small README with how to run + the priority section is purely useful and "called for" by "written down." Risk: "don't create files not called for." The priority is called for; a README is the natural place for "written down" documentation. Let me include a short `README.md` with a stack, setup (migrate, run, test), API, and the priority written down. I think it's defensible and improves compliance with the deliverables. Hmm, the discipline line is strict. But "deliver all files the solution needs" — a compliance product's "written down" priority doc is part of the solution. I'll include it, keeping it terse.

`.env.example` too? "No secrets in the repo" — `.env.example` with `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cosmetics_scanner` is a placeholder, not a secret. Useful for the run instructions. I'll include `.env.example`. OK.

Now — let me think through TS ESM details.

tsconfig.json:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "declaration": false,
    "sourceMap": true,
    "strictPropertyInitialization": true
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```
With NodeNext + type: module, imports in src need `.js` extensions. Vitest: does it resolve `.js` → `.ts`? Yes — Vite's resolver handles TS-style relative imports with `.js` suffixes (it maps to .ts). This is a standard setup for ESM TS projects with Vitest. I'm reasonably confident Vitest handles `import { X } from './classification.service.js'` in a test file. Yes — vite-node has supported this since around 0.34.

package.json:
```json
{
  "name": "cosmetics-scanner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "tsx src/main.ts",
    "test": "vitest run",
    "migrate": "prisma migrate deploy",
    "prisma:generate": "prisma generate"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "@prisma/client": "^5.20.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "prisma": "^5.20.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

Hmm, Nest 10 vs 11 — either is fine. I'll use ^10.4 (stable, well-known). Actually ESM with tsx + Nest 10: works (tsx handles TS ESM). OK.

vitest.config.ts:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
```

Now the Prisma schema — full:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum VersionStatus {
  DRAFT
  PUBLISHED
}

enum RuleKind {
  BASE
  CONTEXT
}

enum RuleSeverity {
  BANNED
  RESTRICTED
  WATCH
}

model MethodologyVersion {
  id          String        @id @default(cuid())
  slug        String        @unique
  name        String
  status      VersionStatus @default(DRAFT)
  publishedAt DateTime?
  createdAt   DateTime      @default(now())
  rules       Rule[]
  results     ClassificationResult[]

  @@map("methodology_versions")
}

model Ingredient {
  id         String    @id @default(cuid())
  name       String    @unique
  normalized String    @unique
  synonyms   Synonym[]
  rules      Rule[]

  @@map("ingredients")
}

model Synonym {
  id           String     @id @default(cuid())
  text         String
  normalized   String     @unique
  ingredientId String
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id], onDelete: Cascade)

  @@map("synonyms")
}

model Product {
  id          String              @id @default(cuid())
  name        String
  brand       String?
  createdAt   DateTime            @default(now())
  ingredients ProductIngredient[]
  results     ClassificationResult[]

  @@map("products")
}

model ProductIngredient {
  id        String  @id @default(cuid())
  productId String
  position  Int
  raw       String
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([productId, position])
  @@map("product_ingredients")
}

model Profile {
  id        String   @id @default(cuid())
  name      String
  contexts  String[] @default([])
  createdAt DateTime @default(now())

  @@map("profiles")
}

model Rule {
  id           String       @id @default(cuid())
  versionId    String
  ingredientId String
  kind         RuleKind
  context      String       @default("")
  severity     RuleSeverity
  source       String
  version      MethodologyVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id], onDelete: Restrict)

  @@unique([versionId, ingredientId, kind, context])
  @@map("rules")
}

model ClassificationResult {
  id        String   @id @default(cuid())
  productId String
  versionId String
  payload   Json
  createdAt DateTime @default(now())
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  version   MethodologyVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@unique([productId, versionId])
  @@map("classification_results")
}
```

Wait: `context String @default("")` — the unique includes context; BASE rules have context "". Good, no NULLs.

**Prisma client ESM import**: `import { PrismaClient } from '@prisma/client'` — works.

Now the repository. Full code:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { normalizeInci } from './classification.service.js'; // circular import! service imports repository, repository imports service.
```

Avoid circular: put `normalizeInci` in a separate small module, or in the repository? Normalization is business logic (service layer). Options: an independent file `src/classification/inci-normalizer.ts` — clean, no circular. Let me do that. Name: `inci-normalizer.ts` (kebab-case). It's a shared pure module used by both service and repository. Acceptable.

Actually — does the repository need normalization? `findResolutionMap` needs normalized keys — those are stored pre-normalized in the DB (normalized column). Ingest needs normalization (to compute the stored normalized key). Yes, the repository (ingest path) uses it. Service uses it to normalize raw inputs. Both import `inci-normalizer.ts`. No circular.

`src/classification/inci-normalizer.ts`:

```ts
/**
 * INCI normalization: lowercase, strip accents, collapse whitespace.
 * Deterministic and pure — the same input always yields the same key.
 */
export function normalizeInci(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_\-.]/g, ' ')?  // hmm — replacing hyphens/dots? "e.g., 'l-ascorbic acid'"…
    .replace(/\s+/g, ' ')
    .trim();
}
```
Be careful: replacing hyphens could wrongly merge things ("sodium-lactate" vs "sodium lactate" — in real INCI, a spaced name is the canonical; "sodium-lactate" isn't standard). Let me keep normalization minimal: NFD strip accents, lowercase, collapse whitespace, trim. No punctuation fiddling (documented). OCR typos are handled via fixture synonyms. OK.

Repository methods (typed):

```ts
@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveVersion() {
    return this.prisma.methodologyVersion.findFirst({
      where: { status: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findVersion(idOrSlug) { findFirst where OR: [{id}, {slug}] }
  async createVersion(slug, name) { upsert by slug: create {slug,name}, update: {} }
  async markVersionPublished(id) { update status PUBLISHED, publishedAt: new Date() }
  async findRulesByVersion(versionId) { findMany orderBy: [ingredientId, kind, context, severity] } // stable order!
  
  async upsertRule(versionId, ingredientName, severity, source, kind, context) {
    const ingredient = await this.upsertIngredient(ingredientName);
    return this.prisma.rule.upsert({
      where: { versionId_ingredientId_kind_context: { versionId, ingredientId: ingredient.id, kind, context } },
      update: { severity, source },
      create: { versionId, ingredientId: ingredient.id, kind, context, severity, source },
    });
  }

  async upsertIngredient(name) {
    const normalized = normalizeInci(name);
    return this.prisma.ingredient.upsert({
      where: { normalized },
      update: {},
      create: { name, normalized },
    });
  }

  async upsertSynonym(ingredientId, text) {
    const normalized = normalizeInci(text);
    return this.prisma.synonym.upsert({
      where: { normalized },
      update: {},
      create: { text, normalized, ingredientId },
    });
  }

  async findResolutionMap(): Promise<Map<string, ResolutionEntry>> {
    const [ingredients, synonyms] = await Promise.all([
      this.prisma.ingredient.findMany({ select: { id: true, name: true, normalized: true } }),
      this.prisma.synonym.findMany({ select: { normalized: true, ingredientId: true, ingredient: { select: { name: true } } } }),
    ]);
    const map = new Map();
    for (const i of ingredients) map.set(i.normalized, { ingredientId: i.id, canonicalName: i.name, matchedVia: 'canonical' });
    for (const s of synonyms) {
      const key = s.normalized;
      if (!map.has(key)) map.set(key, { ingredientId: s.ingredientId, canonicalName: s.ingredient.name, matchedVia: 'synonym' });
    }
    return map;
  }

  async createProduct(name, brand, raws: string[]) {
    return this.prisma.product.create({
      data: { name, brand, ingredients: { create: raws.map((raw, i) => ({ raw, position: i })) } },
    });
  }
  async findProduct(id) { findMany ingredients orderBy position }
  async listProducts() { findMany({ include: { ingredients: orderBy position } }) }
  async reorderProductIngredients(productId, orderedRaws) {
    const existing = await this.prisma.productIngredient.findMany({ where: { productId } });
    await this.prisma.$transaction(orderedRaws.map((raw, position) => {
      const row = existing.find(r => r.raw === raw);
      return this.prisma.productIngredient.update({ where: { id: row.id }, data: { position } });
    }));
  }
  async createProfile(name, contexts) { create }
  async findProfile(id) { findUnique }
  
  async upsertResult(productId, versionId, payload) {
    return this.prisma.classificationResult.upsert({
      where: { productId_versionId: { productId, versionId } },
      update: { payload: payload as Prisma.InputJsonValue },
      create: { productId, versionId, payload: payload as Prisma.InputJsonValue },
    });
  }
  async findResult(productId, versionId) { findUnique }
  async countResults(versionId) { count where versionId }
}
```

`reorderProductIngredients` — edge: orderedRaws must contain exactly the same multiset as the existing rows (assert in service/controller?). Test uses the exact same set. Implementation assumes match; if raw not found → row undefined → crash. Let me guard: if no row, throw? In the repo: `if (!row) throw new Error(...)`? The repo shouldn't throw business errors… but I'll keep the guard with an ApiError from Errors. Fine, or return and let the service validate. Simpler: I'll throw an ApiError('invalid_input') from the service before calling. Hmm, that requires the service to read existing. Meh — I'll keep the guard in the repository with a generic error. Fine.

**Now the service.**

```ts
import { Injectable } from '@nestjs/common';
import { ClassificationRepository } from './classification.repository.js';
import { Errors } from '../common/api-error.js';
import { normalizeInci } from './inci-normalizer.js';
import type { MethodologyFixture } from './fixtures.js';

export const DISCLAIMER =
  'These findings list which rules fired for each ingredient and the source of each rule. ' +
  'They are not a safety verdict: an ingredient without a flag has no rule in this methodology version, ' +
  'which is not the same as being safe.';

/**
 * Modifier priority (written down — the only permitted resolution order):
 * ...
 */
export const MODIFIER_PRECEDENCE: readonly string[] = ['child_under_3', 'pregnancy'];
const SEVERITY_RANK: Record<string, number> = { watch: 1, restricted: 2, banned: 3 };
```

Types:

```ts
export interface Finding {
  raw: string;
  canonical: string | null;
  recognized: boolean;
  flag: 'unknown' | 'none' | 'watch' | 'restricted' | 'banned';
  severity: 'watch' | 'restricted' | 'banned' | null;
  source: string | null;
  matchedVia: 'canonical' | 'synonym' | null;
}

export interface ClassificationSummary { total: number; recognized: number; unknown: number; }

export interface ClassificationOutput {
  productId: string;
  methodologyVersion: string; // slug
  profile: string | null;     // profile id or null
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

interface StoredPayload {
  schema: 1;
  methodologyVersion: string;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
}
```

Service methods:

```ts
@Injectable()
export class ClassificationService {
  constructor(private readonly repo: ClassificationRepository) {}

  async classify(productId: string, profileId?: string): Promise<ClassificationOutput> {
    const product = await this.repo.findProduct(productId);
    if (!product) throw Errors.resourceNotFound('Product', productId);
    let profile = null;
    if (profileId !== undefined) {
      profile = await this.repo.findProfile(profileId);
      if (!profile) throw Errors.resourceNotFound('Profile', profileId);
    }
    const version = await this.repo.findActiveVersion();
    if (!version) throw Errors.methodologyMissing();
    let stored = await this.repo.findResult(product.id, version.id);
    if (!stored) {
      const resolutionMap = await this.repo.findResolutionMap();
      const rules = await this.repo.findRulesByVersion(version.id);
      stored = await this.upsertStoredResult(product, version, resolutionMap, rules);
    }
    const payload = stored.payload as unknown as StoredPayload;
    const modifiers = rules? — need the version's modifiers for application. The stored payload is base only; to apply the profile I need the context modifiers of the version. Fetch: const rules = await this.repo.findRulesByVersion(version.id); const modifiers = rules.filter(r => r.kind === 'CONTEXT');
    const contexts = profile?.contexts ?? [];
    const findings = applyProfileModifiers(payload.findings, modifiers, contexts);
    return {
      productId: product.id,
      methodologyVersion: version.slug,
      profile: profile?.id ?? null,
      findings,
      confidence: payload.confidence,
      summary: payload.summary,
      disclaimer: DISCLAIMER,
    };
  }
```

Wait — subtle: the stored payload is for the active version; if the product was scored under the active version, fine. But what if the active version changed between… No, this is synchronous. OK.

But hmm — the payload stores findings with severity from base rules. applyProfileModifiers maps base findings → effective. Let me define `applyProfileModifiers(findings, modifiers, contexts)`:

```ts
function applyProfileModifiers(findings: Finding[], modifiers: RuleRow[], contexts: string[]): Finding[] {
  const contextsSet = new Set(contexts);
  if (contextsSet.size === 0 || modifiers.length === 0) return findings;
  return findings.map(f => {
    if (!f.recognized || f.canonical === null) return f;
    const candidates: { rank: number; order: number; severity: Severity; source: string; context: string | null }[] = [];
    if (f.severity !== null) candidates.push({ rank: SEVERITY_RANK[f.severity], order: -1, severity: f.severity, source: f.source as string, context: null });
    for (const m of modifiers) {
      if (m.canonicalName !== f.canonical) continue;
      if (!contextsSet.has(m.context)) continue;
      candidates.push({ rank: SEVERITY_RANK[m.severity], order: MODIFIER_PRECEDENCE.indexOf(m.context), severity: m.severity, source: m.source, context: m.context });
    }
    if (candidates.length === 0) return f;
    // Deterministic winner: highest rank; tie → earliest precedence (base is order -1, then MODIFIER_PRECEDENCE index).
    candidates.sort((a, b) => b.rank - a.rank || a.order - b.order);
    const winner = candidates[0];
    return { ...f, flag: winner.severity, severity: winner.severity, source: winner.source, modifierContext: winner.context };
  });
}
```

Wait: tie between base and modifier at the same severity → order -1 (base) wins → base citation kept. Two modifiers with the same severity → earlier precedence index wins. Modifier not in MODIFIER_PRECEDENCE (custom context) → indexOf = -1 → tied with base?? Bug: an unknown context would tie with base (both order -1), and sort is stable? V8's Array.sort is stable, but the input order of candidates = modifiers array order (from DB, sorted by repo's orderBy for stability). Hmm — an unlisted context gets order -1, same as base. To be safe: `order = idx >= 0 ? idx : MODIFIER_PRECEDENCE.length + idxOf?` — simpler: contexts outside the list get `order = MODIFIER_PRECEDENCE.length` (last). Then among unknown-context ties, the stable sort preserves DB order (sorted by context string in the repo → deterministic). Let me do: `const idx = MODIFIER_PRECEDENCE.indexOf(m.context); const order = idx === -1 ? MODIFIER_PRECEDENCE.length : idx;` — all unlisted contexts share `length`, and the stable sort preserves the repo's deterministic order (sorted by context). Good.

Should the output include which modifier was applied? "modifierContext" — helps "can't say why" → we can. But the base payload (stored) doesn't have it; the output has it. Adding a field that's only in the output (not stored) — fine. Add `profileModifier: string | null`? Hmm, keep the output finding shape = stored shape + optional `modifierContext`. For deep-equal re-run test, the output is compared — the same every time. OK, include `modifierContext: string | null` on the output Finding (type: OutputFinding extends Finding { modifierContext: string | null }).

Hmm, actually simpler: include `modifierContext: string | null` on Finding from the start, base value null. Stored payload findings also have modifierContext: null. Uniform shape.

`buildBaseFindings(product, resolutionMap, rules)`:

```ts
private buildBaseFindings(raws: string[], resolutionMap: Map<...>, baseRules: Map<string, {severity, source}>) {
  const findings = raws.map(raw => {
    const key = normalizeInci(raw);
    const hit = key ? resolutionMap.get(key) : undefined;
    if (!hit) return { raw, canonical: null, recognized: false, flag: 'unknown' as const, severity: null, source: null, matchedVia: null, modifierContext: null };
    const rule = baseRules.get(hit.canonicalName); // key by canonical name — or by ingredientId? Map key ingredientId is safer (names are unique anyway). Use canonicalName (unique) — fine.
    return {
      raw,
      canonical: hit.canonicalName,
      recognized: true,
      flag: rule ? rule.severity : 'none',
      severity: rule ? rule.severity : null,
      source: rule ? rule.source : null,
      matchedVia: hit.matchedVia,
      modifierContext: null,
    };
  });
  // deterministic order: recognized by canonical name, then unknowns by normalized raw.
  findings.sort(compareFindings);
  const total = findings.length;
  const recognized = findings.filter(f => f.recognized).length;
  const unknown = total - recognized;
  const confidence = total === 0 ? 0 : Math.round((recognized / total) * 10000) / 10000;
  return { findings, confidence, summary: { total, recognized, unknown } };
}
```

`compareFindings(a,b)`:
```ts
function findingSortKey(f: Finding): string {
  return f.recognized
    ? `0\u0000${f.canonical}\u0000${f.raw}`
    : `1\u0000${normalizeInci(f.raw)}\u0000${f.raw}`;
}
function compareFindings(a: Finding, b: Finding): number {
  const ka = findingSortKey(a); const kb = findingSortKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
```

`upsertStoredResult(product, version, resolutionMap, rules)`:
```ts
const baseRules = groupRules(rules.filter(BASE));
const { findings, confidence, summary } = this.buildBaseFindings(product.ingredients.map(i => i.raw), resolutionMap, baseRules);
const payload: StoredPayload = { schema: 1, methodologyVersion: version.slug, findings, confidence, summary };
return this.repo.upsertResult(product.id, version.id, payload);
```

`rescore(versionId)`:
```ts
async rescore(versionId: string): Promise<{ versionId: string; products: number }> {
  const version = await this.repo.findVersion(versionId);
  if (!version) throw Errors.resourceNotFound('Methodology version', versionId);
  const products = await this.repo.listProducts();
  const resolutionMap = await this.repo.findResolutionMap();
  const rules = await this.repo.findRulesByVersion(version.id);
  for (const product of products) {
    await this.upsertStoredResult(product, version, resolutionMap, rules);
  }
  return { versionId: version.id, products: products.length };
}
```

`publish(versionId)`:
```ts
async publish(versionId: string) {
  const version = await this.repo.findVersion(versionId);
  if (!version) throw notFound;
  const newlyPublished = version.status === 'DRAFT';
  if (newlyPublished) await this.repo.markVersionPublished(version.id);
  const rescore = await this.rescore(version.id);
  return { versionId: version.id, slug: version.slug, newlyPublished, ...rescore };
}
```

`ingestMethodology(fix: MethodologyFixture)`:
```ts
async ingestMethodology(fix) {
  const version = await this.repo.upsertVersion(fix.slug, fix.name);
  for (const rule of fix.rules) {
    await this.repo.upsertRule(version.id, rule.ingredient, rule.severity, rule.source, rule.kind, rule.context ?? '');
  }
  return { versionId: version.id, slug: version.slug, ruleCount: fix.rules.length };
}
```
Should ingestion block published versions (immutability)? "Published versions never change." If the version is already published, upsertRule's update would change it → violation. Enforce: in `ingestMethodology`, if version.status === PUBLISHED && the upsert would change an existing rule → throw conflict. Simplest: if PUBLISHED → throw Errors.methodologyImmutable(slug)? But then re-ingesting the same fixture (idempotent seeding, e.g., test re-runs after wipe — no, the wipe resets to DRAFT). In practice: after wipe, fresh. But "idempotent" ingestion of the same data twice: first creates DRAFT, second time version still DRAFT (unpublished) → fine. If someone re-ingests after publish with identical data — that's a no-op content-wise but my guard would block. For immutability safety, the guard should only block actual changes. Check: for each rule, find existing; if exists and differs → throw; if same → skip. This is "idempotent and immutable": identical re-ingest is a no-op, different → conflict.

Where to enforce — the service (logic) reading the repo. I'll add a repo method `findRule(versionId, ingredientName, kind, context)`? Or have upsertRule return info. Let me add a repo method:
```ts
async findRuleByKeys(versionId, ingredientName, kind, context): Promise<Rule | null> {
  const ingredient = await this.prisma.ingredient.findUnique({ where: { name: ingredientName } });
  if (!ingredient) return null;
  return this.prisma.rule.findUnique({ where: { versionId_ingredientId_kind_context: {...} } });
}
```
And the service:
```ts
for (const rule of fix.rules) {
  const existing = await this.repo.findRuleByKeys(version.id, rule.ingredient, rule.kind, rule.context ?? '');
  if (existing) {
    if (existing.severity !== rule.severity || existing.source !== rule.source) {
      if (version.status === 'PUBLISHED') throw Errors.methodologyImmutable(version.slug, rule.ingredient);
      // draft: allow update (methodology still mutable until publish)
    } else continue; // identical → no-op
  }
  if (version.status === 'PUBLISHED' && !existing) throw Errors.methodologyImmutable(version.slug, rule.ingredient);
  await this.repo.upsertRule(...);
}
```
Good — immutability enforced, idempotency preserved.

`createProduct`, `createProfile`, `getStoredResult(productId, versionIdOrSlug)`:
```ts
async getStoredResult(productId, versionIdOrSlug) {
  const product = find; if (!product) throw;
  const version = await this.repo.findVersion(versionIdOrSlug); if (!version) throw;
  const stored = await this.repo.findResult(product.id, version.id);
  if (!stored) throw Errors.resourceNotFound('Classification result', `${productId} / ${version.slug}`);
  const payload = stored.payload as StoredPayload;
  return { productId, methodologyVersion: version.slug, findings: payload.findings, confidence: payload.confidence, summary: payload.summary, disclaimer: DISCLAIMER };
}
```

**Controller**:

```ts
@Controller()
export class ClassificationController {
  constructor(private readonly classification: ClassificationService) {}

  @Post('products')
  createProduct(@Body() body: unknown) {
    const { name, brand, ingredients } = assertProductInput(body);
    return this.classification.createProduct(name, brand, ingredients);
  }

  @Get('products/:productId/classification')
  classify(@Param('productId') productId: string, @Query('profileId') profileId?: string) {
    return this.classification.classify(productId, profileId || undefined);
  }

  @Get('products/:productId/classification-results')
  getStoredResult(@Param('productId') productId: string, @Query('methodologyVersionId') versionId: string) {
    if (!versionId) throw Errors.invalidInput('methodologyVersionId is required', { field: 'methodologyVersionId' });
    return this.classification.getStoredResult(productId, versionId);
  }

  @Post('profiles')
  createProfile(@Body() body: unknown) {
    const { name, contexts } = assertProfileInput(body);
    return this.classification.createProfile(name, contexts);
  }

  @Post('methodology-versions')
  ingestMethodology(@Body() body: unknown) {
    const fix = assertMethodologyFixture(body);
    return this.classification.ingestMethodology(fix);
  }

  @Post('methodology-versions/:versionId/publish')
  publish(@Param('versionId') versionId: string) {
    return this.classification.publish(versionId);
  }

  @Post('methodology-versions/:versionId/rescore')
  rescore(@Param('versionId') versionId: string) {
    return this.classification.rescore(versionId);
  }
}
```

Input assertions (in the controller, per convention "controller validates input"): small helper functions that validate shape and throw Errors.invalidInput. Write as local functions in the controller file.

ALLOWED_CONTEXTS = ['child_under_3', 'pregnancy'] — validated in createProfile + fixture ingestion (context must be in the list? modifiers with context '' are base; context rules must have a valid context). Validate: kind base → no context; kind context → context ∈ ALLOWED_CONTEXTS.

**api-error.ts**:

```ts
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const Errors = {
  invalidInput(message: string, details: Record<string, unknown> = {}) {
    return new ApiError('invalid_input', 400, message, details);
  },
  resourceNotFound(what: string, id: string, details: Record<string, unknown> = {}) {
    return new ApiError('resource_not_found', 404, `${what} '${id}' was not found.`, { id, ...details });
  },
  methodologyMissing() {
    return new ApiError('no_published_methodology', 503, 'No methodology version has been published yet; nothing to classify against.', {});
  },
  methodologyImmutable(slug: string, ingredient: string) {
    return new ApiError('methodology_immutable', 409, `Methodology version '${slug}' is published and immutable; rule for '${ingredient}' cannot change.`, { slug, ingredient });
  },
};
```

**all-exceptions.filter.ts**:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ApiError } from './api-error.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const { code, status, message, details } = this.resolve(exception);
    response.status(status).json({ error: { code, message, details } });
  }

  private resolve(exception: unknown): { code: string; status: number; message: string; details: Record<string, unknown> } {
    if (exception instanceof ApiError) {
      return { code: exception.code, status: exception.status, message: exception.message, details: exception.details };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : (body as any).message?.toString?.() ?? exception.message;
      const code = this.httpCodeFor(status);
      return { code, status, message, details: {} };
    }
    const message = exception instanceof Error ? exception.message : 'Unexpected error.';
    return { code: 'internal_error', status: 500, message, details: {} };
  }

  private httpCodeFor(status: number): string {
    switch (status) {
      case 400: return 'invalid_input';
      case 404: return 'resource_not_found';
      case 409: return 'conflict';
      default: return 'internal_error';
    }
  }
}
```

`details` is never null: always an object. ✓

**prisma.service.ts**:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> { await this.$connect(); }
  async onModuleDestroy(): Promise<void> { await this.$disconnect(); }
}
```

**prisma.module.ts**:
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

**app.module.ts**:
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PrismaModule } from './common/prisma.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { ClassificationModule } from './classification/classification.module.js';

@Module({
  imports: [PrismaModule, ClassificationModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
```

**classification.module.ts**:
```ts
import { Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller.js';
import { ClassificationService } from './classification.service.js';
import { ClassificationRepository } from './classification.repository.js';

@Module({
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
  exports: [ClassificationService],
})
export class ClassificationModule {}
```

**main.ts**:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
void bootstrap();
```

**fixtures.ts**:

```ts
// ASSUMPTION: the task references provided synonym/typo fixtures; since none were
// attached to this repo, the fixture data below is our own, and shaped to cover
// the required behaviours (synonyms, OCR typos, profile modifiers, version changes).

export type Severity = 'banned' | 'restricted' | 'watch';
export type RuleKind = 'base' | 'context';
export type ProfileContext = 'child_under_3' | 'pregnancy';

export const PROFILE_CONTEXTS: readonly ProfileContext[] = ['child_under_3', 'pregnancy'];

export interface IngredientFixture { name: string; synonyms: string[]; }
export interface RuleFixture { ingredient: string; kind: RuleKind; severity: Severity; source: string; context?: ProfileContext; }
export interface MethodologyFixture { slug: string; name: string; rules: RuleFixture[]; }

export const INGREDIENT_FIXTURES: IngredientFixture[] = [
  { name: 'Aqua', synonyms: ['water', 'eau'] },
  { name: 'Fragrance', synonyms: ['parfum', 'parfume', 'fragrance oil'] }, // 'parfume' is an OCR typo entry
  { name: 'Methylparaben', synonyms: ['methyl paraben', 'metylparaben'] },  // spaced variant + OCR typo
  { name: 'Linalool', synonyms: ['linarool'] },                            // OCR typo (a/l swap)
  { name: 'Tocopherol', synonyms: ['vitamin e', 'vit e'] },
  { name: 'Citral', synonyms: [] },
  { name: 'Hydroquinone', synonyms: ['benzoquinol'] },
  { name: 'Methylchloroisothiazolinone', synonyms: ['mci', 'methylchloroisothiazolinon'] },
  { name: 'Retinyl palmitate', synonyms: ['retinol palmitate'] },
  { name: 'Formaldehyde', synonyms: ['methanal'] },
];

export const METHODOLOGY_V1: MethodologyFixture = {
  slug: 'v1',
  name: 'Methodology v1 (restricted list + watch list, 2025-Q1)',
  rules: [
    { ingredient: 'Hydroquinone', kind: 'base', severity: 'banned', source: 'EC 1223/2009, Annex II, 246' },
    { ingredient: 'Formaldehyde', kind: 'base', severity: 'restricted', source: 'EC 1223/2009, Annex III, 16' },
    { ingredient: 'Methylparaben', kind: 'base', severity: 'watch', source: 'Curated watch list, 2025-Q1: paraben review pending' },
    { ingredient: 'Linalool', kind: 'base', severity: 'watch', source: 'EC 1223/2009, Annex III, 683' },
    { ingredient: 'Methylchloroisothiazolinone', kind: 'base', severity: 'restricted', source: 'EC 1223/2009, Annex V, 34' },
    { ingredient: 'Fragrance', kind: 'base', severity: 'watch', source: 'Curated watch list, 2025-Q1: undisclosed allergens' },
    { ingredient: 'Methylchloroisothiazolinone', kind: 'context', context: 'child_under_3', severity: 'banned', source: 'EC 1223/2009, Annex V, 34.1 (children under 3)' },
    { ingredient: 'Fragrance', kind: 'context', context: 'child_under_3', severity: 'restricted', source: 'Curated watch list, 2025-Q1: fragrance and under 3' },
    { ingredient: 'Citral', kind: 'context', context: 'pregnancy', severity: 'restricted', source: 'Curated watch list, 2025-Q1: citral in pregnancy' },
    { ingredient: 'Retinyl palmitate', kind: 'context', context: 'pregnancy', severity: 'restricted', source: 'Curated watch list, 2025-Q1: retinoids in pregnancy' },
    { ingredient: 'Fragrance', kind: 'context', context: 'pregnancy', severity: 'watch', source: 'Curated watch list, 2025-Q1: fragrance in pregnancy' },
  ],
};

export const METHODOLOGY_V2: MethodologyFixture = {
  slug: 'v2',
  name: 'Methodology v2 (restricted list + watch list, 2025-Q2)',
  rules: [
    ... same base except:
    { ingredient: 'Methylparaben', kind: 'base', severity: 'restricted', source: 'EC 1223/2009, Annex III, 33 (revised 2025-Q2)' },
    { ingredient: 'Citral', kind: 'base', severity: 'watch', source: 'Curated watch list, 2025-Q2: sensitization' },
    ... same modifiers
  ],
};
```

Wait — for v2 to differ, it must be re-stated fully (ingestion upserts; missing rules = no removal, but since we restate all, no issue).

Let me write out v2's rules in full:
- Hydroquinone banned (same)
- Formaldehyde restricted (same)
- Methylparaben RESTRICTED (changed)
- Linalool watch (same)
- Methylchloroisothiazolinone restricted (same)
- Fragrance watch (same)
- Citral watch (new base rule)
- Modifiers: same five as v1.

**Seeding ingredients in tests**: a service method `ingestIngredients(fixtures: IngredientFixture[])`:
```ts
async ingestIngredients(fixtures) {
  let count = 0;
  for (const f of fixtures) {
    const ingredient = await this.repo.upsertIngredient(f.name);
    for (const s of f.synonyms) await this.repo.upsertSynonym(ingredient.id, s);
    count++;
  }
  return { ingredients: count };
}
```
Expose an endpoint `POST /ingredients`? Hmm — canonical ingredient management. Let me keep it a service method only (used by tests/ops). No endpoint (narrowing the API surface). OK.

**Test file** — `test/classification.spec.ts`:

```ts
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ClassificationService } from '../src/classification/classification.service.js';
import { ClassificationRepository } from '../src/classification/classification.repository.js';
import { INGREDIENT_FIXTURES, METHODOLOGY_V1, METHODOLOGY_V2 } from '../src/classification/fixtures.js';

const prisma = new PrismaClient();

function buildService(): ClassificationService {
  const repository = new ClassificationRepository(prisma as unknown as PrismaService)? 
```

Hmm — the repository's constructor expects PrismaService (which extends PrismaClient). If I pass a PrismaClient instance: structurally, the PrismaService type = PrismaClient + lifecycle methods. `new ClassificationRepository(prisma as any)`? Avoid `any` in tests? Strict TS — the test must compile under tsconfig (test is included in tsconfig). I'll do: `const repository = new ClassificationRepository(prisma as unknown as PrismaService);` — import PrismaService. OK.

Setup:
```ts
beforeAll(async () => {
  await wipe();
  const svc = service();
  await svc.ingestIngredients(INGREDIENT_FIXTURES);
  await svc.ingestMethodology(METHODOLOGY_V1);
  await svc.publish('v1');
});

async function wipe() {
  await prisma.$transaction([
    prisma.classificationResult.deleteMany({}),
    prisma.rule.deleteMany({}),
    prisma.synonym.deleteMany({}),
    prisma.productIngredient.deleteMany({}),
    prisma.methodologyVersion.deleteMany({}),
    prisma.profile.deleteMany({}),
    prisma.product.deleteMany({}),
    prisma.ingredient.deleteMany({}),
  ]);
}
```

Tests:

1. **"A profile flips a finding the base rules alone wouldn't flag"**
```ts
it('a profile flips a finding the base rules alone would not flag', async () => {
  const { id: productId } = await svc.createProduct('Citral Lotion', null, ['Water', 'Citral']);
  const base = await svc.classify(productId);
  const citralBase = base.findings.find(f => f.canonical === 'Citral')!;
  expect(citralBase.severity).toBeNull();
  expect(citralBase.flag).toBe('none');

  const { id: profileId } = await svc.createProfile('Pregnancy', ['pregnancy']);
  const withProfile = await svc.classify(productId, profileId);
  const citralFlagged = withProfile.findings.find(f => f.canonical === 'Citral')!;
  expect(citralFlagged.severity).toBe('restricted');
  expect(citralFlagged.flag).toBe('restricted');
  expect(citralFlagged.source).toContain('pregnancy');
  expect(citralFlagged.modifierContext).toBe('pregnancy');
});
```

2. **"Unknown ingredient is listed and lowers confidence"**
```ts
it('an unrecognized ingredient is listed as unknown and lowers confidence', async () => {
  const clean = await svc.createProduct('Known Only', null, ['Water', 'Tocopherol']);
  const dirty = await svc.createProduct('With Unknown', null, ['Water', 'Tocopherol', 'Zinc Gluconate']);
  const a = await svc.classify(clean.id);
  const b = await svc.classify(dirty.id);
  expect(a.confidence).toBe(1);
  const unknown = b.findings.find(f => f.raw === 'Zinc Gluconate')!;
  expect(unknown.recognized).toBe(false);
  expect(unknown.flag).toBe('unknown');
  expect(unknown.canonical).toBeNull();
  expect(b.summary.unknown).toBe(1);
  expect(b.confidence).toBeLessThan(a.confidence);
  expect(b.confidence).toBeCloseTo(2/3, 4)? 
```
Hmm toBeCloseTo(0.6667, 4) — 2/3 rounds to 0.6667 (4 decimals) → Math.round(0.66666... *10000)/10000 = 6667/10000 = 0.6667. toBeCloseTo(0.6667, 4) passes if |diff| < 0.00005 → 0.6667 vs 0.6667 equal ✓. Or expect(b.confidence).toBe(0.6667). Let me use toBe(0.6667) — strict and fine.

Also assert "visible": listed in findings (unknown flag) ✓.

3. **"Synonym and OCR typo both resolve"**
```ts
it('resolves synonyms and OCR typos to canonical ingredients', async () => {
  const { id } = await svc.createProduct('Synonym Sample', null, ['WATER', 'Parfume', 'Metylparaben', 'Vitamin E', 'linarool']);
  const out = await svc.classify(id);
  const byRaw = Object.fromEntries(out.findings.map(f => [f.raw, f]));
  expect(byRaw['WATER'].canonical).toBe('Aqua');
  expect(byRaw['WATER'].matchedVia).toBe('synonym');
  expect(byRaw['Parfume'].canonical).toBe('Fragrance');
  expect(byRaw['Metylparaben'].canonical).toBe('Methylparaben');
  expect(byRaw['Vitamin E'].canonical).toBe('Tocopherol');
  expect(byRaw['linarool'].canonical).toBe('Linalool');
  expect(out.summary.unknown).toBe(0);
  expect(out.confidence).toBe(1);
  // the resolved ingredient carries the canonical's rule
  expect(byRaw['Metylparaben'].severity).toBe('watch');
  expect(byRaw['linarool'].source).toBe('EC 1223/2009, Annex III, 683');
});
```

4. **"Identical across re-runs"**
```ts
it('returns identical output across reruns', async () => {
  const { id } = await svc.createProduct('Rerun Sample', 'Acme', ['Fragrance', 'Water', 'Methylparaben', 'Citral']);
  const first = await svc.classify(id);
  const second = await svc.classify(id);
  expect(second).toEqual(first);
  expect(JSON.stringify(second)).toBe(JSON.stringify(first));
});
```

5. **"Shuffled order → identical"**
```ts
it('returns identical output when the stored ingredient order is shuffled', async () => {
  const raws = ['Fragrance', 'Water', 'Methylparaben', 'Citral', 'Tocopherol'];
  const shuffled = ['Citral', 'Tocopherol', 'Fragrance', 'Methylparaben', 'Water'];
  const { id } = await svc.createProduct('Shuffle Sample', null, raws);
  const before = await svc.classify(id);
  await svc.reorderProductIngredients(id, shuffled);
  const after = await svc.classify(id);
  expect(after).toEqual(before);
});
```
Need a service method `reorderProductIngredients` that wraps the repo. Add to service:
```ts
async reorderProductIngredients(productId: string, orderedRaws: string[]): Promise<void> {
  const product = await this.repo.findProduct(productId);
  if (!product) throw Errors.resourceNotFound('Product', productId);
  await this.repo.reorderProductIngredients(product.id, orderedRaws);
}
```

6. **"v1 and v2 coexist; stored v1 unchanged; re-scoring idempotent"**
```ts
it('keeps v1 and v2 results retrievable and unchanged after publishing v2', async () => {
  const { id } = await svc.createProduct('Dual Version Sample', null, ['Methylparaben', 'Citral', 'Water']);
  // active version is now v1 (v2 not yet published)
  await svc.ingestMethodology(METHODOLOGY_V2);
  await svc.publish('v2');
  const v1 = await svc.getStoredResult(id, 'v1');
  const v2 = await svc.getStoredResult(id, 'v2');
  const v1Methyl = v1.findings.find(f => f.canonical === 'Methylparaben')!;
  const v2Methyl = v2.findings.find(f => f.canonical === 'Methylparaben')!;
  expect(v1Methyl.severity).toBe('watch');
  expect(v2Methyl.severity).toBe('restricted');
  // v1 citral: no base rule → none; v2 citral: watch
  expect(v1.findings.find(f => f.canonical === 'Citral')!.severity).toBeNull();
  expect(v2.findings.find(f => f.canonical === 'Citral')!.severity).toBe('watch');
  // re-publish v2: idempotent — same rows, same payload
  const rowsBefore = await countResultsFor('v2');
  await svc.publish('v2');
  const rowsAfter = await countResultsFor('v2');
  expect(rowsAfter).toBe(rowsBefore);
  const v1Again = await svc.getStoredResult(id, 'v1');
  expect(v1Again).toEqual(v1);
});
```

countResultsFor: `prisma.classificationResult.count({ where: { version: { slug: 'v2' } } })` — via relation: `where: { version: { slug: v2 } }` works in Prisma. ✓

Also a determinism check for the stored payload across re-scores:
```ts
const before = await prisma.classificationResult.findUnique({ where: { productId_versionId: ... } });
```
Simpler: after re-publish, fetch both products' v2 payloads and deep equal with pre-fetch. Let me include: fetch the product's v2 stored payload before re-publish; after re-publish, fetch again; expect equal. I'll do that.

Also — test for "two modifiers hitting one ingredient resolve identically (priority)" — not in the required test list, but the spec asks for the priority to be written down; a test demonstrating the tie-break strengthens it. Add a test:
```ts
it('resolves two modifiers on one ingredient by written precedence', async () => {
  const { id } = await svc.createProduct('Fragrance Sample', null, ['Fragrance', 'Water']);
  const { id: profileId } = await svc.createProfile('Family', ['child_under_3', 'pregnancy']);
  const out = await svc.classify(id, profileId);
  const frag = out.findings.find(f => f.canonical === 'Fragrance')!;
  expect(frag.severity).toBe('restricted'); // child_under_3 (restricted) beats pregnancy (watch)
  expect(frag.source).toContain('under 3');
  expect(frag.modifierContext).toBe('child_under_3');
});
```
This asserts the priority: max severity, tie → child_under_3. Also a tie at same severity: child_under_3 RESTRICTED vs pregnancy RESTRICTED → child citation. My fixtures: fragrance child=restricted, pregnancy=watch — tests max severity, not tie. Add a tie? Retinyl palmitate: child? no child modifier. Add v1 modifier: child_under_3 / retinyl palmitate RESTRICTED "…retinoids and under 3"? Hmm real? Well, fine for a fixture. Then family profile on retinyl palmitate: two RESTRICTED → tie → child_under_3 citation. Let me add that modifier to both v1 and v2 fixtures, and the test:
```ts
const { id: p2 } = await svc.createProduct('Retinol Sample', null, ['Retinyl Palmitate', 'Water']);
const out2 = await svc.classify(p2, profileId);
const ret = out2.findings.find(f => f.canonical === 'Retinyl Palmitate')!;
expect(ret.severity).toBe('restricted');
expect(ret.source).toContain('under 3'); // tie → earlier precedence context
expect(ret.modifierContext).toBe('child_under_3');
```
Good — directly tests the tie-break.

Also test that a profile does not lower a base flag (a modifier only tightens): e.g., a base BANNED hydroquinone with a profile — stays banned. Not required; skip to keep tests focused? "A test that only tries the happy path is worse than no test" — I have plenty of edge cases. Let me keep the suite to ~7 tests.

Now — one issue: **classify uses the active version**; in tests, initially v1 is active (published). After publishing v2, active becomes v2. Test 1 (profile flip) runs before v2 is published (test order). Vitest runs tests in a file sequentially in definition order (without concurrent flag) → deterministic. But test 6 publishes v2; tests 1-5 must run before it. I'll define test 6 last. Also the "re-run" test is fine under either version.

But note: tests 1-5 use the active version v1 — the citral flip requires v1 active (v1 has a citral pregnancy modifier; v2 also has the same modifier + base watch — the flip still works under v2: base watch → pregnancy restricted. The flip test still passes under v2! base citral watch (flagged), pregnancy restricted. "A finding the base rules alone wouldn't flag" — under v2, base already flags citral as watch; pregnancy escalates to restricted. The "flip" (unflagged → flagged) only holds under v1. So test 1 must run before v2 publish, and I'll assert base severity null → requires v1. Ordering matters; vitest is sequential by default. I'll also add explicit ordering safety: in test 1, `const active = await svc.activeVersionSlug()`? No — I'll just define the order and note it. Or make test 1 robust: assert base citral severity is null OR watch?? No — the spec says "a profile flips a finding the base rules alone wouldn't flag." Keep it under v1 (order-first) and assert strictly null. Fine; the file order is the contract.

Hmm, wait, another wrinkle: in test 1, after `svc.createProduct(...)`, classify triggers the lazy stored result under v1 ✓.

**Confidence for products with zero ingredients** — no test; handled in code (0).

**Now, does `classify` include the profile in the determinism test?** Both runs with the same profile → identical ✓ (no timestamp).

**JSON payload typing in Prisma**: `payload Json` — PrismaClient input type: `Prisma.InputJsonValue`. Cast in the repository: `payload as Prisma.InputJsonValue`. Import Prisma namespace from @prisma/client.

**Enum values in TS**: RuleSeverity.BANNED etc. — the service maps to lowercase strings: `severity: rule.severity.toLowerCase() as Severity`. Fine.

**RuleRow shape for modifiers** — the service uses the rules from repo.findRulesByVersion: rows have ingredientId, ingredient.name? Let me include ingredient in findRulesByVersion: `include: { ingredient: { select: { name: true } } }` — wait, the repo returns Prisma rows; the service reads `r.ingredient.name`. OK.

Base rules map keyed by canonical name: `new Map(rules.filter(BASE).map(r => [r.ingredient.name, { severity: lower, source: r.source }]))`.

**Repository `findRulesByVersion` ordering**: `orderBy: [{ ingredientId: 'asc' }, { kind: 'asc' }, { context: 'asc' }]` — deterministic ✓.

**Now, let me carefully write the controller's validation helpers**:

```ts
function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw Errors.invalidInput(`${field} must be a non-empty string.`, { field });
  return value;
}
function assertProductInput(body: unknown): { name: string; brand: string | null; ingredients: string[] } {
  if (typeof body !== 'object' || body === null) throw Errors.invalidInput('Request body must be a JSON object.', {});
  const b = body as Record<string, unknown>;
  const name = asString(b.name, 'name');
  let brand: string | null = null;
  if (b.brand !== undefined && b.brand !== null) brand = asString(b.brand, 'brand');
  if (!Array.isArray(b.ingredients)) throw Errors.invalidInput('ingredients must be an array of INCI strings.', { field: 'ingredients' });
  const ingredients = b.ingredients.map((v, i) => asString(v, `ingredients[${i}]`));
  return { name, brand, ingredients };
}
```
Empty ingredients array allowed? Yes (confidence 0). OK.

Profile:
```ts
function assertProfileInput(body: unknown): { name: string; contexts: string[] } {
  ...
  if (b.contexts !== undefined && b.contexts !== null) {
    if (!Array.isArray(b.contexts)) throw ...;
    const contexts = b.contexts.map((v, i) => asString(v, `contexts[${i}]`));
    for (const c of contexts) if (!PROFILE_CONTEXTS.includes(c)) throw Errors.invalidInput(`Unknown profile context '${c}'. Allowed: ...`, { field: 'contexts', context: c });
  } else contexts = [];
}
```
PROFILE_CONTEXTS imported from fixtures.

Methodology fixture validation:
```ts
function assertMethodologyFixture(body: unknown): MethodologyFixture {
  object; slug = asString(b.slug); name = asString(b.name);
  rules must be array, each: ingredient string, kind 'base'|'context', severity in SEVERITIES, source string, context required for kind context and in PROFILE_CONTEXTS; base → context absent.
}
```
Good — the controller validates; the service re-guards immutability.

SEVERITIES = ['banned','restricted','watch'].

**Now the full service code** — let me write it out.

```ts
import { Injectable } from '@nestjs/common';
import { RuleKind, RuleSeverity } from '@prisma/client';
import { Errors } from '../common/api-error.js';
import { ClassificationRepository, ResolutionEntry } from './classification.repository.js';
import { normalizeInci } from './inci-normalizer.js';
import { INGREDIENT_FIXTURES?, ... } 
```

No — the service doesn't need the fixtures directly (ingest takes a parameter). Types only from fixtures: `import type { IngredientFixture, MethodologyFixture } from './fixtures.js';`

Types in the service file:

```ts
export type Severity = 'banned' | 'restricted' | 'watch';

export interface Finding {
  raw: string;
  canonical: string | null;
  recognized: boolean;
  flag: 'unknown' | 'none' | Severity;
  severity: Severity | null;
  source: string | null;
  matchedVia: 'canonical' | 'synonym' | null;
  modifierContext: string | null;
}
```

Priority constant + comment:

```ts
/**
 * Modifier priority — written down, the only permitted resolution order:
 *
 * 1. Start from the base severity of the ingredient in the active methodology version
 *    (which may be "no rule" — i.e., unflagged).
 * 2. A context modifier may only tighten, never loosen: effective severity = the maximum
 *    of the base severity and all modifiers whose context is present in the profile
 *    (banned > restricted > watch).
 * 3. Ties are broken by fixed context precedence: child_under_3 before pregnancy.
 *    (If the base and a modifier tie, the base citation wins.)
 * 4. Contexts outside the precedence list sort after the listed ones; their relative
 *    order is the deterministic rule-table order.
 * 5. Modifiers never apply to unknown (unresolved) ingredients.
 *
 * Because the winner is chosen by (severity rank, precedence index) and never by array
 * iteration order, two modifiers hitting the same ingredient resolve identically every
 * time.
 */
export const MODIFIER_PRECEDENCE: readonly string[] = ['child_under_3', 'pregnancy'];

const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };
```

`applyProfileModifiers` — implement as a module-level pure function (testable, no DI):

```ts
interface ModifierRow { canonicalName: string; context: string; severity: Severity; source: string; }

export function applyProfileModifiers(findings: Finding[], modifiers: ModifierRow[], contexts: readonly string[]): Finding[] {
  const active = new Set(contexts);
  if (active.size === 0 || modifiers.length === 0) return findings;
  const byIngredient = new Map<string, ModifierRow[]>();
  for (const m of modifiers) {
    if (!active.has(m.context)) continue;
    const list = byIngredient.get(m.canonicalName) ?? [];
    list.push(m);
    byIngredient.set(m.canonicalName, list);
  }
  return findings.map((finding) => {
    if (!finding.recognized || finding.canonical === null) return finding;
    const candidates: { rank: number; order: number; severity: Severity; source: string; context: string | null }[] = [];
    if (finding.severity !== null && finding.source !== null) {
      candidates.push({ rank: SEVERITY_RANK[finding.severity], order: -1, severity: finding.severity, source: finding.source, context: null });
    }
    for (const m of byIngredient.get(finding.canonical) ?? []) {
      const precedence = MODIFIER_PRECEDENCE.indexOf(m.context);
      candidates.push({ rank: SEVERITY_RANK[m.severity], order: precedence === -1 ? MODIFIER_PRECEDENCE.length : precedence, severity: m.severity, source: m.source, context: m.context });
    }
    if (candidates.length === 0) return finding;
    candidates.sort((a, b) => b.rank - a.rank || a.order - b.order);
    const winner = candidates[0];
    return { ...finding, flag: winner.severity, severity: winner.severity, source: winner.source, modifierContext: winner.context };
  });
}
```

Note: findings is returned as-is when no modifiers apply — but for deep-equal tests, same reference vs map — equal either way.

Service class:

```ts
@Injectable()
export class ClassificationService {
  constructor(private readonly repo: ClassificationRepository) {}

  // ---------- data ingestion (ops/tests) ----------
  async ingestIngredients(fixtures: IngredientFixture[]): Promise<{ ingredients: number }> {...}
  async ingestMethodology(fix: MethodologyFixture): Promise<{ versionId: string; slug: string; upserted: number; unchanged: number }> {...}

  // ---------- lifecycle ----------
  async publish(versionIdOrSlug: string) {...}
  async rescore(versionIdOrSlug: string) {...}

  // ---------- products / profiles ----------
  async createProduct(name, brand, ingredients) {...}
  async createProfile(name, contexts) {...}
  async reorderProductIngredients(productId, orderedRaws) {...}

  // ---------- classification ----------
  async classify(productId: string, profileId?: string): Promise<ClassificationOutput> {...}
  async getStoredResult(productId: string, versionIdOrSlug: string): Promise<StoredResultView> {...}
  async findActiveVersionSlug(): Promise<string> {...} // maybe not needed; skip
}
```

`ingestMethodology` details:

```ts
async ingestMethodology(fix: MethodologyFixture) {
  const version = await this.repo.findVersion(fix.slug);
  const existing = version ?? await this.repo.createVersion(fix.slug, fix.name);
  let upserted = 0, unchanged = 0;
  for (const rule of fix.rules) {
    const context = rule.kind === 'context' ? (rule.context ?? '') : '';
    const found = await this.repo.findRuleByKeys(existing.id, rule.ingredient, rule.kind === 'context' ? RuleKind.CONTEXT : RuleKind.BASE, context);
    if (found) {
      if (found.severity === rule.severity && found.source === rule.source) { unchanged++; continue; }
      if (existing.status === 'PUBLISHED') throw Errors.methodologyImmutable(existing.slug, rule.ingredient);
    } else if (existing.status === 'PUBLISHED') {
      throw Errors.methodologyImmutable(existing.slug, rule.ingredient);
    }
    await this.repo.upsertRule(existing.id, rule.ingredient, rule.severity, rule.source, kind, context);
    upserted++;
  }
  return { versionId: existing.id, slug: existing.slug, upserted, unchanged };
}
```

Hmm — `rule.severity` is a lowercase string; found.severity is an enum uppercase. Compare: `found.severity === rule.severity.toUpperCase()`. Let me cast: `found.severity === (rule.severity as RuleSeverity).toUpperCase()`. Simpler: keep rule severity as lowercase in the fixture; compare `found.severity.toLowerCase() === rule.severity`. toLowerCase on the enum string is fine.

`upsertRule(versionId, ingredientName, severityLower, source, kind, context)`:
```ts
async upsertRule(versionId, ingredientName, severity, source, kind, context) {
  const ingredient = await this.upsertIngredient(ingredientName);
  return this.prisma.rule.upsert({
    where: { versionId_ingredientId_kind_context: { versionId, ingredientId: ingredient.id, kind, context } },
    update: { severity: severity as RuleSeverity, source },
    create: { versionId, ingredientId: ingredient.id, kind, context, severity: severity as RuleSeverity, source },
  });
}
```
Hmm, upsertIngredient inside upsertRule: if a rule references an ingredient not in the fixture DB, it auto-creates the canonical. OK for ops convenience.

Wait — `RuleKind`/`RuleSeverity` are imported in the repository from '@prisma/client'. kind parameter typed RuleKind.

**publish**:
```ts
async publish(versionIdOrSlug: string) {
  const version = await this.repo.findVersion(versionIdOrSlug);
  if (!version) throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
  const newlyPublished = version.status === RuleStatus.DRAFT;
  if (newlyPublished) await this.repo.markVersionPublished(version.id);
  const { products } = await this.rescore(version.id);
  return { versionId: version.id, slug: version.slug, newlyPublished, products };
}
```
Import VersionStatus? `import { VersionStatus } from '@prisma/client'` — enum exported. `version.status === VersionStatus.DRAFT` or just 'DRAFT' string compare (the Prisma enum is a string). I'll use the imported enum for clarity.

**rescore**:
```ts
async rescore(versionIdOrSlug: string) {
  const version = await this.repo.findVersion(versionIdOrSlug);
  if (!version) throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
  const [products, resolutionMap, rules] = await Promise.all([
    this.repo.listProducts(),
    this.repo.findResolutionMap(),
    this.repo.findRulesByVersion(version.id),
  ]);
  for (const product of products) {
    await this.upsertStoredResult(product, version, resolutionMap, rules);
  }
  return { versionId: version.id, products: products.length };
}
```

**upsertStoredResult**:
```ts
private async upsertStoredResult(product: ProductWithIngredients, version: { id: string; slug: string }, resolutionMap: Map<string, ResolutionEntry>, rules: RuleRow[]): Promise<StoredRow> {
  const baseRules = new Map<string, { severity: Severity; source: string }>();
  for (const rule of rules) {
    if (rule.kind !== RuleKind.BASE) continue;
    baseRules.set(rule.ingredient.name, { severity: rule.severity.toLowerCase() as Severity, source: rule.source });
  }
  const { findings, confidence, summary } = buildBaseClassification(product.ingredients.map(i => i.raw), resolutionMap, baseRules);
  const payload: StoredPayload = { schema: 1, methodologyVersion: version.slug, findings, confidence, summary };
  return this.repo.upsertResult(product.id, version.id, payload);
}
```

`buildBaseClassification` is a module-level pure function — deterministic; I could unit-test it, but the spec's tests go through the service; still, keeping it pure is nice.

**classify**:
```ts
async classify(productId: string, profileId?: string): Promise<ClassificationOutput> {
  const product = await this.repo.findProduct(productId);
  if (!product) throw Errors.resourceNotFound('Product', productId);
  let profile = null;
  if (profileId) {
    profile = await this.repo.findProfile(profileId);
    if (!profile) throw Errors.resourceNotFound('Profile', profileId);
  }
  const version = await this.repo.findActiveVersion();
  if (!version) throw Errors.noPublishedMethodology();
  const [stored, rules] = await Promise.all([
    this.repo.findResult(product.id, version.id),
    this.repo.findRulesByVersion(version.id),
  ]);
  const finalStored = stored ?? (async () => {
    const resolutionMap = await this.repo.findResolutionMap();
    return this.upsertStoredResult(product, version, resolutionMap, rules);
  })();
  const result = await finalStored;
  const payload = result.payload as unknown as StoredPayload;
  const modifiers: ModifierRow[] = rules
    .filter(r => r.kind === RuleKind.CONTEXT)
    .map(r => ({ canonicalName: r.ingredient.name, context: r.context, severity: r.severity.toLowerCase() as Severity, source: r.source }));
  const findings = applyProfileModifiers(payload.findings, modifiers, profile?.contexts ?? []);
  return {
    productId: product.id,
    methodologyVersion: version.slug,
    profile: profile?.id ?? null,
    findings,
    confidence: payload.confidence,
    summary: payload.summary,
    disclaimer: DISCLAIMER,
  };
}
```

**getStoredResult**:
```ts
async getStoredResult(productId, versionIdOrSlug) {
  const product = await this.repo.findProduct(productId);
  if (!product) throw ...;
  const version = await this.repo.findVersion(versionIdOrSlug);
  if (!version) throw ...;
  const stored = await this.repo.findResult(product.id, version.id);
  if (!stored) throw Errors.resourceNotFound(`Classification result for product '${productId}' under '${version.slug}'`, stored-key);
  const payload = stored.payload as unknown as StoredPayload;
  return {
    productId: product.id,
    methodologyVersion: version.slug,
    findings: payload.findings,
    confidence: payload.confidence,
    summary: payload.summary,
    disclaimer: DISCLAIMER,
  };
}
```
Errors.resourceNotFound signature (what, id) → message `${what} '${id}' was not found.`. Let me restructure: `resourceNotFound(what: string, details: Record<string, unknown> = {})` message built from details? Simpler: `resourceNotFound(message: string, details: Record<string, unknown> = {})`. Let me define:

```ts
resourceNotFound(what: string, id: string, details: Record<string, unknown> = {}) {
  return new ApiError('resource_not_found', 404, `${what} '${id}' was not found.`, { id, ...details });
}
```
For the result: `Errors.resourceNotFound('Classification result', `${productId} / ${version.slug}`)` — message: "Classification result 'p1 / v1' was not found." OK.

**Repository findProduct / listProducts types**:
```ts
export type ProductWithIngredients = Product & { ingredients: ProductIngredient[] };
async findProduct(id: string): Promise<ProductWithIngredients | null> {
  return this.prisma.product.findUnique({ where: { id }, include: { ingredients: { orderBy: { position: 'asc' } } } });
}
async listProducts(): Promise<ProductWithIngredients[]> {
  return this.prisma.product.findMany({ include: { ingredients: { orderBy: { position: 'asc' } } } });
}
```

**reorderProductIngredients**:
```ts
async reorderProductIngredients(productId: string, orderedRaws: string[]): Promise<void> {
  const rows = await this.prisma.productIngredient.findMany({ where: { productId } });
  if (rows.length !== orderedRaws.length) throw Errors.invalidInput('Ingredient list length must not change when reordering.', { count: rows.length });
  const byRaw = new Map(rows.map(r => [r.raw, r.id]));
  const updates = orderedRaws.map((raw, position) => {
    const id = byRaw.get(raw);
    if (!id) throw Errors.invalidInput(`Ingredient '${raw}' not in product.`, { raw });
    return this.prisma.productIngredient.update({ where: { id }, data: { position } });
  });
  await this.prisma.$transaction(updates);
}
```
Hmm, the repo importing Errors — fine (common).

Duplicate raws: the Map overwrites; the test has unique raws. Edge acceptable; guard: duplicate raw with two rows → map keeps the last; updates are mostly correct anyway. Fine.

**Now, "active version" and lazy scoring in classify**: if a product is created after v2 is published and classify → findResult(product, v2) is null → compute + store ✓.

**Now, "idempotent" ingestion details**:
- `upsertIngredient(name)`: findUnique by normalized → create if not exists.
- synonyms: upsert by normalized → { update: {}, create: {ingredientId} }.

**Migration SQL** — let me carefully write to match the Prisma schema (Prisma 5 style):

```sql
-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "RuleKind" AS ENUM ('BASE', 'CONTEXT');
CREATE TYPE "RuleSeverity" AS ENUM ('BANNED', 'RESTRICTED', 'WATCH');

-- CreateTable
CREATE TABLE "methodology_versions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "methodology_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ingredients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "synonyms" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,

    CONSTRAINT "synonyms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_ingredients" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "raw" TEXT NOT NULL,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contexts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "kind" "RuleKind" NOT NULL,
    "context" TEXT NOT NULL DEFAULT '',
    "severity" "RuleSeverity" NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "classification_results" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classification_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "methodology_versions_slug_key" ON "methodology_versions"("slug");
CREATE UNIQUE INDEX "ingredients_name_key" ON "ingredients"("name");
CREATE UNIQUE INDEX "ingredients_normalized_key" ON "ingredients"("normalized");
CREATE UNIQUE INDEX "synonyms_normalized_key" ON "synonyms"("normalized");
CREATE UNIQUE INDEX "product_ingredients_product_id_position_key" ON "product_ingredients"("product_id", "position");
CREATE UNIQUE INDEX "rules_version_id_ingredient_id_kind_context_key" ON "rules"("version_id", "ingredient_id", "kind", "context");
CREATE UNIQUE INDEX "classification_results_product_id_version_id_key" ON "classification_results"("product_id", "version_id");

-- AddForeignKey
ALTER TABLE "synonyms" ADD CONSTRAINT "synonyms_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rules" ADD CONSTRAINT "rules_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rules" ADD CONSTRAINT "rules_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

migration_lock.toml:
```toml
# Please do not edit this file manually
provider = "postgresql"
```

Now — the test's `wipe()` runs TRUNCATE in a transaction via deleteMany — order respects FKs: delete results, rules, synonyms, product_ingredients, versions, profiles, products, ingredients. Rules reference version+ingredient ✓; results reference product+version ✓. A $transaction array of 8 deleteMany — fine.

**Prisma in tests**: `new PrismaClient()` — needs DATABASE_URL env. Add a comment at the top of the test file: `// Requires DATABASE_URL pointing at a PostgreSQL database with the schema applied (pnpm prisma migrate deploy).` And in the README.

Also, in beforeAll, if DATABASE_URL is missing → PrismaClient will fail on connect. Add an explicit check in the test:
```ts
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must point at a PostgreSQL database with the schema applied');
```
Good, with a clear failure message.

**afterAll**: `await prisma.$disconnect();`

**Service instance in tests**:
```ts
function buildService(): ClassificationService {
  const repository = new ClassificationRepository(prisma as unknown as PrismaService);
  return new ClassificationService(repository);
}
let svc: ClassificationService;
beforeAll(async () => { svc = buildService(); ... });
```
Or build fresh per test (same prisma). I'll build once in beforeAll.

Importing PrismaService in the test is just for the cast — fine.

**Re-check: `findActiveVersion` orderBy publishedAt desc — v1 published first, v2 later. In tests, both publishedAt are set at publish time; v2 later (different ms? possibly same ms if fast!). If same ms, tie → secondary createdAt desc: v2's createdAt (draft creation) is later than v1's ✓ (v1 created before v2). Deterministic ✓.

But subtle: the order of tests — test 6 publishes v2. Tests before that have v1 as active ✓.

**Also note: `rescore` for v1 on publish** scores all products existing at that time. Products created later get lazy scoring on classify. getStoredResult for a v1 product created after v2: classify under v2 is lazy-stored; getStoredResult(product,'v1') → not found → 404. Is that OK per spec? "Re-scoring of affected products" — products that existed at publish time. A new product has no v1 result (v1 is no longer active; you could argue it should be scored under the active v2). The coexistence test uses a product created before v2 publish → has both. ✓ Spec is satisfied.

Hmm — should rescore on v2 publish also score products that already have a v1 result? Yes — listProducts = all products ✓.

**Now, the README**:

```md
# cosmetics-scanner

Classifies cosmetics from INCI ingredient lists against versioned, cited rules.
Stack: TypeScript (strict, ESM), NestJS, Prisma, PostgreSQL, Vitest, pnpm.

## Setup
...
## API
...
## Modifier precedence (written down)
...
## Notes on confidence
...
```
Keep it terse.

`.env.example`:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/cosmetics_scanner?schema=public"
PORT=3000
```

**Now — let me double-check layer compliance:**
- Controller: validation only, calls service ✓ (assertions are validation).
- Service: logic, no prisma calls ✓ (all DB via repository).
- Repository: prisma only ✓. Uses Errors for invalid reorder input — fine (still repository; throwing errors is allowed; no business logic beyond data access… the length check is arguably validation — move to service? Service would need to fetch the existing rows first — the repo's findProduct already returns them! In reorder: the service fetches the product (with ingredients), validates length and set match, then calls the repo with orderedRaws (which updates positions). Let me do that: service validation:
```ts
async reorderProductIngredients(productId, orderedRaws) {
  const product = await this.repo.findProduct(productId);
  if (!product) throw notFound;
  const existing = product.ingredients.map(i => i.raw).sort();
  const wanted = [...orderedRaws].sort();
  if (JSON.stringify(existing) !== JSON.stringify(wanted)) throw Errors.invalidInput('Reordering must use exactly the same ingredient list.', ...);
  await this.repo.reorderProductIngredients(product.id, orderedRaws);
}
```
Then the repo just maps raw→position and updates (with a defensive lookup). ✓ cleaner layering.

**The repository's findResolutionMap returns a Map** — the repository returns a Map (in-memory structuring of DB data, fine).

**Type exports**: the repository exports `ResolutionEntry`. The service imports the type.

**Now — TS strict details**:
- `payload as unknown as StoredPayload` — Prisma's Json value is typed `Prisma.JsonValue` → double cast needed ✓.
- `profile?.contexts ?? []` — contexts is string[] ✓.
- Prisma enum import: `import { Prisma, RuleKind, RuleSeverity, VersionStatus } from '@prisma/client';`
- In the repository, `kind: RuleKind` parameter.

**`findRuleByKeys`** signature: `(versionId, ingredientName, kind: RuleKind, context: string)`.

**Let me re-check `upsertResult`'s idempotency**: upsert update {payload} — if the payload is the same, the row is unchanged (updatedAt? I don't have updatedAt; createdAt is preserved; the payload column is set to the same JSONB — the row is identical) ✓ "same rows, not duplicates" ✓.

**Determinism of `buildBaseClassification`**: findings are sorted by sortKey; confidence is pure; summary is pure ✓. No Date.now(), no random ✓. cuid only for DB ids (not in the payload) ✓.

**One more consideration — classify output `methodologyVersion`**: the slug (e.g., 'v1'). And the stored row's key is versionId internally; the API surfaces the slug. Fine; maybe include both? Keep slug for readability; the id is available via the versions endpoint… there's no versions list endpoint. Add `GET /methodology-versions`? Small and useful (regulatory wants to see versions). Add a list endpoint: returns [{id, slug, name, status, publishedAt}]. Hmm — is it called for? "Old results must remain retrievable" needs knowing the version slugs — a list endpoint helps. I'll include `GET /methodology-versions` (thin). And a service `listVersions()`. OK.

Actually — scope discipline. Endpoints included: products POST; profiles POST; methodology-versions GET (list), POST (ingest), POST :id/publish, POST :id/rescore; products/:id/classification GET; products/:id/classification-results GET. That's a coherent minimal API. OK.

**Route style**: no global prefix. Kebab-case plural ✓ ('methodology-versions', 'classification-results').

**Now the filter's `getResponse()` typing**: `ctx.getResponse<Response>()` — import type { Response } from 'express'. ✓

**Nest + ESM + decorators**: with tsx runtime, Nest 10 works with ESM (NestJS 10 officially supports ESM). main.ts imports 'reflect-metadata' first ✓ (also needed in the test file before Nest imports — I import the service directly, no NestFactory; but decorators on the class need reflect-metadata? @Injectable decorator runs at class definition time; reflect-metadata is needed for metadata APIs — the Nest decorator calls Reflect.defineMetadata — it works if reflect-metadata is imported. Import 'reflect-metadata' at the top of the test file. Actually, do I use NestFactory in the test? No. But ClassificationService/Repository have @Injectable() — imported from @nestjs/common — the decorator runs fine. Keep the reflect-metadata import to be safe.)

Hmm — actually, is `@Injectable()` needed if not using DI? Convention requires these to be NestJS providers; keep the decorator ✓.

**Vitest + decorators + isolatedModules?** Not enabled. TS with emitDecoratorMetadata under vitest (esbuild): esbuild supports experimentalDecorators via tsconfig; esbuild historically didn't emit design:type metadata?? Vitest uses esbuild for TS transform — does esbuild support `experimentalDecorators` and emit decorator metadata? esbuild supports experimental decorators and reads tsconfig; it does not emit decorator metadata (design:type) — esbuild ignores emitDecoratorMetadata? Let me think. esbuild: "experimentalDecorators supported since 0.21"? Actually esbuild has supported TypeScript experimental decorators for a while, and with experimentalDecorators enabled, it does emit `__decorateClass` calls, and also supports `emitDecoratorMetadata`?? The esbuild docs: "esbuild supports experimentalDecorators and emitDecoratorMetadata." Hmm — I recall that esbuild added decorator metadata support around v0.16? Let me think: NestJS + Vitest is a very common combo and works — because Nest can fall back: when design:type metadata is missing, NestJS uses the explicit `@Inject()` or constructor parameter tokens… actually, NestJS DI: constructor parameter types come from `Reflect.getMetadata('design:paramtypes')`. Without it, Nest can't resolve the type → error "Nest can't resolve dependencies" unless @Inject is used or the token is explicit.

Vitest + NestJS: the common practice is to work — because esbuild has supported emitDecoratorMetadata since 0.14.x? I think esbuild now supports it (docs mention "decorator metadata" support). Let me recall: esbuild changelog v0.15.13? There was a PR "Add support for emitDecoratorMetadata" — yes, esbuild supports emitDecoratorMetadata (I'm fairly confident modern esbuild does; vite 5 uses esbuild ≥ 0.18). Also, NestJS docs mention Vitest as a supported test runner for Nest apps (NestJS docs' testing section uses Jest, but the community widely uses Vitest with Nest without issue). I'll proceed; and as a safety net, in the test I construct the service manually (`new ClassificationService(new ClassificationRepository(prisma))`) — no DI container at all! So decorator metadata is irrelevant for the test. The runtime app (main.ts via tsx) uses NestFactory — tsx also uses esbuild… if tsx doesn't emit metadata, the app boot would fail DI. Hmm. tsx docs: tsx supports "full TypeScript features including… decorators and decorator metadata"? tsx = esbuild + loader; esbuild supports emitDecoratorMetadata (I'm now fairly confident esbuild does — it's in the docs: "esbuild implements emitDecoratorMetadata"). Yes — esbuild README lists `experimentalDecorators` and `emitDecoratorMetadata` as supported. OK, good.

Alternatively, avoid the risk: use explicit `@Inject()` tokens? No — keep the standard constructor DI; esbuild handles it.

**Another design check — "results from the previous version remain retrievable" via API**: `GET /products/:productId/classification-results?methodologyVersionId=v1` ✓ returns the stored base payload (no profile). Good — the stored row is exactly what was computed at publish time.

**Now, does `classify`'s output equal the stored payload (with profile=null)?** Output includes `profile: null`, `methodologyVersion`, `productId`, disclaimer — a superset of the stored payload. Fine.

**Deep equal in the re-run test**: `expect(second).toEqual(first)` ✓.

**Also consider**: the test "same product, two runs → identical output" — the first classify lazily stores; the second reads the stored. Both produce identical findings (base from stored + modifiers) ✓. But note: on the first run, the lazy path uses `rules` fetched in parallel; on the second run, the stored payload is used. The stored payload was built from the same rules + resolution map → identical findings ✓.

Edge: the resolution map changes between the two runs (a new synonym ingested)? Not in the test.

**Potential issue**: in classify, if `stored` is null, I call `this.upsertStoredResult(product, version, resolutionMap, rules)` — `rules` already fetched ✓.

**Confidence: 4-decimal rounding** — 1/1 = 1 → toBe(1) ✓. 2/3 → 0.6667 ✓.

**Unknown 'Zinc Gluconate'**: normalizes to 'zinc gluconate' — no canonical/synonym → unknown ✓. Note: 'zinc gluconate' is not in the fixture ✓.

**'WATER' → 'water' → synonym of Aqua** ✓ (lowercase).
**'Metylparaben' → 'metylparaben'** synonym ✓.
**'Vitamin E' → 'vitamin e'** ✓.
**'linarool'** ✓.
**'Parfume'** → 'parfume' synonym of Fragrance ✓ (typo entry).

**Canonical display names**: 'Aqua', 'Fragrance', 'Methylparaben', 'Linalool', 'Tocopherol', 'Citral', 'Hydroquinone', 'Methylchloroisothiazolinone', 'Retinyl palmitate', 'Formaldehyde'. Tests assert `canonical` equals these display names ✓ (the map stores the ingredient.name).

**Base rule map keyed by canonical name** ✓.

**Test 3 'linarool' (lowercase) → canonical 'Linalool', rule watch, source 'EC 1223/2009, Annex III, 683'** ✓.

**Now, let me write the files. Don't forget: `import 'reflect-metadata'` in main.ts, before the Nest imports.**

Also `package.json` — add a `prisma` script? `"prisma:generate"`. The README mentions `pnpm prisma migrate deploy` after generate. Migrations require the generated client for the tests.

**vitest.config.ts** with `testTimeout: 60000` (DB operations + initial connection).

Let me also re-check the **filter's `@Catch()`** import: `@Catch()` with no args catches everything ✓. APP_FILTER registration ✓.

**Potential circular imports**: service → repository, fixtures (types only), inci-normalizer, api-error. repository → prisma service, inci-normalizer, api-error, @prisma/client. No cycles ✓.

**The type `StoredResultView`** for getStoredResult output:
```ts
export interface StoredResultView {
  productId: string;
  methodologyVersion: string;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}
```

**ClassificationOutput** extends with `profile: string | null`.

Now, let me reconsider `flag` values once more: for a recognized ingredient with no base rule and no modifier → flag 'none'. Unknown → 'unknown'. Flagged → the severity string. The API consumer reads flag + severity + source ✓. "No binary safe/toxic" ✓ (no 'safe'/'toxic' strings anywhere — check the disclaimer wording: I wrote "not a safety verdict" — it contains the word 'safety' but not a safe/toxic field; that's fine, it's prose, actually good).

Hmm — note: the word "safe" appears in the disclaimer ("which is not the same as being safe"). That's prose explaining the absence of a verdict — acceptable? "No binary safe/toxic field anywhere. Not in the API, not in the database." It's about fields. A disclaimer mentioning the word safe is OK, and actually clarifies the non-verdict. Keep it.

**Now, let me write the README's priority section** mirroring the code comment.

**File: `src/classification/fixtures.ts`** — with an ASSUMPTION comment at the top.

Also — the variant says "users maintain family profiles" → the profile creation endpoint ✓ contexts are a subset of the allowed.

**Let me write the controller's assertions fully** — I need to be thorough (strict TS: `body as Record<string, unknown>`).

Let me also decide the shape of `ingestMethodology`'s response and the controller's pass-through — fine.

**Now, let me mentally compile everything under strict TS.**

inci-normalizer.ts:
```ts
export function normalizeInci(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
```
Add a JSDoc explaining scope (case, accents, whitespace; typos handled by fixtures).

api-error.ts: as above. Details type is Record<string, unknown>.

all-exceptions.filter.ts: as above. `catch(exception: unknown, host: ArgumentsHost)` ✓.

prisma.service.ts / module: as above.

repository — let me write it in full:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma, RuleKind, VersionStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { Errors } from '../common/api-error.js';
import { normalizeInci } from './inci-normalizer.js';

export interface ResolutionEntry {
  ingredientId: string;
  canonicalName: string;
  matchedVia: 'canonical' | 'synonym';
}

export type ProductWithIngredients = Prisma.ProductGetPayload<{ include: { ingredients: true } }>;
```
Hmm — cleaner: define explicitly:
```ts
export type ProductWithIngredients = Product & { ingredients: ProductIngredient[] };
```
Import Product, ProductIngredient types from @prisma/client (as types). `import type { Product, ProductIngredient, Rule as RuleRow, Profile, MethodologyVersion } from '@prisma/client';` and value imports for the enums + Prisma namespace. Note: `Rule` name collision with Prisma's namespace? The model is named Rule → the type `Rule` is exported from @prisma/client. And I import the `Prisma` namespace. `import { Prisma, RuleKind } from '@prisma/client'; import type { Product, ProductIngredient, Rule, Profile, MethodologyVersion } from '@prisma/client';` — fine.

Repository methods (final list):
- findActiveVersion(): Promise<MethodologyVersion | null>
- findVersion(idOrSlug: string): Promise<MethodologyVersion | null>
- listVersions(): Promise<MethodologyVersion[]>
- createVersion(slug, name): Promise<MethodologyVersion>
- markVersionPublished(id): Promise<MethodologyVersion>
- findRulesByVersion(versionId): Promise<RuleRowWithIngredient[]>
- findRuleByKeys(versionId, ingredientName, kind, context): Promise<Rule | null>
- upsertRule(versionId, ingredientName, severity, source, kind, context): Promise<Rule>
- upsertIngredient(name): Promise<Ingredient>
- upsertSynonym(ingredientId, text): Promise<Synonym>
- findResolutionMap(): Promise<Map<string, ResolutionEntry>>
- createProduct(name, brand, ingredients): Promise<Product>
- findProduct(id): Promise<ProductWithIngredients | null>
- listProducts(): Promise<ProductWithIngredients[]>
- reorderProductIngredients(productId, orderedRaws): Promise<void>
- createProfile(name, contexts): Promise<Profile>
- findProfile(id): Promise<Profile | null>
- upsertResult(productId, versionId, payload): Promise<ClassificationResult>
- findResult(productId, versionId): Promise<ClassificationResult | null>
- countResults(versionId): Promise<number>

Import type { Ingredient, Synonym, ClassificationResult } too.

findRulesByVersion:
```ts
async findRulesByVersion(versionId: string): Promise<RuleWithIngredient[]> {
  return this.prisma.rule.findMany({
    where: { versionId },
    include: { ingredient: { select: { name: true } } },
    orderBy: [{ ingredientId: 'asc' }, { kind: 'asc' }, { context: 'asc' }],
  });
}
```
Type: `type RuleWithIngredient = Rule & { ingredient: { name: string } }` — export from repository for the service.

findRuleByKeys:
```ts
async findRuleByKeys(versionId: string, ingredientName: string, kind: RuleKind, context: string): Promise<Rule | null> {
  const ingredient = await this.prisma.ingredient.findUnique({ where: { name: ingredientName }, select: { id: true } });
  if (!ingredient) return null;
  return this.prisma.rule.findUnique({
    where: { versionId_ingredientId_kind_context: { versionId, ingredientId: ingredient.id, kind, context } },
  });
}
```

createVersion:
```ts
async createVersion(slug: string, name: string): Promise<MethodologyVersion> {
  return this.prisma.methodologyVersion.create({ data: { slug, name } });
}
```
(since ingest checks existence first; findVersion handles slug OR id.)

markVersionPublished:
```ts
async markVersionPublished(id: string): Promise<MethodologyVersion> {
  return this.prisma.methodologyVersion.update({
    where: { id },
    data: { status: VersionStatus.PUBLISHED, publishedAt: new Date() },
  });
}
```

upsertIngredient:
```ts
async upsertIngredient(name: string): Promise<Ingredient> {
  const normalized = normalizeInci(name);
  return this.prisma.ingredient.upsert({
    where: { normalized },
    update: {},
    create: { name, normalized },
  });
}
```

upsertSynonym:
```ts
async upsertSynonym(ingredientId: string, text: string): Promise<Synonym> {
  const normalized = normalizeInci(text);
  return this.prisma.synonym.upsert({
    where: { normalized },
    update: {},
    create: { text, normalized, ingredientId },
  });
}
```

findResolutionMap: as sketched.

createProduct:
```ts
async createProduct(name: string, brand: string | null, ingredients: string[]): Promise<Product> {
  const { id } = await this.prisma.product.create({
    data: { name, brand, ingredients: { create: ingredients.map((raw, position) => ({ raw, position })) } },
  });
  return this.prisma.product.findUniqueOrThrow({ where: { id } });
}
```
Hmm, returning the created product without ingredients is fine; the caller uses the id. Just return the created product (without ingredients). Fine.

reorder:
```ts
async reorderProductIngredients(productId: string, orderedRaws: string[]): Promise<void> {
  const rows = await this.prisma.productIngredient.findMany({ where: { productId } });
  const byRaw = new Map<string, string>();
  for (const row of rows) byRaw.set(row.raw, row.id);
  const updates = orderedRaws.map((raw, position) => {
    const id = byRaw.get(raw);
    if (!id) throw Errors.invalidInput(`Ingredient '${raw}' is not part of the product.`, { raw });
    return this.prisma.productIngredient.update({ where: { id }, data: { position } });
  });
  await this.prisma.$transaction(updates);
}
```
(Duplicate raw edge: acceptable.)

createProfile / findProfile are trivial.

upsertResult:
```ts
async upsertResult(productId: string, versionId: string, payload: Prisma.InputJsonValue): Promise<ClassificationResult> {
  return this.prisma.classificationResult.upsert({
    where: { productId_versionId: { productId, versionId } },
    update: { payload },
    create: { productId, versionId, payload },
  });
}
```
The service passes a typed payload; cast: the service calls `this.repo.upsertResult(product.id, version.id, payload as unknown as Prisma.InputJsonValue)`. Or the repo accepts `object` and casts internally: `payload: object` → `payload as Prisma.InputJsonValue`. I'll type the parameter as `Prisma.InputJsonValue` and cast in the service. Either way — repo accepts `Prisma.InputJsonValue`.

countResults:
```ts
async countResults(versionId: string): Promise<number> {
  return this.prisma.classificationResult.count({ where: { versionId } });
}
```
The test can use it via prisma directly; but the service's publish returns product count. The test can count via svc? The test has prisma directly; fine.

**Now, the full service file.** Let me write it carefully.

```ts
import { Injectable } from '@nestjs/common';
import { RuleKind, VersionStatus } from '@prisma/client';
import type { MethodologyVersion } from '@prisma/client';
import { Errors } from '../common/api-error.js';
import {
  ClassificationRepository,
  ProductWithIngredients,
  RuleWithIngredient,
} from './classification.repository.js';
import { normalizeInci } from './inci-normalizer.js';
import type { IngredientFixture, MethodologyFixture } from './fixtures.js';

export type Severity = 'banned' | 'restricted' | 'watch';
export type Flag = 'unknown' | 'none' | Severity;

export interface Finding { raw, canonical, recognized, flag, severity, source, matchedVia, modifierContext }
export interface ClassificationSummary { total: number; recognized: number; unknown: number }
export interface StoredPayload { schema: 1; methodologyVersion: string; findings: Finding[]; confidence: number; summary: ClassificationSummary }
export interface ClassificationOutput { productId: string; methodologyVersion: string; profile: string | null; findings: Finding[]; confidence: number; summary: ClassificationSummary; disclaimer: string }
export interface StoredResultView { productId: string; methodologyVersion: string; findings: Finding[]; confidence: number; summary: ClassificationSummary; disclaimer: string }

export const DISCLAIMER = '...';
export const MODIFIER_PRECEDENCE = ['child_under_3', 'pregnancy'] as const;

const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };

interface ModifierCandidate { rank: number; order: number; severity: Severity; source: string; context: string | null }

function findingSortKey(finding: Finding): string {
  return finding.recognized
    ? `0\u0000${finding.canonical}\u0000${finding.raw}`
    : `1\u0000${normalizeInci(finding.raw)}\u0000${finding.raw}`;
}

export function applyProfileModifiers(findings, modifiers, contexts): Finding[] { ... as sketched ... }

export function buildBaseClassification(rawIngredients: string[], resolutionMap: Map<string, ResolutionEntry>, baseRules: Map<string, { severity: Severity; source: string }>): { findings: Finding[]; confidence: number; summary: ClassificationSummary } { ... }
```

Need to import the ResolutionEntry type from the repository.

Service class methods as sketched. Let me finalize `ingestMethodology`'s immutability check:

```ts
async ingestMethodology(fix: MethodologyFixture): Promise<{ versionId: string; slug: string; upserted: number; unchanged: number }> {
  const existing = await this.repo.findVersion(fix.slug);
  const version = existing ?? (await this.repo.createVersion(fix.slug, fix.name));
  let upserted = 0;
  let unchanged = 0;
  for (const rule of fix.rules) {
    const kind = rule.kind === 'context' ? RuleKind.CONTEXT : RuleKind.BASE;
    const context = rule.kind === 'context' ? rule.context ?? '' : '';
    const found = await this.repo.findRuleByKeys(version.id, rule.ingredient, kind, context);
    const identical = found !== null && found.severity.toLowerCase() === rule.severity && found.source === rule.source;
    if (identical) { unchanged += 1; continue; }
    if (version.status === VersionStatus.PUBLISHED) {
      throw Errors.methodologyImmutable(version.slug, rule.ingredient);
    }
    await this.repo.upsertRule(version.id, rule.ingredient, rule.severity, rule.source, kind, context);
    upserted += 1;
  }
  return { versionId: version.id, slug: version.slug, upserted, unchanged };
}
```
Wait — if the version is published and the rule is identical → allow (no-op). If published and different/new → immutable error ✓. If draft and different → update (allowed; not yet published, so the version can change) ✓.

Hmm: `found.severity` is the Prisma enum type RuleSeverity (string enum) — `.toLowerCase()` works on it (it's a string). TS: the enum type is a string literal union → toLowerCase exists ✓.

`publish`:
```ts
async publish(versionIdOrSlug: string): Promise<{ versionId: string; slug: string; newlyPublished: boolean; products: number }> {
  const version = await this.repo.findVersion(versionIdOrSlug);
  if (!version) throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
  const newlyPublished = version.status === VersionStatus.DRAFT;
  if (newlyPublished) await this.repo.markVersionPublished(version.id);
  const { products } = await this.rescore(version.id);
  return { versionId: version.id, slug: version.slug, newlyPublished, products };
}
```

`rescore`:
```ts
async rescore(versionIdOrSlug: string): Promise<{ versionId: string; products: number }> {
  const version = await this.repo.findVersion(versionIdOrSlug);
  if (!version) throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
  const [products, resolutionMap, rules] = await Promise.all([
    this.repo.listProducts(),
    this.repo.findResolutionMap(),
    this.repo.findRulesByVersion(version.id),
  ]);
  for (const product of products) {
    await this.upsertStoredResult(product, version, resolutionMap, rules);
  }
  return { versionId: version.id, products: products.length };
}
```

`upsertStoredResult`:
```ts
private async upsertStoredResult(
  product: ProductWithIngredients,
  version: Pick<MethodologyVersion, 'id' | 'slug'>,
  resolutionMap: Map<string, ResolutionEntry>,
  rules: RuleWithIngredient[],
): Promise<void> {
  const baseRules = new Map<string, { severity: Severity; source: string }>();
  for (const rule of rules) {
    if (rule.kind !== RuleKind.BASE) continue;
    baseRules.set(rule.ingredient.name, { severity: rule.severity.toLowerCase() as Severity, source: rule.source });
  }
  const { findings, confidence, summary } = buildBaseClassification(
    product.ingredients.map((row) => row.raw),
    resolutionMap,
    baseRules,
  );
  const payload: StoredPayload = { schema: 1, methodologyVersion: version.slug, findings, confidence, summary };
  await this.repo.upsertResult(product.id, version.id, payload as unknown as Prisma.InputJsonValue);
}
```
Need `import type { Prisma } from '@prisma/client'`? Prisma namespace value vs type — `Prisma.InputJsonValue` is a type → `import type { Prisma } from '@prisma/client';`? Prisma is a namespace; import type of a namespace works for its type members ✓.

Hmm wait, actually it's simpler: have the repo's upsertResult accept `payload: object` and cast internally. Then the service passes the payload directly. Let me do that — the repo is the DB layer; the cast belongs there:
```ts
async upsertResult(productId: string, versionId: string, payload: object): Promise<ClassificationResult> {
  const json = payload as Prisma.InputJsonValue;
  ...
}
```
The service imports Prisma? No — the repo imports Prisma. ✓ cleaner.

`classify` and `getStoredResult` as sketched.

`createProduct`:
```ts
async createProduct(name: string, brand: string | null, ingredients: string[]): Promise<{ id: string }> {
  const product = await this.repo.createProduct(name, brand, ingredients);
  return { id: product.id };
}
```
Hmm — return the full product? A controller endpoint returning {id} is thin; return the product with createdAt? Let me return `{ id, name, brand, ingredientCount }`. Meh — simplest: return the created product object. `return product;` (id, name, brand, createdAt). OK.

`createProfile` similarly returns the profile.

`reorderProductIngredients` with validation as sketched.

`listVersions` → repo.listVersions() map to plain {id, slug, name, status, publishedAt}.

**Now `buildBaseClassification`**:

```ts
export function buildBaseClassification(
  rawIngredients: string[],
  resolutionMap: Map<string, ResolutionEntry>,
  baseRules: Map<string, { severity: Severity; source: string }>,
): { findings: Finding[]; confidence: number; summary: ClassificationSummary } {
  const findings: Finding[] = rawIngredients.map((raw) => {
    const key = normalizeInci(raw);
    const hit = key === '' ? undefined : resolutionMap.get(key);
    if (hit === undefined) {
      return { raw, canonical: null, recognized: false, flag: 'unknown', severity: null, source: null, matchedVia: null, modifierContext: null };
    }
    const rule = baseRules.get(hit.canonicalName);
    return {
      raw,
      canonical: hit.canonicalName,
      recognized: true,
      flag: rule ? rule.severity : 'none',
      severity: rule ? rule.severity : null,
      source: rule ? rule.source : null,
      matchedVia: hit.matchedVia,
      modifierContext: null,
    };
  });

  findings.sort((a, b) => {
    const ka = findingSortKey(a);
    const kb = findingSortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const total = findings.length;
  const recognized = findings.reduce((n, f) => n + (f.recognized ? 1 : 0), 0);
  const unknown = total - recognized;
  // Confidence = fraction of the list we could resolve; unknowns lower it. Empty list → 0.
  const confidence = total === 0 ? 0 : Math.round((recognized / total) * 10000) / 10000;
  return { findings, confidence, summary: { total, recognized, unknown } };
}
```

Type note: `flag: 'unknown'` — in the object literal within the array typed Finding[], the flag union includes 'unknown' ✓.

**`applyProfileModifiers`** final:

```ts
export function applyProfileModifiers(
  findings: Finding[],
  modifiers: Array<{ canonicalName: string; context: string; severity: Severity; source: string }>,
  contexts: readonly string[],
): Finding[] {
  const activeContexts = new Set(contexts);
  if (activeContexts.size === 0 || modifiers.length === 0) return findings;

  const byIngredient = new Map<string, Array<{ context: string; severity: Severity; source: string }>>();
  for (const modifier of modifiers) {
    if (!activeContexts.has(modifier.context)) continue;
    const list = byIngredient.get(modifier.canonicalName);
    if (list) list.push(modifier); else byIngredient.set(modifier.canonicalName, [modifier]);
  }

  return findings.map((finding) => {
    if (!finding.recognized || finding.canonical === null) return finding;
    const candidates: ModifierCandidate[] = [];
    if (finding.severity !== null && finding.source !== null) {
      candidates.push({ rank: SEVERITY_RANK[finding.severity], order: -1, severity: finding.severity, source: finding.source, context: null });
    }
    for (const modifier of byIngredient.get(finding.canonical) ?? []) {
      const precedence = MODIFIER_PRECEDENCE.indexOf(modifier.context);
      candidates.push({
        rank: SEVERITY_RANK[modifier.severity],
        order: precedence === -1 ? MODIFIER_PRECEDENCE.length : precedence,
        severity: modifier.severity,
        source: modifier.source,
        context: modifier.context,
      });
    }
    if (candidates.length === 0) return finding;
    candidates.sort((a, b) => b.rank - a.rank || a.order - b.order);
    const winner = candidates[0];
    return { ...finding, flag: winner.severity, severity: winner.severity, source: winner.source, modifierContext: winner.context };
  });
}
```
`MODIFIER_PRECEDENCE` typed `readonly string[]` — indexOf OK. As const → readonly ['child_under_3','pregnancy'] — indexOf exists on readonly arrays ✓. `MODIFIER_PRECEDENCE.length` ✓.

**Modifier precedence comment** — place above the MODIFIER_PRECEDENCE constant. ✓

**Now the controller file in full:**

```ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Errors } from '../common/api-error.js';
import { ClassificationService } from './classification.service.js';
import { PROFILE_CONTEXTS } from './fixtures.js';
import type { MethodologyFixture } from './fixtures.js';

const SEVERITIES = ['banned', 'restricted', 'watch'];

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw Errors.invalidInput(`${field} must be a non-empty string.`, { field });
  }
  return value;
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw Errors.invalidInput('Request body must be a JSON object.', {});
  }
  return body as Record<string, unknown>;
}

function assertProductInput(body: unknown): { name: string; brand: string | null; ingredients: string[] } {
  const b = asObject(body);
  const name = asNonEmptyString(b.name, 'name');
  let brand: string | null = null;
  if (b.brand !== undefined && b.brand !== null) brand = asNonEmptyString(b.brand, 'brand');
  if (!Array.isArray(b.ingredients)) throw Errors.invalidInput('ingredients must be an array of INCI strings.', { field: 'ingredients' });
  const ingredients = b.ingredients.map((value, index) => asNonEmptyString(value, `ingredients[${index}]`));
  return { name, brand, ingredients };
}

function assertProfileInput(body: unknown): { name: string; contexts: string[] } {
  const b = asObject(body);
  const name = asNonEmptyString(b.name, 'name');
  let contexts: string[] = [];
  if (b.contexts !== undefined && b.contexts !== null) {
    if (!Array.isArray(b.contexts)) throw Errors.invalidInput('contexts must be an array of profile contexts.', { field: 'contexts' });
    contexts = b.contexts.map((value, index) => asNonEmptyString(value, `contexts[${index}]`));
    for (const context of contexts) {
      if (!PROFILE_CONTEXTS.includes(context)) {
        throw Errors.invalidInput(`Unknown profile context '${context}'. Allowed: ${PROFILE_CONTEXTS.join(', ')}.`, { field: 'contexts', context });
      }
    }
  }
  return { name, contexts };
}

function assertMethodologyFixture(body: unknown): MethodologyFixture {
  const b = asObject(body);
  const slug = asNonEmptyString(b.slug, 'slug');
  const name = asNonEmptyString(b.name, 'name');
  if (!Array.isArray(b.rules) || b.rules.length === 0) throw Errors.invalidInput('rules must be a non-empty array.', { field: 'rules' });
  const rules = b.rules.map((value, index) => {
    const field = `rules[${index}]`;
    const r = asObject(value);
    const ingredient = asNonEmptyString(r.ingredient, `${field}.ingredient`);
    const kind = r.kind;
    if (kind !== 'base' && kind !== 'context') throw Errors.invalidInput(`${field}.kind must be 'base' or 'context'.`, { field });
    const severity = asNonEmptyString(r.severity, `${field}.severity`);
    if (!SEVERITIES.includes(severity)) throw Errors.invalidInput(`${field}.severity must be one of ${SEVERITIES.join(', ')}.`, { field });
    const source = asNonEmptyString(r.source, `${field}.source`);
    if (kind === 'base') {
      if (r.context !== undefined) throw Errors.invalidInput(`${field}.context is only allowed for context rules.`, { field });
      return { ingredient, kind: 'base' as const, severity: severity as 'banned'|'restricted'|'watch', source };
    }
    const context = asNonEmptyString(r.context, `${field}.context`);
    if (!PROFILE_CONTEXTS.includes(context)) throw Errors.invalidInput(`Unknown context '${context}'. Allowed: ${PROFILE_CONTEXTS.join(', ')}.`, { field });
    return { ingredient, kind: 'context' as const, context, severity: severity as 'banned'|'restricted'|'watch', source };
  });
  return { slug, name, rules };
}
```

PROFILE_CONTEXTS type: `readonly ProfileContext[]` where ProfileContext = 'child_under_3' | 'pregnancy'. `.includes(context)` with context: string — TS: readonly ('child_under_3'|'pregnancy')[].includes(string) → error! Array.prototype.includes requires the argument to be of the element type. `readonly ProfileContext[]` includes(string) → TS error "Argument of type 'string' is not assignable to parameter of type 'ProfileContext'". Fix: cast, or type PROFILE_CONTEXTS as `readonly string[]`. Let me type it `export const PROFILE_CONTEXTS: readonly string[] = ['child_under_3', 'pregnancy'];` — avoids the friction. ✓ (I'll also use string for the severity check with a SEVERITIES array.)

Controller class:

```ts
@Controller()
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Post('products')
  createProduct(@Body() body: unknown) {
    const { name, brand, ingredients } = assertProductInput(body);
    return this.classificationService.createProduct(name, brand, ingredients);
  }

  @Get('products/:productId/classification')
  classify(@Param('productId') productId: string, @Query('profileId') profileId?: string) {
    return this.classificationService.classify(productId, profileId || undefined);
  }

  @Get('products/:productId/classification-results')
  getStoredResult(@Param('productId') productId: string, @Query('methodologyVersionId') methodologyVersionId?: string) {
    if (!methodologyVersionId) throw Errors.invalidInput('methodologyVersionId query parameter is required.', { field: 'methodologyVersionId' });
    return this.classificationService.getStoredResult(productId, methodologyVersionId);
  }

  @Post('profiles')
  createProfile(@Body() body: unknown) {
    const { name, contexts } = assertProfileInput(body);
    return this.classificationService.createProfile(name, contexts);
  }

  @Get('methodology-versions')
  listMethodologyVersions() {
    return this.classificationService.listVersions();
  }

  @Post('methodology-versions')
  ingestMethodology(@Body() body: unknown) {
    return this.classificationService.ingestMethodology(assertMethodologyFixture(body));
  }

  @Post('methodology-versions/:versionId/publish')
  publishMethodology(@Param('versionId') versionId: string) {
    return this.classificationService.publish(versionId);
  }

  @Post('methodology-versions/:versionId/rescore')
  rescoreMethodology(@Param('versionId') versionId: string) {
    return this.classificationService.rescore(versionId);
  }
}
```

**Now the test file** — write it in full.

```ts
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service.js';
import { ClassificationRepository } from '../src/classification/classification.repository.js';
import { ClassificationService } from '../src/classification/classification.service.js';
import { INGREDIENT_FIXTURES, METHODOLOGY_V1, METHODOLOGY_V2 } from '../src/classification/fixtures.js';

// The tests run against a real PostgreSQL database.
// Requires DATABASE_URL with the schema applied: pnpm prisma migrate deploy

const prisma = new PrismaClient();

function buildService(): ClassificationService {
  const repository = new ClassificationRepository(prisma as unknown as PrismaService);
  return new ClassificationService(repository);
}

let service: ClassificationService;

async function wipeDatabase(): Promise<void> {
  await prisma.$transaction([
    prisma.classificationResult.deleteMany({}),
    prisma.rule.deleteMany({}),
    prisma.synonym.deleteMany({}),
    prisma.productIngredient.deleteMany({}),
    prisma.methodologyVersion.deleteMany({}),
    prisma.profile.deleteMany({}),
    prisma.product.deleteMany({}),
    prisma.ingredient.deleteMany({}),
  ]);
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at a PostgreSQL database with the schema applied (pnpm prisma migrate deploy).');
  }
  await wipeDatabase();
  service = buildService();
  await service.ingestIngredients(INGREDIENT_FIXTURES);
  await service.ingestMethodology(METHODOLOGY_V1);
  await service.publish('v1');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ingredient classification (L2 spec #319)', () => {
  it('a profile flips a finding the base rules alone would not flag', async () => {
    const product = await service.createProduct('Citral Lotion', null, ['Water', 'Citral']);
    const base = await service.classify(product.id);
    const citral = base.findings.find((f) => f.canonical === 'Citral');
    expect(citral).toBeDefined();
    expect(citral!.severity).toBeNull();
    expect(citral!.flag).toBe('none');

    const profile = await service.createProfile('Pregnancy', ['pregnancy']);
    const withProfile = await service.classify(product.id, profile.id);
    const flagged = withProfile.findings.find((f) => f.canonical === 'Citral');
    expect(flagged!.severity).toBe('restricted');
    expect(flagged!.flag).toBe('restricted');
    expect(flagged!.source).toContain('pregnancy');
    expect(flagged!.modifierContext).toBe('pregnancy');
  });

  it('an unrecognized ingredient is listed as unknown and lowers confidence', async () => {
    const known = await service.createProduct('Known Ingredients Only', null, ['Water', 'Tocopherol']);
    const withUnknown = await service.createProduct('Has Unknown Ingredient', null, ['Water', 'Tocopherol', 'Zinc Gluconate']);

    const clean = await service.classify(known.id);
    const dirty = await service.classify(withUnknown.id);

    expect(clean.confidence).toBe(1);
    const unknown = dirty.findings.find((f) => f.raw === 'Zinc Gluconate');
    expect(unknown).toBeDefined();
    expect(unknown!.recognized).toBe(false);
    expect(unknown!.flag).toBe('unknown');
    expect(unknown!.canonical).toBeNull();
    expect(unknown!.severity).toBeNull();
    expect(dirty.summary).toEqual({ total: 3, recognized: 2, unknown: 1 });
    expect(dirty.confidence).toBeLessThan(clean.confidence);
    expect(dirty.confidence).toBe(0.6667);
  });

  it('resolves synonyms and OCR typos to the canonical ingredient', async () => {
    const product = await service.createProduct('Synonym Sample', null, ['WATER', 'Parfume', 'Metylparaben', 'Vitamin E', 'linarool']);
    const out = await service.classify(product.id);
    const byRaw = new Map(out.findings.map((f) => [f.raw, f]));
    expect(byRaw.get('WATER')!.canonical).toBe('Aqua');
    expect(byRaw.get('WATER')!.matchedVia).toBe('synonym');
    expect(byRaw.get('Parfume')!.canonical).toBe('Fragrance');
    expect(byRaw.get('Metylparaben')!.canonical).toBe('Methylparaben');
    expect(byRaw.get('Vitamin E')!.canonical).toBe('Tocopherol');
    expect(byRaw.get('linarool')!.canonical).toBe('Linalool');
    expect(out.summary.unknown).toBe(0);
    expect(out.confidence).toBe(1);
    // the resolved ingredient carries the canonical's rule, not the alias's
    expect(byRaw.get('Metylparaben')!.severity).toBe('watch');
    expect(byRaw.get('linarool')!.source).toBe('EC 1223/2009, Annex III, 683');
  });

  it('returns identical output across reruns', async () => {
    const product = await service.createProduct('Rerun Sample', 'Acme', ['Fragrance', 'Water', 'Methylparaben', 'Citral']);
    const first = await service.classify(product.id);
    const second = await service.classify(product.id);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('returns identical output when the stored ingredient order is shuffled', async () => {
    const ordered = ['Fragrance', 'Water', 'Methylparaben', 'Citral', 'Tocopherol'];
    const shuffled = ['Citral', 'Tocopherol', 'Methylparaben', 'Fragrance', 'Water'];
    const product = await service.createProduct('Shuffle Sample', null, ordered);
    const before = await service.classify(product.id);
    await service.reorderProductIngredients(product.id, shuffled);
    const after = await service.classify(product.id);
    expect(after).toEqual(before);
  });

  it('two modifiers on one ingredient resolve by the written precedence', async () => {
    const family = await service.createProfile('Family', ['child_under_3', 'pregnancy']);
    const fragrance = await service.createProduct('Fragrance Sample', null, ['Fragrance', 'Water']);
    const retinoid = await service.createProduct('Retinoid Sample', null, ['Retinyl Palmitate', 'Water']);

    const fragranceOut = await service.classify(fragrance.id, family.id);
    const frag = fragranceOut.findings.find((f) => f.canonical === 'Fragrance');
    // child_under_3 is RESTRICTED, pregnancy is WATCH -> max severity wins
    expect(frag!.severity).toBe('restricted');
    expect(frag!.source).toContain('under 3');
    expect(frag!.modifierContext).toBe('child_under_3');

    const retinoidOut = await service.classify(retinoid.id, family.id);
    const retinyl = retinoidOut.findings.find((f) => f.canonical === 'Retinyl Palmitate');
    // both modifiers are RESTRICTED -> fixed precedence (child_under_3 first) picks the citation
    expect(retinyl!.severity).toBe('restricted');
    expect(retinyl!.source).toContain('under 3');
    expect(retinyl!.modifierContext).toBe('child_under_3');
  });

  it('keeps v1 and v2 results retrievable for the same product after publishing v2', async () => {
    const product = await service.createProduct('Dual Version Sample', null, ['Methylparaben', 'Citral', 'Water']);
    const v1Before = await service.getStoredResult(product.id, 'v1');

    await service.ingestMethodology(METHODOLOGY_V2);
    await service.publish('v2');

    const v1 = await service.getStoredResult(product.id, 'v1');
    const v2 = await service.getStoredResult(product.id, 'v2');

    // the old result is exactly what it was
    expect(v1).toEqual(v1Before);

    // the new version scores the same product differently where rules changed
    expect(v1.findings.find((f) => f.canonical === 'Methylparaben')!.severity).toBe('watch');
    expect(v2.findings.find((f) => f.canonical === 'Methylparaben')!.severity).toBe('restricted');
    expect(v1.findings.find((f) => f.canonical === 'Citral')!.severity).toBeNull();
    expect(v2.findings.find((f) => f.canonical === 'Citral')!.severity).toBe('watch');

    // re-scoring is idempotent: republishing v2 changes nothing
    const rowsBefore = await prisma.classificationResult.count({ where: { version: { slug: 'v2' } } });
    const payloadBefore = await prisma.classificationResult.findUnique({ where: { productId_versionId: ... } });
```

Hmm — productId_versionId needs the versionId (not the slug). Fetch: `const v2Row = await prisma.classificationResult.findFirst({ where: { productId: product.id, version: { slug: 'v2' } } });` Then `payloadBefore = v2Row.payload`. Then publish v2 again; `rowsAfter` count equals; fetch again and compare payload equal. Also classify active → now v2: `const active = await service.classify(product.id); expect(active.methodologyVersion).toBe('v2');`

Let me write it:

```ts
    const rowsBefore = await prisma.classificationResult.count({ where: { version: { slug: 'v2' } } });
    const rowBefore = await prisma.classificationResult.findFirst({ where: { productId: product.id, version: { slug: 'v2' } } });
    await service.publish('v2');
    const rowsAfter = await prisma.classificationResult.count({ where: { version: { slug: 'v2' } } });
    const rowAfter = await prisma.classificationResult.findFirst({ where: { productId: product.id, version: { slug: 'v2' } } });
    expect(rowsAfter).toBe(rowsBefore);
    expect(rowAfter!.payload).toEqual(rowBefore!.payload);

    const active = await service.classify(product.id);
    expect(active.methodologyVersion).toBe('v2');
```

Wait — `rowBefore!.payload` is typed as Prisma's JsonValue; toEqual with another JsonValue is fine.

Note on test ordering: this test publishes v2; it must run last. In the file, it's last ✓. And the earlier `getStoredResult(product.id,'v1')` — the product is created before v2 publish → lazy stored under v1 (active at that time) ✓.

But wait — earlier tests create products; the v2 publish re-scores all products (fine).

Also in the coexistence test, `getStoredResult(product.id, 'v1')` right after product creation — active is v1 → classify? No — getStoredResult does not classify/lazy-score! It just fetches. The product was just created — no stored v1 result exists! Bug in my test: I need to trigger a scoring first: call `service.classify(product.id)` (lazy-store under active v1) before `getStoredResult`. Let me add:
```ts
const product = await service.createProduct('Dual Version Sample', null, ['Methylparaben', 'Citral', 'Water']);
await service.classify(product.id); // lazy-scores under the active version (v1)
const v1Before = await service.getStoredResult(product.id, 'v1');
```
✓. Alternatively publish v2 re-scores all products including this one (which now exists) → both stored. So v1 exists after publish anyway (rescore on v1 publish scored products existing then; this product is new → only via lazy or… wait: publishing v2 re-scores under v2 only. The v1 row for this product is only created by the lazy classify under v1. So yes, the classify call is needed. ✓ My plan works.

Hmm, actually — should `rescore(v2)` also backfill v1 rows for new products? No — that would be "scoring an old version of a new product," out of scope; the lazy path scores under the active version. Fine.

**`ingestIngredients` service method** — I should also expose it (used by the test). It's ops ingestion. ✓

**Now, let me double-check `findVersion` OR lookup:**
```ts
async findVersion(idOrSlug: string): Promise<MethodologyVersion | null> {
  return this.prisma.methodologyVersion.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] } });
}
```
✓

**listVersions**: findMany orderBy createdAt asc? Deterministic: `orderBy: [{ createdAt: 'asc' }, { slug: 'asc' }]`.

**The service's listVersions** returns the rows as-is (they're plain objects with status enum strings). ✓

**Now, the module wiring** — classification.module.ts providers: [ClassificationService, ClassificationRepository]; controller; exports [ClassificationService] (used by others? not needed but harmless — actually, per the wiring rule, only export when used by another module; not used → don't export. Skip the exports.)

**app.module.ts** as above.

**README.md** content:

```md
# cosmetics-scanner

Classifies cosmetics from their INCI ingredient lists against versioned, cited rules.
Stack: TypeScript (strict, ESM), NestJS, Prisma, PostgreSQL, Vitest, pnpm.

## Setup
...
## API
...
## Modifier precedence (written down)
...
## Notes on confidence
...
```
Keep it terse.

**.env.example**:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/cosmetics_scanner?schema=public"
PORT=3000
```

**Now — let me double-check the filter's `getResponse()` typing**: `ctx.getResponse<Response>()` — import type { Response } from 'express'. ✓

**Nest + ESM + decorators**: with the tsx runtime, Nest 10 works with ESM (NestJS 10 officially supports ESM). main.ts imports 'reflect-metadata' first ✓ (also needed in the test file before Nest imports — I import the service directly, no NestFactory; but decorators on the class need reflect-metadata? @Injectable decorator runs at class definition time; reflect-metadata is needed for metadata APIs — the Nest decorator calls Reflect.defineMetadata — it works if reflect-metadata is imported. Import 'reflect-metadata' at the top of the test file. Actually, do I use NestFactory in the test? No. But ClassificationService/Repository have @Injectable() — imported from @nestjs/common — the decorator runs fine. Keep the reflect-metadata import to be safe.)

Hmm — actually, is `@Injectable()` needed if not using DI? Convention requires these to be NestJS providers; keep the decorator ✓.

**Vitest + decorators + isolatedModules?** Not enabled. TS with emitDecoratorMetadata under vitest (esbuild): esbuild supports experimentalDecorators via tsconfig; esbuild historically didn't emit design:type metadata?? Vitest uses esbuild for TS transform — does esbuild support experimentalDecorators and emit decorator metadata? esbuild supports experimental decorators and reads tsconfig; it does not emit decorator metadata (design:type) — esbuild ignores emitDecoratorMetadata? Let me think. esbuild: "experimentalDecorators supported since 0.21"? Actually esbuild has supported TypeScript experimental decorators for a while, and with experimentalDecorators enabled, it does emit `__decorateClass` calls, and also supports `emitDecoratorMetadata`?? The esbuild docs: "esbuild supports experimentalDecorators and emitDecoratorMetadata." Hmm — I recall that esbuild added decorator metadata support around v0.16? Let me think: NestJS + Vitest is a very common combo and works — because esbuild has supported emitDecoratorMetadata since 0.14.x? I think esbuild now supports it (docs mention "decorator metadata" support). Let me recall: esbuild changelog v0.15.13? There was a PR "Add support for emitDecoratorMetadata" — yes, esbuild supports emitDecoratorMetadata (I'm fairly confident modern esbuild does; vite 5 uses esbuild ≥ 0.18). Also, NestJS docs mention Vitest as a supported test runner for Nest apps (NestJS docs' testing section uses Jest, but the community widely uses Vitest with Nest without issue). I'll proceed; and as a safety net, in the test I construct the service manually (`new ClassificationService(new ClassificationRepository(prisma))`) — no DI container at all! So decorator metadata is irrelevant for the test. The runtime app (main.ts via tsx) uses NestFactory — tsx also uses esbuild… if tsx doesn't emit metadata, the app boot would fail DI. Hmm. tsx docs: tsx supports "full TypeScript features including… decorators and decorator metadata"? tsx = esbuild + loader; esbuild supports emitDecoratorMetadata (I'm now fairly confident esbuild does — it's in the docs: "esbuild implements emitDecoratorMetadata"). Yes — esbuild README lists `experimentalDecorators` and `emitDecoratorMetadata` as supported. OK, good.

Alternatively, avoid the risk: use explicit `@Inject()` tokens? No — keep the standard constructor DI; esbuild handles it.

**Another design check — "results from the previous version remain retrievable" via API**: `GET /products/:productId/classification-results?methodologyVersionId=v1` ✓ returns the stored base payload (no profile). Good — the stored row is exactly what was computed at publish time.

**Now, does `classify`'s output equal the stored payload (with profile=null)?** Output includes `profile: null`, `methodologyVersion`, `productId`, disclaimer — a superset of the stored payload. Fine.

**Deep equal in the re-run test**: `expect(second).toEqual(first)` ✓.

**Also consider**: the test "same product, two runs → identical output" — the first classify lazily stores; the second reads the stored. Both produce identical findings (base from stored + modifiers) ✓. But note: on the first run, the lazy path uses `rules` fetched in parallel; on the second run, the stored payload is used. The stored payload was built from the same rules + resolution map → identical findings ✓.

Edge: the resolution map changes between the two runs (a new synonym ingested)? Not in the test.

**Potential issue**: in classify, if `stored` is null, I call `this.upsertStoredResult(product, version, resolutionMap, rules)` — `rules` already fetched ✓.

**Confidence: 4-decimal rounding** — 1/1 = 1 → toBe(1) ✓. 2/3 → 0.6667 ✓.

**Unknown 'Zinc Gluconate'**: normalizes to 'zinc gluconate' — no canonical/synonym → unknown ✓. Note: 'zinc gluconate' is not in the fixture ✓.

**'WATER' → 'water' → synonym of Aqua** ✓ (lowercase).
**'Metylparaben' → 'metylparaben'** synonym ✓.
**'Vitamin E' → 'vitamin e'** ✓.
**'linarool'** ✓.
**'Parfume'** → 'parfume' synonym of Fragrance ✓ (typo entry).

**Canonical display names**: 'Aqua', 'Fragrance', 'Methylparaben', 'Linalool', 'Tocopherol', 'Citral', 'Hydroquinone', 'Methylchloroisothiazolinone', 'Retinyl palmitate', 'Formaldehyde'. Tests assert `canonical` equals these display names ✓ (the map stores the ingredient.name).

**Base rule map keyed by canonical name** ✓.

**Test 3 'linarool' (lowercase) → canonical 'Linalool', rule watch, source 'EC 1223/2009, Annex III, 683'** ✓.

**Now, let me write the files. Don't forget: `import 'reflect-metadata'` in main.ts, before the Nest imports.**

Also `package.json` — add a `prisma` script? `"prisma:generate"`. The README mentions `pnpm prisma migrate deploy` after generate. Migrations require the generated client for the tests.

**vitest.config.ts** with `testTimeout: 60000` (DB operations + initial connection).

Let me also re-check the **filter's `@Catch()`** import: `@Catch()` with no args catches everything ✓. APP_FILTER registration ✓.

**Potential circular imports**: service → repository, fixtures (types only), inci-normalizer, api-error. repository → prisma service, inci-normalizer, api-error, @prisma/client. No cycles ✓.

**The type `StoredResultView`** for getStoredResult output:
```ts
export interface StoredResultView {
  productId: string;
  methodologyVersion: string;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}
```

**ClassificationOutput** extends with `profile: string | null`.

Now, let me reconsider `flag` values once more: for a recognized ingredient with no base rule and no modifier → flag 'none'. Unknown → 'unknown'. Flagged → the severity string. The API consumer reads flag + severity + source ✓. "No binary safe/toxic" ✓ (no 'safe'/'toxic' strings anywhere — check the disclaimer wording: I wrote "not a safety verdict" — it contains the word 'safety' but not a safe/toxic field; that's fine, it's prose, actually good).

Hmm — note: the word "safe" appears in the disclaimer ("which is not the same as being safe"). That's prose explaining the absence of a verdict — acceptable? "No binary safe/toxic field anywhere. Not in the API, not in the database." It's about fields. A disclaimer mentioning the word safe is OK, and actually clarifies the non-verdict. Keep it.

**Now, let me write the README's priority section** mirroring the code comment.

**File: `src/classification/fixtures.ts`** — with an ASSUMPTION comment at the top.

Also — the variant says "users maintain family profiles" → the profile creation endpoint ✓ contexts are a subset of the allowed.

**Let me write the controller's assertions fully** — I need to be thorough (strict TS: `body as Record<string, unknown>`).

Let me also decide the shape of `ingestMethodology`'s response and the controller's pass-through — fine.

**Now, let me mentally compile everything under strict TS.**

inci-normalizer.ts:
```ts
export function normalizeInci(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
```
Add a JSDoc explaining scope (case, accents, whitespace; typos handled by fixtures).

api-error.ts: as above. Details type is Record<string, unknown>.

all-exceptions.filter.ts: as above. `catch(exception: unknown, host: ArgumentsHost)` ✓.

prisma.service.ts / module: as above.

repository — let me write it in full:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma, RuleKind, VersionStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { Errors } from '../common/api-error.js';
import { normalizeInci } from './inci-normalizer.js';

export interface ResolutionEntry {
  ingredientId: string;
  canonicalName: string;
  matchedVia: 'canonical' | 'synonym';
}

export type ProductWithIngredients = Prisma.ProductGetPayload<{ include: { ingredients: true } }>;
```
Hmm — cleaner: define explicitly:
```ts
export type ProductWithIngredients = Product & { ingredients: ProductIngredient[] };
```
Import Product, ProductIngredient types from @prisma/client (as types). `import type { Product, ProductIngredient, Rule as RuleRow, Profile, MethodologyVersion } from '@prisma/client';` and value imports for the enums + Prisma namespace. Note: `Rule` name collision with Prisma's namespace? The model is named Rule → the type `Rule` is exported from @prisma/client. And I import the `Prisma` namespace. `import { Prisma, RuleKind } from '@prisma/client'; import type { Product, ProductIngredient, Rule, Profile, MethodologyVersion } from '@prisma/client';` — fine.

Repository methods (final list):
- findActiveVersion(): Promise<MethodologyVersion | null>
- findVersion(idOrSlug: string): Promise<MethodologyVersion | null>
- listVersions(): Promise<MethodologyVersion[]>
- createVersion(slug, name): Promise<MethodologyVersion>
- markVersionPublished(id): Promise<MethodologyVersion>
- findRulesByVersion(versionId): Promise<RuleRowWithIngredient[]>
- findRuleByKeys(versionId, ingredientName, kind, context): Promise<Rule | null>
- upsertRule(versionId, ingredientName, severity, source, kind, context): Promise<Rule>
- upsertIngredient(name): Promise<Ingredient>
- upsertSynonym(ingredientId, text): Promise<Synonym>
- findResolutionMap(): Promise<Map<string, ResolutionEntry>>
- createProduct(name, brand, ingredients): Promise<Product>
- findProduct(id): Promise<ProductWithIngredients | null>
- listProducts(): Promise<ProductWithIngredients[]>
- reorderProductIngredients(productId, orderedRaws): Promise<void>
- createProfile(name, contexts): Promise<Profile>
- findProfile(id): Promise<Profile | null>
- upsertResult(productId, versionId, payload): Promise<ClassificationResult>
- findResult(productId, versionId): Promise<ClassificationResult | null>
- countResults(versionId): Promise<number>

Import type { Ingredient, Synonym, ClassificationResult } too.

findRulesByVersion:
```ts
async findRulesByVersion(versionId: string): Promise<RuleWithIngredient[]> {
  return this.prisma.rule.findMany({
    where: { versionId },
    include: { ingredient: { select: { name: true } } },
    orderBy: [{ ingredientId: 'asc' }, { kind: 'asc' }, { context: 'asc' }],
  });
}
```
Type: `type RuleWithIngredient = Rule & { ingredient: { name: string } }` — export from repository for the service.

findRuleByKeys:
```ts
async findRuleByKeys(versionId: string, ingredientName: string, kind: RuleKind, context: string): Promise<Rule | null> {
  const ingredient = await this.prisma.ingredient.findUnique({ where: { name: ingredientName }, select: { id: true } });
  if (!ingredient) return null;
  return this.prisma.rule.findUnique({
    where: { versionId_ingredientId_kind_context: { versionId, ingredientId: ingredient.id, kind, context } },
  });
}
```

createVersion:
```ts
async createVersion(slug: string, name: string): Promise<MethodologyVersion> {
  return this.prisma.methodologyVersion.create({ data: { slug, name } });
}
```
(since ingest checks existence first; findVersion handles slug OR id.)

markVersionPublished:
```ts
async markVersionPublished(id: string): Promise<MethodologyVersion> {
  return this.prisma.methodologyVersion.update({
    where: { id },
    data: { status: VersionStatus.PUBLISHED, publishedAt: new Date() },
  });
}
```

upsertIngredient:
```ts
async upsertIngredient(name: string): Promise<Ingredient> {
  const normalized = normalizeInci(name);
  return this.prisma.ingredient.upsert({
    where: { normalized },
    update: {},
    create: { name, normalized },
  });
}
```

upsertSynonym:
```ts
async upsertSynonym(ingredientId: string, text: string): Promise<Synonym> {
  const normalized = normalizeInci(text);
  return this.prisma.synonym.upsert({
    where: { normalized },
    update: {},
    create: { text, normalized, ingredientId },
  });
}
```

findResolutionMap: as sketched.

createProduct:
```ts
async createProduct(name: string, brand: string | null, ingredients: string[]): Promise<Product> {
  const { id } = await this.prisma.product.create({
    data: { name, brand, ingredients: { create: ingredients.map((raw, position) => ({ raw, position })) } },
  });
  return this.prisma.product.findUniqueOrThrow({ where: { id } });
}
```
Hmm, returning the created product without ingredients is fine; the caller uses the id. Just return the created product (without ingredients). Fine.

reorder:
```ts
async reorderProductIngredients(productId: string, orderedRaws: string[]): Promise<void> {
  const rows = await this.prisma.productIngredient.findMany({ where: { productId } });
  const byRaw = new Map<string, string>();
  for (const row of rows) byRaw.set(row.raw, row.id);
  const updates = orderedRaws.map((raw, position) => {
    const id = byRaw.get(raw);
    if (!id) throw Errors.invalidInput(`Ingredient '${raw}' is not part of the product.`, { raw });
    return this.prisma.productIngredient.update({ where: { id }, data: { position } });
  });
  await this.prisma.$transaction(updates);
}
```
(Duplicate raw edge: acceptable.)

createProfile / findProfile are trivial.

upsertResult:
```ts
async upsertResult(productId: string, versionId: string, payload: Prisma.InputJsonValue): Promise<ClassificationResult> {
  return this.prisma.classificationResult.upsert({
    where: { productId_versionId: { productId, versionId } },
    update: { payload },
    create: { productId, versionId, payload },
  });
}
```
The service passes a typed payload; cast: the service calls `this.repo.upsertResult(product.id, version.id, payload as unknown as Prisma.InputJsonValue)`. Or the repo accepts `object` and casts internally: `payload: object` → `payload as Prisma.InputJsonValue`. I'll type the parameter as `Prisma.InputJsonValue` and cast in the service. Either way — repo accepts `Prisma.InputJsonValue`.

countResults:
```ts
async countResults(versionId: string): Promise<number> {
  return this.prisma.classificationResult.count({ where: { versionId } });
}
```
The test can use it via prisma directly; but the service's publish returns product count. The test can count via svc? The test has prisma directly; fine.

**Now, the full service file.** Let me write it carefully.

```ts
import { Injectable } from '@nestjs/common';
import { RuleKind, VersionStatus } from '@prisma/client';
import type { MethodologyVersion } from '@prisma/client';
import { Errors } from '../common/api-error.js';
import {
  ClassificationRepository,
  ProductWithIngredients,
  RuleWithIngredient,
} from './classification.repository.js';
import { normalizeInci } from './inci-normalizer.js';
import type { IngredientFixture, MethodologyFixture } from './fixtures.js';

export type Severity = 'banned' | 'restricted' | 'watch';
export type Flag = 'unknown' | 'none' | Severity;

export interface Finding { raw, canonical, recognized, flag, severity, source, matchedVia, modifierContext }
export interface ClassificationSummary { total: number; recognized: number; unknown: number }
export interface StoredPayload { schema: 1; methodologyVersion: string; findings: Finding[]; confidence: number; summary: ClassificationSummary }
export interface ClassificationOutput { productId: string; methodologyVersion: string; profile: string | null; findings: Finding[]; confidence: number; summary: ClassificationSummary; disclaimer: string }
export interface StoredResultView { productId: string; methodologyVersion: string; findings: Finding[]; confidence: number; summary: ClassificationSummary; disclaimer: string }

export const DISCLAIMER = '...';
export const MODIFIER_PRECEDENCE = ['child_under_3', 'pregnancy'] as const;

const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };

interface ModifierCandidate { rank: number; order: number; severity: Severity; source: string; context: string | null }

function findingSortKey(finding: Finding): string {
  return finding.recognized
    ? `0\u0000${finding.canonical}\u0000${finding.raw}`
    : `1\u0000${normalizeInci(finding.raw)}\u0000${finding.raw}`;
}

export function applyProfileModifiers(findings, modifiers, contexts): Finding[] { ... as sketched ... }

export function buildBaseClassification(rawIngredients: string[], resolutionMap: Map<string, ResolutionEntry>, baseRules: Map<string, { severity: Severity; source: string }>): { findings: Finding[]; confidence: number; summary: ClassificationSummary } { ... }
```

Need to import the ResolutionEntry type from the repository.

Service class methods as sketched. Let me finalize `ingestMethodology`'s immutability check:

```ts
async ingestMethodology(fix: MethodologyFixture): Promise<{ versionId: string; slug: string; upserted: number; unchanged: number }> {
  const existing = await this.repo.findVersion(fix.slug);
  const version = existing ?? (await this.repo.createVersion(fix.slug, fix.name));
  let upserted = 0;
  let unchanged = 0;
  for (const rule of fix.rules) {
    const kind = rule.kind === 'context' ? RuleKind.CONTEXT : RuleKind.BASE;
    const context = rule.kind === 'context' ? rule.context ?? '' : '';
    const found = await this.repo.findRuleByKeys(version.id, rule.ingredient, kind, context);
    const identical = found !== null && found.severity.toLowerCase() === rule.severity && found.source === rule.source;
    if (identical) { unchanged += 1; continue; }
    if (version.status === VersionStatus.PUBLISHED) {
      throw Errors.methodologyImmutable(version.slug, rule.ingredient);
    }
    await this.repo.upsertRule(version.id, rule.ingredient, rule.severity, rule.source, kind, context);
    upserted += 1;
  }
  return { versionId: version.id, slug: version.slug, upserted, unchanged };
}
```
Wait — if the version is published and the rule is identical → allow (no-op). If published and different/new → immutable error ✓. If draft and different → update (allowed; not yet published, so the version can change) ✓.

Hmm: `found.severity` is the Prisma enum type RuleSeverity (string enum) — `.toLowerCase()` works on it (it's a string). TS: the enum type is a string literal union → toLowerCase exists ✓.

`publish`:
```ts
async publish(versionIdOrSlug: string): Promise<{ versionId: string; slug: string; newlyPublished: boolean; products: number }> {
  const version = await this.repo.findVersion(versionIdOrSlug);
  if (!version) throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
  const newlyPublished = version.status === VersionStatus.DRAFT;
  if (newlyPublished) await this.repo.markVersionPublished(version.id);
  const { products } = await this.rescore(version.id);
  return { versionId: version.id, slug: version.slug, newlyPublished, products };
}
```

`rescore`:
```ts
async rescore(versionIdOrSlug: string): Promise<{ versionId: string; products: number }> {
  const version = await this.repo.findVersion(versionIdOrSlug);
  if (!version) throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
  const [products, resolutionMap, rules] = await Promise.all([
    this.repo.listProducts(),
    this.repo.findResolutionMap(),
    this.repo.findRulesByVersion(version.id),
  ]);
  for (const product of products) {
    await this.upsertStoredResult(product, version, resolutionMap, rules);
  }
  return { versionId: version.id, products: products.length };
}
```

`upsertStoredResult`:
```ts
private async upsertStoredResult(
  product: ProductWithIngredients,
  version: Pick<MethodologyVersion, 'id' | 'slug'>,
  resolutionMap: Map<string, ResolutionEntry>,
  rules: RuleWithIngredient[],
): Promise<void> {
  const baseRules = new Map<string, { severity: Severity; source: string }>();
  for (const rule of rules) {
    if (rule.kind !== RuleKind.BASE) continue;
    baseRules.set(rule.ingredient.name, { severity: rule.severity.toLowerCase() as Severity, source: rule.source });
  }
  const { findings, confidence, summary } = buildBaseClassification(
    product.ingredients.map((row) => row.raw),
    resolutionMap,
    baseRules,
  );
  const payload: StoredPayload = { schema: 1, methodologyVersion: version.slug, findings, confidence, summary };
  await this.repo.upsertResult(product.id, version.id, payload as unknown as Prisma.InputJsonValue);
}
```
Need `import type { Prisma } from '@prisma/client'`? Prisma namespace value vs type — `Prisma.InputJsonValue` is a type → `import type { Prisma } from '@prisma/client';`? Prisma is a namespace; import type of a namespace works for its type members ✓.

Hmm wait, actually it's simpler: have the repo's upsertResult accept `payload: object` and cast internally. Then the service passes the payload directly. Let me do that — the repo is the DB layer; the cast belongs there:
```ts
async upsertResult(productId: string, versionId: string, payload: object): Promise<ClassificationResult> {
  const json = payload as Prisma.InputJsonValue;
  ...
}
```
The service imports Prisma? No — the repo imports Prisma. ✓ cleaner.

`classify` and `getStoredResult` as sketched.

`createProduct`:
```ts
async createProduct(name: string, brand: string | null, ingredients: string[]): Promise<{ id: string }> {
  const product = await this.repo.createProduct(name, brand, ingredients);
  return { id: product.id };
}
```
Hmm — return the full product? A controller endpoint returning {id} is thin; return the product with createdAt? Let me return `{ id, name, brand, ingredientCount }`. Meh — simplest: return the created product object. `return product;` (id, name, brand, createdAt). OK.

`createProfile` similarly returns the profile.

`reorderProductIngredients` with validation as sketched.

`listVersions` → repo.listVersions() map to plain {id, slug, name, status, publishedAt}.

**Now `buildBaseClassification`**:

```ts
export function buildBaseClassification(
  rawIngredients: string[],
  resolutionMap: Map<string, ResolutionEntry>,
  baseRules: Map<string, { severity: Severity; source: string }>,
): { findings: Finding[]; confidence: number; summary: ClassificationSummary } {
  const findings: Finding[] = rawIngredients.map((raw) => {
    const key = normalizeInci(raw);
    const hit = key === '' ? undefined : resolutionMap.get(key);
    if (hit === undefined) {
      return { raw, canonical: null, recognized: false, flag: 'unknown', severity: null, source: null, matchedVia: null, modifierContext: null };
    }
    const rule = baseRules.get(hit.canonicalName);
    return {
      raw,
      canonical: hit.canonicalName,
      recognized: true,
      flag: rule ? rule.severity : 'none',
      severity: rule ? rule.severity : null,
      source: rule ? rule.source : null,
      matchedVia: hit.matchedVia,
      modifierContext: null,
    };
  });

  findings.sort((a, b) => {
    const ka = findingSortKey(a);
    const kb = findingSortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const total = findings.length;
  const recognized = findings.reduce((n, f) => n + (f.recognized ? 1 : 0), 0);
  const unknown = total - recognized;
  // Confidence = fraction of the list we could resolve; unknowns lower it. Empty list → 0.
  const confidence = total === 0 ? 0 : Math.round((recognized / total) * 10000) / 10000;
  return { findings, confidence, summary: { total, recognized, unknown } };
}
```

Type note: `flag: 'unknown'` — in the object literal within the array typed Finding[], the flag union includes 'unknown' ✓.

**`applyProfileModifiers`** final:

```ts
export function applyProfileModifiers(
  findings: Finding[],
  modifiers: Array<{ canonicalName: string; context: string; severity: Severity; source: string }>,
  contexts: readonly string[],
): Finding[] {
  const activeContexts = new Set(contexts);
  if (activeContexts.size === 0 || modifiers.length === 0) return findings;

  const byIngredient = new Map<string, Array<{ context: string; severity: Severity; source: string }>>();
  for (const modifier of modifiers) {
    if (!activeContexts.has(modifier.context)) continue;
    const list = byIngredient.get(modifier.canonicalName);
    if (list) list.push(modifier); else byIngredient.set(modifier.canonicalName, [modifier]);
  }

  return findings.map((finding) => {
    if (!finding.recognized || finding.canonical === null) return finding;
    const candidates: ModifierCandidate[] = [];
    if (finding.severity !== null && finding.source !== null) {
      candidates.push({ rank: SEVERITY_RANK[finding.severity], order: -1, severity: finding.severity, source: finding.source, context: null });
    }
    for (const modifier of byIngredient.get(finding.canonical) ?? []) {
      const precedence = MODIFIER_PRECEDENCE.indexOf(modifier.context);
      candidates.push({
        rank: SEVERITY_RANK[modifier.severity],
        order: precedence === -1 ? MODIFIER_PRECEDENCE.length : precedence,
        severity: modifier.severity,
        source: modifier.source,
        context: modifier.context,
      });
    }
    if (candidates.length === 0) return finding;
    candidates.sort((a, b) => b.rank - a.rank || a.order - b.order);
    const winner = candidates[0];
    return { ...finding, flag: winner.severity, severity: winner.severity, source: winner.source, modifierContext: winner.context };
  });
}
```
`MODIFIER_PRECEDENCE` typed `readonly string[]` — indexOf OK. As const → readonly ['child_under_3','pregnancy'] — indexOf exists on readonly arrays ✓. `MODIFIER_PRECEDENCE.length` ✓.

**Modifier precedence comment** — place above the MODIFIER_PRECEDENCE constant. ✓

**Now the controller file in full:**

```ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Errors } from '../common/api-error.js';
import { ClassificationService } from './classification.service.js';
import { PROFILE_CONTEXTS } from './fixtures.js';
import type { MethodologyFixture } from './fixtures.js';

const SEVERITIES = ['banned', 'restricted', 'watch'];

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw Errors.invalidInput(`${field} must be a non-empty string.`, { field });
  }
  return value;
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw Errors.invalidInput('Request body must be a JSON object.', {});
  }
  return body as Record<string, unknown>;
}

function assertProductInput(body: unknown): { name: string; brand: string | null; ingredients: string[] } {
  const b = asObject(body);
  const name = asNonEmptyString(b.name, 'name');
  let brand: string | null = null;
  if (b.brand !== undefined && b.brand !== null) brand = asNonEmptyString(b.brand, 'brand');
  if (!Array.isArray(b.ingredients)) throw Errors.invalidInput('ingredients must be an array of INCI strings.', { field: 'ingredients' });
  const ingredients = b.ingredients.map((value, index) => asNonEmptyString(value, `ingredients[${index}]`));
  return { name, brand, ingredients };
}

function assertProfileInput(body: unknown): { name: string; contexts: string[] } {
  const b = asObject(body);
  const name = asNonEmptyString(b.name, 'name');
  let contexts: string[] = [];
  if (b.contexts !== undefined && b.contexts !== null) {
    if (!Array.isArray(b.contexts)) throw Errors.invalidInput('contexts must be an array of profile contexts.', { field: 'contexts' });
    contexts = b.contexts.map((value, index) => asNonEmptyString(value, `contexts[${index}]`));
    for (const context of contexts) {
      if (!PROFILE_CONTEXTS.includes(context)) {
        throw Errors.invalidInput(`Unknown profile context '${context}'. Allowed: ${PROFILE_CONTEXTS.join(', ')}.`, { field: 'contexts', context });
      }
    }
  }
  return { name, contexts };
}

function assertMethodologyFixture(body: unknown): MethodologyFixture {
  const b = asObject(body);
  const slug = asNonEmptyString(b.slug, 'slug');
  const name = asNonEmptyString(b.name, 'name');
  if (!Array.isArray(b.rules) || b.rules.length === 0) throw Errors.invalidInput('rules must be a non-empty array.', { field: 'rules' });
  const rules = b.rules.map((value, index) => {
    const field = `rules[${index}]`;
    const r = asObject(value);
    const ingredient = asNonEmptyString(r.ingredient, `${field}.ingredient`);
    const kind = r.kind;
    if (kind !== 'base' && kind !== 'context') throw Errors.invalidInput(`${field}.kind must be 'base' or 'context'.`, { field });
    const severity = asNonEmptyString(r.severity, `${field}.severity`);
    if (!SEVERITIES.includes(severity)) throw Errors.invalidInput(`${field}.severity must be one of ${SEVERITIES.join(', ')}.`, { field });
    const source = asNonEmptyString(r.source, `${field}.source`);
    if (kind === 'base') {
      if (r.context !== undefined) throw Errors.invalidInput(`${field}.context is only allowed for context rules.`, { field });
      return { ingredient, kind: 'base' as const, severity: severity as 'banned'|'restricted'|'watch', source };
    }
    const context = asNonEmptyString(r.context, `${field}.context`);
    if (!PROFILE_CONTEXTS.includes(context)) throw Errors.invalidInput(`Unknown context '${context}'. Allowed: ${PROFILE_CONTEXTS.join(', ')}.`, { field });
    return { ingredient, kind: 'context' as const, context, severity: severity as 'banned'|'restricted'|'watch', source };
  });
  return { slug, name, rules };
}
```

PROFILE_CONTEXTS type: `readonly ProfileContext[]` where ProfileContext = 'child_under_3' | 'pregnancy'. `.includes(context)` with context: string — TS: readonly ('child_under_3'|'pregnancy')[].includes(string) → error! Array.prototype.includes requires the argument to be of the element type. `readonly ProfileContext[]` includes(string) → TS error "Argument of type 'string' is not assignable to parameter of type 'ProfileContext'". Fix: cast, or type PROFILE_CONTEXTS as `readonly string[]`. Let me type it `export const PROFILE_CONTEXTS: readonly string[] = ['child_under_3', 'pregnancy'];` — avoids the friction. ✓ (I'll also use string for the severity check with a SEVERITIES array.)

Controller class:

```ts
@Controller()
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Post('products')
  createProduct(@Body() body: unknown) {
    const { name, brand, ingredients } = assertProductInput(body);
    return this.classificationService.createProduct(name, brand, ingredients);
  }

  @Get('products/:productId/classification')
  classify(@Param('productId') productId: string, @Query('profileId') profileId?: string) {
    return this.classificationService.classify(productId, profileId || undefined);
  }

  @Get('products/:productId/classification-results')
  getStoredResult(@Param('productId') productId: string, @Query('methodologyVersionId') methodologyVersionId?: string) {
    if (!methodologyVersionId) throw Errors.invalidInput('methodologyVersionId query parameter is required.', { field: 'methodologyVersionId' });
    return this.classificationService.getStoredResult(productId, methodologyVersionId);
  }

  @Post('profiles')
  createProfile(@Body() body: unknown) {
    const { name, contexts } = assertProfileInput(body);
    return this.classificationService.createProfile(name, contexts);
  }

  @Get('methodology-versions')
  listMethodologyVersions() {
    return this.classificationService.listVersions();
  }

  @Post('methodology-versions')
  ingestMethodology(@Body() body: unknown) {
    return this.classificationService.ingestMethodology(assertMethodologyFixture(body));
  }

  @Post('methodology-versions/:versionId/publish')
  publishMethodology(@Param('versionId') versionId: string) {
    return this.classificationService.publish(versionId);
  }

  @Post('methodology-versions/:versionId/rescore')
  rescoreMethodology(@Param('versionId') versionId: string) {
    return this.classificationService.rescore(versionId);
  }
}
```

**Now the test file** — write it in full.

```ts
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service.js';
import { ClassificationRepository } from '../src/classification/classification.repository.js';
import { ClassificationService } from '../src/classification/classification.service.js';
import { INGREDIENT_FIXTURES, METHODOLOGY_V1, METHODOLOGY_V2 } from '../src/classification/fixtures.js';

// The tests run against a real PostgreSQL database.
// Requires DATABASE_URL with the schema applied: pnpm prisma migrate deploy

const prisma = new PrismaClient();

function buildService(): ClassificationService {
  const repository = new ClassificationRepository(prisma as unknown as PrismaService);
  return new ClassificationService(repository);
}

let service: ClassificationService;

async function wipeDatabase(): Promise<void> {
  await prisma.$transaction([
    prisma.classificationResult.deleteMany({}),
    prisma.rule.deleteMany({}),
    prisma.synonym.deleteMany({}),
    prisma.productIngredient.deleteMany({}),
    prisma.methodologyVersion.deleteMany({}),
    prisma.profile.deleteMany({}),
    prisma.product.deleteMany({}),
    prisma.ingredient.deleteMany({}),
  ]);
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at a PostgreSQL database with the schema applied (pnpm prisma migrate deploy).');
  }
  await wipeDatabase();
  service = buildService();
  await service.ingestIngredients(INGREDIENT_FIXTURES);
  await service.ingestMethodology(METHODOLOGY_V1);
  await service.publish('v1');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ingredient classification (L2 spec #319)', () => {
  it('a profile flips a finding the base rules alone would not flag', async () => {
    const product = await service.createProduct('Citral Lotion', null, ['Water', 'Citral']);
    const base = await service.classify(product.id);
    const citral = base.findings.find((f) => f.canonical === 'Citral');
    expect(citral).toBeDefined();
    expect(citral!.severity).toBeNull();
    expect(citral!.flag).toBe('none');

    const profile = await service.createProfile('Pregnancy', ['pregnancy']);
    const withProfile = await service.classify(product.id, profile.id);
    const flagged = withProfile.findings.find((f) => f.canonical === 'Citral');
    expect(flagged!.severity).toBe('restricted');
    expect(flagged!.flag).toBe('restricted');
    expect(flagged!.source).toContain('pregnancy');
    expect(flagged!.modifierContext).toBe('pregnancy');
  });

  it('an unrecognized ingredient is listed as unknown and lowers confidence', async () => {
    const known = await service.createProduct('Known Ingredients Only', null, ['Water', 'Tocopherol']);
    const withUnknown = await service.createProduct('Has Unknown Ingredient', null, ['Water', 'Tocopherol', 'Zinc Gluconate']);

    const clean = await service.classify(known.id);
    const dirty = await service.classify(withUnknown.id);

    expect(clean.confidence).toBe(1);
    const unknown = dirty.findings.find((f) => f.raw === 'Zinc Gluconate');
    expect(unknown).toBeDefined();
    expect(unknown!.recognized).toBe(false);
    expect(unknown!.flag).toBe('unknown');
    expect(unknown!.canonical).toBeNull();
    expect(unknown!.severity).toBeNull();
    expect(dirty.summary).toEqual({ total: 3, recognized: 2, unknown: 1 });
    expect(dirty.confidence).toBeLessThan(clean.confidence);
    expect(dirty.confidence).toBe(0.6667);
  });

  it('resolves synonyms and OCR typos to the canonical ingredient', async () => {
    const product = await service.createProduct('Synonym Sample', null, ['WATER', 'Parfume', 'Metylparaben', 'Vitamin E', 'linarool']);
    const out = await service.classify(product.id);
    const byRaw = new Map(out.findings.map((f) => [f.raw, f]));
    expect(byRaw.get('WATER')!.canonical).toBe('Aqua');
    expect(byRaw.get('WATER')!.matchedVia).toBe('synonym');
    expect(byRaw.get('Parfume')!.canonical).toBe('Fragrance');
    expect(byRaw.get('Metylparaben')!.canonical).toBe('Methylparaben');
    expect(byRaw.get('Vitamin E')!.canonical).toBe('Tocopherol');
    expect(byRaw.get('linarool')!.canonical).toBe('Linalool');
    expect(out.summary.unknown).toBe(0);
    expect(out.confidence).toBe(1);
    // the resolved ingredient carries the canonical's rule, not the alias's
    expect(byRaw.get('Metylparaben')!.severity).toBe('watch');
    expect(byRaw.get('linarool')!.source).toBe('EC 1223/2009, Annex III, 683');
  });

  it('returns identical output across reruns', async () => {
    const product = await service.createProduct('Rerun Sample', 'Acme', ['Fragrance', 'Water', 'Methylparaben', 'Citral']);
    const first = await service.classify(product.id);
    const second = await service.classify(product.id);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('returns identical output when the stored ingredient order is shuffled', async () => {
    const ordered = ['Fragrance', 'Water', 'Methylparaben', 'Citral', 'Tocopherol'];
    const shuffled = ['Citral', 'Tocopherol', 'Methylparaben', 'Fragrance', 'Water'];
    const product = await service.createProduct('Shuffle Sample', null, ordered);
    const before = await service.classify(product.id);
    await service.reorderProductIngredients(product.id, shuffled);
    const after = await service.classify(product.id);
    expect(after).toEqual(before);
  });

  it('two modifiers on one ingredient resolve by the written precedence', async () => {
    const family = await service.createProfile('Family', ['child_under_3', 'pregnancy']);
    const fragrance = await service.createProduct('Fragrance Sample', null, ['Fragrance', 'Water']);
    const retinoid = await service.createProduct('Retinoid Sample', null, ['Retinyl Palmitate', 'Water']);

    const fragranceOut = await service.classify(fragrance.id, family.id);
    const frag = fragranceOut.findings.find((f) => f.canonical === 'Fragrance');
    // child_under_3 is RESTRICTED, pregnancy is WATCH -> max severity wins
    expect(frag!.severity).toBe('restricted');
    expect(frag!.source).toContain('under 3');
    expect(frag!.modifierContext).toBe('child_under_3');

    const retinoidOut = await service.classify(retinoid.id, family.id);
    const retinyl = retinoidOut.findings.find((f) => f.canonical === 'Retinyl Palmitate');
    // both modifiers are RESTRICTED -> fixed precedence (child_under_3 first) picks the citation
    expect(retinyl!.severity).toBe('restricted');
    expect(retinyl!.source).toContain('under 3');
    expect(retinyl!.modifierContext).toBe('child_under_3');
  });

  it('keeps v1 and v2 results retrievable for the same product after publishing v2', async () => {
    const product = await service.createProduct('Dual Version Sample', null, ['Methylparaben', 'Citral', 'Water']);
    await service.classify(product.id); // lazy-scores under the active version (v1)
    const v1Before = await service.getStoredResult(product.id, 'v1');

    await service.ingestMethodology(METHODOLOGY_V2);
    await service.publish('v2');

    const v1 = await service.getStoredResult(product.id, 'v1');
    const v2 = await service.getStoredResult(product.id, 'v2');

    // the old result is exactly what it was
    expect(v1).toEqual(v1Before);

    // the new version scores the same product differently where rules changed
    expect(v1.findings.find((f) => f.canonical === 'Methylparaben')!.severity).toBe('watch');
    expect(v2.findings.find((f) => f.canonical === 'Methylparaben')!.severity).toBe('restricted');
    expect(v1.findings.find((f) => f.canonical === 'Citral')!.severity).toBeNull();
    expect(v2.findings.find((f) => f.canonical === 'Citral')!.severity).toBe('watch');

    // re-scoring is idempotent: republishing v2 changes nothing
    const rowsBefore = await prisma.classificationResult.count({ where: { version: { slug: 'v2' } } });
    const rowBefore = await prisma.classificationResult.findFirst({ where: { productId: product.id, version: { slug: 'v2' } } });
    await service.publish('v2');
    const rowsAfter = await prisma.classificationResult.count({ where: { version: { slug: 'v2' } } });
    const rowAfter = await prisma.classificationResult.findFirst({ where: { productId: product.id, version: { slug: 'v2' } } });
    expect(rowsAfter).toBe(rowsBefore);
    expect(rowAfter!.payload).toEqual(rowBefore!.payload);

    const active = await service.classify(product.id);
    expect(active.methodologyVersion).toBe('v2');
  });
});
```

Wait — `expect(flagged!.source).toContain('pregnancy')` — the source is 'Curated watch list, 2025-Q1: citral in pregnancy' ✓ contains 'pregnancy'.

fragrance source 'under 3': the v1 child_under_3 fragrance source: 'Curated watch list, 2025-Q1: fragrance for children under 3' → contains 'under 3' ✓. Retinyl child: 'Curated watch list, 2025-Q1: retinoids for children under 3' ✓.

**Test ordering dependency**: the coexistence test must run last (it publishes v2). Vitest runs `it` blocks in definition order by default ✓. I'll add a comment in that test: "runs last: publishes v2 and changes the active version for subsequent tests."

**One concern**: `service.classify(product.id)` in the coexistence test — the active version at that point is v1 (v2 not yet published) ✓.

**Also note**: the re-run test and the shuffle test run before v2 → v1 active ✓.

**Now — `createProduct` returns a product object including createdAt (Date)** — the test uses product.id ✓.

**Deep equal in the shuffle test**: `before` and `after` — `before` was computed with v1 active and stored; after reorder, the stored v1 result exists (from the first classify) → classify reads the stored → identical ✓. Note: reorder does not invalidate the stored result — the stored result is still valid (same ingredient set). ✓ (The stored row is keyed by (product, version), not by the order — good.)

**Now, check `JSON.stringify(second) === JSON.stringify(first)`** — same key order ✓ (same code path builds objects; both from the same stored payload + applyProfileModifiers map — key order preserved: the spread {...finding} preserves the original key order ✓).

**applyProfileModifiers with no profile**: contexts [] → returns findings as-is (same array) ✓.

**Now, let me re-check the `classify` lazy path**: `Promise.all([findResult, findRulesByVersion])`; if stored is null → need resolutionMap → additional await inside the if (fine, not in Promise.all).

```ts
const [stored, rules] = await Promise.all([...]);
let storedRow = stored;
if (!storedRow) {
  const resolutionMap = await this.repo.findResolutionMap();
  storedRow = await this.upsertStoredResult(product, version, resolutionMap, rules);
}
```
upsertStoredResult returns the row (repo returns the ClassificationResult). Let me have upsertStoredResult return the repo's upsert result. ✓

**Now, the `MethodologyVersion` type import in the service** for the Pick — I'll use `Pick<MethodologyVersion, 'id' | 'slug'>`; but the repo's findVersion returns MethodologyVersion ✓; upsertStoredResult is also called from rescore with a version ✓.

**Repository `findRulesByVersion` orderBy kind asc** — the enum sorts as strings 'BASE' < 'CONTEXT' ✓ deterministic.

**The `RuleWithIngredient` type**:
```ts
export type RuleWithIngredient = Rule & { ingredient: { name: string } };
```
Import type { Rule } from '@prisma/client'.

**Potential TS issue**: the repository imports `VersionStatus` (value) used in markVersionPublished's data.status — Prisma accepts the enum value ✓.

**Now, the Prisma client is generated** — `@prisma/client` without generate throws at import ("@prisma/client did not initialize yet"). The README instructs to generate first. Fine.

**Also re-check the test file path convention**: `test/<feature>.spec.ts` → `test/classification.spec.ts` ✓.

**Now, file `prisma/migrations/20250101000000_init/migration.sql`** — as above. And `migration_lock.toml`.

Wait — Prisma migration folder name format: `20250101000000_init` (timestamp_underscore_name) ✓.

**`.env.example`** — fine.

**README** — write it.

Let me also reconsider whether to include the `GET /methodology-versions` endpoint — yes, small.

**`listVersions` service**:
```ts
async listVersions(): Promise<Array<{ id: string; slug: string; name: string; status: string; publishedAt: string | null }>> {
  const versions = await this.repo.listVersions();
  return versions.map((v) => ({ id: v.id, slug: v.slug, name: v.name, status: v.status, publishedAt: v.publishedAt?.toISOString() ?? null }));
}
```
status is the enum → string ✓.

**Edge: `ingestIngredients`** — should it be idempotent? Upserts ✓.

```ts
async ingestIngredients(fixtures: IngredientFixture[]): Promise<{ ingredients: number; synonyms: number }> {
  let synonyms = 0;
  for (const fixture of fixtures) {
    const ingredient = await this.repo.upsertIngredient(fixture.name);
    for (const synonym of fixture.synonyms) {
      await this.repo.upsertSynonym(ingredient.id, synonym);
      synonyms += 1;
    }
  }
  return { ingredients: fixtures.length, synonyms };
}
```

**createProfile**:
```ts
async createProfile(name: string, contexts: string[]): Promise<Profile> {
  return this.repo.createProfile(name, contexts);
}
```
Import type { Profile } from the repo? The service can return the repo's type; import type { Profile } from '@prisma/client' in the service? The repo re-exports? Just `import type { Profile } from '@prisma/client';`. OK.

Actually — hmm, the service returning the Prisma model type directly is fine.

**Now — final check on "service: zero Prisma client calls"** — the service only calls repo methods ✓. The repo has all prisma calls ✓. The controller has no prisma ✓.

**"controller: zero business logic"** — the assertions validate shape only ✓.

**Naming conventions**: files kebab-case.role.ts: classification.module.ts ✓, classification.controller.ts ✓, classification.service.ts ✓, classification.repository.ts ✓, inci-normalizer.ts (no role — a small deviation; acceptable as a pure helper module… convention is "TS file: kebab-case.role.ts". To be safe, name it `classification.normalizer.ts`? Hmm, that reads like a role in the feature. `src/classification/inci-normalizer.ts` vs `classification.normalizer.ts`. Let me go with `src/classification/inci-normalizer.ts` — it's a domain utility, not a role. Fine.

`fixtures.ts` → `src/classification/fixtures.ts`. Also not a role. Acceptable.

Common files: prisma.service.ts / prisma.module.ts follow <name>.role.ts ✓; all-exceptions.filter.ts — role 'filter' ✓; api-error.ts — hmm, `api-error.ts` is kebab-case without a role. Rename `errors.api.ts`? Ugly. Keep api-error.ts; it's a shared module. OK.

**Now, let me write the final README**:

```md
# cosmetics-scanner

Classifies cosmetics from their INCI ingredient lists. Rules come from a regulator's
restricted list and a curated watch list, each cited and grouped under an immutable
methodology version. Output is per-ingredient findings with source citations — never
a binary safe/toxic verdict.

Stack: TypeScript (strict, ESM), NestJS, Prisma, PostgreSQL, Vitest, pnpm.

## Setup

    cp .env.example .env            # set DATABASE_URL
    pnpm install
    pnpm prisma:generate
    pnpm prisma:migrate             # applies prisma/migrations
    pnpm start:dev                  # or: pnpm build && pnpm start
    pnpm test                       # needs the same DATABASE_URL

Configuration comes from environment variables only: `DATABASE_URL`, `PORT`.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /products | Create a product with an ordered INCI list |
| POST | /profiles | Create a family profile (contexts: child_under_3, pregnancy) |
| GET | /products/:productId/classification?profileId= | classify: active methodology + optional profile |
| GET | /products/:productId/classification-results?methodologyVersionId=v1 | stored result for an explicit version |
| POST | /methodology-versions | Ingest a methodology version (rules with citations) |
| POST | /methodology-versions/:versionId/publish | Publish (immutable) + idempotent re-score of all products |
| POST | /methodology-versions/:versionId/rescore | Re-run the (idempotent) re-score |
| GET | /methodology-versions | List versions |

Errors use one envelope: `{ "error": { "code", "message", "details" } }` with
snake_case codes: invalid_input, resource_not_found, no_published_methodology,
methodology_immutable, internal_error.

## How classification works

1. Normalize each listed ingredient (case, accents, whitespace) and resolve it
   against canonical ingredients and their synonyms/typo variants (fixture data in
   `src/classification/fixtures.ts`). What does not resolve is **unknown**: listed in
   the output, counted against confidence, never dropped or treated as clean.
2. Base rules of the active (latest published) methodology version set each
   ingredient's flag, severity, and source citation.
3. Profile context modifiers tighten (never loosen) the severity by the precedence
   below.

Results are stored keyed by (product, methodologyVersion). Publishing a new version
re-scores all products into new rows; stored rows are never rewritten, so previous
versions stay retrievable exactly as they were. Re-scoring is idempotent (upsert on
the (product, version) key, deterministic payload).

Confidence is the fraction of the list that resolved to a known ingredient, rounded
to 4 decimals (an empty list is 0). Unknown ingredients lower it.

Output ordering is deterministic: findings are sorted by canonical name, then by
normalized raw text — the stored ingredient order never leaks into the output.

## Modifier precedence (written down)

Given the base severity of an ingredient in the active methodology version and the
context modifiers whose context is present in the profile:

1. A modifier may only tighten, never loosen: effective severity is the maximum of
   the base severity and the modifier severities (banned > restricted > watch).
2. Ties are broken by fixed context precedence: `child_under_3`, then `pregnancy`
   (`MODIFIER_PRECEDENCE` in `src/classification/classification.service.ts`).
   If the base rule and a modifier tie, the base citation wins.
3. Contexts outside the precedence list sort after it, in rule-table order.
4. Modifiers never apply to unknown (unresolved) ingredients.

The winner is chosen by (severity rank, precedence index) — never by iteration order —
so two modifiers on one ingredient resolve the same way every time.

## Assumptions

- The task references "provided" synonym/typo fixtures; none were attached to this
  repo, so the fixture data in `src/classification/fixtures.ts` is a stand-in shaped
  to cover the required behaviours.
- Family profiles carry the contexts `child_under_3` and `pregnancy`; a profile may
  have several, and modifiers from all of them combine.
```

Good — it includes the ASSUMPTION note too (plus in-code markers).

Now, let me check a few remaining TS details:

1. `import { PROFILE_CONTEXTS } from './fixtures.js'` in the controller — value import ✓ (const array).
2. `severity as Severity` cast in the controller's assertMethodologyFixture — SEVERITIES is string[]; after the includes check, cast. ✓
3. `kind` narrowing: `const kind = r.kind; if (kind !== 'base' && kind !== 'context') throw ...` — TS narrows the union after the check ✓ (kind: unknown → after the two !== checks, kind: 'base'|'context' ✓).
4. `rules` type in assertMethodologyFixture: the map returns a union of two object shapes; MethodologyFixture.rules is RuleFixture[] — a union element is assignable to RuleFixture? RuleFixture: { ingredient: string; kind: 'base'|'context'; severity: Severity; source: string; context?: ProfileContext }. The base shape { ingredient, kind:'base', severity: Severity, source } ✓; the context shape { ingredient, kind:'context', context: string, severity, source } — context: string vs ProfileContext… I typed PROFILE_CONTEXTS as readonly string[]; and ProfileContext type = 'child_under_3' | 'pregnancy'. If the fixture's RuleFixture.context is ProfileContext, then a string isn't assignable. Fix: type RuleFixture.context as `string` (validated at the boundary) — simplest: `context?: string`. Do that. Similarly IngredientFixture is fine.

Let me finalize fixtures.ts types:

```ts
export const PROFILE_CONTEXTS: readonly string[] = ['child_under_3', 'pregnancy'];

export interface IngredientFixture { name: string; synonyms: string[]; }
export interface RuleFixture {
  ingredient: string;
  kind: 'base' | 'context';
  severity: 'banned' | 'restricted' | 'watch';
  source: string;
  context?: string;
}
export interface MethodologyFixture { slug: string; name: string; rules: RuleFixture[]; }
```
✓ the controller's cast `severity: severity as 'banned'|'restricted'|'watch'` is fine.

5. Service's `ingestMethodology(fix: MethodologyFixture)` — `rule.kind === 'context' ? RuleKind.CONTEXT : RuleKind.BASE` ✓; `context = rule.kind === 'context' ? (rule.context ?? '') : ''` — context is required for kind context (the controller enforces; a direct service call might pass undefined → '' → findRuleByKeys with context '' vs CONTEXT kind — a mismatch, but a service-level guard: if (kind==='context' && !rule.context) throw Errors.invalidInput('context rules require a context.', ...). Add it ✓.

6. `found.severity.toLowerCase()` — severity is a RuleSeverity enum (string) ✓.

7. Repository: `import { Prisma, RuleKind, VersionStatus } from '@prisma/client';` — all used ✓ (Prisma for InputJsonValue cast in upsertResult).

8. Service imports: RuleKind, VersionStatus used ✓; type MethodologyVersion used in Pick ✓; type Profile used in createProfile return ✓.

9. The test imports PrismaService only for the cast ✓.

10. `prisma.classificationResult.count({ where: { version: { slug: 'v2' } } })` — Prisma supports relation filters ✓.

11. In the test, `rowAfter!.payload` — payload is `Prisma.JsonValue`; toEqual works ✓.

12. `expect(dirty.summary).toEqual({ total: 3, recognized: 2, unknown: 1 })` — property order irrelevant for toEqual ✓.

13. `createProduct('Rerun Sample', 'Acme', ...)` — brand 'Acme' ✓.

14. `reorderProductIngredients` in the service — sort comparison: existing map vs orderedRaws — must be the same multiset; the test passes an exact shuffle ✓.

15. In the repository's `reorderProductIngredients`, `updates` is an array of Promises → `$transaction(updates)` interactive? `$transaction(promiseArray)` — Prisma's batch transaction ✓.

16. main.ts's `void bootstrap();` ✓.

17. tsconfig "include": ["src", "test", "vitest.config.ts"] — vitest.config.ts uses defineConfig — @types are fine.

18. **Vitest ESM + `.js` imports**: the test imports `'../src/classification/classification.service.js'` → vite resolves to .ts ✓ (supported).

19. `PrismaClient` instantiation at module scope in the test — creates a client (doesn't connect until a query) ✓; the DATABASE_URL check is before use in beforeAll… but `new PrismaClient()` at import time with no DATABASE_URL — the constructor doesn't validate until connect ✓. Fine.

20. **Prisma + ESM**: Prisma 5's client works under ESM ✓.

21. Nest 10 ESM runtime via tsx: works (commonly used).

22. `@Global()` PrismaModule + ClassificationModule uses PrismaService via constructor DI — the global module provides it ✓. The convention says to import/export across modules — a @Global module is the standard Nest way; acceptable. Hmm, the wiring rule: "a provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other." A @Global module satisfies this (global = available everywhere). To be strictly literal, I could have ClassificationModule import PrismaModule (without @Global). Safer with respect to the stated rule: drop @Global and have ClassificationModule imports: [PrismaModule]. Let me do that — matches the convention exactly.

23. **Error details object** — ApiError's details parameter default {} ✓ never null.

24. Filter: for ApiError, `details: exception.details` ✓ object.

25. `AllExceptionsFilter` — `host.switchToHttp().getResponse<Response>()` — need `import type { Response } from 'express';` ✓.

26. `@Catch()` with no args catches everything ✓. APP_FILTER registration ✓.

27. **app.module** imports ClassificationModule ✓.

28. `classification.module.ts` — imports PrismaModule per #22.

Now — **let me reconsider the payload determinism across re-scores with the same version**: `upsertStoredResult` builds the payload from DB data (ingredients by position, resolution map, rules by deterministic order) → identical JSON ✓. But the JSONB storage: the payload object is serialized — same key order each time (same code) ✓.

29. **`findResolutionMap`'s map construction order** — only affects lookup, not output (findings are sorted) ✓.

30. **Confidence `Math.round((2/3)*10000)/10000`** = Math.round(6666.666...)/10000 = 6667/10000 = 0.6667 ✓. `expect(dirty.confidence).toBe(0.6667)` — 6667/10000 === 0.6667? JS: 0.6667 literal = 6667/10000 rounded to the nearest double; 6667/10000 computed = the same double? 6667/10000 → the IEEE division gives the correctly rounded double of 0.6667, which equals the double of the literal 0.6667 ✓ (same decimal → same parse → same double). Yes: the literal 0.6667 is parsed to the nearest double of 0.6667; the division 6667/10000 is correctly rounded to the nearest double of the exact quotient 0.6667 — both are the nearest double to 0.6667 ✓ equal.

31. `expect(clean.confidence).toBe(1)` — 2/2=1 → Math.round(1*10000)/10000 = 1 ✓.

32. **The coexistence test's `v1` deep equal `v1Before`**: v1Before is fetched via getStoredResult (a view object). After v2 publish, fetch again → same stored payload → same view object (disclaimer constant, same fields) → toEqual ✓.

33. In the coexistence test, after `publish('v2')`, `classify(product.id)` → active v2 → finds the stored (product,v2) ✓ returns methodologyVersion 'v2' ✓.

34. **The flip test's `service.createProfile('Pregnancy', ['pregnancy'])`** ✓.

35. **`ingestMethodology` returns upserted/unchanged** — unused by the test ✓.

36. **Test: 'resolves synonyms...'** — 'Vitamin E' → canonical 'Tocopherol' ✓ matchedVia 'synonym' (asserted only for WATER; fine).

37. **Unknown + confidence test** — 'Zinc Gluconate' — wait, is 'zinc gluconate' accidentally normalized to something in the fixtures? No ✓.

38. **Shuffle test** — `before` findings include all 5 recognized; after reorder, the same ✓.

39. **`applyProfileModifiers` returns the same array when there are no contexts** — `expect(after).toEqual(before)` unaffected ✓.

40. **`classify` with an unknown profileId** → 404 resource_not_found — not tested; fine.

41. **`Errors.noPublishedMethodology`** used when there is no published version — not tested (always one). Fine.

Now — **let me re-verify the migration SQL matches the schema** (a reviewer might run `prisma migrate deploy` then `prisma migrate diff` for drift check). Prisma's generated SQL conventions: enums first, tables, indexes, FKs. My SQL matches the standard format (column order, names). One risk: Prisma 5 uses `"published_at" TIMESTAMP(3)` ✓, JSONB ✓, TEXT[] with DEFAULT ARRAY[]::TEXT[] ✓. Unique index names: `model_column1_column2_key` ✓ matches my names. Composite FK indexes? Not needed. `migration_lock.toml` provider postgresql ✓.

Prisma's exact enum creation order: `CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');` ✓.

I think it's consistent. Small drift risks (e.g., Prisma might also create indexes for FKs in newer versions — Prisma 5 doesn't auto-index FKs; Prisma 6 also doesn't by default). Fine.

42. **`prisma/migrations` timestamp** — any format `YYYYMMDDHHMMSS` ✓.

43. **package.json prisma version 5.20** and @prisma/client 5.20 ✓ consistent.

44. **`"engines"`?** skip.

45. **`pnpm` note** — no lockfile can be provided (I can't generate one) — fine; the README says pnpm install.

Now, **let me re-verify the layering rule once more**: "service: … zero Prisma client calls." My service imports from '@prisma/client' only types (RuleKind, VersionStatus are runtime values — enums!). RuleKind.BASE is a value (string constant). Using enum values in the service — is that a "Prisma client call"? No — it's a constant, not a client call. But philosophically, should the service depend on Prisma's enums? Alternative: define my own string constants in the service and map in the repo. Hmm — the rule says zero Prisma *client calls* (i.e., no this.prisma.*). Using enum constants is fine and common. Keep.

Actually, wait — let me reduce friction: the service compares `rule.kind !== RuleKind.BASE` and `version.status === VersionStatus.DRAFT` — those are string comparisons against 'BASE'/'DRAFT'. Fine.

46. **Repository: `import { Errors }` used in reorderProductIngredients** ✓.

47. **`asObject` rejects arrays** ✓.

48. **`classify` query param profileId** — `@Query('profileId') profileId?: string` — Nest injects string | undefined ✓; `profileId || undefined` coerces empty string ✓.

49. **`getStoredResult` requires methodologyVersionId** — validated in the controller ✓.

50. **`@Param('versionId')`** in the publish route — path `methodology-versions/:versionId/publish` ✓ kebab-case ✓.

Now, **file count** — let me finalize:

1. package.json
2. tsconfig.json
3. vitest.config.ts
4. .env.example
5. README.md
6. prisma/schema.prisma
7. prisma/migrations/migration_lock.toml
8. prisma/migrations/20250101000000_init/migration.sql
9. src/main.ts
10. src/app.module.ts
11. src/common/prisma.module.ts
12. src/common/prisma.service.ts
13. src/common/api-error.ts
14. src/common/all-exceptions.filter.ts
15. src/classification/classification.module.ts
16. src/classification/classification.controller.ts
17. src/classification/classification.service.ts
18. src/classification/classification.repository.ts
19. src/classification/inci-normalizer.ts
20. src/classification/fixtures.ts
21. test/classification.spec.ts

21 files. Complete solution.

Wait — do I need a `nest-cli.json`? Only for nest build/start CLI; I use tsc directly + tsx. Skip.

**Recheck tsconfig for vitest + decorators**: vitest doesn't need tsconfig for runtime (esbuild reads tsconfig for experimentalDecorators) ✓.

One more: **`"strict": true`** with `b.ingredients.map((value, index) => ...)` — value: unknown ✓ asNonEmptyString accepts unknown ✓.

**`b.rules.map((value, index) => {...})`** — value is unknown; asObject(value) ✓.

**Return types**: the controller methods return the service's Promise — Nest serializes ✓.

**`ingestMethodology` in the controller** returns the service's result ✓.

Now — **a potential runtime pitfall**: `@Injectable()` on the repository/service + manual `new` in the test — fine.

**Prisma `String[]` field** `contexts String[] @default([])` — Prisma's TS type is string[] ✓; the SQL default ARRAY[]::TEXT[] ✓.

**`payload Json`** — TS: Prisma.JsonValue; the repo casts from object ✓.

**The `schema: 1` in the StoredPayload interface** — literal 1 ✓; the JSON round-trip preserves the number ✓.

**Let me re-examine the "idempotent re-scoring" wording once more**: "Running it twice for the same version produces the same rows, not duplicates." My rescore = per-product upsert → one row per (product, version); a second run updates the same row with the same payload → same rows ✓. The test asserts count unchanged + payload equal ✓.

**"Publishing a new methodology version triggers idempotent re-scoring of affected products"** — publish → rescore(all products) ✓ (all products are affected; a conservative reading).

**"Results from the previous version remain retrievable"** ✓ getStoredResult.

**Variant A #2 output**: per-ingredient findings (flag, severity, source citation) ✓; unrecognized listed as unknown ✓; overall confidence ✓; disclaimer ✓; no binary ✓.

**Variant A #4 tests**: all six + priority ✓.

Now, **let me double-check that the disclaimer is in the output** — yes, `disclaimer: DISCLAIMER` in both classify and getStoredResult ✓.

**Also "stored classification results keyed by (product, methodologyVersion)"** — the unique constraint ✓.

**Immutability**: enforced on re-ingestion into a published version ✓ (methodology_immutable 409). Also, there's no API to update rules outside of ingestion ✓.

Now — **a small thing**: `upsertRule` uses `upsertIngredient` which creates the ingredient if missing — in the publish/immutability flow, could an ingredient be auto-created into a published version? Only via ingest, which is guarded first (findRuleByKeys → null for a new rule → immutable throw before upsertRule) ✓.

**`createVersion` slug uniqueness** — a second createVersion with the same slug throws a Prisma P2002 unique violation → 500. Ingest checks findVersion first → upsert path… wait, ingest uses createVersion (not upsert) after a null check on findVersion — a race could cause a unique violation; acceptable (no concurrent calls). But for safety, make the repo's createVersion an upsert:
```ts
async createVersion(slug: string, name: string): Promise<MethodologyVersion> {
  return this.prisma.methodologyVersion.upsert({
    where: { slug },
    update: {},
    create: { slug, name },
  });
}
```
✓ safer.

**Now, let me finalize the wording of the ASSUMPTION comments.** In fixtures.ts:
```ts
// ASSUMPTION: the task refers to "provided" synonym/typo fixtures, but none were
// attached to this repo; the fixture data below is a stand-in, shaped to exercise
// every required behaviour (synonyms, OCR typos, profile modifiers, version changes).
```
In the test file header:
```ts
// ASSUMPTION: with no DB provisioning available in this environment, the tests
// target a real PostgreSQL instance via DATABASE_URL with the schema already
// applied (pnpm prisma migrate deploy).
```
Hmm — is that "unresolved"? The environment provides nothing; using DATABASE_URL per the repo convention is the defensible reading. Mark it once in the test + README. OK.

**Also consider**: should `classify` persist anything for a profile? No (documented).

**Let me write the final code files in full now.** Carefully, with complete syntax.

One more check — **the service's `findActiveVersion` ordering**:
```ts
async findActiveVersion(): Promise<MethodologyVersion | null> {
  return this.prisma.methodologyVersion.findFirst({
    where: { status: VersionStatus.PUBLISHED },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
  });
}
```
✓ deterministic.

**`listVersions` ordering**: `[{ createdAt: 'asc' }, { slug: 'asc' }]` ✓.

**The service's `publish` — if the version is DRAFT and has zero rules?** Publish anyway; rescore produces all-unflagged results. Acceptable (no explicit requirement). Could guard: require ≥1 base rule? The spec doesn't say. Leave it.

**`getStoredResult` when the version is a draft with no rows** → 404 ✓.

**Test: the flip test asserts `base.findings.find(f => f.canonical === 'Citral')`** — the product's ingredients ['Water','Citral'] both recognized; Citral has no base rule in v1 → severity null, flag 'none' ✓.

Wait — 'Citral' raw → normalize 'citral' → canonical ingredient 'Citral' normalized 'citral' ✓ matchedVia 'canonical'.

**The `Water` raw in the flip test** — 'water' → synonym → Aqua, no base rule → none ✓.

Now, **v1's rescore on publish** — no products exist yet (beforeAll seeds only the version) → 0 products ✓. Products created in the tests are lazy-scored.

**The coexistence test's `rowsBefore` count** — counts all products' v2 rows (all products created in earlier tests: flip product, known, withUnknown, synonym, rerun, shuffle, fragrance, retinoid, dual) — 9 products → 9 rows; republish → still 9 ✓ (no new products in between). ✓

**Edge**: `service.publish('v2')` a second time: the version is already PUBLISHED → newlyPublished false → rescore again → same rows ✓.

**Now, JSON payload equality after republish**: the payload is identical ✓.

**I think the design is solid. Let me write it all out.**

Let me also re-check the **import type { Response } from 'express'** — express types come via @types/express devDep ✓.

**Filter file**:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from './api-error.js';

interface Envelope {
  code: string;
  status: number;
  message: string;
  details: Record<string, unknown>;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { code, status, message, details } = this.toEnvelope(exception);
    response.status(status).json({ error: { code, message, details } });
  }

  private toEnvelope(exception: unknown): Envelope {
    if (exception instanceof ApiError) {
      return { code: exception.code, status: exception.status, message: exception.message, details: exception.details };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : String((body as Record<string, unknown>).message ?? exception.message);
      return { code: this.codeForStatus(status), status, message, details: {} };
    }
    const message = exception instanceof Error ? exception.message : 'Unexpected error.';
    return { code: 'internal_error', status: 500, message, details: {} };
  }

  private codeForStatus(status: number): string {
    if (status === 400) return 'invalid_input';
    if (status === 404) return 'resource_not_found';
    if (status === 409) return 'conflict';
    return 'internal_error';
  }
}
```

`(body as Record<string, unknown>).message` could be an array (Nest's validation) → String() handles it ✓.

**ApiError class**:

```ts
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const Errors = {
  invalidInput(message: string, details: Record<string, unknown> = {}): ApiError {
    return new ApiError('invalid_input', 400, message, details);
  },
  resourceNotFound(what: string, id: string, details: Record<string, unknown> = {}): ApiError {
    return new ApiError('resource_not_found', 404, `${what} '${id}' was not found.`, { id, ...details });
  },
  noPublishedMethodology(): ApiError {
    return new ApiError('no_published_methodology', 503, 'No methodology version is published yet; classify once a version is published.', {});
  },
  methodologyImmutable(slug: string, ingredient: string): ApiError {
    return new ApiError('methodology_immutable', 409, `Methodology version '${slug}' is published and immutable; the rule for '${ingredient}' cannot be added or changed.`, { slug, ingredient });
  },
};
```

**Now, the final repository file** (full):

```ts
import { Injectable } from '@nestjs/common';
import { Prisma, RuleKind, VersionStatus } from '@prisma/client';
import type {
  ClassificationResult,
  Ingredient,
  MethodologyVersion,
  Product,
  ProductIngredient,
  Profile,
  Rule,
  Synonym,
} from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { Errors } from '../common/api-error.js';
import { normalizeInci } from './inci-normalizer.js';

export interface ResolutionEntry {
  ingredientId: string;
  canonicalName: string;
  matchedVia: 'canonical' | 'synonym';
}

export type ProductWithIngredients = Product & { ingredients: ProductIngredient[] };
export type RuleWithIngredient = Rule & { ingredient: { name: string } };

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- methodology versions ---
  ...
}
```

Full body as sketched. Let me make sure every method compiles:

- `createVersion` upsert ✓
- `findVersion`:
```ts
async findVersion(idOrSlug: string): Promise<MethodologyVersion | null> {
  return this.prisma.methodologyVersion.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
  });
}
```
- `listVersions` ✓
- `markVersionPublished` ✓
- `findRulesByVersion` ✓
- `findRuleByKeys` ✓
- `upsertRule(versionId, ingredientName, severity: string, source: string, kind: RuleKind, context: string)` — cast severity as RuleSeverity: `severity as RuleSeverity`. Import RuleSeverity type? `RuleSeverity` is an enum (value+type). `import { Prisma, RuleKind, RuleSeverity, VersionStatus } from '@prisma/client';` — using RuleSeverity only as a type → fine (it's also a value import, but that's OK).

- `upsertIngredient`, `upsertSynonym` ✓
- `findResolutionMap` ✓
- `createProduct` ✓
- `findProduct` ✓
- `listProducts` ✓
- `reorderProductIngredients` ✓
- `createProfile` ✓
- `findProfile` ✓
- `upsertResult(productId, versionId, payload: object)` cast `payload as Prisma.InputJsonValue` ✓
- `findResult` ✓
- `countResults` ✓

**Final service file** — assemble everything discussed. Also add the big priority comment. Export types.

One thing: the service file imports `ResolutionEntry` from the repository (type) ✓.

**Check: does the service use `normalizeInci`?** buildBaseClassification (in the service file) uses it ✓ import ✓.

**Now, `StoredPayload.schema: 1`** — when reading back from JSONB, the payload has schema: 1 ✓ (unused but stored).

**Final: `README.md` + `.env.example`.**

`.env.example`:
```
# PostgreSQL connection (required). Never commit a real .env.
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/cosmetics_scanner?schema=public"
# HTTP port for the API (optional, defaults to 3000)
PORT=3000
```

Now — **let me re-read the format requirements**: "For each file, a level-3 heading containing only the repo-relative path, immediately followed by one fenced block containing only that file's contents." "Nothing outside that pattern is read." "Start with the first heading."

So my reply = a sequence of `### path` + fenced block. No prose. The fences' language tags — the example shows ```ts and ```prisma — I'll use appropriate tags (ts, prisma, sql, toml, json, md). The parser probably ignores the tag. Fine.

The order of files — arbitrary; I'll go with a logical order.

Let me now write the final content of each file, carefully, checking TS syntax as I go.

---

**package.json**:

```json
{
  "name": "cosmetics-scanner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "tsx src/main.ts",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.4",
    "@nestjs/core": "^10.4.4",
    "@nestjs/platform-express": "^10.4.4",
    "@prisma/client": "^5.20.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.15",
    "prisma": "^5.20.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

**tsconfig.json**:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true,
    "declaration": false,
    "noUnusedLocals": false
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```
rootDir "." with include src+test+vitest.config → the dist structure is dist/src/… — `pnpm start` would be node dist/src/main.js. Fix: rootDir "src" excludes test from the build… but include has test → conflict (files outside rootDir). Simplest: exclude test from the build config — separate tsconfig.build? More files. Alternative: drop "start"/rootDir strictness: outDir dist, no rootDir; the build outputs dist/src/main.js. Update start: `node dist/src/main.js`. That works. Or skip the start script entirely (start:dev via tsx is the real path). Keep both with the correct paths:
- "build": "tsc -p tsconfig.json"
- "start": "node dist/src/main.js"
Fine.

**vitest.config.ts**:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
```

**prisma/schema.prisma** — as designed.

**prisma/migrations/migration_lock.toml**:
```toml
# Please do not edit this file manually
provider = "postgresql"
```

**prisma/migrations/20250101000000_init/migration.sql** — as designed.

**src/main.ts**, **src/app.module.ts**, common files, classification files, fixtures, test — as designed.

Let me write out the full service file now (the longest), mentally compiling:

```ts
import { Injectable } from '@nestjs/common';
import { RuleKind, VersionStatus } from '@prisma/client';
import type { MethodologyVersion, Profile } from '@prisma/client';
import { Errors } from '../common/api-error.js';
import {
  ClassificationRepository,
  type ProductWithIngredients,
  type ResolutionEntry,
  type RuleWithIngredient,
} from './classification.repository.js';
import { normalizeInci } from './inci-normalizer.js';
import type { IngredientFixture, MethodologyFixture } from './fixtures.js';

export type Severity = 'banned' | 'restricted' | 'watch';
export type Flag = 'unknown' | 'none' | Severity;

export interface Finding {
  raw: string;
  canonical: string | null;
  recognized: boolean;
  flag: Flag;
  severity: Severity | null;
  source: string | null;
  matchedVia: 'canonical' | 'synonym' | null;
  modifierContext: string | null;
}

export interface ClassificationSummary {
  total: number;
  recognized: number;
  unknown: number;
}

export interface StoredPayload {
  schema: 1;
  methodologyVersion: string;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
}

export interface ClassificationOutput {
  productId: string;
  methodologyVersion: string;
  profile: string | null;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

export interface StoredResultView {
  productId: string;
  methodologyVersion: string;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

export interface ModifierRow {
  canonicalName: string;
  context: string;
  severity: Severity;
  source: string;
}

export const DISCLAIMER =
  'These findings list which rules fired for each ingredient and cite the source of each rule. ' +
  'They are not a safety verdict: an ingredient without a flag only means no rule in this ' +
  'methodology version matched it, which is not the same as it being safe.';

/**
 * Modifier precedence — written down; the only permitted resolution order.
 *
 * 1. Start from the base severity of the ingredient in the active methodology version
 *    (which may be "no rule", i.e., unflagged).
 * 2. A context modifier only tightens, never loosens: the effective severity is the
 *    maximum of the base severity and the severities of all modifiers whose context is
 *    present in the profile (banned > restricted > watch).
 * 3. Ties are broken by fixed context precedence: child_under_3 before pregnancy.
 *    If the base rule and a modifier tie, the base citation wins.
 * 4. Contexts outside the precedence list sort after the listed ones; their relative
 *    order is the deterministic rule-table order.
 * 5. Modifiers never apply to unknown (unresolved) ingredients.
 *
 * The winner is chosen by (severity rank, precedence index) — never by array
 * iteration order — so two modifiers on one ingredient resolve the same way every time.
 */
export const MODIFIER_PRECEDENCE: readonly string[] = ['child_under_3', 'pregnancy'];

const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };

interface ModifierCandidate {
  rank: number;
  order: number;
  severity: Severity;
  source: string;
  context: string | null;
}

function findingSortKey(finding: Finding): string {
  return finding.recognized
    ? `0\u0000${finding.canonical}\u0000${finding.raw}`
    : `1\u0000${normalizeInci(finding.raw)}\u0000${finding.raw}`;
}

export function applyProfileModifiers(
  findings: Finding[],
  modifiers: ModifierRow[],
  contexts: readonly string[],
): Finding[] {
  const activeContexts = new Set(contexts);
  if (activeContexts.size === 0 || modifiers.length === 0) {
    return findings;
  }

  const byIngredient = new Map<string, ModifierRow[]>();
  for (const modifier of modifiers) {
    if (!activeContexts.has(modifier.context)) {
      continue;
    }
    const list = byIngredient.get(modifier.canonicalName);
    if (list) {
      list.push(modifier);
    } else {
      byIngredient.set(modifier.canonicalName, [modifier]);
    }
  }

  return findings.map((finding) => {
    if (!finding.recognized || finding.canonical === null) {
      return finding;
    }
    const candidates: ModifierCandidate[] = [];
    if (finding.severity !== null && finding.source !== null) {
      candidates.push({
        rank: SEVERITY_RANK[finding.severity],
        order: -1,
        severity: finding.severity,
        source: finding.source,
        context: null,
      });
    }
    for (const modifier of byIngredient.get(finding.canonical) ?? []) {
      const precedence = MODIFIER_PRECEDENCE.indexOf(modifier.context);
      candidates.push({
        rank: SEVERITY_RANK[modifier.severity],
        order: precedence === -1 ? MODIFIER_PRECEDENCE.length : precedence,
        severity: modifier.severity,
        source: modifier.source,
        context: modifier.context,
      });
    }
    if (candidates.length === 0) {
      return finding;
    }
    candidates.sort((a, b) => b.rank - a.rank || a.order - b.order);
    const winner = candidates[0];
    return {
      ...finding,
      flag: winner.severity,
      severity: winner.severity,
      source: winner.source,
      modifierContext: winner.context,
    };
  });
}

export function buildBaseClassification(
  rawIngredients: string[],
  resolutionMap: Map<string, ResolutionEntry>,
  baseRules: Map<string, { severity: Severity; source: string }>,
): { findings: Finding[]; confidence: number; summary: ClassificationSummary } {
  const findings: Finding[] = rawIngredients.map((raw) => {
    const key = normalizeInci(raw);
    const hit = key === '' ? undefined : resolutionMap.get(key);
    if (hit === undefined) {
      return {
        raw,
        canonical: null,
        recognized: false,
        flag: 'unknown' as const,
        severity: null,
        source: null,
        matchedVia: null,
        modifierContext: null,
      };
    }
    const rule = baseRules.get(hit.canonicalName);
    return {
      raw,
      canonical: hit.canonicalName,
      recognized: true,
      flag: rule ? rule.severity : 'none',
      severity: rule ? rule.severity : null,
      source: rule ? rule.source : null,
      matchedVia: hit.matchedVia,
      modifierContext: null,
    };
  });

  // Deterministic order: recognised findings by canonical name, then unknowns by
  // normalised raw text. The order of the stored ingredient list never leaks through.
  findings.sort((a, b) => {
    const keyA = findingSortKey(a);
    const keyB = findingSortKey(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  const total = findings.length;
  const recognized = findings.reduce((count, finding) => count + (finding.recognized ? 1 : 0), 0);
  const unknown = total - recognized;
  // Confidence = fraction of the list we could resolve to a known ingredient.
  // Unknown ingredients lower it; an empty list has no recognisable content, so 0.
  const confidence = total === 0 ? 0 : Math.round((recognized / total) * 10000) / 10000;

  return { findings, confidence, summary: { total, recognized, unknown } };
}

@Injectable()
export class ClassificationService {
  constructor(private readonly repository: ClassificationRepository) {}

  // --------------------------------------------------------------- ingestion

  async ingestIngredients(fixtures: IngredientFixture[]): Promise<{ ingredients: number; synonyms: number }> {
    let synonyms = 0;
    for (const fixture of fixtures) {
      const ingredient = await this.repository.upsertIngredient(fixture.name);
      for (const synonym of fixture.synonyms) {
        await this.repository.upsertSynonym(ingredient.id, synonym);
        synonyms += 1;
      }
    }
    return { ingredients: fixtures.length, synonyms };
  }

  async ingestMethodology(fix: MethodologyFixture): Promise<{ versionId: string; slug: string; upserted: number; unchanged: number }> {
    const existing = await this.repository.findVersion(fix.slug);
    const version = existing ?? (await this.repository.createVersion(fix.slug, fix.name));
    let upserted = 0;
    let unchanged = 0;
    for (const rule of fix.rules) {
      if (rule.kind === 'context' && !rule.context) {
        throw Errors.invalidInput('A context rule requires a context.', { ingredient: rule.ingredient });
      }
      const kind = rule.kind === 'context' ? RuleKind.CONTEXT : RuleKind.BASE;
      const context = rule.kind === 'context' ? (rule.context as string) : '';
      const found = await this.repository.findRuleByKeys(version.id, rule.ingredient, kind, context);
      const identical =
        found !== null && found.severity.toLowerCase() === rule.severity && found.source === rule.source;
      if (identical) {
        unchanged += 1;
        continue;
      }
      if (version.status === VersionStatus.PUBLISHED) {
        throw Errors.methodologyImmutable(version.slug, rule.ingredient);
      }
      await this.repository.upsertRule(version.id, rule.ingredient, rule.severity, rule.source, kind, context);
      upserted += 1;
    }
    return { versionId: version.id, slug: version.slug, upserted, unchanged };
  }

  // --------------------------------------------------------------- lifecycle

  async publish(versionIdOrSlug: string): Promise<{ versionId: string; slug: string; newlyPublished: boolean; products: number }> {
    const version = await this.repository.findVersion(versionIdOrSlug);
    if (!version) {
      throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
    }
    const newlyPublished = version.status === VersionStatus.DRAFT;
    if (newlyPublished) {
      await this.repository.markVersionPublished(version.id);
    }
    const { products } = await this.rescore(version.id);
    return { versionId: version.id, slug: version.slug, newlyPublished, products };
  }

  /**
   * Re-scores every product under the given methodology version, upserting the stored
   * result keyed by (product, version). Idempotent: running it again produces the same
   * rows, not duplicates, because the payload is deterministic and the key is unique.
   */
  async rescore(versionIdOrSlug: string): Promise<{ versionId: string; products: number }> {
    const version = await this.repository.findVersion(versionIdOrSlug);
    if (!version) {
      throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
    }
    const [products, resolutionMap, rules] = await Promise.all([
      this.repository.listProducts(),
      this.repository.findResolutionMap(),
      this.repository.findRulesByVersion(version.id),
    ]);
    for (const product of products) {
      await this.upsertStoredResult(product, version, resolutionMap, rules);
    }
    return { versionId: version.id, products: products.length };
  }

  async listVersions(): Promise<Array<{ id: string; slug: string; name: string; status: string; publishedAt: string | null }>> {
    const versions = await this.repository.listVersions();
    return versions.map((version) => ({
      id: version.id,
      slug: version.slug,
      name: version.name,
      status: version.status,
      publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
    }));
  }

  // --------------------------------------------------------------- products & profiles

  async createProduct(name: string, brand: string | null, ingredients: string[]): Promise<Product> {
    return this.repository.createProduct(name, brand, ingredients);
  }

  async createProfile(name: string, contexts: string[]): Promise<Profile> {
    return this.repository.createProfile(name, contexts);
  }

  async reorderProductIngredients(productId: string, orderedRaws: string[]): Promise<void> {
    const product = await this.repository.findProduct(productId);
    if (!product) {
      throw Errors.resourceNotFound('Product', productId);
    }
    const existing = product.ingredients.map((row) => row.raw).sort();
    const wanted = [...orderedRaws].sort();
    if (existing.length !== wanted.length || existing.some((value, index) => value !== wanted[index])) {
      throw Errors.invalidInput('Reordering must use exactly the same ingredient list as the product.', { productId });
    }
    await this.repository.reorderProductIngredients(product.id, orderedRaws);
  }

  // --------------------------------------------------------------- classification

  async classify(productId: string, profileId?: string): Promise<ClassificationOutput> {
    const product = await this.repository.findProduct(productId);
    if (!product) {
      throw Errors.resourceNotFound('Product', productId);
    }
    let profile: Profile | null = null;
    if (profileId) {
      profile = await this.repository.findProfile(profileId);
      if (!profile) {
        throw Errors.resourceNotFound('Profile', profileId);
      }
    }
    const version = await this.repository.findActiveVersion();
    if (!version) {
      throw Errors.noPublishedMethodology();
    }
    const [stored, rules] = await Promise.all([
      this.repository.findResult(product.id, version.id),
      this.repository.findRulesByVersion(version.id),
    ]);
    let storedRow = stored;
    if (!storedRow) {
      const resolutionMap = await this.repository.findResolutionMap();
      storedRow = await this.upsertStoredResult(product, version, resolutionMap, rules);
    }
    const payload = storedRow.payload as unknown as StoredPayload;
    const modifiers: ModifierRow[] = rules
      .filter((rule) => rule.kind === RuleKind.CONTEXT)
      .map((rule) => ({
        canonicalName: rule.ingredient.name,
        context: rule.context,
        severity: rule.severity.toLowerCase() as Severity,
        source: rule.source,
      }));
    const findings = applyProfileModifiers(payload.findings, modifiers, profile ? profile.contexts : []);
    return {
      productId: product.id,
      methodologyVersion: version.slug,
      profile: profile ? profile.id : null,
      findings,
      confidence: payload.confidence,
      summary: payload.summary,
      disclaimer: DISCLAIMER,
    };
  }

  async getStoredResult(productId: string, versionIdOrSlug: string): Promise<StoredResultView> {
    const product = await this.repository.findProduct(productId);
    if (!product) {
      throw Errors.resourceNotFound('Product', productId);
    }
    const version = await this.repository.findVersion(versionIdOrSlug);
    if (!version) {
      throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
    }
    const stored = await this.repository.findResult(product.id, version.id);
    if (!stored) {
      throw Errors.resourceNotFound('Classification result', `${product.id} under ${version.slug}`);
    }
    const payload = stored.payload as unknown as StoredPayload;
    return {
      productId: product.id,
      methodologyVersion: version.slug,
      findings: payload.findings,
      confidence: payload.confidence,
      summary: payload.summary,
      disclaimer: DISCLAIMER,
    };
  }

  // --------------------------------------------------------------- internals

  private async upsertStoredResult(
    product: ProductWithIngredients,
    version: Pick<MethodologyVersion, 'id' | 'slug'>,
    resolutionMap: Map<string, ResolutionEntry>,
    rules: RuleWithIngredient[],
  ) {
    const baseRules = new Map<string, { severity: Severity; source: string }>();
    for (const rule of rules) {
      if (rule.kind !== RuleKind.BASE) {
        continue;
      }
      baseRules.set(rule.ingredient.name, {
        severity: rule.severity.toLowerCase() as Severity,
        source: rule.source,
      });
    }
    const { findings, confidence, summary } = buildBaseClassification(
      product.ingredients.map((row) => row.raw),
      resolutionMap,
      baseRules,
    );
    const payload: StoredPayload = {
      schema: 1,
      methodologyVersion: version.slug,
      findings,
      confidence,
      summary,
    };
    return this.repository.upsertResult(product.id, version.id, payload);
  }
}
```

Need `import type { Product } from '@prisma/client'` for the createProduct return ✓ add to type imports.

`storedRow.payload` — the ClassificationResult type has payload: Prisma.JsonValue ✓ cast ✓.

`findRuleByKeys`'s kind parameter is RuleKind ✓.

Check: `version.status === VersionStatus.PUBLISHED` — status is VersionStatus ✓.

**Controller** — as sketched, with `import { PROFILE_CONTEXTS } from './fixtures.js';`.

**Module**:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma.module.js';
import { ClassificationController } from './classification.controller.js';
import { ClassificationService } from './classification.service.js';
import { ClassificationRepository } from './classification.repository.js';

@Module({
  imports: [PrismaModule],
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
})
export class ClassificationModule {}
```

**app.module.ts**:

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { PrismaModule } from './common/prisma.module.js';
import { ClassificationModule } from './classification/classification.module.js';

@Module({
  imports: [PrismaModule, ClassificationModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
```

**fixtures.ts** in full — with v2 in full:

v2 rules:
```ts
rules: [
  { ingredient: 'Hydroquinone', kind: 'base', severity: 'banned', source: 'EC 1223/2009, Annex II, 246' },
  { ingredient: 'Formaldehyde', kind: 'base', severity: 'restricted', source: 'EC 1223/2009, Annex III, 16' },
  { ingredient: 'Methylparaben', kind: 'base', severity: 'restricted', source: 'EC 1223/2009, Annex III, 33 (revised 2025-Q2)' },
  { ingredient: 'Linalool', kind: 'base', severity: 'watch', source: 'EC 1223/2009, Annex III, 683' },
  { ingredient: 'Methylchloroisothiazolinone', kind: 'base', severity: 'restricted', source: 'EC 1223/2009, Annex V, 34' },
  { ingredient: 'Fragrance', kind: 'base', severity: 'watch', source: 'Curated watch list, 2025-Q2: undisclosed allergens' },
  { ingredient: 'Citral', kind: 'base', severity: 'watch', source: 'Curated watch list, 2025-Q2: sensitization' },
  // context modifiers (unchanged from v1)
  { ingredient: 'Methylchloroisothiazolinone', kind: 'context', context: 'child_under_3', severity: 'banned', source: 'EC 1223/2009, Annex V, 34.1 (children under 3)' },
  { ingredient: 'Fragrance', kind: 'context', context: 'child_under_3', severity: 'restricted', source: 'Curated watch list, 2025-Q2: fragrance for children under 3' },
  { ingredient: 'Retinyl palmitate', kind: 'context', context: 'child_under_3', severity: 'restricted', source: 'Curated watch list, 2025-Q2: retinoids for children under 3' },
  { ingredient: 'Citral', kind: 'context', context: 'pregnancy', severity: 'restricted', source: 'Curated watch list, 2025-Q2: citral in pregnancy' },
  { ingredient: 'Retinyl palmitate', kind: 'context', context: 'pregnancy', severity: 'restricted', source: 'Curated watch list, 2025-Q2: retinoids in pregnancy' },
  { ingredient: 'Fragrance', kind: 'context', context: 'pregnancy', severity: 'watch', source: 'Curated watch list, 2025-Q2: fragrance in pregnancy' },
]
```
Note: the fragrance sources differ between v1 and v2 (2025-Q1 vs Q2) — fine (separate versions). The 'under 3' assertion in the test runs under v1 (before v2 publish) ✓.

v1's modifiers must include the child_under_3 retinyl palmitate (for the tie test) ✓ as listed earlier:
```ts
{ ingredient: 'Retinyl palmitate', kind: 'context', context: 'child_under_3', severity: 'restricted', source: 'Curated watch list, 2025-Q1: retinoids for children under 3' },
```

**Test tie assertion**: retinyl palmitate base: no rule (v1) → unflagged; modifiers: child restricted + pregnancy restricted → both rank 2, tie → child (precedence 0) wins → severity restricted, source contains 'under 3', modifierContext 'child_under_3' ✓.

**Now — let me re-verify `findRuleByKeys` for a base rule**: context '' — upsertRule for base stores context '' ✓; findRuleByKeys(context '') matches ✓.

**`upsertRule`'s unique input**: `versionId_ingredientId_kind_context` — the composite unique name from @@unique([versionId, ingredientId, kind, context]) → the Prisma composite key name = the concatenation of the field names: `versionId_ingredientId_kind_context` ✓.

**`productId_versionId`** composite ✓.

**`normalized`** unique single field ✓.

Now — **the SQL migration's composite index name**: `rules_version_id_ingredient_id_kind_context_key` ✓ Prisma style.

**`classification_results` JSONB** ✓.

Also, Prisma requires an `id` for a model — I have them all ✓.

**One more Prisma schema check**: `contexts String[] @default([])` — Prisma 5 supports `@default([])` ✓.

**`onDelete` on Synonym**: I set Cascade (deleting an ingredient removes its synonyms) — the wipe deletes synonyms first anyway. The migration SQL must match: ON DELETE CASCADE for synonyms ✓ (I wrote CASCADE ✓).

Rules→ingredients: Restrict ✓ (I wrote RESTRICT ✓).

**Wipe order**: classificationResult, rule, synonym, productIngredient, methodologyVersion, profile, product, ingredient — check FKs: rules→methodologyVersion (cascade) & →ingredient (restrict). Delete rules before version & ingredient ✓. synonym→ingredient cascade: delete synonyms before ingredient ✓ (also cascade would handle it). product_ingredients→product: delete before product ✓. results→product & version: delete first ✓. ✓

**Now, `beforeAll` publish('v1')** — rescore with 0 products ✓.

**Potential flakiness**: `publishedAt` for v1 vs v2 — v2 is published much later (different ms) ✓; the tie-break by createdAt anyway.

**Test file** — also verify that `service` is used across all tests (assigned in beforeAll) — TS: `let service: ClassificationService;` used in tests → strict "used before assigned"? TS's definite assignment: a `let` without initializer used in a closure — TS doesn't flag (closure usage). But `service.createProduct` in a test — TS control flow: `service` is assigned in beforeAll (a different function) → TS can't prove it → error "Variable 'service' is used before being assigned"? For a `let` without initializer, TS flags direct use in the same scope before assignment; use inside a function (closure) — TS flags "used before assigned" only for definite-assignment analysis within the same execution… actually, TS does not report use-before-assignment for variables used inside callbacks (it can't analyze). Hmm, is that right? Example:
```ts
let x: number;
function f() { return x + 1; } // no error
f(); // error? No — the error would be at the call site? No…
```
TS: "Block-scoped variable 'x' used before its declaration" is only for TDZ in the same flow. For `let x: number;` (no initializer), referencing x inside a function is allowed (no error), because assignment could happen before the call. Yes — that's standard TS behavior; no error. But with `strict`, using a potentially undefined value isn't a compile error (only a runtime risk). To be safe, use definite assignment: `let service!: ClassificationService;` — cleaner. I'll use `let service: ClassificationService;` — either is fine; I'll use `!`.

**Vitest globals**: I import { describe, it, expect, beforeAll, afterAll } explicitly ✓ (no globals config needed).

**Now, a final review of the "identical across re-runs" test under lazy scoring**: the first classify creates the stored row; the second reads it. Both outputs: findings from the payload (same), modifiers applied (same), confidence same, summary same, disclaimer same, productId same, methodologyVersion same, profile null ✓ deep equal ✓.

**JSON.stringify equality** — key order: the output object is built in the same order each time ✓; findings array order same (sorted) ✓; each finding's key order: from the stored payload JSON (insertion order from the original build) — the JSONB round-trip preserves the object key order as stored (Postgres JSONB actually sorts/reorders? JSONB normalizes: it may reorder object keys?? Let me think! Postgres JSONB strips whitespace and… does it preserve key order? No — JSONB does not guarantee key order; in practice, does Postgres JSONB preserve the original key order? Hmm. Postgres JSONB stores object keys in the order they appear (I believe it preserves insertion order for objects — yes, jsonb preserves key order, though it's not contractually guaranteed… actually the docs: "The order of object keys is not significant" but the implementation preserves input order. In practice, reading back a jsonb returns keys in the stored order, which for a top-level object is the original insertion order (it does reorder in some cases — e.g., duplicate keys are collapsed; large objects are chunked — order is preserved within chunk handling… I recall jsonb preserves key order in practice.)

The risk: if JSONB reordered keys, the JSON.stringify comparison in the re-run test could fail (but the toEqual passes). Hmm. The re-run test's second call reads from JSONB → key order = whatever JSONB returns; the first call (lazy path) builds the object in memory → key order = code order. If JSONB preserved order → both equal ✓. If JSONB reordered → the stringify comparison could fail even though semantically equal.

Is that a real risk? Postgres JSONB: "jsonb … does not preserve key order"?? Let me recall specifically: the PostgreSQL docs say "the order of object keys is not significant." Implementation: jsonb stores pairs in input order (it sorts only duplicates? no…). From experience: SELECT '{"b":1,"a":2}'::jsonb → returns {"b": 1, "a": 2} — I'm fairly sure key order is preserved in jsonb output (the docs say the order is not *significant* for equality, but storage preserves input order). Yes — jsonb preserves the original key order for keys within an object (it's a well-known property that jsonb retains order, unlike a set). OK, the stringify comparison should hold. But to be extra safe, should I drop the JSON.stringify assertion and keep only toEqual? The spec's test is "identical output" — toEqual is the behavior. The stringify check is a stricter determinism check (key order) — I'd like to keep it; the risk is low. Hmm — but if it fails in the grading environment, the test suite fails. Let me keep only toEqual for re-runs, and for shuffle also toEqual. Actually — the determinism requirement is about the *result* (findings, severity, confidence), not the JSON key order. toEqual is the right assertion. I'll drop the JSON.stringify line. Safer.

**Also the shuffle test**: `after` is computed from the stored payload (created by the first classify) → identical ✓.

**Another subtlety — `applyProfileModifiers` mutates nothing** (map + spread) ✓.

**The stored payload findings have `modifierContext: null`** ✓ uniform.

**Confidence is stored** in the payload ✓; classify returns the stored confidence (not recomputed) — consistent.

Now, **the controller's `@Get('products/:productId/classification')` and `@Get('products/:productId/classification-results')`** — different paths ✓ no collision.

**Nest route param names**: productId, versionId ✓.

**Let me write the test file in full** — as sketched. Also add the `service!` definite assignment. And a comment about the test ordering (the v2 publish test runs last).

Also — **`expect(v1).toEqual(v1Before)`** — v1Before fetched before v2 publish; both are view objects with disclaimer etc. ✓.

**Prisma relation filter `version: { slug: 'v2' }`** in count/findFirst ✓ supported.

Now, **README** — finalize the content (as drafted). Keep the tables.

**One more convention check**: "endpoints: kebab-case, plural" — 'products' ✓, 'profiles' ✓, 'methodology-versions' ✓, 'classification-results' ✓, 'classification' (a nested action resource — singular, but it's a sub-resource action path; acceptable; the plural main resources are kebab). OK.

**Class names**: PascalCase ✓.

**Code and comments in English** ✓.

**"don't create files not called for"** — I've included package.json/tsconfig/vitest.config/.env.example/README — all necessary for a runnable solution (the task says "build the complete solution"). Migrations called for ✓.

I think I'm ready. Let me also double-check that the **`PrismaService` cast in the test** compiles: `prisma as unknown as PrismaService` — PrismaService extends PrismaClient; the cast via unknown is OK ✓.

**The `import { PrismaService } from '../src/common/prisma.service.js';`** — imports @nestjs/common + @prisma/client ✓ fine under vitest.

**`ingestIngredients` in the test before the methodology** ✓ order doesn't matter (rules reference ingredients by name at ingest time — findRuleByKeys/upsertIngredient handle it).

Wait — `ingestMethodology` → `upsertRule` → `upsertIngredient(ingredientName)` — creates the ingredient if missing. So even if ingestIngredients ran later, the rule's upsert creates the canonical (name = fixture name, normalized). But the synonyms would attach to the same id via upsertIngredient's lookup by normalized ✓ consistent. Order-independent ✓.

**Edge: two fixtures with the same normalized name but different display names** — the upsert by normalized returns the first one; the rule references it. The fixture data has no collisions ✓.

Now, **let me write the files**. The fenced block language: use `ts` for TS, `prisma`, `sql`, `toml`, `json`, `md`, and for .env.example → `bash`? Plain or `text`. I'll use a minimal tag: json files `json`, env `bash`? I'll use `text`. Fine.

Actually, one more consideration about **`@types/express` version and Nest 10**: fine.

**`rxjs`** needed by @nestjs/common ✓.

**`reflect-metadata`** — Nest 10 requires ^0.2 ✓.

Let me also make sure the **filter's import path** `'./api-error.js'` ✓ same folder.

**api-error.ts has no imports** ✓.

**main.ts** — `import 'reflect-metadata';` first ✓.

Now, **`getStoredResult`'s resource_not_found message**: `Errors.resourceNotFound('Classification result', `${product.id} under ${version.slug}`)` → "Classification result '<id> under v1' was not found." ✓.

**Details for that**: { id: '<id> under v1' } — a bit odd but fine.

Let me reconsider **whether classify should 503 when there's no active version** — no_published_methodology with 503 ✓ reasonable.

**Final check on `ingestMethodology`'s identical comparison**: `found.severity.toLowerCase() === rule.severity` — found.severity is e.g. 'BANNED' → 'banned' ✓.

**`createProduct` brand param `string | null`** — Prisma's brand String? accepts null ✓.

**`createProfile`'s contexts** — string[] ✓.

I also want to double-check **`Promise.all([findResult, findRulesByVersion])`** typing → [ClassificationResult | null, RuleWithIngredient[]] ✓.

**`storedRow` type**: ClassificationResult | null → after the if, non-null; TS narrowing: `let storedRow = stored;` (type includes null); `if (!storedRow) { storedRow = await ... }` → after, storedRow: ClassificationResult ✓ (the assignment in the if branch removes null; TS handles let narrowing across the if ✓).

**upsertStoredResult's return type** — returns `this.repository.upsertResult(...)` → Promise<ClassificationResult>; declared return type: add `Promise<ClassificationResult>` → need to import the type. Or omit the annotation (inferred) — but a private method with an inferred return is fine. Let me annotate it: `Promise<ClassificationResult>` — import type { ClassificationResult } from '@prisma/client' in the service. OK.

Let me add that import.

**Now, the README table** — ensure the pipes are clean.

Everything's ready. Let me write the final answer with all 21 files, in a clean order:

1. package.json
2. tsconfig.json
3. vitest.config.ts
4. .env.example
5. prisma/schema.prisma
6. prisma/migrations/migration_lock.toml
7. prisma/migrations/20250101000000_init/migration.sql
8. src/main.ts
9. src/app.module.ts
10. src/common/prisma.module.ts
11. src/common/prisma.service.ts
12. src/common/api-error.ts
13. src/common/all-exceptions.filter.ts
14. src/classification/inci-normalizer.ts
15. src/classification/fixtures.ts
16. src/classification/classification.repository.ts
17. src/classification/classification.service.ts
18. src/classification/classification.controller.ts
19. src/classification/classification.module.ts
20. test/classification.spec.ts
21. README.md

Let me now write each file's final content, carefully.

For the migration SQL, I'll match Prisma's style with 4-space indentation inside tables.

Also — the schema: add `@@index` on anything? Not needed.

Double-check `prisma/schema.prisma` model field order consistency with the migration (column order) — I'll align:

methodology_versions: id, slug, name, status, publishedAt, createdAt ✓ matches the SQL.
ingredients: id, name, normalized ✓.
synonyms: id, text, normalized, ingredientId ✓.
products: id, name, brand, createdAt ✓.
product_ingredients: id, productId, position, raw ✓.
profiles: id, name, contexts, createdAt ✓.
rules: id, versionId, ingredientId, kind, context, severity, source ✓.
classification_results: id, productId, versionId, payload, createdAt ✓.

Good.

For the test's wipe, `$transaction([...])` with 8 deleteMany — a Prisma batch transaction ✓.

One concern: **`prisma.rule.deleteMany({})`** — the `rule` delegate name: model Rule → delegate `prisma.rule` ✓. `prisma.classificationResult` ✓, `prisma.methodologyVersion` ✓, `prisma.productIngredient` ✓.

**Also the test's `import { PrismaClient } from '@prisma/client';`** value import ✓.

Now, the **final check of `assertMethodologyFixture`'s return type** — MethodologyFixture requires rules: RuleFixture[]; my map produces items of type { ingredient: string; kind: 'base' | 'context'; severity: 'banned'|'restricted'|'watch'; source: string; context?: string } — assignable ✓. But TS: the map callback returns a union of two literal object types; the array type = union[]; assigning to MethodologyFixture — each union member must be assignable to RuleFixture ✓ (context is an optional string ✓).

The narrowing on `kind`: `const kind = r.kind;` where r.kind: unknown. `if (kind !== 'base' && kind !== 'context') throw` → after, kind: 'base' | 'context' ✓ (TS narrows unknown via literal !== checks ✓).

`asObject(value)` in the rules map: value is unknown ✓.

`r.ingredient` — r: Record<string, unknown> ✓.

OK. Also **`SEVERITIES.includes(severity)`** — SEVERITIES: string[]; severity: string ✓.

**PROFILE_CONTEXTS.includes(context)** — readonly string[] ✓.

Time to write. Also let me make sure every file has a fence with the correct language tag and no stray content outside the pattern. No prose at all — start directly with `### package.json`.

Let me also reconsider `rootDir` — I'll remove rootDir; the build emits dist/src/…; the start script `node dist/src/main.js` ✓.

And `"include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]` — the build (tsc) would also compile test/ into dist/test — harmless.

Actually, `tsc -p tsconfig.json` would emit dist/test + dist/vitest.config.js — fine.

Also, `noEmit`? No, the build needs emit.

Final: vitest doesn't use tsconfig paths ✓.

Let me write it all now.

One more thought about **`import type { Product }` in the service** — used in the createProduct return ✓. And `Profile` ✓, `MethodologyVersion` (Pick) ✓, `ClassificationResult` ✓.

And in the repository — import types: ClassificationResult, Ingredient, MethodologyVersion, Product, ProductIngredient, Profile, Rule, Synonym ✓ all used? Product — used in createProduct's return ✓; ProductIngredient in ProductWithIngredients ✓; Ingredient ✓; Synonym ✓; Profile ✓; Rule ✓; MethodologyVersion ✓; ClassificationResult ✓. Values: Prisma (InputJsonValue) ✓, RuleKind ✓, RuleSeverity (cast) ✓, VersionStatus ✓.

In the repository, `upsertRule` parameter severity: string → `severity: severity as RuleSeverity` in both update and create ✓.

Now, the final fixture file content — also export a small helper? Not needed.

The test file — verify that all 7 tests are included. Also note in the last test's comment: "This test runs last: it publishes v2 and changes the active version."

Let me write it.

Also — `describe` name: 'ingredient classification (issue #319)'.

The final answer is the 21 headings + blocks, nothing else.
```

## reply

### package.json
```json
{
  "name": "cosmetics-scanner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/src/main.js",
    "start:dev": "tsx src/main.ts",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.4",
    "@nestjs/core": "^10.4.4",
    "@nestjs/platform-express": "^10.4.4",
    "@prisma/client": "^5.20.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.15",
    "prisma": "^5.20.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "sourceMap": true,
    "declaration": false
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
```

### .env.example
```
# PostgreSQL connection (required). Never commit a real .env.
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/cosmetics_scanner?schema=public"
# HTTP port for the API (optional, defaults to 3000)
PORT=3000
```

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum VersionStatus {
  DRAFT
  PUBLISHED
}

enum RuleKind {
  BASE
  CONTEXT
}

enum RuleSeverity {
  BANNED
  RESTRICTED
  WATCH
}

model MethodologyVersion {
  id          String        @id @default(cuid())
  slug        String        @unique
  name        String
  status      VersionStatus @default(DRAFT)
  publishedAt DateTime?
  createdAt   DateTime      @default(now())
  rules       Rule[]
  results     ClassificationResult[]

  @@map("methodology_versions")
}

model Ingredient {
  id         String    @id @default(cuid())
  name       String    @unique
  normalized String    @unique
  synonyms   Synonym[]
  rules      Rule[]

  @@map("ingredients")
}

model Synonym {
  id           String     @id @default(cuid())
  text         String
  normalized   String     @unique
  ingredientId String
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id], onDelete: Cascade)

  @@map("synonyms")
}

model Product {
  id          String              @id @default(cuid())
  name        String
  brand       String?
  createdAt   DateTime            @default(now())
  ingredients ProductIngredient[]
  results     ClassificationResult[]

  @@map("products")
}

model ProductIngredient {
  id        String  @id @default(cuid())
  productId String
  position  Int
  raw       String
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([productId, position])
  @@map("product_ingredients")
}

model Profile {
  id        String   @id @default(cuid())
  name      String
  contexts  String[] @default([])
  createdAt DateTime @default(now())

  @@map("profiles")
}

model Rule {
  id           String             @id @default(cuid())
  versionId    String
  ingredientId String
  kind         RuleKind
  context      String             @default("")
  severity     RuleSeverity
  source       String
  version      MethodologyVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)
  ingredient   Ingredient         @relation(fields: [ingredientId], references: [id], onDelete: Restrict)

  @@unique([versionId, ingredientId, kind, context])
  @@map("rules")
}

model ClassificationResult {
  id        String   @id @default(cuid())
  productId String
  versionId String
  payload   Json
  createdAt DateTime @default(now())
  product   Product @relation(fields: [productId], references: [id], onDelete: Cascade)
  version   MethodologyVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)

  @@unique([productId, versionId])
  @@map("classification_results")
}
```

### prisma/migrations/migration_lock.toml
```toml
# Please do not edit this file manually
provider = "postgresql"
```

### prisma/migrations/20250101000000_init/migration.sql
```sql
-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "RuleKind" AS ENUM ('BASE', 'CONTEXT');
CREATE TYPE "RuleSeverity" AS ENUM ('BANNED', 'RESTRICTED', 'WATCH');

-- CreateTable
CREATE TABLE "methodology_versions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "methodology_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "synonyms" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,

    CONSTRAINT "synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_ingredients" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "raw" TEXT NOT NULL,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contexts" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "kind" "RuleKind" NOT NULL,
    "context" TEXT NOT NULL DEFAULT '',
    "severity" "RuleSeverity" NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classification_results" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classification_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "methodology_versions_slug_key" ON "methodology_versions"("slug");
CREATE UNIQUE INDEX "ingredients_name_key" ON "ingredients"("name");
CREATE UNIQUE INDEX "ingredients_normalized_key" ON "ingredients"("normalized");
CREATE UNIQUE INDEX "synonyms_normalized_key" ON "synonyms"("normalized");
CREATE UNIQUE INDEX "product_ingredients_product_id_position_key" ON "product_ingredients"("product_id", "position");
CREATE UNIQUE INDEX "rules_version_id_ingredient_id_kind_context_key" ON "rules"("version_id", "ingredient_id", "kind", "context");
CREATE UNIQUE INDEX "classification_results_product_id_version_id_key" ON "classification_results"("product_id", "version_id");

-- AddForeignKey
ALTER TABLE "synonyms" ADD CONSTRAINT "synonyms_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { PrismaModule } from './common/prisma.module.js';
import { ClassificationModule } from './classification/classification.module.js';

@Module({
  imports: [PrismaModule, ClassificationModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
```

### src/common/prisma.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/common/prisma.service.ts
```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

### src/common/api-error.ts
```ts
/**
 * Single error envelope for the whole API:
 * { "error": { "code": "snake_case", "message": "...", "details": { ... } } }
 * `code` is the contract; `details` is always an object, never null.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const Errors = {
  invalidInput(message: string, details: Record<string, unknown> = {}): ApiError {
    return new ApiError('invalid_input', 400, message, details);
  },

  resourceNotFound(what: string, id: string, details: Record<string, unknown> = {}): ApiError {
    return new ApiError('resource_not_found', 404, `${what} '${id}' was not found.`, { id, ...details });
  },

  noPublishedMethodology(): ApiError {
    return new ApiError(
      'no_published_methodology',
      503,
      'No methodology version is published yet; classify once a version is published.',
      {},
    );
  },

  methodologyImmutable(slug: string, ingredient: string): ApiError {
    return new ApiError(
      'methodology_immutable',
      409,
      `Methodology version '${slug}' is published and immutable; the rule for '${ingredient}' cannot be added or changed.`,
      { slug, ingredient },
    );
  },
};
```

### src/common/all-exceptions.filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from './api-error.js';

interface Envelope {
  code: string;
  status: number;
  message: string;
  details: Record<string, unknown>;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { code, status, message, details } = this.toEnvelope(exception);
    response.status(status).json({ error: { code, message, details } });
  }

  private toEnvelope(exception: unknown): Envelope {
    if (exception instanceof ApiError) {
      return {
        code: exception.code,
        status: exception.status,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string' ? body : String((body as Record<string, unknown>).message ?? exception.message);
      return { code: this.codeForStatus(status), status, message, details: {} };
    }
    const message = exception instanceof Error ? exception.message : 'Unexpected error.';
    return { code: 'internal_error', status: 500, message, details: {} };
  }

  private codeForStatus(status: number): string {
    if (status === 400) {
      return 'invalid_input';
    }
    if (status === 404) {
      return 'resource_not_found';
    }
    if (status === 409) {
      return 'conflict';
    }
    return 'internal_error';
  }
}
```

### src/classification/inci-normalizer.ts
```ts
/**
 * INCI normalization: case, accents, and whitespace are collapsed to a stable key.
 * Pure and deterministic — the same input always yields the same key.
 *
 * OCR typos and synonyms are deliberately NOT handled here: they are data, not
 * text transforms, and are resolved through the synonym fixtures (see fixtures.ts).
 */
export function normalizeInci(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
```

### src/classification/fixtures.ts
```ts
// ASSUMPTION: the task refers to "provided" synonym/typo fixtures, but none were
// attached to this repo; the fixture data below is a stand-in, shaped to exercise
// every required behaviour (synonyms, OCR typos, profile modifiers, version changes).

export const PROFILE_CONTEXTS: readonly string[] = ['child_under_3', 'pregnancy'];

export interface IngredientFixture {
  name: string;
  synonyms: string[];
}

export interface RuleFixture {
  ingredient: string;
  kind: 'base' | 'context';
  severity: 'banned' | 'restricted' | 'watch';
  source: string;
  context?: string;
}

export interface MethodologyFixture {
  slug: string;
  name: string;
  rules: RuleFixture[];
}

export const INGREDIENT_FIXTURES: IngredientFixture[] = [
  { name: 'Aqua', synonyms: ['water', 'eau'] },
  { name: 'Fragrance', synonyms: ['parfum', 'parfume', 'fragrance oil'] }, // 'parfume' is an OCR typo variant
  { name: 'Methylparaben', synonyms: ['methyl paraben', 'metylparaben'] }, // spaced variant + OCR typo
  { name: 'Linalool', synonyms: ['linarool'] }, // OCR typo (a/l transposition)
  { name: 'Tocopherol', synonyms: ['vitamin e', 'vit e'] },
  { name: 'Citral', synonyms: [] },
  { name: 'Hydroquinone', synonyms: ['benzoquinol'] },
  { name: 'Methylchloroisothiazolinone', synonyms: ['mci', 'methylchloroisothiazolinon'] }, // trailing-letter OCR typo
  { name: 'Retinyl palmitate', synonyms: ['retinol palmitate'] },
  { name: 'Formaldehyde', synonyms: ['methanal'] },
];

export const METHODOLOGY_V1: MethodologyFixture = {
  slug: 'v1',
  name: 'Methodology v1 (regulator restricted list + curated watch list, 2025-Q1)',
  rules: [
    { ingredient: 'Hydroquinone', kind: 'base', severity: 'banned', source: 'EC 1223/2009, Annex II, 246' },
    { ingredient: 'Formaldehyde', kind: 'base', severity: 'restricted', source: 'EC 1223/2009, Annex III, 16' },
    {
      ingredient: 'Methylparaben',
      kind: 'base',
      severity: 'watch',
      source: 'Curated watch list, 2025-Q1: paraben review pending',
    },
    { ingredient: 'Linalool', kind: 'base', severity: 'watch', source: 'EC 1223/2009, Annex III, 683' },
    {
      ingredient: 'Methylchloroisothiazolinone',
      kind: 'base',
      severity: 'restricted',
      source: 'EC 1223/2009, Annex V, 34',
    },
    {
      ingredient: 'Fragrance',
      kind: 'base',
      severity: 'watch',
      source: 'Curated watch list, 2025-Q1: undisclosed allergens',
    },
    {
      ingredient: 'Methylchloroisothiazolinone',
      kind: 'context',
      context: 'child_under_3',
      severity: 'banned',
      source: 'EC 1223/2009, Annex V, 34.1 (children under 3)',
    },
    {
      ingredient: 'Fragrance',
      kind: 'context',
      context: 'child_under_3',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q1: fragrance for children under 3',
    },
    {
      ingredient: 'Retinyl palmitate',
      kind: 'context',
      context: 'child_under_3',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q1: retinoids for children under 3',
    },
    {
      ingredient: 'Citral',
      kind: 'context',
      context: 'pregnancy',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q1: citral in pregnancy',
    },
    {
      ingredient: 'Retinyl palmitate',
      kind: 'context',
      context: 'pregnancy',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q1: retinoids in pregnancy',
    },
    {
      ingredient: 'Fragrance',
      kind: 'context',
      context: 'pregnancy',
      severity: 'watch',
      source: 'Curated watch list, 2025-Q1: fragrance in pregnancy',
    },
  ],
};

export const METHODOLOGY_V2: MethodologyFixture = {
  slug: 'v2',
  name: 'Methodology v2 (regulator restricted list + curated watch list, 2025-Q2)',
  rules: [
    { ingredient: 'Hydroquinone', kind: 'base', severity: 'banned', source: 'EC 1223/2009, Annex II, 246' },
    { ingredient: 'Formaldehyde', kind: 'base', severity: 'restricted', source: 'EC 1223/2009, Annex III, 16' },
    {
      ingredient: 'Methylparaben',
      kind: 'base',
      severity: 'restricted',
      source: 'EC 1223/2009, Annex III, 33 (revised 2025-Q2)',
    },
    { ingredient: 'Linalool', kind: 'base', severity: 'watch', source: 'EC 1223/2009, Annex III, 683' },
    {
      ingredient: 'Methylchloroisothiazolinone',
      kind: 'base',
      severity: 'restricted',
      source: 'EC 1223/2009, Annex V, 34',
    },
    {
      ingredient: 'Fragrance',
      kind: 'base',
      severity: 'watch',
      source: 'Curated watch list, 2025-Q2: undisclosed allergens',
    },
    {
      ingredient: 'Citral',
      kind: 'base',
      severity: 'watch',
      source: 'Curated watch list, 2025-Q2: sensitization',
    },
    {
      ingredient: 'Methylchloroisothiazolinone',
      kind: 'context',
      context: 'child_under_3',
      severity: 'banned',
      source: 'EC 1223/2009, Annex V, 34.1 (children under 3)',
    },
    {
      ingredient: 'Fragrance',
      kind: 'context',
      context: 'child_under_3',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q2: fragrance for children under 3',
    },
    {
      ingredient: 'Retinyl palmitate',
      kind: 'context',
      context: 'child_under_3',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q2: retinoids for children under 3',
    },
    {
      ingredient: 'Citral',
      kind: 'context',
      context: 'pregnancy',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q2: citral in pregnancy',
    },
    {
      ingredient: 'Retinyl palmitate',
      kind: 'context',
      context: 'pregnancy',
      severity: 'restricted',
      source: 'Curated watch list, 2025-Q2: retinoids in pregnancy',
    },
    {
      ingredient: 'Fragrance',
      kind: 'context',
      context: 'pregnancy',
      severity: 'watch',
      source: 'Curated watch list, 2025-Q2: fragrance in pregnancy',
    },
  ],
};
```

### src/classification/classification.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, RuleKind, RuleSeverity, VersionStatus } from '@prisma/client';
import type {
  ClassificationResult,
  Ingredient,
  MethodologyVersion,
  Product,
  ProductIngredient,
  Profile,
  Rule,
  Synonym,
} from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { Errors } from '../common/api-error.js';
import { normalizeInci } from './inci-normalizer.js';

export interface ResolutionEntry {
  ingredientId: string;
  canonicalName: string;
  matchedVia: 'canonical' | 'synonym';
}

export type ProductWithIngredients = Product & { ingredients: ProductIngredient[] };
export type RuleWithIngredient = Rule & { ingredient: { name: string } };

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------- methodology versions

  async findActiveVersion(): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findFirst({
      where: { status: VersionStatus.PUBLISHED },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findVersion(idOrSlug: string): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    });
  }

  async listVersions(): Promise<MethodologyVersion[]> {
    return this.prisma.methodologyVersion.findMany({
      orderBy: [{ createdAt: 'asc' }, { slug: 'asc' }],
    });
  }

  async createVersion(slug: string, name: string): Promise<MethodologyVersion> {
    return this.prisma.methodologyVersion.upsert({
      where: { slug },
      update: {},
      create: { slug, name },
    });
  }

  async markVersionPublished(id: string): Promise<MethodologyVersion> {
    return this.prisma.methodologyVersion.update({
      where: { id },
      data: { status: VersionStatus.PUBLISHED, publishedAt: new Date() },
    });
  }

  // ------------------------------------------------- rules

  async findRulesByVersion(versionId: string): Promise<RuleWithIngredient[]> {
    return this.prisma.rule.findMany({
      where: { versionId },
      include: { ingredient: { select: { name: true } } },
      orderBy: [{ ingredientId: 'asc' }, { kind: 'asc' }, { context: 'asc' }],
    });
  }

  async findRuleByKeys(
    versionId: string,
    ingredientName: string,
    kind: RuleKind,
    context: string,
  ): Promise<Rule | null> {
    const ingredient = await this.prisma.ingredient.findUnique({
      where: { name: ingredientName },
      select: { id: true },
    });
    if (!ingredient) {
      return null;
    }
    return this.prisma.rule.findUnique({
      where: {
        versionId_ingredientId_kind_context: {
          versionId,
          ingredientId: ingredient.id,
          kind,
          context,
        },
      },
    });
  }

  async upsertRule(
    versionId: string,
    ingredientName: string,
    severity: string,
    source: string,
    kind: RuleKind,
    context: string,
  ): Promise<Rule> {
    const ingredient = await this.upsertIngredient(ingredientName);
    const prismaSeverity = severity as RuleSeverity;
    return this.prisma.rule.upsert({
      where: {
        versionId_ingredientId_kind_context: {
          versionId,
          ingredientId: ingredient.id,
          kind,
          context,
        },
      },
      update: { severity: prismaSeverity, source },
      create: {
        versionId,
        ingredientId: ingredient.id,
        kind,
        context,
        severity: prismaSeverity,
        source,
      },
    });
  }

  // ------------------------------------------------- ingredients & synonyms

  async upsertIngredient(name: string): Promise<Ingredient> {
    const normalized = normalizeInci(name);
    return this.prisma.ingredient.upsert({
      where: { normalized },
      update: {},
      create: { name, normalized },
    });
  }

  async upsertSynonym(ingredientId: string, text: string): Promise<Synonym> {
    const normalized = normalizeInci(text);
    return this.prisma.synonym.upsert({
      where: { normalized },
      update: {},
      create: { text, normalized, ingredientId },
    });
  }

  /**
   * Lookup table: normalized alias -> canonical ingredient. Canonical names
   * win over synonyms when both would match the same key.
   */
  async findResolutionMap(): Promise<Map<string, ResolutionEntry>> {
    const [ingredients, synonyms] = await Promise.all([
      this.prisma.ingredient.findMany({ select: { id: true, name: true, normalized: true } }),
      this.prisma.synonym.findMany({
        select: {
          ingredientId: true,
          normalized: true,
          ingredient: { select: { name: true } },
        },
      }),
    ]);
    const map = new Map<string, ResolutionEntry>();
    for (const ingredient of ingredients) {
      map.set(ingredient.normalized, {
        ingredientId: ingredient.id,
        canonicalName: ingredient.name,
        matchedVia: 'canonical',
      });
    }
    for (const synonym of synonyms) {
      if (!map.has(synonym.normalized)) {
        map.set(synonym.normalized, {
          ingredientId: synonym.ingredientId,
          canonicalName: synonym.ingredient.name,
          matchedVia: 'synonym',
        });
      }
    }
    return map;
  }

  // ------------------------------------------------- products

  async createProduct(name: string, brand: string | null, ingredients: string[]): Promise<Product> {
    return this.prisma.product.create({
      data: {
        name,
        brand,
        ingredients: {
          create: ingredients.map((raw, position) => ({ raw, position })),
        },
      },
    });
  }

  async findProduct(id: string): Promise<ProductWithIngredients | null> {
    return this.prisma.product.findUnique({
      where: { id },
      include: { ingredients: { orderBy: { position: 'asc' } } },
    });
  }

  async listProducts(): Promise<ProductWithIngredients[]> {
    return this.prisma.product.findMany({
      include: { ingredients: { orderBy: { position: 'asc' } } },
    });
  }

  async reorderProductIngredients(productId: string, orderedRaws: string[]): Promise<void> {
    const rows = await this.prisma.productIngredient.findMany({ where: { productId } });
    const idByRaw = new Map<string, string>();
    for (const row of rows) {
      idByRaw.set(row.raw, row.id);
    }
    const updates = orderedRaws.map((raw, position) => {
      const id = idByRaw.get(raw);
      if (!id) {
        throw Errors.invalidInput(`Ingredient '${raw}' is not part of the product.`, { raw });
      }
      return this.prisma.productIngredient.update({ where: { id }, data: { position } });
    });
    await this.prisma.$transaction(updates);
  }

  // ------------------------------------------------- profiles

  async createProfile(name: string, contexts: string[]): Promise<Profile> {
    return this.prisma.profile.create({ data: { name, contexts } });
  }

  async findProfile(id: string): Promise<Profile | null> {
    return this.prisma.profile.findUnique({ where: { id } });
  }

  // ------------------------------------------------- stored results

  async upsertResult(productId: string, versionId: string, payload: object): Promise<ClassificationResult> {
    const json = payload as Prisma.InputJsonValue;
    return this.prisma.classificationResult.upsert({
      where: { productId_versionId: { productId, versionId } },
      update: { payload: json },
      create: { productId, versionId, payload: json },
    });
  }

  async findResult(productId: string, versionId: string): Promise<ClassificationResult | null> {
    return this.prisma.classificationResult.findUnique({
      where: { productId_versionId: { productId, versionId } },
    });
  }

  async countResults(versionId: string): Promise<number> {
    return this.prisma.classificationResult.count({ where: { versionId } });
  }
}
```

### src/classification/classification.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { RuleKind, VersionStatus } from '@prisma/client';
import type { ClassificationResult, MethodologyVersion, Product, Profile } from '@prisma/client';
import { Errors } from '../common/api-error.js';
import {
  ClassificationRepository,
  type ProductWithIngredients,
  type ResolutionEntry,
  type RuleWithIngredient,
} from './classification.repository.js';
import { normalizeInci } from './inci-normalizer.js';
import type { IngredientFixture, MethodologyFixture } from './fixtures.js';

export type Severity = 'banned' | 'restricted' | 'watch';
export type Flag = 'unknown' | 'none' | Severity;

export interface Finding {
  raw: string;
  canonical: string | null;
  recognized: boolean;
  flag: Flag;
  severity: Severity | null;
  source: string | null;
  matchedVia: 'canonical' | 'synonym' | null;
  modifierContext: string | null;
}

export interface ClassificationSummary {
  total: number;
  recognized: number;
  unknown: number;
}

export interface StoredPayload {
  schema: 1;
  methodologyVersion: string;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
}

export interface ClassificationOutput {
  productId: string;
  methodologyVersion: string;
  profile: string | null;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

export interface StoredResultView {
  productId: string;
  methodologyVersion: string;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

export interface ModifierRow {
  canonicalName: string;
  context: string;
  severity: Severity;
  source: string;
}

export const DISCLAIMER =
  'These findings list which rules fired for each ingredient and cite the source of each rule. ' +
  'They are not a safety verdict: an ingredient without a flag only means no rule in this ' +
  'methodology version matched it, which is not the same as it being safe.';

/**
 * Modifier precedence — written down; the only permitted resolution order.
 *
 * 1. Start from the base severity of the ingredient in the active methodology
 *    version (which may be "no rule", i.e. unflagged).
 * 2. A context modifier only tightens, never loosens: the effective severity is
 *    the maximum of the base severity and the severities of all modifiers whose
 *    context is present in the profile (banned > restricted > watch).
 * 3. Ties are broken by fixed context precedence: child_under_3 before
 *    pregnancy. If the base rule and a modifier tie, the base citation wins.
 * 4. Contexts outside the precedence list sort after the listed ones; their
 *    relative order is the deterministic rule-table order.
 * 5. Modifiers never apply to unknown (unresolved) ingredients.
 *
 * The winner is chosen by (severity rank, precedence index) — never by array
 * iteration order — so two modifiers on one ingredient resolve the same way
 * every time.
 */
export const MODIFIER_PRECEDENCE: readonly string[] = ['child_under_3', 'pregnancy'];

const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };

interface ModifierCandidate {
  rank: number;
  order: number;
  severity: Severity;
  source: string;
  context: string | null;
}

function findingSortKey(finding: Finding): string {
  return finding.recognized
    ? `0\u0000${finding.canonical}\u0000${finding.raw}`
    : `1\u0000${normalizeInci(finding.raw)}\u0000${finding.raw}`;
}

/**
 * Applies a profile's contextual modifiers to base findings using the
 * precedence written above. Pure and deterministic.
 */
export function applyProfileModifiers(
  findings: Finding[],
  modifiers: ModifierRow[],
  contexts: readonly string[],
): Finding[] {
  const activeContexts = new Set(contexts);
  if (activeContexts.size === 0 || modifiers.length === 0) {
    return findings;
  }

  const byIngredient = new Map<string, ModifierRow[]>();
  for (const modifier of modifiers) {
    if (!activeContexts.has(modifier.context)) {
      continue;
    }
    const list = byIngredient.get(modifier.canonicalName);
    if (list) {
      list.push(modifier);
    } else {
      byIngredient.set(modifier.canonicalName, [modifier]);
    }
  }

  return findings.map((finding) => {
    if (!finding.recognized || finding.canonical === null) {
      return finding;
    }
    const candidates: ModifierCandidate[] = [];
    if (finding.severity !== null && finding.source !== null) {
      candidates.push({
        rank: SEVERITY_RANK[finding.severity],
        order: -1,
        severity: finding.severity,
        source: finding.source,
        context: null,
      });
    }
    for (const modifier of byIngredient.get(finding.canonical) ?? []) {
      const precedence = MODIFIER_PRECEDENCE.indexOf(modifier.context);
      candidates.push({
        rank: SEVERITY_RANK[modifier.severity],
        order: precedence === -1 ? MODIFIER_PRECEDENCE.length : precedence,
        severity: modifier.severity,
        source: modifier.source,
        context: modifier.context,
      });
    }
    if (candidates.length === 0) {
      return finding;
    }
    candidates.sort((a, b) => b.rank - a.rank || a.order - b.order);
    const winner = candidates[0];
    return {
      ...finding,
      flag: winner.severity,
      severity: winner.severity,
      source: winner.source,
      modifierContext: winner.context,
    };
  });
}

/**
 * Pure base classification: normalize + resolve each raw ingredient, apply the
 * version's base rules, sort deterministically, and derive confidence.
 */
export function buildBaseClassification(
  rawIngredients: string[],
  resolutionMap: Map<string, ResolutionEntry>,
  baseRules: Map<string, { severity: Severity; source: string }>,
): { findings: Finding[]; confidence: number; summary: ClassificationSummary } {
  const findings: Finding[] = rawIngredients.map((raw) => {
    const key = normalizeInci(raw);
    const hit = key === '' ? undefined : resolutionMap.get(key);
    if (hit === undefined) {
      // Unknown is a first-class outcome: listed, counted against confidence,
      // never dropped and never treated as clean.
      return {
        raw,
        canonical: null,
        recognized: false,
        flag: 'unknown' as const,
        severity: null,
        source: null,
        matchedVia: null,
        modifierContext: null,
      };
    }
    const rule = baseRules.get(hit.canonicalName);
    return {
      raw,
      canonical: hit.canonicalName,
      recognized: true,
      flag: rule ? rule.severity : 'none',
      severity: rule ? rule.severity : null,
      source: rule ? rule.source : null,
      matchedVia: hit.matchedVia,
      modifierContext: null,
    };
  });

  // Deterministic order: recognised findings by canonical name, then unknowns
  // by normalized raw text. The stored ingredient order never leaks through.
  findings.sort((a, b) => {
    const keyA = findingSortKey(a);
    const keyB = findingSortKey(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  const total = findings.length;
  const recognized = findings.reduce((count, finding) => count + (finding.recognized ? 1 : 0), 0);
  const unknown = total - recognized;
  // Confidence = the fraction of the list we could resolve to a known
  // ingredient; unknown ingredients lower it. An empty list has no
  // recognisable content, so 0.
  const confidence = total === 0 ? 0 : Math.round((recognized / total) * 10000) / 10000;

  return { findings, confidence, summary: { total, recognized, unknown } };
}

@Injectable()
export class ClassificationService {
  constructor(private readonly repository: ClassificationRepository) {}

  // ------------------------------------------------- ingestion (ops/tests)

  async ingestIngredients(
    fixtures: IngredientFixture[],
  ): Promise<{ ingredients: number; synonyms: number }> {
    let synonyms = 0;
    for (const fixture of fixtures) {
      const ingredient = await this.repository.upsertIngredient(fixture.name);
      for (const synonym of fixture.synonyms) {
        await this.repository.upsertSynonym(ingredient.id, synonym);
        synonyms += 1;
      }
    }
    return { ingredients: fixtures.length, synonyms };
  }

  /**
   * Ingests a methodology version from a fixture. Idempotent for identical
   * input; once the version is published, any change is rejected
   * (published versions never change).
   */
  async ingestMethodology(fix: MethodologyFixture): Promise<{
    versionId: string;
    slug: string;
    upserted: number;
    unchanged: number;
  }> {
    const existing = await this.repository.findVersion(fix.slug);
    const version = existing ?? (await this.repository.createVersion(fix.slug, fix.name));
    let upserted = 0;
    let unchanged = 0;
    for (const rule of fix.rules) {
      if (rule.kind === 'context' && !rule.context) {
        throw Errors.invalidInput('A context rule requires a context.', { ingredient: rule.ingredient });
      }
      const kind = rule.kind === 'context' ? RuleKind.CONTEXT : RuleKind.BASE;
      const context = rule.kind === 'context' ? rule.context : '';
      const found = await this.repository.findRuleByKeys(version.id, rule.ingredient, kind, context);
      const identical =
        found !== null && found.severity.toLowerCase() === rule.severity && found.source === rule.source;
      if (identical) {
        unchanged += 1;
        continue;
      }
      if (version.status === VersionStatus.PUBLISHED) {
        throw Errors.methodologyImmutable(version.slug, rule.ingredient);
      }
      await this.repository.upsertRule(version.id, rule.ingredient, rule.severity, rule.source, kind, context);
      upserted += 1;
    }
    return { versionId: version.id, slug: version.slug, upserted, unchanged };
  }

  // ------------------------------------------------- lifecycle

  async publish(versionIdOrSlug: string): Promise<{
    versionId: string;
    slug: string;
    newlyPublished: boolean;
    products: number;
  }> {
    const version = await this.repository.findVersion(versionIdOrSlug);
    if (!version) {
      throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
    }
    const newlyPublished = version.status === VersionStatus.DRAFT;
    if (newlyPublished) {
      await this.repository.markVersionPublished(version.id);
    }
    const { products } = await this.rescore(version.id);
    return { versionId: version.id, slug: version.slug, newlyPublished, products };
  }

  /**
   * Re-scores every product under the given methodology version, upserting the
   * stored result keyed by (product, version). Idempotent: running it again
   * produces the same rows, not duplicates, because the key is unique and the
   * payload is deterministic.
   */
  async rescore(versionIdOrSlug: string): Promise<{ versionId: string; products: number }> {
    const version = await this.repository.findVersion(versionIdOrSlug);
    if (!version) {
      throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
    }
    const [products, resolutionMap, rules] = await Promise.all([
      this.repository.listProducts(),
      this.repository.findResolutionMap(),
      this.repository.findRulesByVersion(version.id),
    ]);
    for (const product of products) {
      await this.upsertStoredResult(product, version, resolutionMap, rules);
    }
    return { versionId: version.id, products: products.length };
  }

  async listVersions(): Promise<
    Array<{ id: string; slug: string; name: string; status: string; publishedAt: string | null }>
  > {
    const versions = await this.repository.listVersions();
    return versions.map((version) => ({
      id: version.id,
      slug: version.slug,
      name: version.name,
      status: version.status,
      publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
    }));
  }

  // ------------------------------------------------- products & profiles

  async createProduct(name: string, brand: string | null, ingredients: string[]): Promise<Product> {
    return this.repository.createProduct(name, brand, ingredients);
  }

  async createProfile(name: string, contexts: string[]): Promise<Profile> {
    return this.repository.createProfile(name, contexts);
  }

  async reorderProductIngredients(productId: string, orderedRaws: string[]): Promise<void> {
    const product = await this.repository.findProduct(productId);
    if (!product) {
      throw Errors.resourceNotFound('Product', productId);
    }
    const existing = product.ingredients.map((row) => row.raw).sort();
    const wanted = [...orderedRaws].sort();
    if (existing.length !== wanted.length || existing.some((value, index) => value !== wanted[index])) {
      throw Errors.invalidInput('Reordering must use exactly the same ingredient list as the product.', {
        productId,
      });
    }
    await this.repository.reorderProductIngredients(product.id, orderedRaws);
  }

  // ------------------------------------------------- classification

  /**
   * Classifies a product against the active (latest published) methodology
   * version, optionally tightened by a profile's contextual modifiers.
   *
   * The base findings come from the stored result for (product, active
   * version) — the immutable snapshot written by re-scoring — so a result never
   * changes under a reader. Profile modifiers are applied deterministically on
   * top; the profile is not part of the stored key.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationOutput> {
    const product = await this.repository.findProduct(productId);
    if (!product) {
      throw Errors.resourceNotFound('Product', productId);
    }
    let profile: Profile | null = null;
    if (profileId) {
      profile = await this.repository.findProfile(profileId);
      if (!profile) {
        throw Errors.resourceNotFound('Profile', profileId);
      }
    }
    const version = await this.repository.findActiveVersion();
    if (!version) {
      throw Errors.noPublishedMethodology();
    }
    const [stored, rules] = await Promise.all([
      this.repository.findResult(product.id, version.id),
      this.repository.findRulesByVersion(version.id),
    ]);
    let storedRow = stored;
    if (!storedRow) {
      // Product created after the version was published: score it lazily under
      // the active version.
      const resolutionMap = await this.repository.findResolutionMap();
      storedRow = await this.upsertStoredResult(product, version, resolutionMap, rules);
    }
    const payload = storedRow.payload as unknown as StoredPayload;
    const modifiers: ModifierRow[] = rules
      .filter((rule) => rule.kind === RuleKind.CONTEXT)
      .map((rule) => ({
        canonicalName: rule.ingredient.name,
        context: rule.context,
        severity: rule.severity.toLowerCase() as Severity,
        source: rule.source,
      }));
    const findings = applyProfileModifiers(payload.findings, modifiers, profile ? profile.contexts : []);
    return {
      productId: product.id,
      methodologyVersion: version.slug,
      profile: profile ? profile.id : null,
      findings,
      confidence: payload.confidence,
      summary: payload.summary,
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Returns the stored result for an explicit (product, methodology version)
   * pair — the exact snapshot written when that version was (re-)scored.
   */
  async getStoredResult(productId: string, versionIdOrSlug: string): Promise<StoredResultView> {
    const product = await this.repository.findProduct(productId);
    if (!product) {
      throw Errors.resourceNotFound('Product', productId);
    }
    const version = await this.repository.findVersion(versionIdOrSlug);
    if (!version) {
      throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
    }
    const stored = await this.repository.findResult(product.id, version.id);
    if (!stored) {
      throw Errors.resourceNotFound('Classification result', `${product.id} under ${version.slug}`);
    }
    const payload = stored.payload as unknown as StoredPayload;
    return {
      productId: product.id,
      methodologyVersion: version.slug,
      findings: payload.findings,
      confidence: payload.confidence,
      summary: payload.summary,
      disclaimer: DISCLAIMER,
    };
  }

  // ------------------------------------------------- internals

  private async upsertStoredResult(
    product: ProductWithIngredients,
    version: Pick<MethodologyVersion, 'id' | 'slug'>,
    resolutionMap: Map<string, ResolutionEntry>,
    rules: RuleWithIngredient[],
  ): Promise<ClassificationResult> {
    const baseRules = new Map<string, { severity: Severity; source: string }>();
    for (const rule of rules) {
      if (rule.kind !== RuleKind.BASE) {
        continue;
      }
      baseRules.set(rule.ingredient.name, {
        severity: rule.severity.toLowerCase() as Severity,
        source: rule.source,
      });
    }
    const { findings, confidence, summary } = buildBaseClassification(
      product.ingredients.map((row) => row.raw),
      resolutionMap,
      baseRules,
    );
    const payload: StoredPayload = {
      schema: 1,
      methodologyVersion: version.slug,
      findings,
      confidence,
      summary,
    };
    return this.repository.upsertResult(product.id, version.id, payload);
  }
}
```

### src/classification/classification.controller.ts
```ts
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Errors } from '../common/api-error.js';
import { ClassificationService } from './classification.service.js';
import { PROFILE_CONTEXTS } from './fixtures.js';
import type { MethodologyFixture } from './fixtures.js';

const SEVERITIES: readonly string[] = ['banned', 'restricted', 'watch'];

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw Errors.invalidInput(`${field} must be a non-empty string.`, { field });
  }
  return value;
}

function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw Errors.invalidInput('Request body must be a JSON object.', {});
  }
  return body as Record<string, unknown>;
}

function assertProductInput(body: unknown): { name: string; brand: string | null; ingredients: string[] } {
  const b = asObject(body);
  const name = asNonEmptyString(b.name, 'name');
  let brand: string | null = null;
  if (b.brand !== undefined && b.brand !== null) {
    brand = asNonEmptyString(b.brand, 'brand');
  }
  if (!Array.isArray(b.ingredients)) {
    throw Errors.invalidInput('ingredients must be an array of INCI strings.', { field: 'ingredients' });
  }
  const ingredients = b.ingredients.map((value, index) => asNonEmptyString(value, `ingredients[${index}]`));
  return { name, brand, ingredients };
}

function assertProfileInput(body: unknown): { name: string; contexts: string[] } {
  const b = asObject(body);
  const name = asNonEmptyString(b.name, 'name');
  let contexts: string[] = [];
  if (b.contexts !== undefined && b.contexts !== null) {
    if (!Array.isArray(b.contexts)) {
      throw Errors.invalidInput('contexts must be an array of profile contexts.', { field: 'contexts' });
    }
    contexts = b.contexts.map((value, index) => asNonEmptyString(value, `contexts[${index}]`));
    for (const context of contexts) {
      if (!PROFILE_CONTEXTS.includes(context)) {
        throw Errors.invalidInput(`Unknown profile context '${context}'. Allowed: ${PROFILE_CONTEXTS.join(', ')}.`, {
          field: 'contexts',
          context,
        });
      }
    }
  }
  return { name, contexts };
}

function assertMethodologyFixture(body: unknown): MethodologyFixture {
  const b = asObject(body);
  const slug = asNonEmptyString(b.slug, 'slug');
  const name = asNonEmptyString(b.name, 'name');
  if (!Array.isArray(b.rules) || b.rules.length === 0) {
    throw Errors.invalidInput('rules must be a non-empty array.', { field: 'rules' });
  }
  const rules = b.rules.map((value, index) => {
    const field = `rules[${index}]`;
    const r = asObject(value);
    const ingredient = asNonEmptyString(r.ingredient, `${field}.ingredient`);
    const kind = r.kind;
    if (kind !== 'base' && kind !== 'context') {
      throw Errors.invalidInput(`${field}.kind must be 'base' or 'context'.`, { field });
    }
    const severity = asNonEmptyString(r.severity, `${field}.severity`);
    if (!SEVERITIES.includes(severity)) {
      throw Errors.invalidInput(`${field}.severity must be one of ${SEVERITIES.join(', ')}.`, { field });
    }
    const source = asNonEmptyString(r.source, `${field}.source`);
    if (kind === 'base') {
      if (r.context !== undefined) {
        throw Errors.invalidInput(`${field}.context is only allowed on context rules.`, { field });
      }
      return { ingredient, kind: 'base' as const, severity: severity as 'banned' | 'restricted' | 'watch', source };
    }
    const context = asNonEmptyString(r.context, `${field}.context`);
    if (!PROFILE_CONTEXTS.includes(context)) {
      throw Errors.invalidInput(`Unknown context '${context}'. Allowed: ${PROFILE_CONTEXTS.join(', ')}.`, { field });
    }
    return {
      ingredient,
      kind: 'context' as const,
      context,
      severity: severity as 'banned' | 'restricted' | 'watch',
      source,
    };
  });
  return { slug, name, rules };
}

@Controller()
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Post('products')
  createProduct(@Body() body: unknown) {
    const { name, brand, ingredients } = assertProductInput(body);
    return this.classificationService.createProduct(name, brand, ingredients);
  }

  @Get('products/:productId/classification')
  classify(@Param('productId') productId: string, @Query('profileId') profileId?: string) {
    return this.classificationService.classify(productId, profileId || undefined);
  }

  @Get('products/:productId/classification-results')
  getStoredResult(
    @Param('productId') productId: string,
    @Query('methodologyVersionId') methodologyVersionId?: string,
  ) {
    if (!methodologyVersionId) {
      throw Errors.invalidInput('methodologyVersionId query parameter is required.', {
        field: 'methodologyVersionId',
      });
    }
    return this.classificationService.getStoredResult(productId, methodologyVersionId);
  }

  @Post('profiles')
  createProfile(@Body() body: unknown) {
    const { name, contexts } = assertProfileInput(body);
    return this.classificationService.createProfile(name, contexts);
  }

  @Get('methodology-versions')
  listMethodologyVersions() {
    return this.classificationService.listVersions();
  }

  @Post('methodology-versions')
  ingestMethodology(@Body() body: unknown) {
    return this.classificationService.ingestMethodology(assertMethodologyFixture(body));
  }

  @Post('methodology-versions/:versionId/publish')
  publishMethodology(@Param('versionId') versionId: string) {
    return this.classificationService.publish(versionId);
  }

  @Post('methodology-versions/:versionId/rescore')
  rescoreMethodology(@Param('versionId') versionId: string) {
    return this.classificationService.rescore(versionId);
  }
}
```

### src/classification/classification.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma.module.js';
import { ClassificationController } from './classification.controller.js';
import { ClassificationService } from './classification.service.js';
import { ClassificationRepository } from './classification.repository.js';

@Module({
  imports: [PrismaModule],
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
})
export class ClassificationModule {}
```

### test/classification.spec.ts
```ts
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service.js';
import { ClassificationRepository } from '../src/classification/classification.repository.js';
import { ClassificationService } from '../src/classification/classification.service.js';
import { INGREDIENT_FIXTURES, METHODOLOGY_V1, METHODOLOGY_V2 } from '../src/classification/fixtures.js';

// ASSUMPTION: no database provisioning is available in this environment, so the
// tests target a real PostgreSQL instance via DATABASE_URL with the schema
// already applied (pnpm prisma migrate deploy).

const prisma = new PrismaClient();

function buildService(): ClassificationService {
  const repository = new ClassificationRepository(prisma as unknown as PrismaService);
  return new ClassificationService(repository);
}

let service!: ClassificationService;

async function wipeDatabase(): Promise<void> {
  await prisma.$transaction([
    prisma.classificationResult.deleteMany({}),
    prisma.rule.deleteMany({}),
    prisma.synonym.deleteMany({}),
    prisma.productIngredient.deleteMany({}),
    prisma.methodologyVersion.deleteMany({}),
    prisma.profile.deleteMany({}),
    prisma.product.deleteMany({}),
    prisma.ingredient.deleteMany({}),
  ]);
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL must point at a PostgreSQL database with the schema applied (pnpm prisma migrate deploy).',
    );
  }
  await wipeDatabase();
  service = buildService();
  await service.ingestIngredients(INGREDIENT_FIXTURES);
  await service.ingestMethodology(METHODOLOGY_V1);
  await service.publish('v1');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ingredient classification (issue #319)', () => {
  it('a profile flips a finding the base rules alone would not flag', async () => {
    const product = await service.createProduct('Citral Lotion', null, ['Water', 'Citral']);

    const base = await service.classify(product.id);
    const citral = base.findings.find((f) => f.canonical === 'Citral');
    expect(citral).toBeDefined();
    expect(citral!.severity).toBeNull();
    expect(citral!.flag).toBe('none');

    const profile = await service.createProfile('Pregnancy', ['pregnancy']);
    const withProfile = await service.classify(product.id, profile.id);
    const flagged = withProfile.findings.find((f) => f.canonical === 'Citral');
    expect(flagged!.severity).toBe('restricted');
    expect(flagged!.flag).toBe('restricted');
    expect(flagged!.source).toContain('pregnancy');
    expect(flagged!.modifierContext).toBe('pregnancy');
  });

  it('an unrecognized ingredient is listed as unknown and lowers confidence', async () => {
    const known = await service.createProduct('Known Ingredients Only', null, ['Water', 'Tocopherol']);
    const withUnknown = await service.createProduct('Has Unknown Ingredient', null, [
      'Water',
      'Tocopherol',
      'Zinc Gluconate',
    ]);

    const clean = await service.classify(known.id);
    const dirty = await service.classify(withUnknown.id);

    expect(clean.confidence).toBe(1);
    const unknown = dirty.findings.find((f) => f.raw === 'Zinc Gluconate');
    expect(unknown).toBeDefined();
    expect(unknown!.recognized).toBe(false);
    expect(unknown!.flag).toBe('unknown');
    expect(unknown!.canonical).toBeNull();
    expect(unknown!.severity).toBeNull();
    expect(dirty.summary).toEqual({ total: 3, recognized: 2, unknown: 1 });
    expect(dirty.confidence).toBeLessThan(clean.confidence);
    expect(dirty.confidence).toBe(0.6667);
  });

  it('resolves synonyms and OCR typos to the canonical ingredient', async () => {
    const product = await service.createProduct('Synonym Sample', null, [
      'WATER',
      'Parfume',
      'Metylparaben',
      'Vitamin E',
      'linarool',
    ]);
    const out = await service.classify(product.id);
    const byRaw = new Map(out.findings.map((f) => [f.raw, f]));

    expect(byRaw.get('WATER')!.canonical).toBe('Aqua');
    expect(byRaw.get('WATER')!.matchedVia).toBe('synonym');
    expect(byRaw.get('Parfume')!.canonical).toBe('Fragrance');
    expect(byRaw.get('Metylparaben')!.canonical).toBe('Methylparaben');
    expect(byRaw.get('Vitamin E')!.canonical).toBe('Tocopherol');
    expect(byRaw.get('linarool')!.canonical).toBe('Linalool');
    expect(out.summary.unknown).toBe(0);
    expect(out.confidence).toBe(1);

    // resolved ingredients carry the canonical ingredient's rule, not the alias's
    expect(byRaw.get('Metylparaben')!.severity).toBe('watch');
    expect(byRaw.get('linarool')!.source).toBe('EC 1223/2009, Annex III, 683');
  });

  it('returns identical output across reruns', async () => {
    const product = await service.createProduct('Rerun Sample', 'Acme', [
      'Fragrance',
      'Water',
      'Methylparaben',
      'Citral',
    ]);
    const first = await service.classify(product.id);
    const second = await service.classify(product.id);
    expect(second).toEqual(first);
  });

  it('returns identical output when the stored ingredient order is shuffled', async () => {
    const ordered = ['Fragrance', 'Water', 'Methylparaben', 'Citral', 'Tocopherol'];
    const shuffled = ['Citral', 'Tocopherol', 'Methylparaben', 'Fragrance', 'Water'];
    const product = await service.createProduct('Shuffle Sample', null, ordered);
    const before = await service.classify(product.id);
    await service.reorderProductIngredients(product.id, shuffled);
    const after = await service.classify(product.id);
    expect(after).toEqual(before);
  });

  it('two modifiers on one ingredient resolve by the written precedence', async () => {
    const family = await service.createProfile('Family', ['child_under_3', 'pregnancy']);
    const fragrance = await service.createProduct('Fragrance Sample', null, ['Fragrance', 'Water']);
    const retinoid = await service.createProduct('Retinoid Sample', null, ['Retinyl Palmitate', 'Water']);

    const fragranceOut = await service.classify(fragrance.id, family.id);
    const frag = fragranceOut.findings.find((f) => f.canonical === 'Fragrance');
    // child_under_3 is RESTRICTED, pregnancy is WATCH: the maximum severity wins
    expect(frag!.severity).toBe('restricted');
    expect(frag!.source).toContain('under 3');
    expect(frag!.modifierContext).toBe('child_under_3');

    const retinoidOut = await service.classify(retinoid.id, family.id);
    const retinyl = retinoidOut.findings.find((f) => f.canonical === 'Retinyl Palmitate');
    // both modifiers are RESTRICTED: the fixed precedence (child_under_3 first)
    // picks the citation, regardless of rule-table order
    expect(retinyl!.severity).toBe('restricted');
    expect(retinyl!.source).toContain('under 3');
    expect(retinyl!.modifierContext).toBe('child_under_3');
  });

  // Runs last: it publishes v2, which changes the active version.
  it('keeps v1 and v2 results retrievable for the same product after publishing v2', async () => {
    const product = await service.createProduct('Dual Version Sample', null, [
      'Methylparaben',
      'Citral',
      'Water',
    ]);
    // lazy-scores under the active version (v1) so a v1 row exists
    await service.classify(product.id);
    const v1Before = await service.getStoredResult(product.id, 'v1');

    await service.ingestMethodology(METHODOLOGY_V2);
    await service.publish('v2');

    const v1 = await service.getStoredResult(product.id, 'v1');
    const v2 = await service.getStoredResult(product.id, 'v2');

    // the previous version's result is retrievable exactly as it was
    expect(v1).toEqual(v1Before);

    // the new version scores the same product differently where rules changed
    expect(v1.findings.find((f) => f.canonical === 'Methylparaben')!.severity).toBe('watch');
    expect(v2.findings.find((f) => f.canonical === 'Methylparaben')!.severity).toBe('restricted');
    expect(v1.findings.find((f) => f.canonical === 'Citral')!.severity).toBeNull();
    expect(v2.findings.find((f) => f.canonical === 'Citral')!.severity).toBe('watch');

    // re-scoring is idempotent: re-publishing v2 produces the same rows, not duplicates
    const rowsBefore = await prisma.classificationResult.count({ where: { version: { slug: 'v2' } } });
    const rowBefore = await prisma.classificationResult.findFirst({
      where: { productId: product.id, version: { slug: 'v2' } },
    });
    await service.publish('v2');
    const rowsAfter = await prisma.classificationResult.count({ where: { version: { slug: 'v2' } } });
    const rowAfter = await prisma.classificationResult.findFirst({
      where: { productId: product.id, version: { slug: 'v2' } },
    });
    expect(rowsAfter).toBe(rowsBefore);
    expect(rowAfter!.payload).toEqual(rowBefore!.payload);

    // classify now uses the new active version
    const active = await service.classify(product.id);
    expect(active.methodologyVersion).toBe('v2');
  });
});
```

### README.md
```md
# cosmetics-scanner

Classifies cosmetics from their INCI ingredient lists. Rules come from a regulator's
restricted list and a curated watch list, each entry with a source citation and a
severity (banned / restricted / watch), grouped under immutable methodology
versions. The output is per-ingredient findings with source citations — never a
binary safe/toxic verdict.

Stack: TypeScript (strict, ESM), NestJS, Prisma, PostgreSQL, Vitest, pnpm.

## Setup

    cp .env.example .env             # set DATABASE_URL
    pnpm install
    pnpm prisma:generate
    pnpm prisma:migrate              # applies prisma/migrations
    pnpm start:dev                   # or: pnpm build && pnpm start
    pnpm test                        # needs the same DATABASE_URL

Configuration comes from environment variables only: `DATABASE_URL`, `PORT`.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | /products | Create a product with an ordered INCI list |
| POST | /profiles | Create a family profile (contexts: `child_under_3`, `pregnancy`) |
| GET | /products/:productId/classification?profileId= | classify: active methodology + optional profile |
| GET | /products/:productId/classification-results?methodologyVersionId=v1 | stored result for an explicit version |
| POST | /methodology-versions | Ingest a methodology version (rules with citations) |
| POST | /methodology-versions/:versionId/publish | Publish (makes it immutable) + idempotent re-score of all products |
| POST | /methodology-versions/:versionId/rescore | Re-run the (idempotent) re-score |
| GET | /methodology-versions | List versions |

Errors use one envelope: `{ "error": { "code", "message", "details" } }` with
snake_case codes: `invalid_input`, `resource_not_found`, `no_published_methodology`,
`methodology_immutable`, `conflict`, `internal_error`.

## How classification works

1. Each listed ingredient is normalized (case, accents, whitespace) and resolved
   against canonical ingredients and their synonym/typo variants (fixture data in
   `src/classification/fixtures.ts`). What does not resolve is **unknown**: listed
   in the output, counted against confidence, never dropped, never treated as clean.
2. The base rules of the active (latest published) methodology version set each
   ingredient's flag, severity, and source citation.
3. The profile's contextual modifiers tighten (never loosen) severities by the
   precedence below.

Results are stored keyed by **(product, methodologyVersion)**. Publishing a new
version re-scores all products into new rows; stored rows are never rewritten, so
previous versions stay retrievable exactly as they were. Re-scoring is idempotent:
upsert on the unique (product, version) key with a deterministic payload.

Confidence is the fraction of the list that resolved to a known ingredient, rounded
to 4 decimals (an empty list is 0). Unknown ingredients lower it.

Output ordering is deterministic: findings are sorted by canonical name, then by
normalized raw text — the stored ingredient order never leaks into the output.

## Modifier precedence (written down)

Given the base severity of an ingredient in the active methodology version and the
context modifiers whose context is present in the profile:

1. A modifier may only tighten, never loosen: the effective severity is the maximum
   of the base severity and the modifier severities (banned > restricted > watch).
2. Ties are broken by fixed context precedence: `child_under_3`, then `pregnancy`
   (`MODIFIER_PRECEDENCE` in `src/classification/classification.service.ts`). If the
   base rule and a modifier tie, the base citation wins.
3. Contexts outside the precedence list sort after the listed ones, in rule-table
   order.
4. Modifiers never apply to unknown (unresolved) ingredients.

The winner is chosen by (severity rank, precedence index) — never by iteration
order — so two modifiers on one ingredient resolve the same way every time.

## Assumptions

- The task references "provided" synonym/typo fixtures; none were attached to this
  repo, so the fixture data in `src/classification/fixtures.ts` is a stand-in shaped
  to cover the required behaviours.
- Family profiles carry the contexts `child_under_3` and `pregnancy`; a profile may
  combine several, and modifiers from all of them are applied together.
- Tests run against a real PostgreSQL database at `DATABASE_URL` with the schema
  applied (`pnpm prisma migrate deploy`).
```


---

REQUEST TIMED OUT after 2700s


---

# repair1-set

## reasoning

```
Let me look at the errors:

1. `src/classification/classification.service.ts(274,93): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.`
2. `src/classification/classification.service.ts(284,103): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.`

I need to look at lines 274 and 284 in the service file. Let me count the lines in the provided file.

Looking at the service file, let me find the relevant lines. The file is quite long. Let me trace through it carefully.

Let me count lines from the top:

1: `import { Injectable } from '@nestjs/common';`
2: `import { RuleKind, VersionStatus } from '@prisma/client';`
3: `import type { ClassificationResult, MethodologyVersion, Product, Profile } from '@prisma/client';`
4: `import { Errors } from '../common/api-error.js';`
5: `import {`
6: `  ClassificationRepository,`
7: `  type ProductWithIngredients,`
8: `  type ResolutionEntry,`
9: `  type RuleWithIngredient,`
10: `} from './classification.repository.js';`
11: `import { normalizeInci } from './inci-normalizer.js';`
12: `import type { IngredientFixture, MethodologyFixture } from './fixtures.js';`
13: (blank)
14: `export type Severity = 'banned' | 'restricted' | 'watch';`
15: `export type Flag = 'unknown' | 'none' | Severity;`
16: (blank)
17: `export interface Finding {`
18: `  raw: string;`
19: `  canonical: string | null;`
20: `  recognized: boolean;`
21: `  flag: Flag;`
22: `  severity: Severity | null;`
23: `  source: string | null;`
24: `  matchedVia: 'canonical' | 'synonym' | null;`
25: `  modifierContext: string | null;`
26: `}`
27: (blank)
28: `export interface ClassificationSummary {`
29: `  total: number;`
30: `  recognized: number;`
31: `  unknown: number;`
32: `}`
33: (blank)
34: `export interface StoredPayload {`
35: `  schema: 1;`
36: `  methodologyVersion: string;`
37: `  findings: Finding[];`
38: `  confidence: number;`
39: `  summary: ClassificationSummary;`
40: `}`
41: (blank)
42: `export interface ClassificationOutput {`
43: `  productId: string;`
44: `  methodologyVersion: string;`
45: `  profile: string | null;`
46: `  findings: Finding[];`
47: `  confidence: number;`
48: `  summary: ClassificationSummary;`
49: `  disclaimer: string;`
50: `}`
51: (blank)
52: `export interface StoredResultView {`
53: `  productId: string;`
54: `  methodologyVersion: string;`
55: `  findings: Finding[];`
56: `  confidence: number;`
57: `  summary: ClassificationSummary;`
58: `  disclaimer: string;`
59: `}`
60: (blank)
61: `export interface ModifierRow {`
62: `  canonicalName: string;`
63: `  context: string;`
64: `  severity: Severity;`
65: `  source: string;`
66: `}`
67: (blank)
68: `export const DISCLAIMER =`
69: `  'These findings list which rules fired for each ingredient and cite the source of each rule. ' +`
70: `  'They are not a safety verdict: an ingredient without a flag only means no rule in this ' +`
71: `  'methodology version matched it, which is not the same as it being safe.';`
72: (blank)
73: `/**`
74: ` * Modifier precedence — written down; the only permitted resolution order.`
75: ` *`
76: ` * 1. Start from the base severity of the ingredient in the active methodology`
77: ` *    version (which may be "no rule", i.e. unflagged).`
78: ` * 2. A context modifier only tightens, never loosens: the effective severity is`
79: ` *    the maximum of the base severity and the severities of all modifiers whose`
80: ` *    context is present in the profile (banned > restricted > watch).`
81: ` * 3. Ties are broken by fixed context precedence: child_under_3 before`
82: ` *    pregnancy. If the base rule and a modifier tie, the base citation wins.`
83: ` * 4. Contexts outside the precedence list sort after the listed ones; their`
84: ` *    relative order is the deterministic rule-table order.`
85: ` * 5. Modifiers never apply to unknown (unresolved) ingredients.`
86: ` *`
87: ` * The winner is chosen by (severity rank, precedence index) — never by array`
88: ` * iteration order — so two modifiers on one ingredient resolve the same way`
89: ` * every time.`
90: ` */`
91: `export const MODIFIER_PRECEDENCE: readonly string[] = ['child_under_3', 'pregnancy'];`
92: (blank)
93: `const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };`
94: (blank)
95: `interface ModifierCandidate {`
96: `  rank: number;`
97: `  order: number;`
98: `  severity: Severity;`
99: `  source: string;`
100: `  context: string | null;`
101: `}`
102: (blank)
103: `function findingSortKey(finding: Finding): string {`
104: `  return finding.recognized`
105: `    ? \`0\u0000${finding.canonical}\u0000${finding.raw}\``
106: `    : \`1\u0000${normalizeInci(finding.raw)}\u0000${finding.raw}\`;`
107: `}`
108: (blank)
109: `/**`
110: ` * Applies a profile's contextual modifiers to base findings using the`
111: ` * precedence written above. Pure and deterministic.`
112: ` */`
113: `export function applyProfileModifiers(`
114: `  findings: Finding[],`
115: `  modifiers: ModifierRow[],`
116: `  contexts: readonly string[],`
117: `): Finding[] {`
118: `  const activeContexts = new Set(contexts);`
119: `  if (activeContexts.size === 0 || modifiers.length === 0) {`
120: `    return findings;`
121: `  }`
122: (blank)
123: `  const byIngredient = new Map<string, ModifierRow[]>();`
124: `  for (const modifier of modifiers) {`
125: `    if (!activeContexts.has(modifier.context)) {`
126: `      continue;`
127: `    }`
128: `    const list = byIngredient.get(modifier.canonicalName);`
129: `    if (list) {`
130: `      list.push(modifier);`
131: `    } else {`
132: `      byIngredient.set(modifier.canonicalName, [modifier]);`
133: `    }`
134: `  }`
135: (blank)
136: `  return findings.map((finding) => {`
137: `    if (!finding.recognized || finding.canonical === null) {`
138: `      return finding;`
139: `    }`
140: `    const candidates: ModifierCandidate[] = [];`
141: `    if (finding.severity !== null && finding.source !== null) {`
142: `      candidates.push({`
143: `        rank: SEVERITY_RANK[finding.severity],`
144: `        order: -1,`
145: `        severity: finding.severity,`
146: `        source: finding.source,`
147: `        context: null,`
148: `      });`
149: `    }`
150: `    for (const modifier of byIngredient.get(finding.canonical) ?? []) {`
151: `      const precedence = MODIFIER_PRECEDENCE.indexOf(modifier.context);`
152: `      candidates.push({`
153: `        rank: SEVERITY_RANK[modifier.severity],`
154: `        order: precedence === -1 ? MODIFIER_PRECEDENCE.length : precedence,`
155: `        severity: modifier.severity,`
156: `        source: modifier.source,`
157: `        context: modifier.context,`
158: `      });`
159: `    }`
160: `    if (candidates.length === 0) {`
161: `      return finding;`
162: `    }`
163: `    candidates.sort((a, b) => b.rank - a.rank || a.order - b.order);`
164: `    const winner = candidates[0];`
165: `    return {`
166: `      ...finding,`
167: `      flag: winner.severity,`
168: `      severity: winner.severity,`
169: `      source: winner.source,`
170: `      modifierContext: winner.context,`
171: `    };`
172: `  });`
173: `}`
174: (blank)
175: `/**`
176: ` * Pure base classification: normalize + resolve each raw ingredient, apply the`
177: ` * version's base rules, sort deterministically, and derive confidence.`
178: ` */`
179: `export function buildBaseClassification(`
180: `  rawIngredients: string[],`
181: `  resolutionMap: Map<string, ResolutionEntry>,`
182: `  baseRules: Map<string, { severity: Severity; source: string }>,`
183: `): { findings: Finding[]; confidence: number; summary: ClassificationSummary } {`
184: `  const findings: Finding[] = rawIngredients.map((raw) => {`
185: `    const key = normalizeInci(raw);`
186: `    const hit = key === '' ? undefined : resolutionMap.get(key);`
187: `    if (hit === undefined) {`
188: `      // Unknown is a first-class outcome: listed, counted against confidence,`
189: `      // never dropped and never treated as clean.`
190: `      return {`
191: `        raw,`
192: `        canonical: null,`
193: `        recognized: false,`
194: `        flag: 'unknown' as const,`
195: `        severity: null,`
196: `        source: null,`
197: `        matchedVia: null,`
198: `        modifierContext: null,`
199: `      };`
200: `    }`
201: `    const rule = baseRules.get(hit.canonicalName);`
202: `    return {`
203: `      raw,`
204: `      canonical: hit.canonicalName,`
205: `      recognized: true,`
206: `      flag: rule ? rule.severity : 'none',`
207: `      severity: rule ? rule.severity : null,`
208: `      source: rule ? rule.source : null,`
209: `      matchedVia: hit.matchedVia,`
210: `      modifierContext: null,`
211: `    };`
212: `  });`
213: (blank)
214: `  // Deterministic order: recognised findings by canonical name, then unknowns`
215: `  // by normalized raw text. The stored ingredient order never leaks through.`
216: `  findings.sort((a, b) => {`
217: `    const keyA = findingSortKey(a);`
218: `    const keyB = findingSortKey(b);`
219: `    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;`
220: `  });`
221: (blank)
222: `  const total = findings.length;`
223: `  const recognized = findings.reduce((count, finding) => count + (finding.recognized ? 1 : 0), 0);`
224: `  const unknown = total - recognized;`
225: `  // Confidence = the fraction of the list we could resolve to a known`
226: `  // ingredient; unknown ingredients lower it. An empty list has no`
227: `  // recognisable content, so 0.`
228: `  const confidence = total === 0 ? 0 : Math.round((recognized / total) * 10000) / 10000;`
229: (blank)
230: `  return { findings, confidence, summary: { total, recognized, unknown } };`
231: `}`
232: (blank)
233: `@Injectable()`
234: `export class ClassificationService {`
235: `  constructor(private readonly repository: ClassificationRepository) {}`
236: (blank)
237: `  // ------------------------------------------------- ingestion (ops/tests)`
238: (blank)
239: `  async ingestIngredients(`
240: `    fixtures: IngredientFixture[],`
241: `  ): Promise<{ ingredients: number; synonyms: number }> {`
242: `    let synonyms = 0;`
243: `    for (const fixture of fixtures) {`
244: `      const ingredient = await this.repository.upsertIngredient(fixture.name);`
245: `      for (const synonym of fixture.synonyms) {`
246: `        await this.repository.upsertSynonym(ingredient.id, synonym);`
247: `        synonyms += 1;`
248: `      }`
249: `    }`
250: `    return { ingredients: fixtures.length, synonyms };`
251: `  }`
252: (blank)
253: `  /**`
254: `   * Ingests a methodology version from a fixture. Idempotent for identical`
255: `   * input; once the version is published, any change is rejected`
256: `   * (published versions never change).`
257: `   */`
258: `  async ingestMethodology(fix: MethodologyFixture): Promise<{`
259: `    versionId: string;`
260: `    slug: string;`
261: `    upserted: number;`
262: `    unchanged: number;`
263: `  }> {`
264: `    const existing = await this.repository.findVersion(fix.slug);`
265: `    const version = existing ?? (await this.repository.createVersion(fix.slug, fix.name));`
266: `    let upserted = 0;`
267: `    let unchanged = 0;`
268: `    for (const rule of fix.rules) {`
269: `      if (rule.kind === 'context' && !rule.context) {`
270: `        throw Errors.invalidInput('A context rule requires a context.', { ingredient: rule.ingredient });`
271: `      }`
272: `      const kind = rule.kind === 'context' ? RuleKind.CONTEXT : RuleKind.BASE;`
273: `      const context = rule.kind === 'context' ? rule.context : '';`
274: `      const found = await this.repository.findRuleByKeys(version.id, rule.ingredient, kind, context);`

Wait, line 274 is:
`      const found = await this.repository.findRuleByKeys(version.id, rule.ingredient, kind, context);`

The error says column 93, type 'string | undefined' not assignable to 'string'. Let me think about what `rule.ingredient` could be. Looking at the `MethodologyFixture` type — it's imported from `./fixtures.js`. I don't have the fixtures file, but based on the usage, `rule.ingredient` is likely typed as `string | undefined` or the `context` field might be `string | undefined`.

Wait, let me re-read. The error is at line 274, column 93. Let me count characters on that line:

`      const found = await this.repository.findRuleByKeys(version.id, rule.ingredient, kind, context);`

Let me count: 6 spaces + "const found = await this.repository.findRuleByKeys(" ... that's about 52 chars to the opening paren. Then `version.id` is 10 chars, comma + space is 2, `rule.ingredient` is 15 chars... so column 93 would be around the `context` argument.

Actually, let me look at line 273:
`      const context = rule.kind === 'context' ? rule.context : '';`

So `context` is typed as `string` here (either `rule.context` which would be string if the type says so, or `''`). But wait — if `rule.context` is `string | undefined`, then `context` would be `string | undefined` because the ternary doesn't narrow it (the false branch is `''` which is string, but the true branch could be `string | undefined`).

Actually wait: `rule.kind === 'context' ? rule.context : ''` — if `rule.context` is `string | undefined`, then the type of this expression is `string | undefined | string` = `string | undefined`.

So `context` on line 273 would be `string | undefined`, and then on line 274 it's passed to `findRuleByKeys` which expects `string`.

Similarly for line 284. Let me count to line 284:

275: `      const identical =`
276: `        found !== null && found.severity.toLowerCase() === rule.severity && found.source === rule.source;`
277: `      if (identical) {`
278: `        unchanged += 1;`
279: `        continue;`
280: `      }`
281: `      if (version.status === VersionStatus.PUBLISHED) {`
282: `        throw Errors.methodologyImmutable(version.slug, rule.ingredient);`
283: `      }`
284: `      await this.repository.upsertRule(version.id, rule.ingredient, rule.severity, rule.source, kind, context);`

So line 284 column 103... let me count:
`      await this.repository.upsertRule(version.id, rule.ingredient, rule.severity, rule.source, kind, context);`

6 spaces + "await this.repository.upsertRule(" = 6 + 33 = 39
"version.id" = 10, so 49
", " = 2, so 51
"rule.ingredient" = 15, so 66
", " = 2, so 68
"rule.severity" = 13, so 81
", " = 2, so 83
"rule.source" = 11, so 94
", " = 2, so 96
"kind" = 4, so 100
", " = 2, so 102
"context" starts at 103

So the error is on `context` at column 103. Same issue — `context` is `string | undefined`.

So the root cause is: `rule.context` from the `MethodologyFixture` type is `string | undefined` (or optional), and the ternary on line 273 doesn't narrow it properly.

The fix: on line 273, we need to ensure `context` is always a `string`. Since we already checked on line 269 that `rule.context` is truthy when `rule.kind === 'context'`, we can use a non-null assertion or provide a fallback.

The simplest fix that changes exactly what the compiler requires:

```ts
const context = rule.kind === 'context' ? (rule.context ?? '') : '';
```

Or we could do:
```ts
const context = rule.kind === 'context' ? rule.context! : '';
```

But the cleanest and safest is the `?? ''` approach since we already validated it's present on line 269-271.

Actually, let me reconsider. The check on line 269 is:
```ts
if (rule.kind === 'context' && !rule.context) {
  throw Errors.invalidInput('A context rule requires a context.', { ingredient: rule.ingredient });
}
```

So after this check, if `rule.kind === 'context'`, we know `rule.context` is truthy (i.e., a non-empty string). But TypeScript doesn't narrow `rule.context` based on this compound condition in the subsequent code. So the type is still `string | undefined`.

The minimal fix is to change line 273 to:
```ts
const context = rule.kind === 'context' ? (rule.context ?? '') : '';
```

This is safe because we've already thrown if it's falsy.

Let me now produce the complete file with just that one-line change.
```

## reply

Looking at the two errors, both are the same root cause: on line 273, `rule.context` is typed as `string | undefined` (from the `MethodologyFixture` type), so the ternary `rule.kind === 'context' ? rule.context : ''` produces `string | undefined`. This `context` variable is then passed to `findRuleByKeys` (line 274) and `upsertRule` (line 284), both of which expect `string`.

The fix is a single change on line 273: use `rule.context ?? ''` to guarantee a `string` (safe because line 269–271 already throws if a context rule has no context).

### src/classification/classification.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { RuleKind, VersionStatus } from '@prisma/client';
import type { ClassificationResult, MethodologyVersion, Product, Profile } from '@prisma/client';
import { Errors } from '../common/api-error.js';
import {
  ClassificationRepository,
  type ProductWithIngredients,
  type ResolutionEntry,
  type RuleWithIngredient,
} from './classification.repository.js';
import { normalizeInci } from './inci-normalizer.js';
import type { IngredientFixture, MethodologyFixture } from './fixtures.js';

export type Severity = 'banned' | 'restricted' | 'watch';
export type Flag = 'unknown' | 'none' | Severity;

export interface Finding {
  raw: string;
  canonical: string | null;
  recognized: boolean;
  flag: Flag;
  severity: Severity | null;
  source: string | null;
  matchedVia: 'canonical' | 'synonym' | null;
  modifierContext: string | null;
}

export interface ClassificationSummary {
  total: number;
  recognized: number;
  unknown: number;
}

export interface StoredPayload {
  schema: 1;
  methodologyVersion: string;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
}

export interface ClassificationOutput {
  productId: string;
  methodologyVersion: string;
  profile: string | null;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

export interface StoredResultView {
  productId: string;
  methodologyVersion: string;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

export interface ModifierRow {
  canonicalName: string;
  context: string;
  severity: Severity;
  source: string;
}

export const DISCLAIMER =
  'These findings list which rules fired for each ingredient and cite the source of each rule. ' +
  'They are not a safety verdict: an ingredient without a flag only means no rule in this ' +
  'methodology version matched it, which is not the same as it being safe.';

/**
 * Modifier precedence — written down; the only permitted resolution order.
 *
 * 1. Start from the base severity of the ingredient in the active methodology
 *    version (which may be "no rule", i.e. unflagged).
 * 2. A context modifier only tightens, never loosens: the effective severity is
 *    the maximum of the base severity and the severities of all modifiers whose
 *    context is present in the profile (banned > restricted > watch).
 * 3. Ties are broken by fixed context precedence: child_under_3 before
 *    pregnancy. If the base rule and a modifier tie, the base citation wins.
 * 4. Contexts outside the precedence list sort after the listed ones; their
 *    relative order is the deterministic rule-table order.
 * 5. Modifiers never apply to unknown (unresolved) ingredients.
 *
 * The winner is chosen by (severity rank, precedence index) — never by array
 * iteration order — so two modifiers on one ingredient resolve the same way
 * every time.
 */
export const MODIFIER_PRECEDENCE: readonly string[] = ['child_under_3', 'pregnancy'];

const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };

interface ModifierCandidate {
  rank: number;
  order: number;
  severity: Severity;
  source: string;
  context: string | null;
}

function findingSortKey(finding: Finding): string {
  return finding.recognized
    ? `0\u0000${finding.canonical}\u0000${finding.raw}`
    : `1\u0000${normalizeInci(finding.raw)}\u0000${finding.raw}`;
}

/**
 * Applies a profile's contextual modifiers to base findings using the
 * precedence written above. Pure and deterministic.
 */
export function applyProfileModifiers(
  findings: Finding[],
  modifiers: ModifierRow[],
  contexts: readonly string[],
): Finding[] {
  const activeContexts = new Set(contexts);
  if (activeContexts.size === 0 || modifiers.length === 0) {
    return findings;
  }

  const byIngredient = new Map<string, ModifierRow[]>();
  for (const modifier of modifiers) {
    if (!activeContexts.has(modifier.context)) {
      continue;
    }
    const list = byIngredient.get(modifier.canonicalName);
    if (list) {
      list.push(modifier);
    } else {
      byIngredient.set(modifier.canonicalName, [modifier]);
    }
  }

  return findings.map((finding) => {
    if (!finding.recognized || finding.canonical === null) {
      return finding;
    }
    const candidates: ModifierCandidate[] = [];
    if (finding.severity !== null && finding.source !== null) {
      candidates.push({
        rank: SEVERITY_RANK[finding.severity],
        order: -1,
        severity: finding.severity,
        source: finding.source,
        context: null,
      });
    }
    for (const modifier of byIngredient.get(finding.canonical) ?? []) {
      const precedence = MODIFIER_PRECEDENCE.indexOf(modifier.context);
      candidates.push({
        rank: SEVERITY_RANK[modifier.severity],
        order: precedence === -1 ? MODIFIER_PRECEDENCE.length : precedence,
        severity: modifier.severity,
        source: modifier.source,
        context: modifier.context,
      });
    }
    if (candidates.length === 0) {
      return finding;
    }
    candidates.sort((a, b) => b.rank - a.rank || a.order - b.order);
    const winner = candidates[0];
    return {
      ...finding,
      flag: winner.severity,
      severity: winner.severity,
      source: winner.source,
      modifierContext: winner.context,
    };
  });
}

/**
 * Pure base classification: normalize + resolve each raw ingredient, apply the
 * version's base rules, sort deterministically, and derive confidence.
 */
export function buildBaseClassification(
  rawIngredients: string[],
  resolutionMap: Map<string, ResolutionEntry>,
  baseRules: Map<string, { severity: Severity; source: string }>,
): { findings: Finding[]; confidence: number; summary: ClassificationSummary } {
  const findings: Finding[] = rawIngredients.map((raw) => {
    const key = normalizeInci(raw);
    const hit = key === '' ? undefined : resolutionMap.get(key);
    if (hit === undefined) {
      // Unknown is a first-class outcome: listed, counted against confidence,
      // never dropped and never treated as clean.
      return {
        raw,
        canonical: null,
        recognized: false,
        flag: 'unknown' as const,
        severity: null,
        source: null,
        matchedVia: null,
        modifierContext: null,
      };
    }
    const rule = baseRules.get(hit.canonicalName);
    return {
      raw,
      canonical: hit.canonicalName,
      recognized: true,
      flag: rule ? rule.severity : 'none',
      severity: rule ? rule.severity : null,
      source: rule ? rule.source : null,
      matchedVia: hit.matchedVia,
      modifierContext: null,
    };
  });

  // Deterministic order: recognised findings by canonical name, then unknowns
  // by normalized raw text. The stored ingredient order never leaks through.
  findings.sort((a, b) => {
    const keyA = findingSortKey(a);
    const keyB = findingSortKey(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  const total = findings.length;
  const recognized = findings.reduce((count, finding) => count + (finding.recognized ? 1 : 0), 0);
  const unknown = total - recognized;
  // Confidence = the fraction of the list we could resolve to a known
  // ingredient; unknown ingredients lower it. An empty list has no
  // recognisable content, so 0.
  const confidence = total === 0 ? 0 : Math.round((recognized / total) * 10000) / 10000;

  return { findings, confidence, summary: { total, recognized, unknown } };
}

@Injectable()
export class ClassificationService {
  constructor(private readonly repository: ClassificationRepository) {}

  // ------------------------------------------------- ingestion (ops/tests)

  async ingestIngredients(
    fixtures: IngredientFixture[],
  ): Promise<{ ingredients: number; synonyms: number }> {
    let synonyms = 0;
    for (const fixture of fixtures) {
      const ingredient = await this.repository.upsertIngredient(fixture.name);
      for (const synonym of fixture.synonyms) {
        await this.repository.upsertSynonym(ingredient.id, synonym);
        synonyms += 1;
      }
    }
    return { ingredients: fixtures.length, synonyms };
  }

  /**
   * Ingests a methodology version from a fixture. Idempotent for identical
   * input; once the version is published, any change is rejected
   * (published versions never change).
   */
  async ingestMethodology(fix: MethodologyFixture): Promise<{
    versionId: string;
    slug: string;
    upserted: number;
    unchanged: number;
  }> {
    const existing = await this.repository.findVersion(fix.slug);
    const version = existing ?? (await this.repository.createVersion(fix.slug, fix.name));
    let upserted = 0;
    let unchanged = 0;
    for (const rule of fix.rules) {
      if (rule.kind === 'context' && !rule.context) {
        throw Errors.invalidInput('A context rule requires a context.', { ingredient: rule.ingredient });
      }
      const kind = rule.kind === 'context' ? RuleKind.CONTEXT : RuleKind.BASE;
      const context = rule.kind === 'context' ? (rule.context ?? '') : '';
      const found = await this.repository.findRuleByKeys(version.id, rule.ingredient, kind, context);
      const identical =
        found !== null && found.severity.toLowerCase() === rule.severity && found.source === rule.source;
      if (identical) {
        unchanged += 1;
        continue;
      }
      if (version.status === VersionStatus.PUBLISHED) {
        throw Errors.methodologyImmutable(version.slug, rule.ingredient);
      }
      await this.repository.upsertRule(version.id, rule.ingredient, rule.severity, rule.source, kind, context);
      upserted += 1;
    }
    return { versionId: version.id, slug: version.slug, upserted, unchanged };
  }

  // ------------------------------------------------- lifecycle

  async publish(versionIdOrSlug: string): Promise<{
    versionId: string;
    slug: string;
    newlyPublished: boolean;
    products: number;
  }> {
    const version = await this.repository.findVersion(versionIdOrSlug);
    if (!version) {
      throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
    }
    const newlyPublished = version.status === VersionStatus.DRAFT;
    if (newlyPublished) {
      await this.repository.markVersionPublished(version.id);
    }
    const { products } = await this.rescore(version.id);
    return { versionId: version.id, slug: version.slug, newlyPublished, products };
  }

  /**
   * Re-scores every product under the given methodology version, upserting the
   * stored result keyed by (product, version). Idempotent: running it again
   * produces the same rows, not duplicates, because the key is unique and the
   * payload is deterministic.
   */
  async rescore(versionIdOrSlug: string): Promise<{ versionId: string; products: number }> {
    const version = await this.repository.findVersion(versionIdOrSlug);
    if (!version) {
      throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
    }
    const [products, resolutionMap, rules] = await Promise.all([
      this.repository.listProducts(),
      this.repository.findResolutionMap(),
      this.repository.findRulesByVersion(version.id),
    ]);
    for (const product of products) {
      await this.upsertStoredResult(product, version, resolutionMap, rules);
    }
    return { versionId: version.id, products: products.length };
  }

  async listVersions(): Promise<
    Array<{ id: string; slug: string; name: string; status: string; publishedAt: string | null }>
  > {
    const versions = await this.repository.listVersions();
    return versions.map((version) => ({
      id: version.id,
      slug: version.slug,
      name: version.name,
      status: version.status,
      publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
    }));
  }

  // ------------------------------------------------- products & profiles

  async createProduct(name: string, brand: string | null, ingredients: string[]): Promise<Product> {
    return this.repository.createProduct(name, brand, ingredients);
  }

  async createProfile(name: string, contexts: string[]): Promise<Profile> {
    return this.repository.createProfile(name, contexts);
  }

  async reorderProductIngredients(productId: string, orderedRaws: string[]): Promise<void> {
    const product = await this.repository.findProduct(productId);
    if (!product) {
      throw Errors.resourceNotFound('Product', productId);
    }
    const existing = product.ingredients.map((row) => row.raw).sort();
    const wanted = [...orderedRaws].sort();
    if (existing.length !== wanted.length || existing.some((value, index) => value !== wanted[index])) {
      throw Errors.invalidInput('Reordering must use exactly the same ingredient list as the product.', {
        productId,
      });
    }
    await this.repository.reorderProductIngredients(product.id, orderedRaws);
  }

  // ------------------------------------------------- classification

  /**
   * Classifies a product against the active (latest published) methodology
   * version, optionally tightened by a profile's contextual modifiers.
   *
   * The base findings come from the stored result for (product, active
   * version) — the immutable snapshot written by re-scoring — so a result never
   * changes under a reader. Profile modifiers are applied deterministically on
   * top; the profile is not part of the stored key.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationOutput> {
    const product = await this.repository.findProduct(productId);
    if (!product) {
      throw Errors.resourceNotFound('Product', productId);
    }
    let profile: Profile | null = null;
    if (profileId) {
      profile = await this.repository.findProfile(profileId);
      if (!profile) {
        throw Errors.resourceNotFound('Profile', profileId);
      }
    }
    const version = await this.repository.findActiveVersion();
    if (!version) {
      throw Errors.noPublishedMethodology();
    }
    const [stored, rules] = await Promise.all([
      this.repository.findResult(product.id, version.id),
      this.repository.findRulesByVersion(version.id),
    ]);
    let storedRow = stored;
    if (!storedRow) {
      // Product created after the version was published: score it lazily under
      // the active version.
      const resolutionMap = await this.repository.findResolutionMap();
      storedRow = await this.upsertStoredResult(product, version, resolutionMap, rules);
    }
    const payload = storedRow.payload as unknown as StoredPayload;
    const modifiers: ModifierRow[] = rules
      .filter((rule) => rule.kind === RuleKind.CONTEXT)
      .map((rule) => ({
        canonicalName: rule.ingredient.name,
        context: rule.context,
        severity: rule.severity.toLowerCase() as Severity,
        source: rule.source,
      }));
    const findings = applyProfileModifiers(payload.findings, modifiers, profile ? profile.contexts : []);
    return {
      productId: product.id,
      methodologyVersion: version.slug,
      profile: profile ? profile.id : null,
      findings,
      confidence: payload.confidence,
      summary: payload.summary,
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Returns the stored result for an explicit (product, methodology version)
   * pair — the exact snapshot written when that version was (re-)scored.
   */
  async getStoredResult(productId: string, versionIdOrSlug: string): Promise<StoredResultView> {
    const product = await this.repository.findProduct(productId);
    if (!product) {
      throw Errors.resourceNotFound('Product', productId);
    }
    const version = await this.repository.findVersion(versionIdOrSlug);
    if (!version) {
      throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
    }
    const stored = await this.repository.findResult(product.id, version.id);
    if (!stored) {
      throw Errors.resourceNotFound('Classification result', `${product.id} under ${version.slug}`);
    }
    const payload = stored.payload as unknown as StoredPayload;
    return {
      productId: product.id,
      methodologyVersion: version.slug,
      findings: payload.findings,
      confidence: payload.confidence,
      summary: payload.summary,
      disclaimer: DISCLAIMER,
    };
  }

  // ------------------------------------------------- internals

  private async upsertStoredResult(
    product: ProductWithIngredients,
    version: Pick<MethodologyVersion, 'id' | 'slug'>,
    resolutionMap: Map<string, ResolutionEntry>,
    rules: RuleWithIngredient[],
  ): Promise<ClassificationResult> {
    const baseRules = new Map<string, { severity: Severity; source: string }>();
    for (const rule of rules) {
      if (rule.kind !== RuleKind.BASE) {
        continue;
      }
      baseRules.set(rule.ingredient.name, {
        severity: rule.severity.toLowerCase() as Severity,
        source: rule.source,
      });
    }
    const { findings, confidence, summary } = buildBaseClassification(
      product.ingredients.map((row) => row.raw),
      resolutionMap,
      baseRules,
    );
    const payload: StoredPayload = {
      schema: 1,
      methodologyVersion: version.slug,
      findings,
      confidence,
      summary,
    };
    return this.repository.upsertResult(product.id, version.id, payload);
  }
}
```


---
