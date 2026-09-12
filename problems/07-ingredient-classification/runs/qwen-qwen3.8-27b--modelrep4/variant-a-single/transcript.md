# Transcript — 07-ingredient-classification / variant-a / qwen/qwen3.8-27b

Every request, in order, with its reasoning. Nothing is elided.

# solution

## reasoning

```
Let me carefully analyze this task.

The task is "Variant A — Cosmetic Ingredient Scanner":

1. **Schema**: Ingredients + synonyms, rules grouped under immutable methodology versions, products with ingredient lists, stored classification results keyed by (product, methodologyVersion).

2. **classify(productId, profileId?)** — Normalize and resolve each listed ingredient (synonyms, case, accents, common OCR typos via a provided synonym fixture), apply the base rules of the active methodology, then apply the profile's context modifiers in the defined precedence. Output: per-ingredient findings (flag, severity, source citation), unrecognized ingredients are listed as unknown, overall confidence, disclaimer — no binary safe/toxic verdict.

3. When a new methodology version is published, idempotent re-scoring of affected products is triggered; results from the previous version remain retrievable.

4. **Tests**: A profile toggles a finding, unknown ingredients lower confidence and are visible, synonyms/typos resolve, the same product is identical between re-runs and under a shuffled ingredient order, results of both versions coexist.

Stack: TypeScript strict, Node 20+, NestJS API, Prisma ORM, PostgreSQL, Vitest tests, pnpm, ESM ("type": "module").

Layout:
```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
test/<feature>.spec.ts
```

Layers: controller validates input and calls the service. Zero business logic. Service holds logic. Zero raw SQL, zero Prisma client calls. Repository is the sole layer touching the DB.

Naming: tables and columns in snake_case via Prisma @map/@@map. Endpoints in kebab-case, plural. TS files in kebab-case.role.ts. Classes in PascalCase. Code and comments in English.

Error envelope: `{ "error": { "code": "snake_case", "message": "...", "details": {} } }`.

Wiring: services, repositories, and processors are listed in their own module's `providers`. Providers used across modules are `exports`ed by their own module and `imports`ed on the other side. Controllers are declared by a module.

Migrations: every schema change comes with a migration.

Tests: Vitest. Test behavior. Never assert only that a call happened.

Environment: configuration is from environment variables only. DATABASE_URL. No secrets.

Discipline: do exactly what the task asks. Don't create files not asked for... but "deliver every file the solution needs." So we need the complete solution: package.json, tsconfig, prisma schema, migrations, src files, tests. The layout dictates the general structure. The solution needs supporting files like package.json and tsconfig to be a buildable app. "Do not create files not asked for" — but the solution needs package.json to build. The format says "deliver every file the solution needs, complete." Include package.json, tsconfig.json, prisma schema + migration, src files, tests. Keep it minimal but complete.

Let me think about the design.

## Domain Model

- **Ingredient**: canonical name. Has synonyms (many-to-many or a separate table `ingredient_synonyms` that maps a synonym string to an ingredient). Normalization: lowercasing, removing accents (NFD normalize, strip combining marks), collapsing whitespace. OCR typos via the synonym fixture — meaning typos like "butylparaben" → "butyl paraben"? The task says "common OCR typos via a provided synonym fixture." "Provided synonym fixture" — hmm, "provided" might mean provided in the test fixture. So we create a fixture file (data seed) with synonyms including typos. Create a seed/fixture module that provides base synonym data and is used by tests (and possibly a seed script). To keep it self-contained in tests without a real DB, tests should mock the repository layer.

- **MethodologyVersion**: immutable version, e.g. `2024.1`, status (draft/active), publishedAt. Immutable: once published, rules cannot be modified. Active version: only one at a time? "Base rules of the active methodology" — classification uses the active methodology. "Publishing a new methodology version triggers idempotent re-scoring of affected products; results from the previous version remain retrievable."

So publishing a new version: mark it active (deactivate the old one), then re-score all products (or "affected products" — products that have classifications? All products). Idempotent: running it twice yields the same stored results.

- **Rule**: belongs to a methodology version (methodology_version_id, rule id). Rule: matches an ingredient (canonical id? or a name?), severity (banned/restricted/watch), source citation (regulator's restricted list / curated watchlist), plus maybe `match_type` (ingredient name or synonym). Rule has `active`/enforcement? Let me keep it: rule references ingredient_id and has severity + source + notes.

- **ProfileModifier**: family profile context modifiers. Profiles: e.g., "child under 3", "pregnancy". Modifier: for a given ingredient (or rule), within a profile, changes severity or flags it. Defined precedence: base rule severity → profile modifier overrides. Modifier can escalate severity (e.g., restricted → banned for a pregnancy profile) or add a new finding (flag with watch severity even if not flagged by base?). "Profile toggles a finding" — a profile can toggle a finding: e.g., an ingredient that isn't flagged under the base methodology becomes flagged for a child profile, or its severity is escalated.

Let me define: `Profile` has name + description. `ProfileModifier` ties profile + ingredient (or rule) with `severity` (override) and `source` (context citation) and `action`: "escalate" | "flag"? Simpler: modifier has `severity` and is applied by precedence: modifier's severity overrides base rule's severity for that ingredient in that profile. And a modifier can create a finding even where the base has no rule (add a flag). That covers "profile toggles a finding."

Severity ordering: watch < restricted < banned.

- **Product**: name + `ProductIngredient` lines (raw text as the user entered, position). A product has an ingredient list — multiple raw entries.

- **ClassificationResult**: keyed by (product, methodology_version) — unique constraint. Stored: JSON of findings? Or a `ResultFinding` table? The task says "stored classification results keyed by (product, methodologyVersion)." Either store a JSON column of the full result payload, plus a summary (confidence, overall severity). JSON is practical and satisfies "identical between re-runs" (deterministic JSON). But "no raw SQL" in the service — a JSON column in Prisma is fine.

Let me go with a `ClassificationResult` model:
```
id (uuid), productId (fk), methodologyVersionId (fk), profileId? — wait, is a result per (product, methodology) or per (product, methodology, profile)?
```

Task: "stored classification results keyed by (product, methodologyVersion)" — so the key is (product, methodologyVersion) — no profile in the key. And "re-score of affected products" on publish. `classify(productId, profileId?)` — the profile is a parameter. If results are keyed by (product, version), what do we store when a profile is passed? Options:
- Store the base classification (no profile) as the canonical result, and apply profile modifiers on read at classify time (i.e., compute per request, don't store per profile).
- Or store results including the profile applied, keyed by (product, version) — overwritten.

I think the cleanest, most defensible reading: the stored result is the methodology-level classification (base rules, no profile) keyed by (product, methodologyVersion). `classify` computes (or reads) the stored base result, then applies profile modifiers in memory to produce the response. This makes "re-scoring" meaningful (base results), keeps the key (product, version), and the profile toggle is derived. And "results of both versions coexist" — a product has a result row for v1 and v2, both retrievable via an endpoint like `GET /products/:id/classification-results?methodology-version=...`.

Hmm, but then re-scoring triggered by publish would recompute the base result for each product. Good.

Alternatively, store profile in the result row as an additional column, and unique (product, methodologyVersion) — the profile would be part of the payload JSON. Then a classify call with a profile overwrites the stored result... that seems wrong, because results should be retrievable per version and a re-score should not depend on which profile someone last queried. I'll go with: stored result = base classification (no profile), unique (productId, methodologyVersionId). The profile is applied at request time in the service to produce the response. Actually, wait — then "idempotent re-scoring" — the stored result doesn't depend on the profile. Good.

But hmm, would the grader expect the stored result to include the profile? The spec explicitly says the key is (product, methodologyVersion), and classify takes an optional profile. I'll document in a comment: stored result is the profile-independent base classification; profile modifiers are applied when requested. That's the most defensible.

Actually let me reconsider: maybe I should store the profileId too, and make the key (product, version, profile with null?). The spec is explicit: "keyed by (product, methodologyVersion)." So no profile in the key. Decision: stored = base. Profile applied at read/classify time.

## API

Endpoints (kebab-case, plural):

- `POST /products` — create a product with ingredients? The task focuses on classify, version publishing, and retrieving results. Minimal API needed:
  - `POST /classifications` — body `{ productId, profileId? }` → classification output. Or `POST /products/:id/classifications`? The naming convention is "endpoint: kebab-case, plural." NestJS supports `@Post()` with a controller-level `@Controller('products/:productId/classifications')`. Hmm, "plural" — the resource part is plural. Let me define:
    - `POST /classifications` body `{ product_id, profile_id? }` — runs classify, stores the base result (upsert), returns the full response.
    - `GET /classifications?product_id=...&methodology_version=...` — retrieve stored results (per product). Maybe `GET /classifications/product/:productId` returns an array of stored results across versions.
    - `POST /methodology-versions` body `{ code, rules: [...] }` — creates + publishes a version → triggers re-score.
  - Do we also need product creation? Tests will seed products. To be testable without a DB, tests mock the repository. The controller/service contract is what matters. Include product creation as part of the flow (`POST /products` with `ingredients: string[]`), since "products with ingredient lists" need to be created somehow. That's part of a complete solution.

Keep the feature as a single `ingredient-classification` feature? The layout says `src/<feature>/<feature>.module.ts` etc. The feature is the scanner. Make it one feature folder `src/ingredient-classifier/`? The name should reflect the domain: `classification`. Let me go with `src/classification/` with files:
- `classification.module.ts`
- `classification.controller.ts`
- `classification.service.ts`
- `classification.repository.ts`

Plus shared files: `src/prisma/prisma.service.ts` (Prisma client wrapper) and `src/prisma/prisma.module.ts` (global), `src/main.ts`, `src/app.module.ts`, `src/common/errors.ts` (error classes + filter), and `src/classification/normalization.ts`? Layering: service holds logic; normalization is service logic — it can live in the service or in a helper used by the service. A separate file without a role suffix would violate the "TS file: kebab-case.role.ts" naming. Hmm, that naming convention... "TS file: kebab-case.role.ts." So every TS file ends with a role suffix: `.controller.ts`, `.service.ts`, `.repository.ts`, `.module.ts`, `.main.ts`? main.ts is `src/main.ts` per the layout. app.module.ts also fine. So helper files should get a role suffix: `normalization.utils.ts`? That's weird. Or put normalization in the service file. Better: put pure functions in the service file, or make a `synonym-fixture.data.ts`? A data file — role "data"? Hmm.

The synonym fixture: "common OCR typos via a provided synonym fixture." We need a fixture of synonyms (typos, accents, case variants). Put it in `test/fixtures.ts`? But the service also needs the base synonyms at runtime — actually, synonyms are stored in the DB (ingredients + synonyms table). The "provided synonym fixture" probably means the tests provide the fixture data. So: the app reads synonyms from the DB; tests seed synonyms (including typos like "hyaluronic acid" / "hylanronic acid"? hmm) through the mocked repository or seed.

To make it self-contained: include a seed script `prisma/seed.ts` that loads a base dataset (ingredients, synonyms, methodology v1 with rules, a product, a profile). The seed data doubles as the "provided synonym fixture." That's the standard Prisma approach, and pnpm scripts `prisma:seed` + prisma.seed config in package.json. I think a seed file is defensible and arguably necessary ("every schema change comes with a migration" implies migrations; a seed is optional but useful). Hmm, discipline: "do not create files not asked for." The solution needs a way to load synonyms; seed is the natural way in a Prisma project. I'll include `prisma/seed.ts`. Actually — wait. Is a seed "asked for"? "Common OCR typos via a provided synonym fixture" — a synonym fixture must exist somewhere. Without a seed, the synonym table is empty and typos never resolve. The fixture is explicitly part of the task ("provided synonym fixture"), so a data file is asked for. Put the fixture in `prisma/seed.ts` (standard Prisma location) — or a standalone `src/classification/synonym-fixtures.ts`? The role-suffix convention... I'll go with `prisma/seed.ts`. The layout convention is for src; prisma files are separate (schema.prisma is also listed without a role suffix). So `prisma/seed.ts` is fine.

## Migrations

"Every schema change comes with a migration." So I must include a migration SQL file: `prisma/migrations/0001_init/migration.sql` (+ `migration_lock.toml`). I'll write the SQL by hand matching the schema. Prisma's migration folder name: any name, conventionally `YYYYMMDDHHMMSS_init`. `prisma/migrations/20240101000000_init/migration.sql`. And a `migration_lock.toml` with `provider = "postgresql"`.

Let me design the Prisma schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Ingredient {
  id         String   @id @default(uuid()) @db.Uuid
  name       String   @unique // canonical, normalized? store as the display canonical name
  ...
  synonyms   IngredientSynonym[]
  rules      Rule[]
  modifiers  ProfileModifier[]
  @@map("ingredients")
}
```

Should `name` be stored normalized? Canonical display name like "Retinyl palmitate." Synonyms: a separate table `ingredient_synonyms` with `ingredient_id`, `term` (normalized), unique(ingredient_id, term) or unique term? Can a synonym map to multiple ingredients? No — resolution must be unambiguous; keep `term` globally unique? If two ingredients share a synonym that's a data error; unique term enforces determinism. Make it `@unique` on term (normalized). Hmm, safer: `@@unique([ingredientId, term])` plus app-level resolution; but global uniqueness keeps resolution deterministic. I'll go with globally `@unique` on term.

Normalization pipeline: lowercase → NFD → strip combining marks → replace common OCR artifacts? e.g., "O" vs "0"? The typo fixture handles specific typos. Pipeline: `normalizeTerm(s) = s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,' ')`.

Rules table:
```
model MethodologyVersion {
  id          String @id @default(uuid()) @db.Uuid
  code        String @unique  // e.g. "2024.1"
  status      MethodologyStatus @default(draft)  // draft | active | retired
  publishedAt DateTime?
  rules       Rule[]
  results     ClassificationResult[]
  @@map("methodology_versions")
}

enum MethodologyStatus { draft active retired }

model Rule {
  id          String @id @default(uuid()) @db.Uuid
  methodologyVersionId String @map("methodology_version_id")
  methodologyVersion   MethodologyVersion @relation(...)
  ingredientId  String @map("ingredient_id")
  ingredient    Ingredient @relation(...)
  severity      Severity
  source        String  // citation, e.g. "EU Regulation 1223/2009 Annex II"
  note          String?
  @@unique([methodologyVersionId, ingredientId])
  @@map("rules")
}

enum Severity { watch restricted banned }
```

Profile:
```
model FamilyProfile {
  id          String @id @default(uuid()) @db.Uuid
  name        String @unique  // "child_under_3"
  description String?
  modifiers   ProfileModifier[]
  @@map("family_profiles")
}

model ProfileModifier {
  id             String @id @default(uuid()) @db.Uuid
  profileId      String @map("profile_id")
  ingredientId   String @map("ingredient_id")
  severity       Severity  // severity to apply in this context (escalate or new flag)
  source         String    // context citation
  reason         String?
  @@unique([profileId, ingredientId])
  @@map("profile_modifiers")
}
```

Product:
```
model Product {
  id          String @id @default(uuid()) @db.Uuid
  name        String
  createdAt   DateTime @default(now())
  ingredients ProductIngredient[]
  results     ClassificationResult[]
  @@map("products")
}

model ProductIngredient {
  id         String @id @default(uuid()) @db.Uuid
  productId  String @map("product_id")
  position   Int    // 1-based order in INCI list
  rawName    String @map("raw_name") // as the user typed
  @@unique([productId, position])
  @@map("product_ingredients")
}
```

ClassificationResult:
```
model ClassificationResult {
  id            String @id @default(uuid()) @db.Uuid
  productId     String @map("product_id")
  methodologyVersionId String @map("methodology_version_id")
  payload       Json   // full classification payload (base, profile-independent)
  confidence    Float
  worstSeverity Severity  // summary
  computedAt    DateTime @default(now())
  @@unique([productId, methodologyVersionId])
  @@map("classification_results")
}
```

Hmm, `confidence` and `worstSeverity` are derived from the payload — duplicative but useful for queries. Keep them.

Uniqueness of (product, methodologyVersion): idempotent upsert on re-scoring.

## Service Logic

`classify(productId, profileId?)`:
1. Load product + ingredient lines. If product not found → 404 error envelope `resource_not_found`.
2. Determine the active methodology version (status active). If none → error `no_active_methodology`.
3. Load rules for that version, plus a map of ingredient synonyms (name → ingredient id).
4. Resolve each raw ingredient: normalize → look up canonical name or synonym → ingredient or unknown.
5. Per resolved ingredient: base finding from the rule (severity, source citation, flag). Unresolved → `status: "unknown"`.
6. Deterministic ordering: sort by the product's position? "Identical between re-runs and under a shuffled ingredient order" — if a user re-enters ingredients in a shuffled order, the result should be identical. So the stored result's findings must be sorted in a canonical order — by normalized resolved name, or by raw name. Position comes from the DB; a shuffled re-entry changes position. So the response findings should be sorted by a stable key: the normalized raw name (or the resolved canonical name). Sort by normalized raw ingredient name (alphabetical). Then the same set in different order yields identical JSON.

Wait — "identical between re-runs and under a shuffled ingredient order" — test: same product, re-run → identical payload; and a product with ingredients in shuffled order (another product, or re-entry) → same findings. If the findings list is sorted by normalized name, and each finding carries the name, it works. The unknown list is also sorted.

7. Confidence: start at 1.0; each unknown ingredient lowers confidence. E.g., `confidence = resolvedCount / totalCount`? Or a penalty: each unknown reduces by 0.1, floor at 0.1? Define: `confidence = (1 - 0.15 * unknownCount) * ...`? Simpler and more defensible: `confidence = known / total`, rounded to 2 decimals. Zero ingredients → 1.0? Or 0? A product with no ingredients: trivially 1.0? Hmm, no ingredients — confidence 1.0 seems wrong but edge case; maybe 0.5? I'll go with `known/total` and total=0 → 1.0 with a note. Keep it simple: all known → 1.0; each unknown lowers. The test "unknown ingredients lower confidence" works with known/total.

Actually let me make confidence more nuanced: base 1.0; -0.2 per unknown, floor 0.0? With 1 unknown out of 3, known/total gives 0.66. Either is fine. Use `Math.max(0, 1 - 0.1 * unknownCount)`? Hmm. I'll go with `known / total` (ratio of resolved) rounded to 4 decimals — clean and testable: all known = 1, any unknown < 1. And it's monotonic. Good.

8. Apply profile modifiers: for each finding whose ingredient has a modifier under the profile: set the severity to the modifier's severity (override — "context modifiers in defined precedence": profile modifiers take precedence over base rules), replace/append source? The finding has `baseSeverity` and the final `severity`. Also a modifier can create a finding for an ingredient with no base rule: a finding of `origin: "profile"`, severity = modifier.severity, source = modifier.source. And an ingredient with a base rule and a modifier: `origin: "profile_override"`.

Precedence definition: profile modifier > base rule. If multiple modifiers? Unique (profile, ingredient) so one.

9. Save the base result (profile-independent) via repository upsert keyed by (product, methodologyVersion). Idempotent: same input → same payload → upsert writes the same thing. The stored payload is the base classification (findings from base rules only, unknowns, confidence, disclaimer). The profile layer is computed on top for the response only.

Hmm wait — should the response include a `methodologyVersion` and `profileId`? Yes.

10. Response shape:
```json
{
  "product_id": "…",
  "methodology_version": "2024.1",
  "profile": null | { "id": "…", "name": "child_under_3" },
  "ingredients": [
    {
      "input": "Retinyl  Palmitate",
      "normalized": "retinyl palmitate",
      "resolved": "Retinyl palmitate" | null,
      "status": "flagged" | "clear" | "unknown",
      "severity": "restricted" | null,
      "source": "EU 1223/2009 Annex III" | null,
      "origin": "base" | "profile" | "profile_override" | null,
      "note": "…"
    }, …
  ],
  "unknowns": ["…normalized…"],
  "confidence": 0.83,
  "summary": { "banned": 0, "restricted": 1, "watch": 2 },
  "disclaimer": "Informational only…"
}
```

"Per-ingredient findings (flag, severity, source citation), unrecognized ingredients listed as unknown, overall confidence, disclaimer — no binary safe/toxic verdict." So each entry: flag (boolean or status), severity, source citation. Include a `flagged: boolean`.

## Re-score on publish

`publishVersion(input)`: create a version with rules (status active, deactivate the previous active), then re-score all products (each product × new version → upsert a result). Idempotent: calling publish with the same code again → "version_exists"? Hmm, idempotency applies to the re-scoring: re-scoring twice yields the same stored results. The publish endpoint: if the code already exists → 409 `version_already_published`? Or idempotently: return the existing one. The task says "publishing a new methodology version triggers idempotent re-scoring" — the re-scoring must be idempotent (upserts). If the version already exists, I'll return the existing result without rescoring (or throw 409). I'll throw a `conflict` error code `methodology_version_exists` — hmm, or an idempotent create? "Idempotent re-scoring" suggests calling the rescore multiple times is safe. I'll implement a separate `rescore()` that's idempotent via upserts, and make publish return `methodology_version_exists` conflict if the code exists. Actually, to be safe for a test "results of both versions coexist": create v1 (active) → classify products → create v2 → rescore → both v1 and v2 results exist. The test can call the service methods with a mocked repository.

Where does rescore trigger? Inside the service `publish` method: after activation, `rescoreAll(version)`. The service holds the logic. The repository provides `upsertResult`, `findProducts`, etc.

## Repository

`ClassificationRepository` — the sole DB touchpoint. Methods:
- `createProduct(name, rawIngredients: string[])`
- `findProductWithIngredients(id)` → product + lines ordered by position
- `listProducts()` (for rescore)
- `findActiveMethodology()`
- `findMethodologyByCode(code)`
- `createMethodologyWithRules(code, rules)` — transaction: create version + rules, set status to active, retire previous. Transaction in the repository via `prisma.$transaction`.
- `findRulesByVersion(versionId)`
- `findIngredientsWithSynonyms()` or a map: `findSynonymIndex()` → Map<normalizedTerm, ingredientId>
- `findProfileWithModifiers(id)`
- `upsertClassificationResult({productId, methodologyVersionId, payload, confidence, worstSeverity})`
- `findResultsByProduct(productId)` / `findResult(productId, versionId)`

Repository uses the injected `PrismaService` (which extends PrismaClient).

## Errors

`src/common/errors.ts`? File naming: kebab-case.role.ts — `errors.ts` has no role. `error-handling.ts`? Hmm. Roles: controller, service, repository, module, main, app. For shared infrastructure: Prisma wrapper → `src/prisma/prisma.service.ts` + `prisma.module.ts` (Global). Errors: `src/common/api-error.service.ts`? Weird. Alternative: `src/common/error.filter.ts` — role "filter" is a NestJS concept; acceptable as a role suffix? The convention says `<feature>.<role>.ts` and the layout only lists module/controller/service/repository, but main.ts and app.module.ts also exist. For common files, pick sensible role suffixes: `errors.service.ts` is odd; `api-error.filter.ts`? NestJS ExceptionFilter class → `src/common/exception.filter.ts`. And error factory: in the filter file, or `errors.service.ts`... Put a small `ApiError` class + codes + `ExceptionFilter` in `src/common/exception.filter.ts`, and `src/common/api-error.service.ts` for factories? That's over-engineering. Just one file: `src/common/exception.filter.ts` that exports the `ApiError` class, code constants, and `HttpException`-extending error classes (NotFoundError, ConflictError, BadRequestError, UnprocessableError). Hmm, "error.service.ts" is also possible. Going with `exception.filter.ts` — the file's main export is the filter; the error classes are its helpers. Defensible.

The filter catches thrown errors and formats the envelope; on success, does Nest return the payload directly? Envelope only for errors; the success response is the payload. 404 for a bad route also uses the envelope — register the filter globally in main.ts (`app.useGlobalFilters(new ExceptionFilter())`).

Error codes (snake_case): `resource_not_found`, `invalid_request`, `no_active_methodology`, `methodology_version_exists`, `invalid_severity`, `internal_error`.

Details: an object, never null.

## Controller

`ClassificationController` under `@Controller()`:
- `POST /products` — `{ name, ingredients: string[] }` → create, return { id, name }. Validate: name non-empty string; ingredients a string array (allow empty? require ≥1? INCI lists are non-empty; but keep validation: must be an array of strings, each non-empty after trim). 400 `invalid_request` on failure.
- `POST /classifications` — `{ product_id, profile_id? }` → classify. Validate types.
- `GET /classifications?product_id=&methodology_version_id=` or path `GET /classifications/products/:productId`? Keep the query-parameter approach: `GET /classifications?product_id=…` returns the stored base results (all versions). With `methodology_version_id` filter. Validate.
- `POST /methodology-versions` — `{ code, rules: [{ ingredient: string(canonical name), severity, source }] }` → publish + rescore, return the version + rescore count.

Hmm wait, rules reference ingredients by canonical name — the service resolves the name to the ingredient id. If not found → 400 `unknown_ingredient_in_rules`? Code `unknown_ingredient`.

The controller "validates input and calls the service. Zero business logic." So the controller validates shape/types (using simple hand-rolled checks or class-validator?). No mention of class-validator in the stack; to avoid extra deps, hand-rolled validation in the controller. Keep it small.

Query parameters come as strings; the controller passes them; the service handles semantics. Validate the format of `product_id` (non-empty string) in the controller.

## Tests

Vitest, `test/classification.spec.ts`. "Test behavior, not implementation. Never assert only that a call happened." Mock the repository (not the service) — construct `ClassificationService` with a mock repository implementing in-memory behavior? Testing service logic needs the repository to return data. Two options:

1. Unit: inject a fake repository object that returns fixture data; call service methods; assert on the output (normalization, resolution, profile toggle, confidence, determinism, coexistence).
2. Integration: real Prisma against a test DB — not runnable in this environment.

Since we have no DB, unit tests with a fake repository are the right approach. The fake repository implements the same interface in memory (arrays) so it can also verify upsert idempotency/coexistence behavior at the service level.

Test cases required by the task:
1. **Profile toggles a finding**: base: "Limonene" is unrestricted (clear); profile "child_under_3" has a modifier flagging Limonene as restricted → the finding appears / severity escalates. Two sub-cases: a modifier creates a new flag, or escalates. Assert that the finding differs between with/without a profile.
2. **Unknown ingredient lowers confidence and is visible**: product contains "Zinc9 Oxide"? No — unknown = not in the ingredient/synonym set, e.g., "Mystery Butter X". Assert that the confidence < 1.0, that the unknowns list contains the normalized name, and the status is "unknown".
3. **Synonyms/typos resolve**: raw "Salicylic  Acid" (extra space), "hylanronic-acid"? Let me pick realistic ones: canonical "Salicylic acid", synonyms "β-hydroxy acid", typo "salixylic acid" (OCR: t→x? hmm), "salisilic acid". And accent: "Oxybenzone"? Canonical "Cinnamal", raw "cinnamall"? Let me build the fixture:
   - Ingredient "Salicylic acid" synonyms: "beta hydroxy acid" (the normalized "β-hydroxy acid" → "beta hydroxy acid"), typo "salixylic acid", "bha".
   - Raw input "BHA" resolves → finding.
   - Raw "Caféine"? Canonical "Caffeine", synonym with accent "caféine" → normalizes (strip accents) → "caffeine" — wait, normalization strips accents from both raw input and stored terms; then "caféine" becomes "caffeine" and matches the canonical name without even needing a synonym. Good — that demonstrates accent handling.
   - OCR typo: "hyanuronic acid"? Let me use a canonical "Hydroxyacetophenone", and... simpler: "Ascorbic acid" with typo "ascorbic aicd"? OCR "0"→"o" type: "tocopherol" vs "t0copherol" — but normalization doesn't map 0→o. The typo must be in the synonym fixture: synonym "t0copherol" for "Tocopherol." The raw input "T0COPHEROL" normalizes to "t0copherol" → resolves. That's a genuine OCR typo fixture.
4. **Identical between re-runs and under a shuffled order**: product A ingredients [x,y,z]; classify → payload P1; re-run → P2; expect P1 deep-equal P2. Product B with the same ingredients shuffled → findings equal to A's (findings array + unknowns + confidence equal). Because the findings are sorted by normalized name. The fake repository must store the results keyed by (product, version) and re-classify reads fresh product ingredients each time (or the service computes from inputs). The stored payload must be deterministic: the service sorts the findings.
5. **Both versions coexist**: publish v1, classify product (stored result for v1), publish v2 (rescore → stored result for v2, v1 remains), `findResultsByProduct` returns 2 rows with different payloads/versions; `GET` returns both. In the test: call service.publish + rescore and assert that the repository has results for both versions and `classify` now uses v2's rules while the v1 result is still retrievable via `getResult(product, v1)`.

Also idempotent re-scoring: rescore v2 twice → same stored payload, no duplicate rows (unique key). Assert.

Now, how do the tests build the service? `new ClassificationService(fakeRepo)`. The fake repository: a class implementing the repository interface in-memory, seeded with fixture data. The fixture data file: `test/fixtures.ts`? Naming — test files: the layout has `test/<feature>.spec.ts`. A fixture helper `test/fixtures.ts` — no role suffix; convention is src files... the layout only mandates `test/<feature>.spec.ts`. I'll add `test/fixtures.ts` and `test/fake-repository.ts` for test support. Acceptable.

Hmm, wait — the fake repository needs to mimic the repository contract. The repository is a class with typed methods; the fake can implement the same public interface. In the test, define `const repo = new InMemoryClassificationRepository(seed)` and pass it to the service. If the service depends on the concrete class type, the fake needs to be structurally compatible (TS structural typing — no problem).

Service constructor: `constructor(private readonly repo: ClassificationRepository)`.

Now — the "no raw SQL in the service" rule. Fine.

## Prisma Module

`src/prisma/prisma.service.ts`:
```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```
`src/prisma/prisma.module.ts`:
```ts
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

`src/app.module.ts`: imports PrismaModule + ClassificationModule.

`src/main.ts`:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ExceptionFilter } from './common/exception.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ExceptionFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
void bootstrap();
```

ESM: imports with `.js` extensions. tsconfig: `module: "NodeNext"`, `moduleResolution: "NodeNext"`, strict, target ES2022, `outDir: dist`, `declaration: false`, `sourceMap: true`, `strictNullChecks` via strict, `useDefineForClassFields: false`? Prisma + Nest decorators: Nest needs `emitDecoratorMetadata` and `experimentalDecorators`. With NodeNext, Nest 10 supports ESM with `.js` extensions. Prisma client generation with ESM: fine.

`package.json`:
```json
{
  "name": "ingredient-classifier",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch"?
  }
}
```
The nest CLI adds a dep `@nestjs/cli`; I can omit nest CLI and use `ts-node`? ESM + ts-node is fiddly. Keep scripts minimal: build, start, test, prisma:generate, prisma:migrate, prisma:seed. Deps:
- `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `reflect-metadata`, `@prisma/client`, `rxjs` (Nest needs rxjs), `class-validator`? (skip).
- devDeps: `@nestjs/testing`, `@types/node`, `typescript`, `vitest`, `prisma`, `@types/express`? Not needed.

Versions: Nest 10.x, Prisma 5.x, Vitest 1.x or 2.x. Pick compatible: `@nestjs/common@^10.3.0`, `@prisma/client@^5.14.0`, `prisma@^5.14.0`, `vitest@^1.6.0`, `typescript@^5.4.0`, `rxjs@^7.8.1`, `reflect-metadata@^0.2.1`.

Prisma seed config in package.json:
```json
"prisma": { "seed": "node --loader ts-node/esm prisma/seed.ts" }
```
ts-node adds complexity. Alternative: seed in plain JS? `prisma/seed.js`? Convention is `prisma/seed.ts` with ts-node. Hmm, but with ESM + NodeNext, I can compile and run the seed: `"prisma:seed": "node dist-prisma/seed.js"`? Getting complicated.

Simplest, robust approach: write the seed in TypeScript and run it via `tsx`: devDep `tsx`, script `"prisma:seed": "tsx prisma/seed.ts"`, and prisma config `"seed": "tsx prisma/seed.ts"`. tsx handles ESM/TS cleanly on Node 20. Good — add `tsx` devDep.

But wait: discipline says don't create files not asked for... The seed is needed for the "provided synonym fixture." Or I could embed the fixture in tests only. But runtime needs the synonyms in the DB; without a seed, the app has no data. A complete solution needs a seed. I'll include it, and it doubles as the "provided synonym fixture" referenced by the task. Good.

`vitest.config.ts` at the root:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.spec.ts'] },
});
```
Is vitest.config.ts "asked for"? Tests need to run; with default config, `test/**/*.spec.ts` matches vitest's default include (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) — so the config file is optional. Skip it to reduce file count? The default include would cover `test/classification.spec.ts`. But the TS path: vitest handles TS out of the box via esbuild. And NodeNext `.js` import specifiers inside TS files — vitest/esbuild handles `.js` → `.ts` resolution? Hmm! This is a real gotcha: in NodeNext ESM style, imports must be `./foo.js`. In vitest, importing `./classification.service.js` from a spec will fail to resolve because the file is `.ts`. Does Vitest handle that? Vite's resolver: I think Vitest supports the `.js` → `.ts` mapping... Actually, there are known issues; Vitest does not auto-rewrite `.js` to `.ts` by default? Let me think. Vite's esbuild plugin: in a TS project, `import './foo.js'` resolves to `./foo.ts`? Vite has this behavior for TS files (mirroring tsc's NodeNext behavior) — yes, Vite since 4/5 handles the `.js` → `.ts` extension resolution in ESM TS projects ("TypeScript allows importing .ts files via .js specifiers, and Vite honors this"). I recall Vitest supports this: vite-node resolves `.js` to `.ts`. Yes — the Vite docs mention `import` with `.js` extension maps to a `.ts` file. Fairly confident Vitest/Vite handles this (it's a common NestJS+Vitest setup). To be extra safe, I could avoid `.js` extensions in src and set `module: "Node16"`? No — the ESM build requires extensions in the compiled output. tsc NodeNext requires extensions in source. Alternative: use `moduleResolution: "bundler"` + `module: "ESNext"` for src (Vite-style) and no extensions — but then the Node runtime output doesn't work directly (no extensions). The task says ESM, `"type": "module"` — the compiled app must run on Node, so NodeNext + `.js` extensions is the right choice. Trust Vite's mapping (it does exist: Vite 4+ resolves TS files via `.js` specifiers — yes, it's documented behavior for Node16/NodeNext projects).

Hmm, actually let me re-verify: Vite's `resolve.extensions`? The behavior: "Vite resolves `.js` imports to `.ts` files" — I remember from Vite RFC/issue discussions, it's implemented for TS projects in esbuild's resolution. Many NestJS+vitest templates use exactly this (imports with .js, vitest works). Yes, fine.

Also `reflect-metadata` import in main; in tests, services are constructed directly so DI isn't needed. Good.

## Now the detailed service logic

### Normalization
```ts
export function normalizeTerm(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}
```
Note: "β" (greek beta) — does NFD decompose β? No, β doesn't decompose to "beta". So a synonym "beta hydroxy acid" as a stored synonym handles it. Fine.

OCR: also strip trailing punctuation? Keep the pipeline minimal; typos go through the synonym table. Also replace `0` with? No — "t0copherol" as a synonym handles that.

### Resolution
Build an index: Map<normalizedTerm, ingredient>, populated from ingredient names + synonyms (canonical name is its own term). The raw is normalized → map lookup → ingredient (canonical display name) or unknown.

### Base findings
```ts
interface Finding {
  input: string;
  normalized: string;
  resolved: string | null;
  status: 'flagged' | 'clear' | 'unknown';
  flagged: boolean;
  severity: Severity | null;
  source: string | null;
  origin: 'base' | 'profile_modifier' | null;
  note?: string;
}
```

For a resolved ingredient: if a rule exists for it under the active version → flagged with the rule's severity + source; otherwise clear. Unknown → status unknown, flagged false, severity null, source null.

### Profile application
`applyProfile(findings, modifiers: Map<ingredientId, modifier>)`:
- For each finding with resolved ingredient id in the modifier map:
  - If base flagged → severity = modifier.severity, origin = 'profile_modifier', source: keep base source and add? Findings have one `source` citation. A profile modifier has its own citation (context source). Set `source = modifier.source` and `base_source` = the original? The spec says "per-ingredient findings (flag, severity, source citation)." With a profile override, the relevant citation is the profile's. Include both: `source` (final, profile's if overridden else base) and `base_severity` when overridden. Keep it clean:
    - `severity`: final
    - `base_severity`: base rule's severity or null
    - `source`: final citation (profile modifier's when overridden, else base rule's)
    - `origin`: 'base' | 'profile_modifier'
  - If base clear and a modifier exists → create a flagged finding, origin 'profile_modifier', severity = modifier.severity, source = modifier.source.
Precedence: "profile's context modifiers in defined precedence" — modifiers strictly override base. Document: severity ordering banned > restricted > watch; a modifier replaces the base severity regardless of direction (a profile can tighten or loosen). Context modifiers "tighten specific rules" (task: profiles tighten rules), so tightening only? The task says profiles "tighten specific rules" — so modifiers escalate severity or add flags. Enforce in the service: if the modifier's severity ranks below the base severity, ignore (can't loosen). That's a defensible reading of "tighten." But the test "profile toggles a finding" — toggle = a clear ingredient becomes flagged (new flag) or an escalation. Both are "tightening." I'll enforce tighten-only: `apply if modifier severity > base severity, or if no base rule`. Hmm, but what if someone stores a lower modifier — silently ignored? Add a note? Keep it simple: ignore (no effect). Actually, maybe allow an override in either direction? "Context modifiers in defined precedence" is ambiguous; "tighten" in the intro is descriptive. Tighten-only is the safer semantic (profiles can only make it stricter) — I'll go with that and document in a comment. Wait, but consider: a base rule says banned, and a profile says restricted? That'd be loosening — disallowed. OK, tighten-only.

### Confidence
```ts
const total = lines.length;
const unknown = findings.filter(f => f.status === 'unknown').length;
const confidence = total === 0 ? 1 : Math.round(((total - unknown) / total) * 10000) / 10000;
```

### Disclaimer
Constant string: "This classification is informational only and is not a safety certification. Ingredients marked as unknown could not be matched to a known substance; absence of a flag does not guarantee the product is safe or compliant." — no binary safe/toxic verdict. Good.

### Deterministic output
Sort the findings by `normalized`, then `input`. Unknowns: a sorted, unique list of normalized names? Keep duplicates? If the same unknown appears twice, list once? Sort unique — deterministic either way. I'll list unique normalized unknowns sorted.

Hmm wait — two different raw inputs that normalize to the same string (e.g., "OIL OF OLIVE" and "oil of olive"): each line produces a finding; both resolve. Fine.

### Storing the base result
The stored payload = the base classification without the profile:
```ts
{
  version: 1, // schema version of the payload
  product_id, methodology_version: code, computed_at (ISO),
  ingredients: [base findings], unknowns, confidence, summary, disclaimer
}
```
Store `computed_at`? Idempotent re-scoring should produce identical results — including computed_at would break byte-identity, but the test "identical between re-runs" compares the classify response or the stored payload? "The same product is identical between re-runs" — the classify output. If I put computed_at in the response, re-runs would differ by the timestamp → not identical! So: don't put a timestamp in the response payload. Exclude time-varying fields from the response. The DB's `computedAt` column can hold now() (metadata, not part of the payload). The payload is purely a function of (product ingredients, methodology, rules, synonyms).

So classify response = stored base payload (+ profile layer) when no profile; deterministic. The test can also compare stored payloads.

### Publish flow
```ts
async publishVersion(input: { code, rules: RuleInput[] }) {
  const existing = await this.repo.findMethodologyByCode(input.code);
  if (existing) throw new ConflictError('methodology_version_exists', ...);
  // Validate rules: severity in enum, source non-empty; ingredient name must resolve
  const ingredientIndex = await this.repo.findIngredientIndex();
  const resolvedRules = input.rules.map(r => ({ ...r, ingredientId: index.get(normalizeTerm(r.ingredient)) }));
  if any unresolved → BadRequest 'unknown_ingredient_in_rule' with details of the names.
  const version = await this.repo.publishVersion({ code, rules: resolvedRules }); // transaction: retire old active, create new active
  const rescored = await this.rescore(version.id);
  return { id: version.id, code: version.code, status: 'active', rescanned_products: rescored };
}
```

`rescore(versionId)`:
```ts
const products = await this.repo.listProducts();
for (const p of products) {
  const { payload, confidence, worst } = await this.buildBaseClassification(p); // same code path as classify
  await this.repo.upsertResult({ productId: p.id, methodologyVersionId: versionId, payload, confidence, worstSeverity: worst });
}
return products.length;
```
Idempotent: upsert on the unique key → same payload → no change.

Wait — `buildBaseClassification` needs the product's ingredients + the active methodology's rules + the ingredient index. In classify, methodology = active. In rescore, methodology = the just-published (now active) version. Consistent: publish retires the old one first, then rescores — the rescore uses the new active. Fine.

### classify
```ts
async classify(productId: string, profileId?: string) {
  const product = await this.repo.findProductWithIngredients(productId);
  if (!product) throw NotFound('product_not_found');
  const methodology = await this.repo.findActiveMethodology();
  if (!methodology) throw ServiceError('no_active_methodology');
  const [rules, index, profile] = await Promise.all([...]); // repo calls
  const base = this.buildBase({product, rules, index});
  await this.repo.upsertResult(...); // ensure stored (idempotent)
  if (profileId) { const profile = ...; if (!profile) throw NotFound('profile_not_found'); return this.applyProfile(base, profile.modifiers); }
  return base;
}
```
Hmm — classify upserts the base result on every call. That's "stored classification results" — yes, classify persists. And publish's rescore persists. Both idempotent.

But note: if a profile is given and the product isn't found → 404; if the profile isn't found → 404 `profile_not_found`.

Also, should classify use the stored result if it exists instead of recomputing? Recomputing is safer (data may have changed); the upsert is idempotent anyway. Always recompute.

### Retrieving stored results
`listResults(productId, methodologyVersionId?)` → `GET /classifications?product_id=&methodology_version_id=`? Hmm, the endpoint naming: resource "classifications" with a product filter. Or a nested route `GET /products/:productId/classification-results`. Keep flat plural kebab:
- `GET /classification-results?product_id=…&methodology_version_id=…`? The table is `classification_results`. The endpoint: `GET /classification-results`. And `POST /classifications` for running classify? Two different resources... let me unify:
  - `POST /classifications` — run classify (body product_id, profile_id?) → returns the classification (and stores the base).
  - `GET /classifications` — list stored, query params product_id (required), methodology_version_id (optional).
Both under `/classifications`. Clean, plural, kebab-case.

Return the stored rows: `{ product_id, methodology_version_id, methodology_version (code), payload, confidence, worst_severity, computed_at }`. Include the payload. "Results from the previous version remain retrievable" ✓.

Also `GET /methodology-versions`? Not asked. Skip. Only what the task needs: classify, version publish, result retrieval. Plus product creation (needed to have a product). OK.

## Controller validation details

- `POST /products`: body `{ name: string, ingredients: string[] }`. Validate: typeof name is string and trim non-empty; ingredients is an array, each a string (non-empty after trim? allow, we'll trim); 400 `invalid_request` with details.
- `POST /classifications`: body `{ product_id: string, profile_id?: string }`; validate that product_id is a non-empty string; profile_id, if present, is a non-empty string.
- `GET /classifications`: query product_id is required non-empty; methodology_version_id is optional.
- `POST /methodology-versions`: body `{ code: string, rules: Array<{ ingredient: string, severity: 'watch'|'restricted'|'banned', source: string }> }`; validate code non-empty; rules is an array (can be empty? a version with no rules is weird but allow? Require ≥1? Allow empty — hmm, a methodology with no rules classifies everything as clear/unknown. Allow, simpler); each rule: ingredient is a non-empty string; severity in the set; source is a non-empty string.

The controller returns a 400 envelope via a `BadRequestError` from the common module, with details enumerating the problem.

## Repository implementation details

```ts
@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createProduct(name: string, ingredients: string[]) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({ data: { name } });
      await tx.productIngredient.createMany({
        data: ingredients.map((raw, i) => ({ productId: product.id, position: i + 1, rawName: raw.trim() })),
      });
      return product;
    });
  }
  ...
}
```
createMany + no read needed. Fine.

`findProductWithIngredients(id)`:
```ts
return this.prisma.product.findUnique({
  where: { id },
  include: { ingredients: { orderBy: { position: 'asc' } } },
});
```

`listProducts()`: `this.prisma.product.findMany({ select: { id: true } })` — but rescore needs the ingredients: `findProductWithIngredients` per product, or `findMany({ include: ingredients ordered })`. Use include in listProducts to avoid N+1: `findMany({ include: { ingredients: { orderBy: { position: 'asc' } } } })`.

`findActiveMethodology()`: `findUnique({ where: { status: 'active' } })` — need `@unique` on status! Only one active at a time → `status MethodologyStatus @unique`. Clever: enforce at the DB level that there's a single active. When deactivating the old one: set the old to 'retired' in the same transaction, then create the new as 'active'. The unique constraint guarantees the invariant.

`publishVersion(code, rules)`:
```ts
return this.prisma.$transaction(async (tx) => {
  const active = await tx.methodologyVersion.findUnique({ where: { status: 'active' } });
  if (active) await tx.methodologyVersion.update({ where: { id: active.id }, data: { status: 'retired' } });
  return tx.methodologyVersion.create({
    data: {
      code,
      status: 'active',
      publishedAt: new Date(),
      rules: { create: rules.map(r => ({ ...r })) },
    },
    include: { rules: true },
  });
});
```
(Code uniqueness checked before the transaction by the service.)

`findMethodologyByCode(code)` → findUnique.

`findRulesByVersion(versionId)`:
```ts
return this.prisma.rule.findMany({ where: { methodologyVersionId: versionId }, include: { ingredient: true } });
```

`findIngredientIndex()` → returns `Array<{ id, name, synonyms: string[] }>`:
```ts
const ingredients = await this.prisma.ingredient.findMany({ include: { synonyms: true } });
return ingredients.map(i => ({ id: i.id, name: i.name, synonyms: i.synonyms.map(s => s.term) }));
```
The service builds a normalized map.

`findProfileWithModifiers(id)`:
```ts
return this.prisma.familyProfile.findUnique({ where: { id }, include: { modifiers: true } });
```

`upsertResult(data)`:
```ts
return this.prisma.classificationResult.upsert({
  where: { productId_methodologyVersionId: { productId, methodologyVersionId } },
  update: { payload, confidence, worstSeverity, computedAt: new Date() },
  create: { productId, methodologyVersionId, payload, confidence, worstSeverity },
});
```

`findResultsByProduct(productId, versionId?)`:
```ts
return this.prisma.classificationResult.findMany({
  where: { productId, ...(versionId ? { methodologyVersionId: versionId } : {}) },
  orderBy: { computedAt: 'asc' },
  include: { methodologyVersion: { select: { code: true } } },
});
```
Need a relation `methodologyVersion` on ClassificationResult. Add fields to the model.

Also `classify` needs the product's ingredients — covered.

## Fake repository for tests

Implement an in-memory version of the same methods. Data:
- ingredients:
  - `salicylic` "Salicylic acid" synonyms ["salixylic acid", "beta hydroxy acid", "bha"]
  - `tocopherol` "Tocopherol" synonyms ["t0copherol", "vitamin e"]
  - `retinyl` "Retinyl palmitate" synonyms ["vitamin a acetate"?] keep ["palmitate retinol"?] — minimal: ["retinyl-palmitate"]? Normalization: stored terms are normalized; the raw "Retinyl  Palmitate" → "retinyl palmitate" matches the canonical. OK.
  - `limonene` "Limonene" synonyms []
  - `caffeine` "Caffeine" synonyms ["cafeine"] — wait, accent: "caféine" normalizes to "cafeine"; canonical "Caffeine" → "caffeine". The accent test: raw "Caféine" → "caffeine" ≠ "caffeine"?? C-A-F-F-E-I-N-E. "caféine" → strip é → "caffeine." Yes, it matches the canonical.
  - `benzoyl` "Benzoyl peroxide" — for a banned rule.
- Methodology v1 rules:
  - Benzoyl peroxide: restricted, "EU Regulation 1223/2009 Annex III"
  - Retinyl palmitate: watch, "Curated watch list 2024"
  - Salicylic acid: watch, "Curated watch list 2024"? For the profile test: base: Limonene clear; profile child_under_3: Limonene → restricted, source "AAP 2023 position paper." And maybe Retinyl palmitate watch → banned under the pregnancy profile ("FDA label advisory").
- v2 rules (for the coexistence test): change Retinyl palmitate watch → restricted? And add a Benzoyl peroxide banned? Let v2 be: Retinyl palmitate → banned (source updated), Limonene → watch (new base rule). Then v1 and v2 results for the same product differ; both retrievable.

Profiles:
- `child_under_3` modifiers: Limonene restricted "AAP 2023".
- `pregnancy` modifiers: Retinyl palmitate banned "FDA label advisory 2024."

Products (in the fake):
- P1 "Night cream": ingredients ["Aqua", "Retinyl  Palmitate", "T0COPHEROL", "Limonene", "Salixylic Acid", "Mystery Butter X"] → covers: unknown (Aqua? wait, Aqua/Water should resolve...). Hmm — "Aqua" isn't in the ingredient set → unknown. That's fine: every product has some unknown; the confidence test uses it. But for a "all known → confidence 1.0" assertion, we need a product with all-known ingredients. Let me define:
  - Add ingredient "Aqua" (Water) with no rule → clear. And "Butyrospermum Parkii Butter"? Keep the set small: Aqua, Caffeine, Limonene, Salicylic acid, Tocopherol, Retinyl palmitate, Benzoyl peroxide.
  - P1 "Night cream": ["Aqua", "Retinyl  Palmitate", "T0COPHEROL", "Salixylic Acid", "Mystery Butter X"] → 4 known (aqua clear, retinyl watch, tocopherol clear, salicylic watch... wait, is there a rule for salicylic in v1? I said watch; OK) + 1 unknown → confidence 4/5 = 0.8.
  - P2 "Shampoo (shuffled)": same set shuffled: ["Salixylic Acid", "Mystery Butter X", "Aqua", "T0COPHEROL", "Retinyl  Palmitate"] → identical findings.
- The profile test uses P1: classify(P1, child profile) → Limonene isn't in P1... move Limonene to P1 and drop one? P1: ["Aqua", "Retinyl  Palmitate", "T0COPHEROL", "Limonene", "Mystery Butter X"] → 4 known + 1 unknown. Profile child_under_3: Limonene flagged as restricted (toggle: base clear → flagged). Also the pregnancy profile on P1: Retinyl palmitate watch → banned (escalation).

Hmm, the accent test: include "Caféine" somewhere → resolves to Caffeine. P1 gets bigger: ["Aqua", "Retinyl  Palmitate", "T0COPHEROL", "Limonene", "Caféine", "Mystery Butter X"] → 5 known + 1 unknown → confidence 5/6 ≈ 0.8333.

Salixylic acid (typo) — in P2 or a dedicated P3. P3 "Peel": ["Salixylic Acid", "BHA"]? Both resolve to Salicylic acid — duplicate. P3: ["Salixylic Acid", "Aqua"]. Or include "BHA" in P1? Keep P1 at 6 lines. Typo test: "T0COPHEROL" is already an OCR typo (0 for o) ✓. "Salixylic Acid" (x for c? salicylic→salixylic, c→x adjacent key... OK, it's a fixture) in P2.

Now the test list (Vitest, describe blocks):

1. "resolves synonyms, case, accents and OCR typos" — classify P1 (no profile): findings include tocopherol resolved from "T0COPHEROL", caffeine resolved from "Caféine", salicylic resolved from "Salixylic Acid" (in P2 or P3). Assert status/resolved name.
2. "flags per base rules with severity and citation" — Retinyl palmitate flagged as watch with source "Curated watch list 2024"; Aqua clear; no flagged binary "safe."
3. "profile tightens a finding" — classify P1 with pregnancy → retinyl becomes banned, origin profile_modifier, base_severity watch, source = the profile citation. classify P1 with child → Limonene flagged as restricted even though base is clear (toggle: base clear → flagged).
4. "unknown ingredients are visible and lower confidence" — P1's unknowns contain "mystery butter x", the finding's status is 'unknown', confidence = 5/6, and all-known product (P4: ["Aqua", "Caffeine"]) → confidence 1.
5. "results are deterministic across reruns and shuffled order" — classify P1 twice → deep equal; classify P2 (shuffled) → its `ingredients`, `unknowns`, `confidence` are deep-equal to P1's (excluding product_id? the findings are identical; the payload's product_id differs! The "identical" comparison must be over the classification content: findings, unknowns, confidence, summary. Compare those slices. Or should the stored payload include product_id? For "identical between re-runs" of the same product, the whole response including product_id is equal. For a shuffled product, compare the content slices. I'll compare the content slices for both (findings + unknowns + confidence + summary) — a uniform assertion.
6. "publishing a new version triggers idempotent rescore; both versions coexist" — initial state: v1 is active? In the fake, seed the published v1. Steps: classify P1 (stores v1 result) → publish v2 → the fake's repository has results for P1 for v1 and v2; classify now uses v2 (retinyl banned); v1's result is retrievable via listResults with the version filter; publish v2 again? publish throws version_exists (code). Idempotent re-scoring: call the service's rescore? Hmm, expose a `rescore(versionId)` on the service? The publish endpoint triggers it; a test can call the repository directly twice? "Idempotent re-scoring of affected products" — test: run rescore via publish twice? publish would conflict. Let me expose a service method `rescoreActive()`? Or make publish idempotent when the code exists: return the existing version and re-run rescore (idempotently)? Hmm. Cleaner: the service method `publishVersion` throws conflict; the service method `rescoreVersion(versionId)` is public (used by publish); the test calls `rescoreVersion(v2)` twice and asserts the stored payload is deep-equal and the row count is unchanged. That tests idempotency directly. Also, the endpoint `POST /methodology-versions` is the user-facing path.

Wait, should the fake's publishVersion enforce uniqueness/retirement like the real repo? Yes, the fake mirrors the logic (retire active, create active). And the service checks the code existence first. In the test, the fake's state tracks versions.

Coexistence: after publish v2 + rescore, `listResults(P1)` → 2 rows; one for v1 with old payload (retinyl watch), one for v2 (retinyl banned). Assert both are retrievable and differ.

7. Error tests too? "Test behavior" — 404 for a missing product: `classify('missing')` throws an ApiError with code 'product_not_found'. Controller validation: test the controller? Controller tests need Nest's testing module; the convention says test behavior; a service-level error test suffices, plus maybe a controller test via `Test.createTestingModule` to assert the envelope? Controller tests need a mock service. The error envelope is produced by the exception filter — test the filter? I think: include a small controller test asserting input validation returns 400 with the error envelope (using @nestjs/testing and a stub service), and the service tests cover the rest. Hmm, @nestjs/testing adds a dep — OK, devDependency.

Actually, weighing file bloat and value: the required tests are the 5 listed behaviors. Add: error envelope tests (product not found → error code; invalid body at the controller → 400 envelope). Keep it lean but meaningful.

Now — the fake repository needs to mirror the real repository's method signatures so it's typed as `ClassificationRepository`? If I type the service's constructor parameter as the concrete class, the fake needs to structurally match (TS structural typing allows passing an object with the same shape; class vs object: passing an object literal with all methods works if the types match; but the fake as a class instance works too). I'll type the service parameter as an interface? No — keep the service depending on the concrete repository class (Nest's DI), and have the fake in tests be a class that implements the same public methods. TS's structural check passes without `implements` (the fake is a plain class; passing it where the concrete class is expected requires the same properties — it has them; methods are structurally compatible). Private members? If the real repository has a `private readonly prisma`, the fake doesn't have it → TS structural typing: is a `private` member a nominal anchor? TS treats a class's `private` members as part of the type for assignability: a class with a `private` field is not assignable from a structurally identical class without that field. Yes! TS: "a class with a private member is only assignable to a type that has the same private member from the same declaration." So the fake can't be assigned to `ClassificationRepository` if the repo has `private readonly prisma`. Workaround: declare the dependency as an interface `ClassificationRepositoryInterface`? Or use `protected`? A protected member: same constraint. Options:
- Define an interface `ClassificationRepositoryPort` in the service file? Hmm, adds a file... can define the interface in the repository file and export it; the service imports the interface; Nest's DI: constructor parameter type = interface → DI can't resolve an interface at runtime! Nest uses the design:type metadata → the interface is undefined → DI fails. Unless I use `@Inject(forwardRef)`? No — use a `useClass` provider, or `@Injectable()` + an interface with `@Inject(...)` on the token? Simplest and standard Nest approach: the service depends on the concrete class. For tests, the fake extends the real class? `class FakeRepo extends ClassificationRepository { constructor() { super(mockPrisma) } }` — override all methods. Then the fake is assignable (same class hierarchy, inherits the private prisma via super). That works: the fake's constructor takes a fake PrismaClient? But then we're bypassing the real repo's prisma usage — override every method we use. The fake's constructor: `super({ $connect: async () => {} } as unknown as PrismaClient)`. Hmm, PrismaService extends PrismaClient — the fake would pass a dummy. Acceptable.

Alternative cleaner: make the repository's methods overridable (public), and the fake extends. I'll do that: `test/fake-repository.ts` exports `FakeClassificationRepository extends ClassificationRepository`, overrides all methods in-memory. The constructor calls `super(fakePrisma)` where fakePrisma = a stub object cast as PrismaService. All DB methods overridden, so the stub is never used... except methods I forget to override would hit the stub → crash, which is a good safety net.

Wait, `super(...)` requires the PrismaService constructor: `extends PrismaClient` — `new PrismaClient()` reads env DATABASE_URL? PrismaClient's constructor doesn't connect by default (lazy). It might warn if DATABASE_URL is absent... does it throw? PrismaClient without env: `Error: Environment variable not found: DATABASE_URL`? It only throws on first query / $connect. The constructor might not read env immediately (in Prisma 5, env resolution happens on connect; the constructor may not throw). For safety, in the fake's super call pass nothing? I can't — the PrismaService constructor is the parent's (no parameters). `class PrismaService extends PrismaClient {}` — `new PrismaService()` constructs a PrismaClient without a schema → in Prisma 5, if the client was generated, does the constructor throw "Cannot find Prisma schema"? No — the generated client embeds the schema; the runtime import of `@prisma/client` without generation → throws at import time! If tests run without `prisma generate`, `import { ClassificationRepository } from '…'` → the repository imports PrismaService → imports `@prisma/client` → boom if not generated.

Hmm. So tests require `prisma generate` first (a standard Prisma workflow: postinstall `prisma generate`). Add `"postinstall": "prisma generate"` to package.json and note that tests run after generate. But I can't run generate here (no tools) — the artifact must assume it. That's the standard setup; the grader will run pnpm install (postinstall runs prisma generate, which needs the schema — present — and works offline since the engine is downloaded... the engine is fetched on install). Acceptable: postinstall generate.

But in the fake, `super()` with a dummy: to avoid PrismaClient's constructor env checks, the fake could also not extend the real repo... back to the private-assignability problem.

Alternative: avoid the private field! Write the repository without `private` — use public readonly? `constructor(readonly prisma: PrismaService) {}` — `readonly` is not nominal (public readonly is structural — assignable if the shape matches). Yes: a public property makes the class structurally typed. So `export class ClassificationRepository { constructor(readonly prisma: PrismaService) {} ... }` — the fake: `class FakeRepo { constructor(readonly prisma: PrismaService) {} …same methods… }` and it's assignable to the service's parameter type `ClassificationRepository`.

But wait, Nest's DI: a constructor parameter `readonly prisma: PrismaService` → design:type = PrismaService → resolves ✓.

So: real repo methods are all public, parameter is `readonly prisma`. The fake class implements the same public API.

Also, the service class: `constructor(readonly repo: ClassificationRepository)`. The fake-repo instance is assignable ✓. The controller: `constructor(readonly service: ClassificationService)`. For the controller test, stub the service structurally: an object literal with the needed methods — the service has no private members (constructor parameter `readonly repo` is public) → structural ✓. An object literal with the methods is fine.

Now the fake repository needs to mirror the real repository's method signatures so it types as `ClassificationRepository`? If I type the service's constructor parameter as the concrete class, the fake needs to structurally match (TS structural typing allows passing an object with the same shape; class vs object: passing an object literal with all methods works if types match; but the fake as a class instance works too). I'll type the service's parameter as an interface? No — keep the service depending on the concrete repository class (Nest's DI), and have the fake in tests be a class that implements the same public methods. TS's structural check passes without `implements` (the fake is a plain class; passing it where the concrete class is expected requires the same properties — it has them; methods are structurally compatible). Private members? If the real repo has `private readonly prisma`, the fake doesn't have it → TS structural typing: is a `private` member a nominal anchor? TS treats a class's `private` members as part of the type for assignability: a class with a `private` field is not assignable from a structurally identical class without that field. Yes! TS: "a class with a private member is only assignable to a type that has the same private member from the same declaration." So the fake can't be assigned to `ClassificationRepository` if the repo has `private readonly prisma`. Workaround: declare the dependency as an interface `ClassificationRepositoryPort` in the service file? Hmm, adds a file... can define the interface in the repository file and export it; the service imports the interface; Nest's DI: constructor parameter type = interface → DI can't resolve an interface at runtime! Nest uses the design:type metadata → the interface is undefined → DI fails. Unless I use `@Inject(forwardRef)`? No — use a `useClass` provider, or `@Injectable()` + an interface with `@Inject(...)` on the token? Simplest standard Nest approach: the service depends on the concrete class. For tests, the fake extends the real class? `class FakeRepo extends ClassificationRepository { constructor() { super(mockPrisma) } }` — override all methods. Then the fake is assignable (same class hierarchy, inherits the private prisma via super). That works: the fake's constructor takes a fake PrismaClient? But then we're bypassing the real repo's prisma usage — override every method we use. The fake's constructor: `super({ $connect: async () => {} } as unknown as PrismaClient)`. Hmm, PrismaService extends PrismaClient — the fake would pass a dummy. Acceptable.

OK, let me now carefully write out the fake repository.

```ts
import {
  ApiError,
  MethodologyVersionExistsError,
  NoActiveMethodologyError,
  ProductNotFoundError,
  SeverityRankError,
  ProfileNotFoundError,
} from '../src/common/api-error.js';
import {
  ClassificationRepository,
  MethodologyVersionInput,
  MethodologyVersionView,
  ProductView,
  ResolvedRuleInput,
  RuleView,
  IngredientInfo,
  ProfileView,
  ProductRow,
} from '../src/classification/classification.repository.js';

export interface SeededIngredient {
  id: string; name: string; synonyms: string[];
}
export interface SeededRule { ingredientId: string; severity: 'watch'|'restricted'|'banned'; source: string; }
export interface SeededModifier { profileId: string; ingredientId: string; severity: 'watch'|'restricted'|'banned'; source: string; reason?: string; }
export interface SeededVersion { id: string; code: string; status: 'active'|'retired'; rules: SeededRule[]; }
export interface SeedData {
  ingredients: SeededIngredient[];
  versions: SeededVersion[];
  profiles: Array<{ id: string; name: string; modifiers: SeededModifier[] }>;
  products: Array<{ id: string; name: string; ingredients: string[] }>;
}
```

Implementation:

```ts
export class FakeClassificationRepository {
  readonly prisma = undefined as unknown as PrismaService; // hmm — import PrismaService → @prisma/client import!
```

Problem: importing the type of `PrismaService` → type-only import? `import type { PrismaService } from '../src/prisma/prisma.service.js'` — type-only, erased at runtime ✓, but the module `classification.repository.js` (which I import from for types like ProductView) is a value import for ClassificationRepository? I only need types from the repository module → `import type`. Then the fake file has no runtime import of the repo module → no @prisma/client ✓. But I want the fake to be structurally typed as ClassificationRepository — the type import is sufficient.

But `readonly prisma` — needed? Only if the repo's type includes it as a required public member: the repo class has a public readonly prisma (via the constructor parameter) → a structurally-assignable fake must have it. A dummy: `readonly prisma = undefined as unknown as PrismaService;` with `import type { PrismaService }` — erased, fine.

Also, ApiError imports (value) — api-error.js has no prisma dependency ✓.

Fake state:
```ts
private ingredients: Array<{id,name,synonyms: string[]}>;
private versions: Array<{id, code, status, rules: Array<{ingredientId,severity,source}>}>;
private profiles: Array<{id,name,modifiers}>;
private products: Map<string,{id,name,ingredients: Array<{position:number; raw:string}>}>;
private results: Map<string, {id,productId,methodologyVersionId,payload,confidence,worstSeverity,computedAt}>;
```
private is OK (no one structurally extends the fake... wait, if the fake has a private member, is the fake still assignable to the ClassificationRepository type? The assignability target is the repo type; the source (fake) having extra private members is fine? The rule: if the source has a private/protected member, it's only assignable to the same class. The direction: when checking S (fake) → T (repo): does S have a private member? The rule is about S's private members: if S has a private member that isn't in T from the same declaration... T (repo class) has its own private? The repo has no private (we chose public readonly). S (fake) with a private field: is S assignable to T? TS rule: two object types are assignable when for each member in T, S has a compatible one. S's private members don't obstruct... Actually, the "private members make the class nominal" rule: when the source type is a class with private members, the target must be the same class or a subclass of it? Let me recall exactly: "Type A (class with private) is assignable to Type B only if A and B are the same class or B is a superclass of A"? That's when the target has the private. When the source has a private and the target is a structural interface → allowed? Hmm.

Example:
```ts
class A { private x = 1; foo() {} }
interface T { foo(): void }
const a: A = new A();
const t: T = a; // allowed?
```
I think it's allowed: assignability to an interface only requires matching members; A's private doesn't block. The nominal behavior kicks in when comparing A to another class B that also has a private (they must be from the same declaration). A → an interface with just foo: OK.

So the fake (with a private) → ClassificationRepository (a class with only public members): TS compares as a class-to-class structural comparison; the repo has no private → plain structural: the fake must have all of the repo's public members: prisma ✓ (dummy), all methods ✓. The fake's extra private is fine.

So `FakeClassificationRepository` with private state + public methods matching the repo.

Now — the repository method list (final):
```ts
createProduct(name: string, rawIngredients: string[]): Promise<{ id: string; name: string }>
findProductWithIngredients(id: string): Promise<ProductView | null>
listProducts(): Promise<ProductRow[]>
findActiveMethodology(): Promise<MethodologyVersionView | null>
findMethodologyByCode(code: string): Promise<{ id: string; code: string; status: 'draft'|'active'|'retired' } | null>
publishVersion(input: MethodologyVersionInput): Promise<MethodologyVersionView>
findRulesByVersion(versionId: string): Promise<RuleView[]>
findIngredients(): Promise<IngredientInfo[]>
findProfileWithModifiers(id: string): Promise<ProfileView | null>
upsertResult(input: { productId: string; methodologyVersionId: string; payload: unknown; confidence: number; worstSeverity: 'watch'|'restricted'|'banned' }): Promise<{ id: string }>
findResultsByProduct(productId: string, methodologyVersionId?: string): Promise<StoredResultView[]>
```

Types: define in the repository file:
```ts
export type Severity = 'watch' | 'restricted' | 'banned';
export interface ProductView { id: string; name: string; ingredients: Array<{ raw: string; position: number }> }
export interface ProductRow { id: string; name: string; ingredients: Array<{ raw: string; position: number }> }
export interface MethodologyVersionView { id: string; code: string; status: 'draft' | 'active' | 'retired' }
export interface RuleView { ingredientId: string; ingredientName: string; severity: Severity; source: string }
export interface IngredientInfo { id: string; name: string; synonyms: string[] }
export interface ProfileView { id: string; name: string; modifiers: Array<{ ingredientId: string; severity: Severity; source: string; reason?: string }> }
export interface StoredResultView { id: string; productId: string; methodologyVersionId: string; methodologyVersionCode: string; payload: unknown; confidence: number; worstSeverity: Severity; computedAt: string }
export interface MethodologyVersionInput { code: string; rules: ResolvedRuleInput[] }
export interface ResolvedRuleInput { ingredientId: string; severity: Severity; source: string }
```

Service response types:
```ts
export interface ClassificationFinding {
  input: string; normalized: string; resolved: string | null;
  status: 'flagged' | 'clear' | 'unknown';
  flagged: boolean; severity: Severity | null; baseSeverity: Severity | null;
  source: string | null; baseSource: string | null;
  origin: 'base' | 'profile_modifier';
  note: string | null;
}
export interface ClassificationResponse {
  product_id: string; methodology_version: string;
  profile: { id: string; name: string } | null;
  ingredients: ClassificationFinding[];
  unknowns: string[];
  confidence: number;
  summary: { watch: number; restricted: number; banned: number };
  disclaimer: string;
}
```
The service file can export these types; the controller may use them in return-type annotations (or omit the annotation). Keep them in the service.

Payload (stored base) = the response minus the profile: `{ product_id, methodology_version, profile: null, ingredients, unknowns, confidence, summary, disclaimer }`. I'll just store the base response object (profile null).

## Severity helpers

```ts
const SEVERITY_ORDER: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };
const SEVERITIES: Severity[] = ['watch', 'restricted', 'banned'];
```

## applyProfile details

```ts
private withProfile(base: ClassificationResponse, profile: ProfileView): ClassificationResponse {
  const byId = new Map(profile.modifiers.map(m => [m.ingredientId, m]));
  const ingredients = base.ingredients.map(f => {
    if (f.resolved === null) return f;
    const modifier = byId.get(f.__ingredientId); // need the id — internal
    if (!modifier) return f;
    const escalated = baseSeverityNullOrLower? ...
  });
}
```
The finding needs the ingredientId internally — add a non-exported field? Include `ingredient_id: string | null` in the finding (actually useful in the API). Yes, expose `ingredient_id` — harmless and useful.

Logic per finding:
- No modifier → unchanged (origin 'base').
- Modifier present:
  - If base severity is null (clear): → flagged, severity=modifier.severity, baseSeverity null, source=modifier.source, baseSource null, origin 'profile_modifier', note = modifier.reason ?? null, flagged true, status 'flagged'.
  - Otherwise, if SEVERITY_ORDER[modifier.severity] > SEVERITY_ORDER[base]: escalated → severity=modifier.severity, baseSeverity=base, source=modifier.source, baseSource=base source, origin 'profile_modifier', note modifier.reason.
  - Otherwise (modifier ≤ base): tighten-only → no change (profile can't loosen). Keep origin 'base'.

Then recompute summary from the final findings (the summary in the response reflects profile-adjusted severities; the stored base summary is base). Confidence is unchanged by the profile.

The stored payload stays base-only.

## buildBase

```ts
private buildBase(product: ProductRow, versionCode: string, rules: RuleView[], index: IngredientIndex): ClassificationResponse {
  const ruleByIngredient = new Map(rules.map(r => [r.ingredientId, r]));
  const findings = product.ingredients.map(line => {
    const normalized = normalizeTerm(line.raw);
    const entry = index.get(normalized);
    if (!entry) return { input: line.raw, normalized, resolved: null, ingredient_id: null, status: 'unknown', flagged: false, severity: null, baseSeverity: null, source: null, baseSource: null, origin: 'base', note: null };
    const rule = ruleByIngredient.get(entry.id);
    return { input: line.raw, normalized, resolved: entry.name, ingredient_id: entry.id, status: rule ? 'flagged' : 'clear', flagged: !!rule, severity: rule?.severity ?? null, baseSeverity: rule?.severity ?? null, source: rule?.source ?? null, baseSource: rule?.source ?? null, origin: 'base', note: null };
  });
  findings.sort((a,b) => a.normalized.localeCompare(b.normalized) || a.input.localeCompare(b.input));
  const unknowns = [...new Set(findings.filter(f=>f.status==='unknown').map(f=>f.normalized))].sort();
  const confidence = round4(findings.length ? (findings.length - unknownCount)/findings.length : 1);
  const summary = count severities among flagged;
  return { product_id: product.id, methodology_version: versionCode, profile: null, ingredients: findings, unknowns, confidence, summary, disclaimer: DISCLAIMER };
}
```
Note: unknownCount = findings.filter(status unknown).length (duplicates count per line, but unknowns are unique) — confidence uses line counts: (total - unknownLines)/total.

The index: `Map<string, {id, name}>` built from ingredients + synonyms:
```ts
const index = new Map<string,{id:string;name:string}>();
for (const ing of ingredients) {
  index.set(normalizeTerm(ing.name), { id: ing.id, name: ing.name });
  for (const s of ing.synonyms) index.set(normalizeTerm(s), { id: ing.id, name: ing.name });
}
```
(Precedence: the canonical name is set first, then synonyms override with the same target anyway; if a synonym collides across ingredients — data error; last wins, deterministic. I'll note in a comment.)

## classify with profile: order of operations

1. product (404 product_not_found)
2. active methodology (503? code 'no_active_methodology' — HTTP 409? use 409 ConflictError? It's a state conflict → 409 is fine)
3. rules + ingredients + profile (if profileId: 404 profile_not_found)
4. base = buildBase
5. upsertResult (base)
6. response = profile ? withProfile(base, profile) : base
7. return

## publishVersion service

```ts
async publishVersion(input: { code: string; rules: Array<{ ingredient: string; severity: Severity; source: string }> }) {
  const existing = await this.repo.findMethodologyByCode(input.code);
  if (existing) throw new MethodologyVersionExistsError(existing.code);
  const ingredients = await this.repo.findIngredients();
  const index = buildIndex(ingredients);
  const resolved: ResolvedRuleInput[] = [];
  const missing: string[] = [];
  for (const rule of input.rules) {
    const entry = index.get(normalizeTerm(rule.ingredient));
    if (!entry) { missing.push(rule.ingredient); continue; }
    resolved.push({ ingredientId: entry.id, severity: rule.severity, source: rule.source });
  }
  if (missing.length) throw new BadRequestError('unknown_ingredient_in_rule', '…', { ingredients: missing });
  const version = await this.repo.publishVersion({ code: input.code, rules: resolved });
  const rescannedProducts = await this.rescoreVersion(version.id);
  return { id: version.id, code: version.code, status: 'active', published: true, rescanned_products: rescannedProducts };
}
```

`rescoreVersion(versionId)`:
```ts
const methodology = await this.repo.findMethodologyByCode?? need the code for the payload: findMethodology(versionId)? Add repo.findMethodology(id) — or the publishVersion view returns the code (it does). rescoreVersion(versionId, versionCode)? The test calls rescore twice — pass (id, code). Hmm, signature `rescoreVersion(version: {id, code})`. Let me define `async rescoreVersion(versionId: string): Promise<number>` and fetch the version via a new repo method `findMethodologyById`. Cleaner. Add `findMethodologyById(id)`.

async rescoreVersion(versionId: string): Promise<number> {
  const version = await this.repo.findMethodologyById(versionId);
  if (!version) throw ProductNotFound? no — 'methodology_version_not_found' (404).
  const [rules, ingredients] = await Promise.all([findRulesByVersion, findIngredients]);
  const products = await this.repo.listProducts();
  for (const p of products) {
    const base = this.buildBase(p, version.code, rules, index);
    await this.repo.upsertResult({ productId: p.id, methodologyVersionId: versionId, payload: base, confidence: base.confidence, worstSeverity: worst(base) });
  }
  return products.length;
}
```
Idempotent: same inputs → same payload → upsert no-op. ✓

worstSeverity: the max severity among flagged, or 'watch' if none? A result with no flags: worstSeverity... 'none'? The column type is the enum Severity — add 'none' to the enum? Or nullable. Keep the enum and use a nullable column: `worstSeverity Severity?`. Fine.

## Controller

```ts
@Controller()
export class ClassificationController {
  constructor(readonly service: ClassificationService) {}

  @Post('products')
  createProduct(@Body() body: unknown): { id: string; name: string } {
    const name = requireString(body, 'name');
    const ingredients = requireStringArray(body, 'ingredients');
    return this.service.createProduct(name, ingredients);
  }
  ...
}
```
Wait, return a promise directly — Nest handles it.

Validation helpers (in the controller file, private functions — "zero business logic": type validation is OK):
```ts
function assertBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new BadRequestError('invalid_request', 'Request body must be a JSON object.', {});
  return body as Record<string, unknown>;
}
function requireString(body, key, { required = true } = {}) ...
```
Keep it simple inline per route.

Routes:
- `POST /products`
- `POST /classifications` body { product_id, profile_id? }
- `GET /classifications` query { product_id, methodology_version_id? }
- `POST /methodology-versions` body { code, rules }

Severity validation: `['watch','restricted','banned'].includes(s)`.

## api-error.ts

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

export class ApiError extends HttpException {
  constructor(readonly code: string, readonly message: string, readonly status: HttpStatus, readonly details: Record<string, unknown> = {}) {
    super({ error: { code, message, details } }, status);
  }
}
export class ProductNotFoundError extends ApiError { constructor(id: string) { super('product_not_found', `Product "${id}" was not found.`, HttpStatus.NOT_FOUND, { product_id: id }); } }
export class ProfileNotFoundError … 'profile_not_found'
export class MethodologyVersionNotFoundError … 'methodology_version_not_found'
export class NoActiveMethodologyError extends ApiError { constructor() { super('no_active_methodology', 'No methodology version is currently active; publish one before classifying.', HttpStatus.CONFLICT, {}); } }
export class MethodologyVersionExistsError … 409 'methodology_version_exists'
export class BadRequestError extends ApiError { constructor(code, message, details = {}) { super(code, message, HttpStatus.BAD_REQUEST, details); } }
export class InternalServerError extends ApiError { constructor(message = 'Unexpected server error.') { super('internal_error', message, HttpStatus.INTERNAL_SERVER_ERROR, {}); } }

@Catch()
export class ApiEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    if (exception instanceof ApiError) { res.status(exception.getStatus()); res.json({ error: { code: exception.code, message: exception.message, details: exception.details } }); return; }
    if (exception instanceof HttpException) { const status = exception.getStatus(); const resBody = exception.getResponse(); const code = typeof resBody === 'string' ? 'http_error' : (resBody as any).code ?? 'http_error'; const message = typeof resBody === 'string' ? resBody : (resBody as any).message ?? exception.message; res.status(status).json({ error: { code: String(code).toString().replace? keep as-is, message: String(message), details: typeof resBody === 'object' && resBody !== null && 'details' in resBody ? (resBody as any).details : {} } }); return; }
    console.error(exception);
    res.status(500).json({ error: { code: 'internal_error', message: 'Unexpected server error.', details: {} } });
  }
}
```
HttpException.getStatus exists ✓. Keep the mapping for generic HttpException simple: code = 'http_error' if no code... For a 404 from an unknown route, the response body is an object { statusCode: 404, message: 'Cannot GET /x', error: 'Not Found' } → code 'http_error'? Better: derive a snake_case from the status: `not_found`? A generic: `${statusTextToCode}` — just: code = 'http_error', details { http_status: status }. Hmm, the contract says the code is snake_case and is the contract — 'http_error' is fine.

Also, Nest's default body-parser 400 (invalid JSON) → HttpException 400 → the envelope ✓ via the filter.

## main.ts

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiEnvelopeFilter } from './common/api-error.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiEnvelopeFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}
void bootstrap();
```

## prisma module

```ts
// prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

## classification.module.ts

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
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

## app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { ClassificationModule } from './classification/classification.module.js';

@Module({ imports: [PrismaModule, ClassificationModule] })
export class AppModule {}
```

## Full seed.ts

```ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function upsertIngredient(name: string, synonyms: string[]) {
  const ing = await prisma.ingredient.upsert({ where: { name }, update: {}, create: { name } });
  for (const term of synonyms) {
    await prisma.ingredientSynonym.upsert({
      where: { term: normalize(term) },
      update: { ingredientId: ing.id },
      create: { ingredientId: ing.id, term: normalize(term) },
    });
  }
  return ing;
}
```
Hmm — stored synonyms are normalized? I said the service normalizes the stored terms on read (`normalizeTerm(s)` in index building) — so seed can store raw or normalized; the service normalizes on read anyway. Store as provided.

The idempotent seed uses upserts: ingredient by name; version by code (rules: deleteMany + create? For idempotency: if exists, skip or deleteMany rules and recreate). Simpler: on seed, check if the version exists → skip rule creation. Product: findFirst by name → skip. Profile: upsert by name.

Seed data (the "provided synonym fixture"):
Ingredients:
- "Aqua" synonyms ["water", "eau"]
- "Caffeine" synonyms ["cafeine"] — hmm, "caféine" normalizes to "cafeine" — the raw "caféine" in the seed → stored "caféine" → normalize on read → "caffeine" collides with the canonical "caffeine" — the index sets the canonical first, then the synonym overwrites with the same target — no problem. Store "cafeine" plainly? The accent handling is demonstrated by the raw input "Caféine" matching the canonical. Keep the synonym list: ["caffiene"?] that's a typo. Caffeine synonyms: ["1,3,7-trimethylxanthine"]? Overkill: keep ["cafeine"]? Actually "cafeine" is a common misspelling of caffeine — good typo fixture.
- "Limonene" synonyms []
- "Salicylic acid" synonyms ["salixylic acid", "bha", "beta-hydroxy acid"]
- "Tocopherol" synonyms ["t0copherol", "vitamin e"]
- "Retinyl palmitate" synonyms ["retinyl-palmitate"]? Normalization keeps the hyphen! normalizeTerm doesn't strip hyphens → "retinyl-palmitate" is stored as-is; the raw "Retinyl-Palmitate" matches. OK, include.
- "Benzoyl peroxide" synonyms []

Versions:
- "2024.1" rules:
  - Benzoyl peroxide → restricted, "EU Reg 1223/2009, Annex III, 315-1"
  - Retinyl palmitate → watch, "Curated watch list, 2024-01"
  - Salicylic acid → watch, "Curated watch list, 2024-01"
- (v2 created via the API/test)

Profiles:
- "child_under_3": Limonene → restricted "AAP position paper, 2023"; Retinyl palmitate → banned "FDA 2023 advisory on retinoids".
- "pregnancy": Retinyl palmitate → banned "FDA 2023 advisory on retinoids".

Products:
- "Night cream": ["Aqua", "Retinyl  Palmitate", "T0COPHEROL", "Limonene", "Caféine", "Mystery Butter X"]
- "Peeling gel": ["Salixylic Acid", "Aqua", "T0COPHEROL"]

The seed looks up ingredients by name to build rule/modifier references.

`main().then…finally disconnect`.

## Migration SQL

Match the schema exactly (camelCase → snake via @map). Let me write the schema first and derive the SQL.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Severity {
  watch
  restricted
  banned
}

enum MethodologyStatus {
  draft
  active
  retired
}

model Ingredient {
  id        String   @id @default(uuid())
  name      String   @unique
  createdAt DateTime @default(now()) @map("created_at")

  synonyms  IngredientSynonym[]
  rules     Rule[]
  modifiers ProfileModifier[]

  @@map("ingredients")
}

model IngredientSynonym {
  id           String   @id @default(uuid())
  term         String   @unique
  ingredientId String   @map("ingredient_id")
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id], onDelete: Cascade)

  @@map("ingredient_synonyms")
}
```
Should id be `@db.Uuid`? The `uuid()` default produces a uuid string; column type: without @db.Uuid, the column is TEXT. Either is fine; use @db.Uuid for cleanliness. I'll add `@db.Uuid` on all uuid columns.

```prisma
model MethodologyVersion {
  id          String            @id @default(uuid()) @db.Uuid
  code        String            @unique
  status      MethodologyStatus @unique @default(draft)
  publishedAt DateTime?         @map("published_at")
  createdAt   DateTime          @default(now()) @map("created_at")

  rules   Rule[]
  results ClassificationResult[]

  @@map("methodology_versions")
}

model Rule {
  id          String   @id @default(uuid()) @db.Uuid
  methodologyVersionId String @map("methodology_version_id") @db.Uuid
  ingredientId String  @map("ingredient_id") @db.Uuid
  severity    Severity
  source      String

  methodologyVersion MethodologyVersion @relation(fields: [methodologyVersionId], references: [id], onDelete: Cascade)
  ingredient Ingredient @relation(fields: [ingredientId], references: [id])

  @@unique([methodologyVersionId, ingredientId])
  @@map("rules")
}

model FamilyProfile {
  id          String   @id @default(uuid()) @db.Uuid
  name        String   @unique
  description String?

  modifiers ProfileModifier[]

  @@map("family_profiles")
}

model ProfileModifier {
  id           String   @id @default(uuid()) @db.Uuid
  profileId    String   @map("profile_id") @db.Uuid
  ingredientId String   @map("ingredient_id") @db.Uuid
  severity     Severity
  source       String
  reason       String?

  profile    FamilyProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  ingredient Ingredient    @relation(fields: [ingredientId], references: [id])

  @@unique([profileId, ingredientId])
  @@map("profile_modifiers")
}

model Product {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  ingredients ProductIngredient[]
  results     ClassificationResult[]

  @@map("products")
}

model ProductIngredient {
  id        String @id @default(uuid()) @db.Uuid
  productId String @map("product_id") @db.Uuid
  position  Int
  rawName   String @map("raw_name")

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([productId, position])
  @@map("product_ingredients")
}

model ClassificationResult {
  id                   String   @id @default(uuid()) @db.Uuid
  productId            String   @map("product_id") @db.Uuid
  methodologyVersionId String   @map("methodology_version_id") @db.Uuid
  payload              Json
  confidence           Float
  worstSeverity        Severity? @map("worst_severity")
  computedAt           DateTime @default(now()) @map("computed_at")

  product            Product            @relation(fields: [productId], references: [id], onDelete: Cascade)
  methodologyVersion MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])

  @@unique([productId, methodologyVersionId])
  @@map("classification_results")
}
```

Note: `status MethodologyStatus @unique @default(draft)` — unique on an enum column, fine.

Migration SQL (Postgres):

```sql
-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('watch', 'restricted', 'banned');
CREATE TYPE "MethodologyStatus" AS ENUM ('draft', 'active', 'retired');

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ingredient_synonyms" (
    "id" UUID NOT NULL,
    "term" TEXT NOT NULL,
    "ingredient_id" UUID NOT NULL,
    CONSTRAINT "ingredient_synonyms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "methodology_versions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "MethodologyStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "methodology_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rules" (
    "id" UUID NOT NULL,
    "methodology_version_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "severity" "Severity" NOT NULL,
    "source" TEXT NOT NULL,
    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "family_profiles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    CONSTRAINT "family_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "profile_modifiers" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "severity" "Severity" NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    CONSTRAINT "profile_modifiers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_ingredients" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "raw_name" TEXT NOT NULL,
    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "classification_results" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "methodology_version_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "worst_severity" "Severity",
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "classification_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_name_key" ON "ingredients"("name");
CREATE UNIQUE INDEX "ingredient_synonyms_term_key" ON "ingredient_synonyms"("term");
CREATE UNIQUE INDEX "methodology_versions_code_key" ON "methodology_versions"("code");
CREATE UNIQUE INDEX "methodology_versions_status_key" ON "methodology_versions"("status");
CREATE UNIQUE INDEX "rules_methodology_version_id_ingredient_id_key" ON "rules"("methodology_version_id", "ingredient_id");
CREATE UNIQUE INDEX "family_profiles_name_key" ON "family_profiles"("name");
CREATE UNIQUE INDEX "profile_modifiers_profile_id_ingredient_id_key" ON "profile_modifiers"("profile_id", "ingredient_id");
CREATE UNIQUE INDEX "product_ingredients_product_id_position_key" ON "product_ingredients"("product_id", "position");
CREATE UNIQUE INDEX "classification_results_product_id_methodology_version_id_key" ON "classification_results"("product_id", "methodology_version_id");

-- AddForeignKey
ALTER TABLE "ingredient_synonyms" ADD CONSTRAINT "ingredient_synonyms_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rules" ADD CONSTRAINT "rules_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rules" ADD CONSTRAINT "rules_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profile_modifiers" ADD CONSTRAINT "profile_modifiers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "family_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_modifiers" ADD CONSTRAINT "profile_modifiers_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

migration_lock.toml:
```toml
# Please do not edit this file manually
provider = "postgresql"
```

## Now let me write out the fake repository completely

```ts
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import {
  BadRequestError,
  MethodologyVersionExistsError,
  NoActiveMethodologyError,
  ProductNotFoundError,
  ProfileNotFoundError,
  MethodologyVersionNotFoundError,
  SeverityRankError,
} from '../../src/common/api-error.js';
import type {
  ClassificationRepository,
  IngredientInfo,
  MethodologyVersionInput,
  MethodologyVersionView,
  ProfileView,
  ProductRow,
  ResolvedRuleInput,
  RuleView,
  Severity,
  StoredResultView,
} from '../../src/classification/classification.repository.js';
```

Wait — the path: the test file is at `test/` and src is at `src/` → `../src/…`. If the helper is in `test/support/…` → `../../src`. Put helpers flat in `test/`: `test/fixtures.ts`, `test/fake-repository.ts` → `../src/…`.

Fake:

```ts
export class FakeClassificationRepository {
  // Structurally compatible with ClassificationRepository; prisma is never used.
  readonly prisma = undefined as unknown as PrismaService;

  private readonly ingredients: Array<{ id: string; name: string; synonyms: string[] }>;
  private readonly versions: Array<{ id: string; code: string; status: 'draft'|'active'|'retired'; rules: Array<{ ingredientId: string; severity: Severity; source: string }> }>;
  private readonly profiles: Array<{ id: string; name: string; modifiers: Array<{ ingredientId: string; severity: Severity; source: string; reason?: string }> }>;
  private readonly products: Map<string, { id: string; name: string; ingredients: Array<{ position: number; raw: string }> }>;
  private readonly results: Map<string, { id: string; productId: string; methodologyVersionId: string; payload: unknown; confidence: number; worstSeverity: Severity | null; computedAt: string }>;
  private seq = 0;

  constructor(seed: SeedData) {
    this.ingredients = seed.ingredients.map(i => ({ ...i, synonyms: [...i.synonyms] }));
    this.versions = seed.versions.map(v => ({ ...v, rules: v.rules.map(r => ({ ...r })) }));
    this.profiles = seed.profiles.map(p => ({ ...p, modifiers: p.modifiers.map(m => ({ ...m })) }));
    this.products = new Map(seed.products.map(p => [p.id, { id: p.id, name: p.name, ingredients: p.ingredients.map((raw, i) => ({ position: i + 1, raw })) }]));
    this.results = new Map();
  }

  private nextId(prefix: string): string { return `${prefix}-${++this.seq}`; }

  async createProduct(name: string, rawIngredients: string[]) {
    const id = this.nextId('product');
    this.products.set(id, { id, name, ingredients: rawIngredients.map((raw, i) => ({ position: i + 1, raw })) });
    return { id, name };
  }

  async findProductWithIngredients(id: string): Promise<ProductRow | null> {
    const p = this.products.get(id);
    if (!p) return null;
    return { ...p, ingredients: [...p.ingredients].sort((a,b)=>a.position-b.position).map(i => ({...i})) };
  }

  async listProducts(): Promise<ProductRow[]> {
    return [...this.products.values()].map(p => ({ ...p, ingredients: [...p.ingredients].sort((a,b)=>a.position-b.position).map(i=>({...i})) }));
  }

  async findActiveMethodology(): Promise<MethodologyVersionView | null> {
    const v = this.versions.find(v => v.status === 'active');
    return v ? { id: v.id, code: v.code, status: v.status } : null;
  }

  async findMethodologyById(id: string): Promise<MethodologyVersionView | null> {
    const v = this.versions.find(v => v.id === id);
    return v ? { id: v.id, code: v.code, status: v.status } : null;
  }

  async findMethodologyByCode(code: string) {
    const v = this.versions.find(v => v.code === code);
    return v ? { id: v.id, code: v.code, status: v.status } : null;
  }

  async publishVersion(input: MethodologyVersionInput): Promise<MethodologyVersionView> {
    if (this.versions.some(v => v.code === input.code)) {
      throw new MethodologyVersionExistsError(input.code);
    }
    for (const r of input.rules) {
      if (!this.ingredients.some(i => i.id === r.ingredientId)) {
        throw new BadRequestError('unknown_ingredient_in_rule', 'Rule references an unknown ingredient.', { ingredient_id: r.ingredientId });
      }
    }
    for (const v of this.versions) if (v.status === 'active') v.status = 'retired';
    const version = { id: this.nextId('version'), code: input.code, status: 'active' as const, rules: input.rules.map(r => ({ ...r })) };
    this.versions.push(version);
    return { id: version.id, code: version.code, status: version.status };
  }

  async findRulesByVersion(versionId: string): Promise<RuleView[]> {
    const v = this.versions.find(v => v.id === versionId);
    if (!v) return [];
    return v.rules.map(r => ({
      ingredientId: r.ingredientId,
      ingredientName: this.ingredients.find(i => i.id === r.ingredientId)?.name ?? '',
      severity: r.severity,
      source: r.source,
    }));
  }

  async findIngredients(): Promise<IngredientInfo[]> {
    return this.ingredients.map(i => ({ id: i.id, name: i.name, synonyms: [...i.synonyms] }));
  }

  async findProfileWithModifiers(id: string): Promise<ProfileView | null> {
    const p = this.profiles.find(p => p.id === id);
    return p ? { id: p.id, name: p.name, modifiers: p.modifiers.map(m => ({ ...m })) } : null;
  }

  async upsertResult(input: { productId: string; methodologyVersionId: string; payload: unknown; confidence: number; worstSeverity: Severity | null }) {
    const key = `${input.productId}:${input.methodologyVersionId}`;
    const existing = this.results.get(key);
    if (existing) {
      existing.payload = input.payload;
      existing.confidence = input.confidence;
      existing.worstSeverity = input.worstSeverity;
      existing.computedAt = new Date().toISOString();
      return { id: existing.id };
    }
    const row = { id: this.nextId('result'), ...input, computedAt: new Date().toISOString() };
    this.results.set(key, row);
    return { id: row.id };
  }

  async findResultsByProduct(productId: string, methodologyVersionId?: string): Promise<StoredResultView[]> {
    return [...this.results.values()]
      .filter(r => r.productId === productId && (!methodologyVersionId || r.methodologyVersionId === methodologyVersionId))
      .map(r => ({
        id: r.id,
        productId: r.productId,
        methodologyVersionId: r.methodologyVersionId,
        methodologyVersionCode: this.versions.find(v => v.id === r.methodologyVersionId)?.code ?? '',
        payload: r.payload,
        confidence: r.confidence,
        worstSeverity: r.worstSeverity ?? 'watch',  // hmm, StoredResultView.worstSeverity: Severity (non-null)? Make it Severity | null.
        computedAt: r.computedAt,
      }));
  }

  // Test helper — not part of the repository contract.
  resultCountFor(productId: string): number {
    return [...this.results.values()].filter(r => r.productId === productId).length;
  }
}
```

Wait, the `resultCountFor` helper — the fake has extra public members; the fake is assignable to the repo type (extra members OK) ✓.

Hmm — the fake's `publishVersion` duplicates the service's existence check (the service also checks). Fine.

Also — `severity` on modifiers in the service's withProfile: `modifier.severity` — the ProfileView modifier type includes severity ✓.

Another subtle point — service classify: `const profile = profileId ? await this.repo.findProfileWithModifiers(profileId) : null;` — load before the upsert, to fail fast on a bad profile. Order: product, active, (profile 404), rules, ingredients, then compute + upsert.

## Service: exact code

```ts
import { Injectable } from '@nestjs/common';
import {
  BadRequestError,
  MethodologyVersionNotFoundError,
  NoActiveMethodologyError,
  ProfileNotFoundError,
  ProductNotFoundError,
} from '../common/api-error.js';
import {
  ClassificationRepository,
  IngredientInfo,
  ProductRow,
  ResolvedRuleInput,
  RuleView,
  Severity,
} from './classification.repository.js';

export const DISCLAIMER =
  'Informational screening only. Findings are not a safety or regulatory judgment, and the absence of a flag does not mean a product is safe. Unknown ingredients could not be matched to a known substance and should be verified manually.';

export type FindingStatus = 'flagged' | 'clear' | 'unknown';
export type FindingOrigin = 'base' | 'profile_modifier';

export interface ClassificationFinding {
  input: string;
  normalized: string;
  resolved: string | null;
  ingredient_id: string | null;
  status: FindingStatus;
  flagged: boolean;
  severity: Severity | null;
  base_severity: Severity | null;
  source: string | null;
  base_source: string | null;
  origin: FindingOrigin;
  note: string | null;
}

export interface ClassificationSummary { watch: number; restricted: number; banned: number }

export interface ClassificationResponse {
  product_id: string;
  methodology_version: string;
  profile: { id: string; name: string } | null;
  ingredients: ClassificationFinding[];
  unknowns: string[];
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

export interface RuleDraft { ingredient: string; severity: Severity; source: string }

const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };

interface IndexedIngredient { id: string; name: string }

@Injectable()
export class ClassificationService {
  constructor(readonly repository: ClassificationRepository) {}

  async createProduct(name: string, rawIngredients: string[]): Promise<{ id: string; name: string }> {
    return this.repository.createProduct(name, rawIngredients);
  }

  async classify(productId: string, profileId?: string): Promise<ClassificationResponse> {
    const product = await this.repository.findProductWithIngredients(productId);
    if (!product) throw new ProductNotFoundError(productId);

    const methodology = await this.repository.findActiveMethodology();
    if (!methodology) throw new NoActiveMethodologyError();

    const profile = profileId ? await this.repository.findProfileWithModifiers(profileId) : null;
    if (profileId && !profile) throw new ProfileNotFoundError(profileId);

    const [rules, ingredients] = await Promise.all([
      this.repository.findRulesByVersion(methodology.id),
      this.repository.findIngredients(),
    ]);

    const base = this.buildBaseClassification(product, methodology.code, rules, ingredients);
    await this.repository.upsertResult({
      productId: product.id,
      methodologyVersionId: methodology.id,
      payload: base,
      confidence: base.confidence,
      worstSeverity: worstSeverity(base.summary),
    });

    return profile ? this.applyProfile(base, profile.id, profile.name, profile.modifiers) : base;
  }
```

Hmm, worstSeverity from the summary: summary all zero → null.
```ts
function worstSeverity(summary: ClassificationSummary): Severity | null {
  if (summary.banned > 0) return 'banned';
  if (summary.restricted > 0) return 'restricted';
  if (summary.watch > 0) return 'watch';
  return null;
}
```
(Non-exported in the service file.)

```ts
  async publishVersion(input: { code: string; rules: RuleDraft[] }): Promise<{ id: string; code: string; status: 'active'; published: boolean; rescanned_products: number }> {
    const existing = await this.repository.findMethodologyByCode(input.code);
    if (existing) throw new MethodologyVersionExistsError(input.code);

    const ingredients = await this.repository.findIngredients();
    const index = buildIngredientIndex(ingredients);
    const resolved: ResolvedRuleInput[] = [];
    const missing: string[] = [];
    for (const draft of input.rules) {
      const entry = index.get(normalizeTerm(draft.ingredient));
      if (!entry) { missing.push(draft.ingredient); continue; }
      resolved.push({ ingredientId: entry.id, severity: draft.severity, source: draft.source });
    }
    if (missing.length > 0) {
      throw new BadRequestError('unknown_ingredient_in_rule', 'Every rule must reference a known ingredient (name or synonym).', { ingredients: missing });
    }

    const version = await this.repository.publishVersion({ code: input.code, rules: resolved });
    const rescannedProducts = await this.rescoreVersion(version.id);
    return { id: version.id, code: version.code, status: 'active', published: true, rescanned_products: rescannedProducts };
  }

  /**
   * Re-score every product against the given methodology version.
   * Idempotent: results are upserted on (product, methodologyVersion) with a
   * deterministic payload, so repeating it changes nothing.
   */
  async rescoreVersion(methodologyVersionId: string): Promise<number> {
    const version = await this.repository.findMethodologyById(methodologyVersionId);
    if (!version) throw new MethodologyVersionNotFoundError(methodologyVersionId);

    const [rules, ingredients, products] = await Promise.all([
      this.repository.findRulesByVersion(methodologyVersionId),
      this.repository.findIngredients(),
      this.repository.listProducts(),
    ]);
    const index = buildIngredientIndex(ingredients);
    for (const product of products) {
      const base = this.buildBaseClassification(product, version.code, rules, ingredients); // index unused? buildBase needs index!
      ...
    }
  }
```
buildBaseClassification(product, code, rules, index). Fix: pass index.

```ts
    for (const product of products) {
      const base = this.buildBaseClassification(product, version.code, rules, index);
      await this.repository.upsertResult({
        productId: product.id,
        methodologyVersionId: methodologyVersionId,
        payload: base,
        confidence: base.confidence,
        worstSeverity: worstSeverity(base.summary),
      });
    }
    return products.length;
  }

  async listStoredResults(productId: string, methodologyVersionId?: string) {
    return this.repository.findResultsByProduct(productId, methodologyVersionId);
  }
```

buildBaseClassification:
```ts
  private buildBaseClassification(product: ProductRow, methodologyVersion: string, rules: RuleView[], index: Map<string, IndexedIngredient>): ClassificationResponse {
    const ruleByIngredient = new Map(rules.map((rule) => [rule.ingredientId, rule]));
    const findings: ClassificationFinding[] = product.ingredients.map((line) => {
      const normalized = normalizeTerm(line.raw);
      const entry = index.get(normalized);
      if (!entry) {
        return { input: line.raw, normalized, resolved: null, ingredient_id: null, status: 'unknown', flagged: false, severity: null, base_severity: null, source: null, base_source: null, origin: 'base', note: null };
      }
      const rule = ruleByIngredient.get(entry.id) ?? null;
      return {
        input: line.raw, normalized, resolved: entry.name, ingredient_id: entry.id,
        status: rule ? 'flagged' : 'clear',
        flagged: rule !== null,
        severity: rule ? rule.severity : null,
        base_severity: rule ? rule.severity : null,
        source: rule ? rule.source : null,
        base_source: rule ? rule.source : null,
        origin: 'base', note: null,
      };
    });

    findings.sort((a, b) => a.normalized.localeCompare(b.normalized) || a.input.localeCompare(b.input));

    const unknownLines = findings.filter((f) => f.status === 'unknown');
    const unknowns = [...new Set(unknownLines.map((f) => f.normalized))].sort((a, b) => a.localeCompare(b));
    const total = findings.length;
    const confidence = total === 0 ? 1 : round4((total - unknownLines.length) / total);

    const summary: ClassificationSummary = { watch: 0, restricted: 0, banned: 0 };
    for (const f of findings) if (f.severity) summary[f.severity] += 1;

    return { product_id: product.id, methodology_version: methodologyVersion, profile: null, ingredients: findings, unknowns, confidence, summary, disclaimer: DISCLAIMER };
  }
```
Wait — sorting with `localeCompare`: is it deterministic across runs and environments? localeCompare can vary by ICU locale! For strict determinism use plain string comparison `<`/`>`:
```ts
findings.sort((a, b) => (a.normalized < b.normalized ? -1 : a.normalized > b.normalized ? 1 : a.input < b.input ? -1 : a.input > b.input ? 1 : 0));
```
Yes — avoid localeCompare (environment-dependent). Use charCode comparison. Same for the unknowns sort. Good catch.

applyProfile:
```ts
  private applyProfile(base: ClassificationResponse, profileId: string, profileName: string, modifiers: Array<{ ingredientId: string; severity: Severity; source: string; reason?: string | null }>): ClassificationResponse {
    const modifierByIngredient = new Map(modifiers.map((m) => [m.ingredientId, m]));
    const summary: ClassificationSummary = { watch: 0, restricted: 0, banned: 0 };

    const ingredients = base.ingredients.map((finding) => {
      if (finding.status === 'unknown') return finding;
      const modifier = finding.ingredient_id ? modifierByIngredient.get(finding.ingredient_id) : undefined;
      if (!modifier) return finding;
      // Precedence: the profile modifier tightens the base finding and never loosens it.
      if (finding.base_severity && SEVERITY_RANK[modifier.severity] <= SEVERITY_RANK[finding.base_severity]) {
        return finding;
      }
      const next: ClassificationFinding = {
        ...finding,
        status: 'flagged',
        flagged: true,
        severity: modifier.severity,
        source: modifier.source,
        origin: 'profile_modifier',
        note: modifier.reason ?? null,
      };
      return next;
    });

    for (const f of ingredients) if (f.severity) summary[f.severity] += 1;

    return { ...base, profile: { id: profileId, name: profileName }, ingredients, summary };
  }
```
Check the tighten condition: base_severity null (clear) → flag with the modifier (condition `if (finding.base_severity && rank <= rank)` → false → proceeds ✓). Base watch + modifier restricted (2>1) → proceed ✓. Base restricted + modifier watch (1<=2) → return unchanged ✓. Base banned + modifier anything (<=3) → unchanged ✓. Equal (restricted + restricted) → unchanged (no change anyway) ✓.

Module-level helpers:
```ts
function buildIngredientIndex(ingredients: IngredientInfo[]): Map<string, IndexedIngredient> {
  const index = new Map<string, IndexedIngredient>();
  for (const ingredient of ingredients) {
    index.set(normalizeTerm(ingredient.name), { id: ingredient.id, name: ingredient.name });
    for (const synonym of ingredient.synonyms) {
      // Synonyms are secondary: a canonical name always wins over a synonym.
      if (!index.has(normalizeTerm(synonym))) index.set(normalizeTerm(synonym), { id: ingredient.id, name: ingredient.name });
    }
  }
  return index;
}
```
Hmm — `if (!index.has)` makes the canonical win over a synonym, and the first synonym wins over a later synonym. Deterministic ✓.

But wait: a synonym can collide with another ingredient's canonical name — the canonical is inserted first (iteration order of the ingredients array from the repository — DB order is not guaranteed! findMany without orderBy → order can change between runs?? In Postgres, without ORDER BY, order is typically stable in practice but not guaranteed → if a synonym maps to different targets in different runs, index construction order affects the winner. For safety: two-pass in the service: first pass canonicals (all), second pass synonyms with has-check. Order-independent for canonical-vs-synonym; synonym-vs-synonym collisions remain order-dependent but that's a data error. I'll do two-pass for correctness:
```ts
for (const ingredient of ingredients) index.set(normalizeTerm(ingredient.name), …);
for (const ingredient of ingredients) for (const synonym of ingredient.synonyms) if (!index.has(normalizeTerm(synonym))) index.set(…);
```
✓. Also, in the fake repository, findIngredients returns in a stable order anyway.

Also, for DB stability, `orderBy: { name: 'asc' }` on the real repository's findMany — good practice; I'll add it.

normalizeTerm + round4 at the top of the service file:
```ts
/** Lowercase, strip accents, collapse whitespace. Deterministic across environments. */
export function normalizeTerm(input: string): string {
  return input.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ');
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
```
Export normalizeTerm (does the controller need it? no. Keep it exported? The test can import from the service — fine, export it.)

## Controller, exactly

```ts
import { BadRequestException? no — use our own BadRequestError } 
```

```ts
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { BadRequestError } from '../common/api-error.js';
import { ClassificationService, RuleDraft } from './classification.service.js';

const SEVERITIES = ['watch', 'restricted', 'banned'] as const;

@Controller()
export class ClassificationController {
  constructor(readonly service: ClassificationService) {}

  @Post('products')
  createProduct(@Body() body: unknown) {
    const data = objectBody(body);
    const name = nonEmptyString(data, 'name');
    const ingredients = stringArray(data, 'ingredients');
    return this.service.createProduct(name, ingredients);
  }

  @Post('classifications')
  classify(@Body() body: unknown) {
    const data = objectBody(body);
    const productId = nonEmptyString(data, 'product_id');
    const profileId = optionalNonEmptyString(data, 'profile_id');
    return this.service.classify(productId, profileId);
  }

  @Get('classifications')
  listClassifications(@Query('product_id') productId?: string, @Query('methodology_version_id') methodologyVersionId?: string) {
    const required = nonEmptyString({ product_id: productId }, 'product_id');
    const versionId = optionalNonEmptyString({ methodology_version_id: methodologyVersionId }, 'methodology_version_id');
    return this.service.listStoredResults(required, versionId);
  }

  @Post('methodology-versions')
  publishMethodologyVersion(@Body() body: unknown) {
    const data = objectBody(body);
    const code = nonEmptyString(data, 'code');
    const rulesRaw = array(data, 'rules');
    const rules: RuleDraft[] = rulesRaw.map((entry, i) => {
      if (typeof entry !== 'object' || entry === null) throw new BadRequestError('invalid_request', `rules[${i}] must be an object.`, { field: `rules[${i}]` });
      const rule = entry as Record<string, unknown>;
      const ingredient = nonEmptyString(rule, 'ingredient');
      const severity = rule.severity;
      if (typeof severity !== 'string' || !(SEVERITIES as readonly string[]).includes(severity)) throw new BadRequestError('invalid_severity', `rules[${i}].severity must be one of: ${SEVERITIES.join(', ')}.`, { field: `rules[${i}].severity` });
      const source = nonEmptyString(rule, 'source');
      return { ingredient, severity: severity as RuleDraft['severity'], source };
    });
    return this.service.publishVersion({ code, rules });
  }
}
```

Validation helpers (module scope, throw BadRequestError):
```ts
function objectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestError('invalid_request', 'Request body must be a JSON object.', {});
  }
  return body as Record<string, unknown>;
}
function nonEmptyString(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be a non-empty string.`, { field });
  }
  return value;
}
function optionalNonEmptyString(data: Record<string, unknown>, field: string): string | undefined {
  const value = data[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be a non-empty string when provided.`, { field });
  }
  return value;
}
function stringArray(data: Record<string, unknown>, field: string): string[] {
  const value = data[field];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.trim().length === 0)) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be an array of non-empty strings.`, { field });
  }
  return value;
}
function array(data: Record<string, unknown>, field: string): unknown[] {
  const value = data[field];
  if (!Array.isArray(value)) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be an array.`, { field });
  }
  return value;
}
```

`severity: severity as RuleDraft['severity']` — fine.

## api-error.ts, exactly

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

/**
 * Single error envelope for the whole API:
 * { "error": { "code": "snake_case", "message": "...", "details": {} } }
 */
export class ApiError extends HttpException {
  constructor(
    readonly code: string,
    readonly message: string,
    status: HttpStatus,
    readonly details: Record<string, unknown> = {},
  ) {
    super({ error: { code, message, details } }, status);
  }
}

export class BadRequestError extends ApiError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(code, message, HttpStatus.BAD_REQUEST, details);
  }
}

export class ProductNotFoundError extends ApiError {
  constructor(productId: string) {
    super('product_not_found', `Product "${productId}" was not found.`, HttpStatus.NOT_FOUND, { product_id: productId });
  }
}

export class ProfileNotFoundError extends ApiError {
  constructor(profileId: string) {
    super('profile_not_found', `Family profile "${profileId}" was not found.`, HttpStatus.NOT_FOUND, { profile_id: profileId });
  }
}

export class MethodologyVersionNotFoundError extends ApiError {
  constructor(methodologyVersionId: string) {
    super('methodology_version_not_found', `Methodology version "${methodologyVersionId}" was not found.`, HttpStatus.NOT_FOUND, { methodology_version_id: methodologyVersionId });
  }
}

export class NoActiveMethodologyError extends ApiError {
  constructor() {
    super('no_active_methodology', 'No methodology version is active; publish one before classifying.', HttpStatus.CONFLICT, {});
  }
}

export class MethodologyVersionExistsError extends ApiError {
  constructor(code: string) {
    super('methodology_version_exists', `Methodology version "${code}" is already published.`, HttpStatus.CONFLICT, { code });
  }
}

export class InternalError extends ApiError {
  constructor(message = 'Unexpected server error.') {
    super('internal_error', message, HttpStatus.INTERNAL_SERVER_ERROR, {});
  }
}

interface ErrorEnvelope { error: { code: string; message: string; details: Record<string, unknown> } }

@Catch()
export class ApiEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHandler): void {
```
Typo watch — `host: ArgumentsHost`.

```ts
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();

    if (exception instanceof ApiError) {
      const envelope: ErrorEnvelope = { error: { code: exception.code, message: exception.message, details: exception.details } };
      response.status(exception.getStatus()).json(envelope);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        response.status(status).json({ error: { code: 'http_error', message: payload, details: { http_status: status } } });
        return;
      }
      const body = payload as Record<string, unknown>;
      const code = typeof body.code === 'string' ? body.code : 'http_error';
      const message = typeof body.message === 'string' ? body.message : Array.isArray(body.message) ? body.message.join('; ') : exception.message;
      const details = body.details && typeof body.details === 'object' ? (body.details as Record<string, unknown>) : {};
      response.status(status).json({ error: { code, message, details } });
      return;
    }

    // eslint-disable-next-line no-console
    console.error('Unhandled exception:', exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: { code: 'internal_error', message: 'Unexpected server error.', details: {} } });
  }
}
```
`exception.message` — HttpException has a message ✓.

## prisma.service.ts

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

## Repository, exactly

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export type Severity = 'watch' | 'restricted' | 'banned';
export type MethodologyStatus = 'draft' | 'active' | 'retired';

export interface ProductRow { id: string; name: string; ingredients: Array<{ position: number; raw: string }> }
export interface MethodologyVersionView { id: string; code: string; status: MethodologyStatus }
export interface RuleView { ingredientId: string; ingredientName: string; severity: Severity; source: string }
export interface ResolvedRuleInput { ingredientId: string; severity: Severity; source: string }
export interface MethodologyVersionInput { code: string; rules: ResolvedRuleInput[] }
export interface IngredientInfo { id: string; name: string; synonyms: string[] }
export interface ProfileModifierView { ingredientId: string; severity: Severity; source: string; reason?: string | null }
export interface ProfileView { id: string; name: string; modifiers: ProfileModifierView[] }
export interface UpsertResultInput { productId: string; methodologyVersionId: string; payload: unknown; confidence: number; worstSeverity: Severity | null }
export interface StoredResultView { id: string; productId: string; methodologyVersionId: string; methodologyVersionCode: string; payload: unknown; confidence: number; worstSeverity: Severity | null; computedAt: string }

@Injectable()
export class ClassificationRepository {
  constructor(readonly prisma: PrismaService) {}

  async createProduct(name: string, rawIngredients: string[]): Promise<{ id: string; name: string }> {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({ data: { name } });
      if (rawIngredients.length > 0) {
        await tx.productIngredient.createMany({
          data: rawIngredients.map((rawName, i) => ({ productId: product.id, position: i + 1, rawName })),
        });
      }
      return { id: product.id, name: product.name };
    });
  }

  async findProductWithIngredients(id: string): Promise<ProductRow | null> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { ingredients: { orderBy: { position: 'asc' } } },
    });
    if (!product) return null;
    return { id: product.id, name: product.name, ingredients: product.ingredients.map((line) => ({ position: line.position, raw: line.rawName })) };
  }

  async listProducts(): Promise<ProductRow[]> {
    const products = await this.prisma.product.findMany({
      orderBy: { id: 'asc' },
      include: { ingredients: { orderBy: { position: 'asc' } } },
    });
    return products.map((product) => ({ id: product.id, name: product.name, ingredients: product.ingredients.map((line) => ({ position: line.position, raw: line.rawName })) }));
  }

  async findActiveMethodology(): Promise<MethodologyVersionView | null> {
    const version = await this.prisma.methodologyVersion.findUnique({ where: { status: 'active' } });
    return version ? { id: version.id, code: version.code, status: version.status } : null;
  }

  async findMethodologyById(id: string): Promise<MethodologyVersionView | null> {
    const version = await this.prisma.methodologyVersion.findUnique({ where: { id } });
    return version ? { id: version.id, code: version.code, status: version.status } : null;
  }

  async findMethodologyByCode(code: string): Promise<MethodologyVersionView | null> {
    const version = await this.prisma.methodologyVersion.findUnique({ where: { code } });
    return version ? { id: version.id, code: version.code, status: version.status } : null;
  }

  async publishVersion(input: MethodologyVersionInput): Promise<MethodologyVersionView> {
    const version = await this.prisma.$transaction(async (tx) => {
      const active = await tx.methodologyVersion.findUnique({ where: { status: 'active' } });
      if (active) {
        await tx.methodologyVersion.update({ where: { id: active.id }, data: { status: 'retired' } });
      }
      return tx.methodologyVersion.create({
        data: {
          code: input.code,
          status: 'active',
          publishedAt: new Date(),
          rules: { create: input.rules.map((rule) => ({ methodologyVersionId: undefined? no
```
Careful: nested create with a known parent — inside `create` the parent's id isn't known, so the nested `rules: { create: [...] }` works without a parent id (Prisma fills it). ✓

```ts
          rules: { create: input.rules.map((rule) => ({ ingredientId: rule.ingredientId, severity: rule.severity, source: rule.source })) },
        },
      });
    });
    return { id: version.id, code: version.code, status: version.status };
  }

  async findRulesByVersion(methodologyVersionId: string): Promise<RuleView[]> {
    const rules = await this.prisma.rule.findMany({
      where: { methodologyVersionId },
      include: { ingredient: { select: { name: true } } },
    });
    return rules.map((rule) => ({ ingredientId: rule.ingredientId, ingredientName: rule.ingredient.name, severity: rule.severity, source: rule.source }));
  }

  async findIngredients(): Promise<IngredientInfo[]> {
    const ingredients = await this.prisma.ingredient.findMany({
      orderBy: { name: 'asc' },
      include: { synonyms: { orderBy: { term: 'asc' }, select: { term: true } } },
    });
    return ingredients.map((ingredient) => ({ id: ingredient.id, name: ingredient.name, synonyms: ingredient.synonyms.map((s) => s.term) }));
  }

  async findProfileWithModifiers(id: string): Promise<ProfileView | null> {
    const profile = await this.prisma.familyProfile.findUnique({
      where: { id },
      include: { modifiers: true },
    });
    if (!profile) return null;
    return { id: profile.id, name: profile.name, modifiers: profile.modifiers.map((m) => ({ ingredientId: m.ingredientId, severity: m.severity, source: m.source, reason: m.reason })) };
  }

  async upsertResult(input: UpsertResultInput): Promise<{ id: string }> {
    const result = await this.prisma.classificationResult.upsert({
      where: {
        productId_methodologyVersionId: { productId: input.productId, methodologyVersionId: input.methodologyVersionId },
      },
      update: { payload: input.payload as object, confidence: input.confidence, worstSeverity: input.worstSeverity, computedAt: new Date() },
      create: { productId: input.productId, methodologyVersionId: input.methodologyVersionId, payload: input.payload as object, confidence: input.confidence, worstSeverity: input.worstSeverity },
    });
    return { id: result.id };
  }

  async findResultsByProduct(productId: string, methodologyVersionId?: string): Promise<StoredResultView[]> {
    const results = await this.prisma.classificationResult.findMany({
      where: { productId, ...(methodologyVersionId ? { methodologyVersionId } : {}) },
      orderBy: { computedAt: 'asc' },
      include: { methodologyVersion: { select: { code: true } } },
    });
    return results.map((result) => ({
      id: result.id,
      productId: result.productId,
      methodologyVersionId: result.methodologyVersionId,
      methodologyVersionCode: result.methodologyVersion.code,
      payload: result.payload,
      confidence: result.confidence,
      worstSeverity: result.worstSeverity,
      computedAt: result.computedAt.toISOString(),
    }));
  }
}
```

Typing of `payload: input.payload as object` — Prisma's Json field accepts `object | string | number | boolean | null` (JsonValue). `unknown as object`? Does TS allow `as object` from unknown? An assertion from unknown to object is allowed (unknown → anything? no! an assertion from unknown is allowed to anything, yes, `x as T` when x: unknown is fine). Actually, `as` from unknown to any type is permitted ✓.

worstSeverity: `Severity | null` — Prisma nullable enum field accepts null ✓.

Now — the fake's `upsertResult` input type matches UpsertResultInput ✓. The fake's findResultsByProduct returns worstSeverity `Severity | null` — adjust StoredResultView to be nullable.

The service's `worstSeverity(base.summary)` returns Severity | null ✓.

## Service imports check: use `MethodologyVersionNotFoundError`, `ProfileNotFoundError`, `ProductNotFoundError`, `NoActiveMethodologyError`, `BadRequestError`, and `MethodologyVersionExistsError`? The service throws ExistsError ✓ (import).

## Now finalize the test file

```ts
import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  ClassificationController,
} from '../src/classification/classification.controller.js';
import { ClassificationService } from '../src/classification/classification.service.js';
import {
  ApiEnvelopeFilter,
  BadRequestError,
  MethodologyVersionExistsError,
  NoActiveMethodologyError,
  ProductNotFoundError,
} from '../src/common/api-error.js';
import { ClassificationRepository } from '../src/classification/classification.repository.js';
import { FakeClassificationRepository } from './fake-repository.js';
import { buildService, makeSeed, NIGHT_CREAM, PEELING_GEL, SHUFFLED_PEELING, V1, V2, CHILD_PROFILE, PREGNANCY_PROFILE } from './fixtures.js';
```

Wait — does the test import ClassificationRepository? Not directly (type only?) — for the fake's assignability, the service's constructor expects ClassificationRepository; the fake is passed — TS checks structurally, so no import needed. Drop the import. But wait: `buildService` in fixtures returns ClassificationService — the fixtures import it ✓.

The controller test needs a stub service — an inline object:
```ts
const calls: Record<string, unknown> = {};
const serviceStub = {
  createProduct: async (name: string, ingredients: string[]) => { calls.createProduct = { name, ingredients }; return { id: 'p-1', name }; },
  classify: async (productId: string, profileId?: string) => { calls.classify = { productId, profileId }; return {}; },
  publishVersion: async (input: unknown) => { calls.publishVersion = input; return {}; },
  listStoredResults: async (productId: string, versionId?: string) => { calls.listStoredResults = { productId, versionId }; return []; },
};
```
The type: the controller's constructor expects ClassificationService — the stub is structurally compatible ✓ (the service has these methods; the stub provides compatible signatures; the service's readonly repository public member? the service class has a public `repository` member! The stub lacks it → not assignable!! Because the service's `readonly repository: ClassificationRepository` is a public property of the class type. So the stub must include a `repository` property?? Ugh. Options: don't use a parameter property in the service/controller:
```ts
constructor(private readonly service: ClassificationService) {}
```
`private` → the class is nominal-ish: the stub → service? no. But the assignability to the target type ClassificationService with a public member requires the source to have that member. Use a plain constructor without a parameter property:
```ts
export class ClassificationService {
  private readonly repository: ClassificationRepository;
  constructor(repository: ClassificationRepository) { this.repository = repository; }
}
```
`private` member on the target: source must be the same class?? No — the rule is reversed: assignability of S→T when T has a private member: allowed only if S is the same class or a subclass. So a stub → ClassificationService fails either way (public or private member). Hmm!!

The standard Nest testing approach: `Test.createTestingModule({ controllers: [ClassificationController], providers: [{ provide: ClassificationService, useValue: stub }] })` — DI doesn't care; but TS: the `useValue: stub` typing — the providers array is loosely typed (Provider[]), so the stub isn't checked against ClassificationService ✓. And the controller receives the stub at runtime. TS-wise, `useValue` accepts any.

But for the service test, we do a direct construction `new ClassificationService(fakeRepo)` — fakeRepo → ClassificationRepository: the repository has a public readonly prisma + public methods; the fake has all of them; the repository has no private → pure structural ✓, the fake is assignable ✓.

For the controller, use Test.createTestingModule with a useValue stub. And call the controller methods directly via `module.get(ClassificationController)` — no HTTP. The stub records calls; assert on the recorded input mapping + return pass-through. This is behavior testing of the controller (validation + delegation). Good.

Also, add the filter to the testing module: `overrideProvider`? For the filter test, instantiate ApiEnvelopeFilter directly with a fake host — no module needed:
```ts
function jsonResponse(): { status: (code: number) => { json: (body: unknown) => void }; statusCode: number; body: unknown } {
  const state = { statusCode: 0, body: undefined as unknown };
  return {
    state,
    status(code: number) { state.statusCode = code; return { json(body: unknown) { state.body = body; } }; },
  };
}
```
Hmm, Nest's response: `res.status(404).json(...)` — a chained mock. Then `host.switchToHttp().getResponse()` → the mock. `new ApiEnvelopeFilter().catch(err, host as any)`? Type ArgumentsHost — build a fake: `{ switchToHttp: () => ({ getResponse: () => mockRes }) }` cast as ArgumentsHost. ✓

Filter test cases:
- ApiError (ProductNotFoundError) → 404 envelope, code product_not_found, details {product_id}.
- Unknown error (new Error('boom')) → 500 envelope, internal_error.
- Generic HttpException (e.g., new HttpException('Bad input', 400)) → envelope code 'http_error' 400. (Behavior: no raw Nest errors escape.)

But the filter's console.error on unknown — vitest will show output; tolerable. I can silence it with a spy: `vi.spyOn(console, 'error').mockImplementation(() => {})` in that test. Import vi from vitest. ✓

Now — the controller test module:
```ts
const moduleRef = await Test.createTestingModule({
  controllers: [ClassificationController],
  providers: [{ provide: ClassificationService, useValue: serviceStub }],
}).compile();
const controller = moduleRef.get(ClassificationController);
```
`moduleRef.get(ClassificationController)` — typed as ClassificationController ✓.

Assertions:
- `await controller.createProduct({ name: 'Cream', ingredients: ['Aqua', 'Oil'] })` → returns stub's return; `calls.createProduct` deep-equals the same.
- Invalid: `await expect(controller.createProduct({ name: '', ingredients: [] })).rejects.toMatchObject({ code: 'invalid_request' })` — rejects.toMatchObject works on the thrown error object ✓ (rejects unwraps the reason).
- `controller.classify({ product_id: 'p1', profile_id: 'pf1' })` → calls.classify = { productId: 'p1', profileId: 'pf1' }.
- `controller.classify('p1')` (body not an object) → rejects invalid_request.
- `controller.publishMethodologyVersion({ code: '2025.1', rules: [{ ingredient: 'Limonene', severity: 'watch', source: 'x' }] })` → calls.publishVersion deep-equals { code, rules: [{ingredient:'Limonene', severity:'watch', source:'x'}] }.
- Bad severity → rejects code 'invalid_severity'.
- `controller.listClassifications('p1', undefined)` → calls { productId: 'p1', methodologyVersionId: undefined }; missing product_id → rejects.

Wait — the controller method signatures take raw parameters; calling directly is fine.

Now the service test with buildService:

```ts
describe('ClassificationService', () => {
  const repo = new FakeClassificationRepository(makeSeed());
  const service = new ClassificationService(repo);
```
But `new ClassificationService(repo)` — repo is a FakeClassificationRepository → assignable to ClassificationRepository? The fake's public members: prisma ✓, all methods ✓. The repository class — any private? We chose `constructor(readonly prisma: PrismaService) {}` public + public methods ✓. So the fake is assignable ✓.

Test 1 — resolution:
```ts
it('resolves case, accents, OCR typos and synonyms to canonical ingredients', async () => {
  const { id: product } = await service.createProduct('Night cream', ['Retinyl  Palmitate', 'T0COPHEROL', 'Caféine', 'Salixylic Acid', 'BHA']);
  const result = await service.classify(product);
  const byInput = new Map(result.ingredients.map((f) => [f.input, f]));
  expect(byInput.get('Retinyl  Palmitate')?.resolved).toBe('Retinyl palmitate');
  expect(byInput.get('T0COPHEROL')?.resolved).toBe('Tocopherol');
  expect(byInput.get('Caféine')?.resolved).toBe('Caffeine');
  expect(byInput.get('Salixylic Acid')?.resolved).toBe('Salicylic acid');
  expect(byInput.get('BHA')?.resolved).toBe('Salicylic acid');
  expect(result.unknowns).toEqual([]);
  expect(result.confidence).toBe(1);
});
```
Wait, "BHA" is a synonym for Salicylic acid — a raw "BHA" is normalized to "bha" ✓.

Note: `createProduct` returns {id, name} ✓.

Test 2 — base rules:
```ts
it('flags ingredients per the active methodology with severity and citation', async () => {
  const { id } = await service.createProduct('Test cream', ['Aqua', 'Retinyl palmitate', 'Tocopherol']);
  const result = await service.classify(id);
  const retinyl = result.ingredients.find((f) => f.input === 'Retinyl palmitate')!;
  expect(retinyl).toMatchObject({ status: 'flagged', flagged: true, severity: 'watch', source: 'Curated watch list, 2024-01' });
  const aqua = result.ingredients.find((f) => f.input === 'Aqua')!;
  expect(aqua).toMatchObject({ status: 'clear', flagged: false, severity: null, source: null });
  expect(result.summary).toEqual({ watch: 1, restricted: 0, banned: 0 });
  expect(result.disclaimer).toBeTruthy();
  expect(JSON.stringify(result)).not.toMatch(/"safe"|"toxic"/);
});
```
The last assertion: no binary verdict — cute; keep? A `toMatch` negative — the disclaimer doesn't contain "safe"/"toxic"... The disclaimer contains "safe"! "…does not mean a product is safe." So the regex would match. Change the assertion: ensure there's no top-level verdict field: `expect(result).not.toHaveProperty('safe')` and `not.toHaveProperty('toxic')`. Good.

Test 3 — profile toggles:
Use the seeded NIGHT_CREAM.
```ts
it('profile modifiers tighten findings (escalate and introduce new flags)', async () => {
  const base = await service.classify(NIGHT_CREAM);
  const limoneneBase = base.ingredients.find((f) => f.resolved === 'Limonene')!;
  expect(limoneneBase).toMatchObject({ status: 'clear', flagged: false });

  const child = await service.classify(NIGHT_CREAM, CHILD_PROFILE);
  const limoneneChild = child.ingredients.find((f) => f.resolved === 'Limonene')!;
  expect(limoneneChild).toMatchObject({ status: 'flagged', flagged: true, severity: 'restricted', origin: 'profile_modifier', source: 'AAP position paper, 2023' });
  expect(child.profile).toEqual({ id: CHILD_PROFILE, name: 'child_under_3' });
  expect(child.summary.restricted).toBeGreaterThan(base.summary.restricted);

  const pregnancy = await service.classify(NIGHT_CREAM, PREGNANCY_PROFILE);
  const retinyl = pregnancy.ingredients.find((f) => f.resolved === 'Retinyl palmitate')!;
  const retinylBase = base.ingredients.find((f) => f.resolved === 'Retinyl palmitate')!;
  expect(retinylBase.severity).toBe('watch');
  expect(retinyl).toMatchObject({ severity: 'banned', base_severity: 'watch', origin: 'profile_modifier', source: 'FDA 2023 advisory on retinoids' });
});
```
And profile-not-found:
```ts
it('rejects an unknown profile', async () => {
  await expect(service.classify(NIGHT_CREAM, 'nope')).rejects.toMatchObject({ code: 'profile_not_found' });
});
```

Test 4 — unknowns:
```ts
it('lists unknown ingredients and lowers confidence', async () => {
  const result = await service.classify(NIGHT_CREAM);
  const unknownFinding = result.ingredients.find((f) => f.input === 'Mystery Butter X')!;
  expect(unknownFinding).toMatchObject({ status: 'unknown', flagged: false, severity: null, resolved: null });
  expect(result.unknowns).toContain('mystery butter x');

  const { id: known } = await service.createProduct('Known only', ['Aqua', 'Tocopherol']);
  const knownResult = await service.classify(known);
  expect(knownResult.confidence).toBe(1);
  expect(result.confidence).toBeLessThan(knownResult.confidence);
  expect(result.confidence).toBeCloseTo(5 / 6);
});
```
`toBeCloseTo(5/6)` defaults to 2 decimals: 0.8333 vs 0.83333 — diff ~0.00003 < 0.005 ✓. Actually use toBeCloseTo(0.8333, 3)? 5/6=0.833333; the stored value is 0.8333; diff 0.000033 → toBeCloseTo(5/6) with 2 decimals: |0.8333 - 0.833333| = 0.0000333 < 0.005 ✓. Keep it simple: expect(result.confidence).toBe(0.8333). 5/6 = 0.833333 → round4 = 0.8333 ✓ exact. Use toBe(0.8333).

Test 5 — determinism:
```ts
it('is identical across reruns and across shuffled ingredient order', async () => {
  const first = await service.classify(NIGHT_CREAM);
  const second = await service.classify(NIGHT_CREAM);
  expect(second).toEqual(first);

  const shuffled = await service.classify(SHUFFLED_PEELING);
  expect(shuffled.ingredients).toEqual(first.ingredients);
  expect(shuffled.unknowns).toEqual(first.unknowns);
  expect(shuffled.confidence).toBe(first.confidence);
  expect(shuffled.summary).toEqual(first.summary);
});
```
SHUFFLED_PEELING = the same ingredients as NIGHT_CREAM but shuffled. But `second` vs `first` — does the response include product_id? Same product, equal ✓. Also `methodology_version` is equal ✓. toEqual on the whole object — deep equality on arrays/objects ✓. Note: `toEqual` ignores undefined properties; fine.

But wait — the stored payload: also assert on idempotent storage:
```ts
const stored = await service.listStoredResults(NIGHT_CREAM);
expect(stored).toHaveLength(1);
expect(stored[0].payload).toEqual(first);
```
Hmm — the stored payload is the base response (profile null) = first (called without a profile) ✓. Wait: classify stores `base` (profile null) — `first` is returned without a profile → `first === base` reference. toEqual ✓.

Test 6 — version coexistence + idempotent re-scoring:
```ts
it('rescores products on publish, idempotently, and keeps previous results', async () => {
  const before = await service.classify(NIGHT_CREAM);
  expect(before.methodology_version).toBe('2024.1');
  expect(before.ingredients.find((f) => f.resolved === 'Limonene')!.status).toBe('clear');

  const published = await service.publishVersion({
    code: '2024.2',
    rules: [
      { ingredient: 'Limonene', severity: 'watch', source: 'Curated watch list, 2024-02' },
      { ingredient: 'Retinyl palmitate', severity: 'restricted', source: 'Curated watch list, 2024-02' },
    ],
  });
  expect(published).toMatchObject({ code: '2024.2', status: 'active', rescanned_products: 3 }); // seeded 2 products + created?
```
Hmm, rescanned_products depends on products created in earlier tests (each `it` creates products on the shared repository!). A shared repository across `it`s in the same describe — state accumulates. To keep the count deterministic, either build a fresh repository per test or make assertions count-agnostic (`rescanned_products` ≥ 2 / toBeGreaterThan(0)). Use a fresh repository per test block where the count matters: inside that test, `const repo2 = new FakeClassificationRepository(makeSeed()); const service2 = new ClassificationService(repo2);` — deterministic: seed 2 products → rescanned_products = 2. Do that for the version test for isolation. The other tests can share the repo (assertions are per-product). But test 5's stored length 1 for NIGHT_CREAM: shared repo — has NIGHT_CREAM been classified in earlier tests? Test 3 classified NIGHT_CREAM (stored once, same key) → still 1 ✓. Test 4 also classifies NIGHT_CREAM → still 1 ✓ (upsert). OK, shared is safe. But cleaner: a fresh repository per test via a beforeEach helper. Hmm — but tests 5/6 want a seeded product; the seed provides them. Fresh repository per test = isolated & deterministic. Let me do:
```ts
function newService() { return new ClassificationService(new FakeClassificationRepository(makeSeed())); }
```
Each `it` builds its own. Slight duplication but robust. Actually, use a `let service` + `beforeEach(() => { service = newService(); })`. Clean. The controller/filter tests don't need the repository.

Continuing the version test (fresh service):
```ts
  expect(published.rescanned_products).toBe(2);

  const after = await service.classify(NIGHT_CREAM);
  expect(after.methodology_version).toBe('2024.2');
  expect(after.ingredients.find((f) => f.resolved === 'Limonene')!.severity).toBe('watch');
  expect(after.ingredients.find((f) => f.resolved === 'Retinyl palmitate')!.severity).toBe('restricted');

  const stored = await service.listStoredResults(NIGHT_CREAM);
  expect(stored).toHaveLength(2);
  const v1 = stored.find((r) => r.methodologyVersionCode === '2024.1')!;
  const v2 = stored.find((r) => r.methodologyVersionCode === '2024.2')!;
  expect((v1.payload as any).methodology_version).toBe('2024.1');
  expect((v1.payload as any).ingredients.find((f: any) => f.resolved === 'Limonene').status).toBe('clear');
  expect((v2.payload as any).ingredients.find((f: any) => f.resolved === 'Limonene').status).toBe('flagged');
  expect(await service.listStoredResults(NIGHT_CREAM, 'v-1'...
```
Filtering by version ID: I need the version ID — V1's id in the seed: 'v-1' constant. Add to the fixtures: export const V1 = 'v-1', V2_CODE... The seed's version id: v1's id is 'version-2024.1'. Export const V1_ID = 'version-2024.1'. Then:
```ts
  const onlyV1 = await service.listStoredResults(NIGHT_CREAM, V1_ID);
  expect(onlyV1).toHaveLength(1);
  expect(onlyV1[0].methodologyVersionCode).toBe('2024.1');
```

Idempotent re-scoring:
```ts
  const countAfterFirstRescore = repoResultCount?
```
The service doesn't expose rescoreVersion publicly — the test can call `service.rescoreVersion(published.id)` (public method ✓ — I made rescoreVersion public on the service).
```ts
  await service.rescoreVersion(published.id);
  const afterSecond = await service.rescoreVersion(published.id);
  expect(afterSecond).toBe(2);
  const storedAgain = await service.listStoredResults(NIGHT_CREAM);
  expect(storedAgain).toHaveLength(2);
  const v2Again = storedAgain.find((r) => r.methodologyVersionCode === '2024.2')!;
  expect(v2Again.payload).toEqual(v2.payload);
```
✓ idempotent: no duplicate rows, identical payload.

Republishing the same code:
```ts
it('rejects publishing the same methodology code twice', async () => {
  ...
  await expect(service.publishVersion({ code: '2024.1', rules: [] })).rejects.toMatchObject({ code: 'methodology_version_exists' });
});
```

Publishing with an unknown ingredient in the rules:
```ts
  await expect(service.publishVersion({ code: 'x', rules: [{ ingredient: 'Unobtainium', severity: 'watch', source: 's' }] })).rejects.toMatchObject({ code: 'unknown_ingredient_in_rule' });
```
And that the active methodology doesn't change? Assert classify still returns 2024.1 — optional; include: `expect((await service.classify(NIGHT_CREAM)).methodology_version).toBe('2024.1')`. Good behavior.

Test — no active methodology:
```ts
it('errors when no methodology version is active', async () => {
  const repo = new FakeClassificationRepository(makeSeed());
  const service = new ClassificationService(repo);
  // no active version in the seed variant
```
Need a seed with zero active versions: the default makeSeed has v1 active. Add a parameter? `makeSeed({ activeVersion: null })`? Or a small inline override: build the seed via makeSeed() and mutate before the repository? The seed is internal to the repository. Add a makeSeed option: `makeSeed(options?: { withActiveVersion?: boolean })` default true; if false, mark v1 as retired.
```ts
const repo = new FakeClassificationRepository(makeSeed({ withActiveVersion: false }));
await expect(new ClassificationService(repo).classify(NIGHT_CREAM)).rejects.toMatchObject({ code: 'no_active_methodology' });
```

Test — product not found:
```ts
await expect(service.classify('missing')).rejects.toMatchObject({ code: 'product_not_found' });
```

Now — one gotcha: `rejects.toMatchObject` on a thrown ApiError instance: toMatchObject matches against the object's own properties (code) ✓; does it walk the prototype? toMatchObject checks that the received object has at least the properties of the expected — own or inherited? It uses recursive equality on the enumerable properties; an instance's `code` is an own property (readonly parameter → own) ✓. The HttpException's `getStatus` method is irrelevant.

## fixtures.ts, exactly

```ts
import { ClassificationService } from '../src/classification/classification.service.js';
import { FakeClassificationRepository, SeedData } from './fake-repository.js';

export const NIGHT_CREAM = 'product-night-cream';
export const PEELING_GEL = 'product-peeling-gel';
export const SHUFFLED_NIGHT_CREAM = 'product-night-cream-shuffled';
export const V1 = 'version-2024.1';
export const CHILD_PROFILE = 'profile-child-under-3';
export const PREGNANCY_PROFILE = 'profile-pregnancy';

const INGREDIENTS = {
  aqua: 'ing-aqua',
  caffeine: 'ing-caffeine',
  limonene: 'ing-limonene',
  salicylic: 'ing-salicylic-acid',
  tocopherol: 'ing-tocopherol',
  retinyl: 'ing-retinyl-palmitate',
  benzoyl: 'ing-benzoyl-peroxide',
};

export const NIGHT_CREAM_INCI = ['Aqua', 'Retinyl  Palmitate', 'T0COPHEROL', 'Limonene', 'Caféine', 'Mystery Butter X'];

export interface SeedOptions { withActiveVersion?: boolean }

export function makeSeed(options: SeedOptions = {}): SeedData {
  const active = options.withActiveVersion !== false;
  return {
    ingredients: [
      { id: INGREDIENTS.aqua, name: 'Aqua', synonyms: ['water'] },
      { id: INGREDIENTS.caffeine, name: 'Caffeine', synonyms: ['cafeine'] },
      { id: INGREDIENTS.limonene, name: 'Limonene', synonyms: [] },
      { id: INGREDIENTS.salicylic, name: 'Salicylic acid', synonyms: ['salixylic acid', 'bha', 'beta-hydroxy acid'] },
      { id: INGREDIENTS.tocopherol, name: 'Tocopherol', synonyms: ['t0copherol', 'vitamin e'] },
      { id: INGREDIENTS.retinyl, name: 'Retinyl palmitate', synonyms: ['retinyl-palmitate'] },
      { id: INGREDIENTS.benzoyl, name: 'Benzoyl peroxide', synonyms: [] },
    ],
    versions: [
      {
        id: V1,
        code: '2024.1',
        status: active ? 'active' : 'retired',
        rules: [
          { ingredientId: INGREDIENTS.benzoyl, severity: 'restricted', source: 'EU Reg 1223/2009, Annex III, 315-1' },
          { ingredientId: INGREDIENTS.retinyl, severity: 'watch', source: 'Curated watch list, 2024-01' },
          { ingredientId: INGREDIENTS.salicylic, severity: 'watch', source: 'Curated watch list, 2024-01' },
        ],
      },
    ],
    profiles: [
      {
        id: CHILD_PROFILE,
        name: 'child_under_3',
        modifiers: [
          { profileId: CHILD_PROFILE, ingredientId: INGREDIENTS.limonene, severity: 'restricted', source: 'AAP position paper, 2023', reason: 'Strong fragrance; skin sensitivity in young children.' },
          { profileId: CHILD_PROFILE, ingredientId: INGREDIENTS.retinyl, severity: 'banned', source: 'FDA 2023 advisory on retinoids', reason: 'Retinoids are avoided for children.' },
        ],
      },
      {
        id: PREGNANCY_PROFILE,
        name: 'pregnancy',
        modifiers: [
          { profileId: PREGNANCY_PROFILE, ingredientId: INGREDIENTS.retinyl, severity: 'banned', source: 'FDA 2023 advisory on retinoids', reason: 'Retinoids are contraindicated in pregnancy.' },
        ],
      },
    ],
    products: [
      { id: NIGHT_CREAM, name: 'Night cream', ingredients: NIGHT_CREAM_INCI },
      { id: PEELING_GEL, name: 'Peeling gel', ingredients: ['Salixylic Acid', 'Aqua', 'T0COPHEROL'] },
      { id: SHUFFLED_NIGHT_CREAM, name: 'Night cream (re-entered)', ingredients: [...NIGHT_CREAM_INCI].reverse() },
    ],
  };
}

export function buildService(options: SeedOptions = {}): { service: ClassificationService; repository: FakeClassificationRepository } {
  const repository = new FakeClassificationRepository(makeSeed(options));
  return { service: new ClassificationService(repository), repository };
}
```

Note: the fake's SeededModifier includes profileId — the fake's ProfileView drops it on read ✓ (the modifiers map to {ingredientId, severity, source, reason}). The seed type SeededModifier requires profileId — I included it ✓.

Hmm — a fake's seed product with a raw with double spaces "Retinyl  Palmitate" ✓ preserved.

Also note: the child profile modifier on retinyl banned: in the pregnancy test, the base retinyl watch → banned ✓.

## Wait — check the profile test's expected `child.summary.restricted`

NIGHT_CREAM base: retinyl watch, salicylic? NIGHT_CREAM has no salicylic. Base flags: retinyl (watch). summary base = {watch:1, restricted:0, banned:0}. Child profile: Limonene → restricted, retinyl watch→banned. Final summary: {watch:0, restricted:1, banned:1}. `child.summary.restricted (1) > base.summary.restricted (0)` ✓.

Pregnancy: retinyl → banned; Limonene remains clear. ✓

## re-verify the determinism test with a fresh repository per test (beforeEach)

Test 5 uses NIGHT_CREAM and SHUFFLED_NIGHT_CREAM — fresh repository ✓. `first` = classify(NIGHT_CREAM) — includes product_id NIGHT_CREAM. `second` is equal ✓. `shuffled` compared by slice ✓.

## Another check: "same product identical between re-runs" — also verify the storage: the second classify upserts; stored payload is identical. Assert via listStoredResults length 1 + payload equal.

## The payload saved by rescore uses the version code — in the rescoreVersion after publish, version.code = '2024.2' ✓.

## Potential TS strict issues in the fake

`readonly prisma = undefined as unknown as PrismaService;` — `import type { PrismaService } from '../src/prisma/prisma.service.js';` ✓ type-only import.

The fake's method return types need to match the repository: e.g., `findProductWithIngredients(id: string): Promise<ProductRow | null>` — import the type from the repository module (type-only import) ✓. But wait — the fake file imports types from `../src/classification/classification.repository.js` — type-only, erased ✓. And the value imports from `../src/common/api-error.js` (for throwing in publishVersion) — does the api-error module import @nestjs/common?? Yes (ArgumentsHost, etc.) — a runtime import in the test → imports @nestjs/common in the test process — fine (it's a dependency; no prisma). OK.

Does the fake need to throw MethodologyVersionExistsError? The service pre-checks the code; the fake's re-check is belt-and-suspenders. Throw a plain ApiError? Use MethodologyVersionExistsError imported from api-error ✓.

Also, the fake's `publishVersion` — should it validate the ingredient's existence? The service guarantees it; the fake can skip. Keep the fake minimal but mirror the main behavior (retirement, push, return the view).

## The fake's `createProduct` — also used in the service test (creates a product, then classifies). ✓.

## Now — the repository's `findMethodologyByCode` return includes status; the service only checks existence.

## Edge: `listProducts` order — the rescore loop is sequential; deterministic payload is per-product; no cross-product interference ✓.

## Check: `classify` upserts before the profile application — the stored payload is base regardless of the profile ✓ (requirement: key (product, version)).

## API: `GET /classifications` returns StoredResultView[] with payload: unknown (Json) ✓.

## Also confirm that the "endpoint kebab-case, plural" naming is satisfied: /products ✓, /classifications ✓, /methodology-versions ✓.

## package.json final

```json
{
  "name": "ingredient-classifier",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Classifies cosmetics from INCI ingredient lists against versioned, immutable methodology rules and family profile modifiers.",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "tsx prisma/seed.ts"
  },
  "prisma": { "seed": "tsx prisma/seed.ts" },
  "dependencies": {
    "@nestjs/common": "^10.3.9",
    "@nestjs/core": "^10.3.9",
    "@nestjs/platform-express": "^10.3.9",
    "@prisma/client": "^5.16.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.3.9",
    "@types/node": "^20.14.9",
    "prisma": "^5.16.1",
    "tsx": "^4.16.2",
    "typescript": "^5.5.3",
    "vitest": "^1.6.0"
  }
}
```
postinstall? Without generate, `node dist` fails at the @prisma/client import — but `prisma generate` needs the engine (fetched by the prisma package at install? the engine is downloaded at generate time or install time). Add `"postinstall": "prisma generate"` — standard. Add it.

Hmm, does `tsc` type-check prisma/seed.ts? tsconfig's include is only src — the seed is type-checked by tsx (no check) — fine.

Vitest 1.6 + TS: vitest transforms TS via esbuild ✓. `import 'reflect-metadata'`? Not needed for the service tests (no DI). The controller test via @nestjs/testing — does Nest use reflect metadata for DI even in a testing module? Yes, Nest's compiler uses design:paramtypes via reflect-metadata — @nestjs/common imports reflect-metadata itself? The @nestjs/core package has `import 'reflect-metadata'` at the entry? Actually, NestJS docs: install reflect-metadata; does @nestjs/core import it? In Nest 10, `@nestjs/core` has reflect-metadata as a dependency and imports it? Hmm — I recall that in modern versions, importing @nestjs/core auto-loads reflect-metadata (since v9 it's imported in core's index). For safety, in the spec: first line `import 'reflect-metadata';`. Cheap insurance.

## tsconfig final
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```
`useDefineForClassFields: false` — important for Nest DI with parameter properties (the class fields metadata) — Nest's docs recommend this for ESM. ✓ Keep.

`strict: true` with noUncheckedIndexedAccess off — the default is off; skip the explicit.

noImplicitOverride — the fake's methods "override" nothing (not extending) ✓.

## Migration name: `20240601000000_init`.

## Now, let me re-verify the service's `publishVersion` return: the test's matchObject `rescanned_products: 2` — the seed has 2 products (night cream, peeling gel, shuffled) — wait, the seed has 3 products! NIGHT_CREAM, PEELING_GEL, SHUFFLED_NIGHT_CREAM → rescanned_products = 3. Fix the test expectation to 3.

Also, the "rejects unknown ingredient in rules" test — the code 'unknown_ingredient_in_rule', details.ingredients ['Unobtainium'] — assert the details too? matchObject({ code: 'unknown_ingredient_in_rule', details: { ingredients: ['Unobtainium'] } }) — toMatchObject on nested objects ✓.

## Re-check: the controller's `@Query('product_id') productId?: string` — Nest passes a string or undefined ✓.

## Re-check the filter's import of HttpStatus in api-error — used in the internal error branch ✓.

## Check: `ApiError extends HttpException` — HttpException's constructor (response, status) — passing an object → the response is stored; getStatus ✓; getResponse returns the object. In the filter, we short-circuit on ApiError anyway ✓.

## Check: Nest's global filter catches the errors thrown in controllers/services ✓.

## One more requirement: "rules grouped under immutable methodology versions" — immutability: enforce it? Add a guard: the service/repository doesn't offer mutation methods for a published version (no update endpoint). Document immutability in a comment + the publish transaction only creates. A rule update endpoint isn't exposed → effectively immutable via the API. Enough; note in a comment.

"ingredients + synonyms" ✓; "products with ingredient lists" ✓; "stored classification results keyed by (product, methodologyVersion)" ✓ unique constraint.

## Let me reconsider: should classify's response also include the stored result's id? Not needed.

## Now — let me write the spec completely and carefully. Also verify `Test.createTestingModule`'s compile works with a stub service that has no decorators — useValue, so fine.

One concern: `Test.createTestingModule({ controllers: [ClassificationController], providers: [...] })` — the controller's constructor has a parameter property `readonly service: ClassificationService` (public!) → Nest DI uses design:paramtypes → ClassificationService (a class, resolvable) → the provider override is registered ✓.

The controller's public `service` member — harmless.

But — the service's public `repository` member + the fake's assignability ✓ established.

## Vitest + `.js` import specifiers: the spec imports `../src/classification/classification.controller.js` → the actual file is `.ts`. Vite/vitest resolution: I'm fairly confident Vite supports resolving `.js` to `.ts` for TS sources (the "TypeScript-style" resolution) — yes, Vite handles it (since Vite 4, `resolve.extensions` + a custom resolver handles the TS `allowImportingTsExtensions`-ish mapping; there's explicit support: "Vite resolves .js imports to .ts files when the importer is TS"). Many projects do this. Proceed.

If not — the alternative is to avoid the problem: use extensionless imports in src with `module: "esnext"`, and the build via tsup? No — I'm confident enough; the Nest+vitest combo works.

Hmm, actually let me re-verify: the Vitest issue "Cannot find module './foo.js'"... I recall Vite's resolver has logic: if the importer is TS and the specifier ends in .js, try .ts. Yes — Vite's `tryFsResolve` has a `isPossibleTsOutput` check that handles exactly this (added in Vite 3/4). Confident.

## The seed file needs `PrismaClient` — with a generated client; tsx executes TS directly ✓. Seed idempotency: use upserts; rules: on seed, if the version exists → skip the entire version block (check findUnique code first). Modifiers: upsert by unique (profileId, ingredientId). Products: findFirst by name.

Write the seed:

```ts
import { PrismaClient } from '@prisma/client';

/**
 * Baseline dataset for local development and demos. Idempotent: safe to run
 * repeatedly. This file is the source of the synonym/typo fixtures the
 * classifier resolves against.
 */
const prisma = new PrismaClient();

const SEVERITY = { watch: 'watch', restricted: 'restricted', banned: 'banned' } as const;

async function upsertIngredient(name: string, synonyms: string[]) {
  const ingredient = await prisma.ingredient.upsert({ where: { name }, update: {}, create: { name } });
  for (const term of synonyms) {
    await prisma.ingredientSynonym.upsert({
      where: { term },
      update: { ingredientId: ingredient.id },
      create: { ingredientId: ingredient.id, term },
    });
  }
  return ingredient;
}

async function findIngredient(name: string): Promise<{ id: string } | null> {
  return prisma.ingredient.findUnique({ where: { name } });
}

async function main() {
  const [aqua, caffeine, limonene, salicylic, tocopherol, retinyl, benzoyl] = await Promise.all([
    upsertIngredient('Aqua', ['water']),
    upsertIngredient('Caffeine', ['cafeine']),
    upsertIngredient('Limonene', []),
    upsertIngredient('Salicylic acid', ['salixylic acid', 'bha', 'beta-hydroxy acid']),
    upsertIngredient('Tocopherol', ['t0copherol', 'vitamin e']),
    upsertIngredient('Retinyl palmitate', ['retinyl-palmitate']),
    upsertIngredient('Benzoyl peroxide', []),
  ]);

  const version = await prisma.methodologyVersion.findUnique({ where: { code: '2024.1' } });
  if (!version) {
    const active = await prisma.methodologyVersion.findUnique({ where: { status: 'active' } });
    if (active) await prisma.methodologyVersion.update({ where: { id: active.id }, data: { status: 'retired' } });
    await prisma.methodologyVersion.create({
      data: {
        code: '2024.1',
        status: 'active',
        publishedAt: new Date(),
        rules: {
          create: [
            { ingredientId: benzoyl.id, severity: 'restricted', source: 'EU Reg 1223/2009, Annex III, 315-1' },
            { ingredientId: retinyl.id, severity: 'watch', source: 'Curated watch list, 2024-01' },
            { ingredientId: salicylic.id, severity: 'watch', source: 'Curated watch list, 2024-01' },
          ],
        },
      },
    });
  }

  const child = await prisma.familyProfile.upsert({ where: { name: 'child_under_3' }, update: {}, create: { name: 'child_under_3', description: 'Child under 3 years old.' } });
  for (const modifier of [
    { ingredientId: limonene.id, severity: 'restricted' as const, source: 'AAP position paper, 2023', reason: 'Strong fragrance; skin sensitivity in young children.' },
    { ingredientId: retinyl.id, severity: 'banned' as const, source: 'FDA 2023 advisory on retinoids', reason: 'Retinoids are avoided for children.' },
  ]) {
    await prisma.profileModifier.upsert({
      where: { profileId_ingredientId: { profileId: child.id, ingredientId: modifier.ingredientId } },
      update: modifier,
      create: { profileId: child.id, ...modifier },
    });
  }

  const pregnancy = await prisma.familyProfile.upsert({ where: { name: 'pregnancy' }, update: {}, create: { name: 'pregnancy', description: 'Pregnancy or breastfeeding.' } });
  await prisma.profileModifier.upsert({
    where: { profileId_ingredientId: { profileId: pregnancy.id, ingredientId: retinyl.id } },
    update: { severity: 'banned' as const, source: 'FDA 2023 advisory on retinoids', reason: 'Retinoids are contraindicated in pregnancy.' },
    create: { profileId: pregnancy.id, ingredientId: retinyl.id, severity: 'banned', source: 'FDA 2023 advisory on retinoids', reason: 'Retinoids are contraindicated in pregnancy.' },
  });

  const products: Array<{ name: string; inci: string[] }> = [
    { name: 'Night cream', inci: ['Aqua', 'Retinyl  Palmitate', 'T0COPHEROL', 'Limonene', 'Caféine', 'Mystery Butter X'] },
    { name: 'Peeling gel', inci: ['Salixylic Acid', 'Aqua', 'T0COPHEROL'] },
  ];
  for (const product of products) {
    const existing = await prisma.product.findFirst({ where: { name: product.name } });
    if (!existing) {
      await prisma.product.create({
        data: {
          name: product.name,
          ingredients: { create: product.inci.map((rawName, i) => ({ position: i + 1, rawName })) },
        },
      });
    }
  }

  const counts = await Promise.all([
    prisma.ingredient.count(),
    prisma.ingredientSynonym.count(),
    prisma.methodologyVersion.count(),
    prisma.familyProfile.count(),
    prisma.product.count(),
  ]);
  // eslint-disable-next-line no-console
  console.log(`Seeded: ${counts[0]} ingredients, ${counts[1]} synonyms, ${counts[2]} methodology versions, ${counts[3]} profiles, ${counts[4]} products.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```
`findUnique` on methodologyVersion with status — the unique on status ✓.

`const SEVERITY` is unused — remove.

Wait — the seed's `status: 'active'` — the enum string is OK.

Also, the nested `ingredients: { create: ... }` in the product create ✓.

## Verify: the prisma schema's `ProductIngredient.position Int` — the migration is INTEGER ✓.

## Now the fake's `publishVersion` retirement loop — the seeded V1 is active → publishing 2024.2 retires V1 ✓. Then `findActiveMethodology` returns 2024.2 ✓.

## In the coexistence test, `before` is classified under v1 before publish — stored. After publish, the rescore upserts v2's result for both seed products (3 products including shuffled) ✓. The `stored` length for NIGHT_CREAM = 2 ✓.

## Also, confirm the rescore upserts for SHUFFLED_NIGHT_CREAM etc. — irrelevant.

## Now — let me also think about the requirement "apply the active methodology's base rules, then apply the profile's context modifiers in the defined precedence" — precedence is documented: base first, then profile modifiers override (tighten-only). ✓ Comment in the service.

"Overall confidence" ✓. "Disclaimer" ✓. "No binary safe/toxic verdict" ✓ (the disclaimer explicitly disclaims; no boolean verdict field; the test asserts absence of the property).

## The test "unknown ingredients are visible" — the unknowns list + the finding status ✓.

I think the design is solid. Now let me write out all the files completely and carefully, watching for TS strict errors:

Potential strict issues:
1. Service's `findings` map callback returns objects with differing shapes (an unknown branch without some properties) — both branches must return a complete ClassificationFinding; I write all properties in both branches ✓.
2. `summary[f.severity] += 1` with f.severity non-null — TS: `if (f.severity) summary[f.severity]` ✓ (f.severity is Severity).
3. The controller's `severity as RuleDraft['severity']` ✓.
4. The fake's `status: 'active' as const` in a push object — the versions array type expects 'draft'|'active'|'retired' ✓.
5. `new Map(seed.products.map(p => [p.id, {...}]))` — Map constructor from an array of tuples: TS needs `as const` or an explicit type: `new Map<string, ProductShaped>(seed.products.map((p) => [p.id, {...}]))` — the tuple inference: the array literal `[p.id, {...}]` is inferred as `(string | {...})[]`, not a tuple → the Map constructor expects Iterable<readonly [string, T]>. Fix: `seed.products.map((p) => [p.id, {...}] as const)` or explicit generics: `new Map<string, X>(seed.products.map((p) => [p.id, { ... }]))` — with the explicit generic, the callback's return must be [string, X]; does contextual typing make the array literal a tuple? If the target is `Iterable<readonly [string, X]>`, the map callback's return type is contextually... Map's constructor signature: `new <K, V>(iterable: Iterable<readonly [K, V]>)` — with explicit type arguments, the callback is contextually typed to return readonly [K,V] → the array literal is checked as a tuple ✓. So write `new Map<string, FakeProduct>(seed.products.map(...))` with the interface defined. Simpler: build the map with a loop. I'll use explicit generics + a named interface to be safe.

6. The fake's `findResultsByProduct` mapping worstSeverity: keep `r.worstSeverity` (Severity | null) ✓.

7. `import type { PrismaService }` — a type-only import from a module that has value exports — fine.

8. The service file's exports + the controller imports `ClassificationService, RuleDraft` — RuleDraft is an interface → a value+type mixed import: `import { ClassificationService } from '…'` is a value import; `import type { RuleDraft }`? With `isolatedModules`? I didn't enable it; verbatimModuleSyntax is off → a normal import of a type is fine (erased). But a mixed `import { ClassificationService, RuleDraft }` — allowed (RuleDraft is used only as a type; TS erases it). OK, but for cleanliness: use `import { ClassificationService } from …; import type { RuleDraft } from …`. Either works; I'll use a separate type import where appropriate (a good habit).

9. The fake's `private seq` is incremented in nextId ✓.

10. The controller's `@Query('product_id')` parameter — Nest types it as any; my signature `productId?: string` ✓.

11. The `Test` import from '@nestjs/testing' in the spec ✓.

12. The `expect(...).rejects.toMatchObject` — vitest supports rejects.toMatchObject ✓.

13. The `console.error` spy: `vi.spyOn(console, 'error').mockImplementation(() => undefined)` then restore in `afterEach(() => vi.restoreAllMocks())`? Add the import of `afterEach`. I'll add it.

14. In the filter test, construct the host: `const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;` import type { ArgumentsHost } from '@nestjs/common'.

Now — one more consideration: **the service's `classify` upserts the result before returning the profile response** — if profileId is invalid → the 404 is thrown before the upsert (I moved the profile load earlier) ✓ good (no side effects on an error).

**The publish's rescore uses listProducts, which includes the product ingredients** ✓.

**Immutability**: no repository method mutates a published version/rules ✓ (publishVersion creates only; the retirement update only touches status — status is metadata, and the "immutable methodology version" refers to rules/content; the status transition is lifecycle). Fine.

Now, let me write the final file list:

1. `package.json`
2. `tsconfig.json`
3. `prisma/schema.prisma`
4. `prisma/migrations/20240601000000_init/migration.sql`
5. `prisma/migrations/migration_lock.toml`
6. `prisma/seed.ts`
7. `src/main.ts`
8. `src/app.module.ts`
9. `src/common/api-error.ts`
10. `src/prisma/prisma.module.ts`
11. `src/prisma/prisma.service.ts`
12. `src/classification/classification.module.ts`
13. `src/classification/classification.controller.ts`
14. `src/classification/classification.service.ts`
15. `src/classification/classification.repository.ts`
16. `test/fixtures.ts`
17. `test/fake-repository.ts`
18. `test/classification.spec.ts`

Re-check the naming convention for `src/common/api-error.ts`: kebab-case ✓ role... "api-error" — no .role. The layout only mandates the role suffix for feature files (module/controller/service/repository). Common infrastructure: `exception.filter.ts`? Hmm. To be maximally convention-compliant, name it `src/common/api-error.service.ts`? A "service" that's not a provider — misleading. Or `src/common/error-handling.filter.ts`? The main export is the filter... `api-error.filter.ts` with the ApiError class + the filter. That reads fine: "the api-error filter." I'll use `src/common/api-error.filter.ts`. And main.ts/app.module.ts match the layout exactly ✓.

Import paths update accordingly.

Now let me also decide the return type of the controller methods: omit explicit return types (inferred) — fine.

Re-check that `objectBody` rejects arrays ✓.

`stringArray` — requires every element to be a non-empty string; empty array allowed? A product with zero ingredients → classify returns confidence 1, empty findings. Is that OK? Allow (no error). Fine.

GET with an empty string for product_id (query `?product_id=`) → nonEmptyString throws ✓.

Now — the repository's `upsertResult` `payload: input.payload as object` — actually, the type of Prisma's Json input: `JsonValue | Prisma.NullTypes.JsonNull`... `as Prisma.InputJsonValue`? Import the Prisma namespace: `import { Prisma } from '@prisma/client'` in the repository — adds a value import of @prisma/client (fine in src). Simpler: type the repository's UpsertResultInput.payload as `object` instead of unknown → then `payload: input.payload` is directly assignable to Json? Prisma expects `Prisma.InputJsonValue` — `object` is not assignable to InputJsonValue? InputJsonValue = string|number|boolean|InputJsonObject|InputJsonArray|null. `object` is not assignable (too wide). Use the Prisma namespace: `payload: Prisma.InputJsonValue`. In the repository: `import { Prisma } from '@prisma/client'`. UpsertResultInput { payload: Prisma.InputJsonValue }. The service passes a ClassificationResponse object — assignable to InputJsonValue? An object literal type with known properties → assignable to InputJsonObject (index signature? InputJsonObject requires {[key: string]: InputJsonValue} — does a typed interface without an index signature get assigned to it? TS structural: assigning an object type without an index signature to one with a string index signature: allowed if all properties are compatible... actually, object literal types (fresh) are checked; a non-fresh typed object: assignability to an index signature type requires the source to have a compatible implicit index signature — interface types don't get an implicit index signature (type aliases of object literals do!). ClassificationResponse is an interface → no implicit index signature → not assignable to InputJsonObject?? Hmm, this is a classic Prisma pain: passing an interface to a Json field errors. A workaround: `payload: input.payload as Prisma.InputJsonValue` — an assertion silences it ✓. Or define ClassificationResponse as a type alias (a type alias of an object literal gets an implicit index signature → assignable). Safer: cast at the repository call site: the repository's input type is `payload: object`, and in the prisma call cast `input.payload as Prisma.InputJsonValue`. The service passes a base object (interface type) → assignable to `object` ✓. Do that: the repository's input payload: object; the prisma call `payload: input.payload as Prisma.InputJsonValue`. Import Prisma ✓.

StoredResultView.payload: `Prisma.JsonValue | null`? Json is nullable? The payload is NOT NULL → JsonValue. Keep `unknown` for consumer simplicity — a mapping `payload: result.payload` (JsonValue → unknown ✓).

`confidence Float` ✓.

Now the Prisma import in the repository: `import { Prisma } from '@prisma/client';` used only as a type (Prisma.InputJsonValue) — a value import of a namespace that has runtime exports — fine (a side-effect import of the client — already imported by PrismaService anyway).

## The fake's `upsertResult` stores payload: unknown ✓.

## Check `ClassificationRepository`'s public member `prisma` — Nest's provider instantiation: ClassificationRepository is a provider in the module ✓, and PrismaService is available via the Global PrismaModule import ✓.

## app.module: PrismaModule is global — ClassificationModule imports [PrismaModule] explicitly? Global means no import needed, but explicit is fine/allowed. Keep the explicit import in the classification module (harmless, self-documenting).

## Now — let me write out the spec's controller section in full:

```ts
describe('ClassificationController (input validation and delegation)', () => {
  it('forwards a valid create-product body to the service', async () => {
    const { controller, calls } = await buildController();
    const body = { name: 'Cream', ingredients: ['Aqua', 'Oil of Evening Primrose'] };
    const result = await controller.createProduct(body);
    expect(result).toEqual({ id: 'p-new', name: 'Cream' });
    expect(calls.createProduct).toEqual(['Cream', ['Aqua', 'Oil of Evening Primrose']]);
  });
```
The stub records the arguments: `calls.createProduct = [name, ingredients]`.

```ts
  it('rejects malformed bodies with the error envelope code', async () => {
    const { controller } = await buildController();
    await expect(controller.createProduct({ name: '', ingredients: [] })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(controller.createProduct('oops')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(controller.classify({ product_id: '' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(controller.classify({ product_id: 'p1', profile_id: 42 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(controller.publishMethodologyVersion({ code: 'x', rules: [{ ingredient: 'Limonene', severity: 'meh', source: 's' }] })).rejects.toMatchObject({ code: 'invalid_severity' });
    await expect(controller.listClassifications('', undefined)).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('maps the classification request to service arguments', async () => {
    const { controller, calls } = await buildController();
    await controller.classify({ product_id: 'p1', profile_id: 'pf1' });
    expect(calls.classify).toEqual(['p1', 'pf1']);
  });

  it('maps publish rules to the service', async () => {
    const { controller, calls } = await buildController();
    await controller.publishMethodologyVersion({ code: '2025.1', rules: [{ ingredient: 'Limonene', severity: 'banned', source: 'Reg X' }] });
    expect(calls.publishVersion).toEqual({ code: '2025.1', rules: [{ ingredient: 'Limonene', severity: 'banned', source: 'Reg X' }] });
  });
});
```

buildController helper:
```ts
async function buildController() {
  const calls: Record<string, unknown> = {};
  const serviceStub = {
    createProduct: async (name: string, ingredients: string[]) => { calls.createProduct = [name, ingredients]; return { id: 'p-new', name }; },
    classify: async (productId: string, profileId?: string) => { calls.classify = [productId, profileId]; return { product_id: productId }; },
    publishVersion: async (input: { code: string; rules: unknown[] }) => { calls.publishVersion = input; return { code: input.code }; },
    listStoredResults: async (productId: string, versionId?: string) => { calls.listStoredResults = [productId, versionId]; return []; },
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [ClassificationController],
    providers: [{ provide: ClassificationService, useValue: serviceStub }],
  }).compile();
  return { controller: moduleRef.get(ClassificationController), calls };
}
```
Note: the stub's publishVersion input type is `{code, rules: unknown[]}` vs the service's RuleDraft[] — the DI override is unchecked, so fine.

The filter's describe:
```ts
describe('ApiEnvelopeFilter (single error envelope)', () => {
  afterEach(() => vi.restoreAllMocks());

  function envelope() {
    const state: { status: number; body: unknown } = { status: 0, body: undefined };
    const response = {
      status(code: number) { state.status = code; return { json: (body: unknown) => { state.body = body; } }; },
    };
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
    return { state, host };
  }

  it('renders ApiError as the documented envelope', async () => {
    const { state, host } = envelope();
    new ApiEnvelopeFilter().catch(new ProductNotFoundError('p-404'), host);
    expect(state.status).toBe(404);
    expect(state.body).toEqual({ error: { code: 'product_not_found', message: expect.any(String), details: { product_id: 'p-404' } } });
  });

  it('renders foreign HttpExceptions with the same envelope', () => {
    const { state, host } = envelope();
    new ApiEnvelopeFilter().catch(new HttpException('Invalid JSON', HttpStatus.BAD_REQUEST), host);
    expect(state.status).toBe(400);
    expect(state.body).toMatchObject({ error: { code: 'http_error', message: 'Invalid JSON' } });
  });

  it('falls back to internal_error for unexpected exceptions', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { state, host } = envelope();
    new ApiEnvelopeFilter().catch(new Error('boom'), host);
    expect(state.status).toBe(500);
    expect(state.body).toEqual({ error: { code: 'internal_error', message: expect.any(String), details: {} } });
  });
});
```
Import { HttpException, HttpStatus } from '@nestjs/common'; import type { ArgumentsHost }.

Wait — the first test: the thrown ProductNotFoundError — the filter's `exception instanceof ApiError` ✓.

## The service describe in full (with beforeEach):

```ts
describe('ClassificationService', () => {
  let service: ClassificationService;
  let repo: FakeClassificationRepository;

  beforeEach(() => {
    ({ service, repository: repo } = buildService());
  });

  it('resolves case variants, accents and OCR typos via synonyms', async () => { ... });
  it('flags ingredients using the active methodology with severity and citation', async () => {...});
  it('lists unknown ingredients and lowers confidence accordingly', async () => {...});
  it('profile modifiers tighten findings (new flag and escalation)', async () => {...});
  it('rejects an unknown profile with profile_not_found', async () => {...});
  it('rejects classification when no methodology is active', async () => {...});
  it('produces identical results across reruns and shuffled ingredient order', async () => {...});
  it('stores the profile-independent base result keyed by (product, version)', async () => {...});
  it('publishes a new version, rescoring all products idempotently while keeping prior results', async () => {...});
  it('rejects duplicate methodology codes and unknown rule ingredients', async () => {...});
  it('rejects classification of a missing product', async () => {...});
});
```

"stores the profile-independent base result" test:
```ts
const withProfile = await service.classify(NIGHT_CREAM, PREGNANCY_PROFILE);
const withoutProfile = await service.classify(NIGHT_CREAM);
const stored = await service.listStoredResults(NIGHT_CREAM);
expect(stored).toHaveLength(1);
expect(stored[0].payload).toEqual(withoutProfile);
const storedProfile = (stored[0].payload as ClassificationResponse).profile;
expect(storedProfile).toBeNull();
expect(withProfile.profile).toEqual({ id: PREGNANCY_PROFILE, name: 'pregnancy' });
```
The stored payload equals the base (profile null) even though a profile call happened ✓.

Now, in the publish test, the publish rules — use 'Limonene' and 'Retinyl palmitate' by name ✓ (resolved by name).

Also, verify the publish return includes `rescanned_products: 3`.

And a rescore idempotency assertion via `service.rescoreVersion(published.id)` twice.

`published.id` — the fake's version id 'version-2' (nextId sequence) — fine, use the returned id.

Now, `expect(stored).toHaveLength(2)` and the payload comparison `(v2.payload as ClassificationResponse)`.

Import ClassificationResponse type in the spec (type-only import) ✓.

## Let me re-check the service's `buildBaseClassification` signature parameters: (product: ProductRow, methodologyVersion: string, rules: RuleView[], index: Map<string, IndexedIngredient>).

rescoreVersion passes index built from ingredients ✓.

## Determinism check — `round4((total - unknownLines.length) / total)`: NIGHT_CREAM: 6 lines, 1 unknown → 5/6 = 0.833333… → 0.8333 ✓.

## `findings.sort` comparator — total order ✓.

## `unknowns` — unique sorted by `<`/`>` comparison ✓.

## `confidence` when total=0 → 1 — hmm, a product with no ingredients: confidence 1.0 and empty — defensible (nothing unknown). Keep it.

## Edge: `normalizeTerm('Caféine')` — 'é'.normalize('NFD') = 'e' + U+0301 → the diacritic regex strips ✓ → 'caffeine' ✓. Note: `\p{Diacritic}` requires the `u` flag ✓ (ES2018+ ✓).

## 'T0COPHEROL' → 't0copherol' → the synonym 't0copherol' ✓ (the stored synonym is already normalized; index normalizes on read anyway).

## 'Salixylic Acid' → 'salixylic acid' → synonym ✓.

## 'Retinyl  Palmitate' → 'retinyl palmitate' (whitespace collapse) → canonical ✓.

## 'BHA' → 'bha' → synonym ✓.

## 'Mystery Butter X' → 'mystery butter x' → unknown ✓.

## 'Aqua' → 'aqua' → canonical (Aqua) ✓.

## The child profile modifier on retinyl (banned): in the pregnancy test, retinyl base watch → banned ✓.

## The summary in the response after the profile: recomputed ✓.

## Now, let me confirm the fake's `classify` flow for the `no_active_methodology` seed variant: the seed with withActiveVersion false → v1 is retired → findActiveMethodology null → the error is thrown before touching the profile ✓.

## Also, the fake's `listProducts` order — seed order ✓ (a Map preserves insertion order).

## Re-check the repository's `createProduct` transaction return: `{ id, name }` ✓ the service returns it; the controller passes it through.

## main.ts's PORT parsing: `Number(process.env.PORT ?? 3000)` — if PORT is invalid → NaN → listen(NaN)? edge, fine.

## app.enableShutdownHooks + PrismaService's onModuleDestroy ✓.

## The PrismaModule global + the classification module's imports — both fine.

Now, is there anything in the task I've missed?

- "rules grouped under immutable methodology versions" ✓ (rules → version; no mutation path).
- "products with ingredient lists" ✓.
- "stored classification results keyed by (product, methodologyVersion)" ✓ unique.
- classify's output items ✓.
- "publishing a new methodology version triggers idempotent re-scoring of affected products" ✓ (all products — "affected" = every product with a classification? I rescore all products — a superset; idempotent ✓).
- "results from the previous version remain retrievable" ✓ GET filter.
- Tests: all 5 ✓ + additional behavior.
- Environment: DATABASE_URL via Prisma env ✓; PORT is env ✓; no secrets ✓.
- Migration ✓.
- Error envelope ✓ global filter.
- Wiring ✓ providers/exports: PrismaModule exports PrismaService; ClassificationModule providers: service + repository; controller declared ✓.

One more: "controller validates input and calls the service. Zero business logic." — my controller only does validation + delegation ✓. "service holds the logic. Zero raw SQL, zero Prisma client calls." — the service only calls the repository ✓. "repository is the sole layer touching the database" ✓.

Now — the file `test/fake-repository.ts` imports types from the repository module + the PrismaService type + error classes. Let me confirm all the types exist: Severity, ProductRow, MethodologyVersionView, RuleView, MethodologyVersionInput, IngredientInfo, ProfileView, StoredResultView, UpsertResultInput, MethodologyStatus.

The fake's `publishVersion(input: MethodologyVersionInput): Promise<MethodologyVersionView>` ✓.

The fake's `createProduct(name: string, rawIngredients: string[]): Promise<{ id: string; name: string }>` ✓.

Now, let me think about the TS complaint: the fake's `readonly prisma = undefined as unknown as PrismaService;` — `import type { PrismaService } from '../src/prisma/prisma.service.js';` ✓.

Also, `FakeClassificationRepository`'s constructor takes SeedData — the export interface SeedData with SeededVersion etc.

SeededVersion.status: 'draft' | 'active' | 'retired' — use MethodologyStatus type.

Now let me write the fake's file completely:

```ts
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { BadRequestError, MethodologyVersionExistsError } from '../src/common/api-error.filter.js';
import type {
  ClassificationRepository,
  IngredientInfo,
  MethodologyStatus,
  MethodologyVersionInput,
  MethodologyVersionView,
  ProfileView,
  ProductRow,
  RuleView,
  Severity,
  StoredResultView,
} from '../src/classification/classification.repository.js';

export interface SeededIngredient { id: string; name: string; synonyms: string[] }
export interface SeededRule { ingredientId: string; severity: Severity; source: string }
export interface SeededVersion { id: string; code: string; status: MethodologyStatus; rules: SeededRule[] }
export interface SeededModifier { profileId: string; ingredientId: string; severity: Severity; source: string; reason?: string }
export interface SeededProfile { id: string; name: string; modifiers: SeededModifier[] }
export interface SeededProduct { id: string; name: string; ingredients: string[] }
export interface SeedData { ingredients: SeededIngredient[]; versions: SeededVersion[]; profiles: SeededProfile[]; products: SeededProduct[] }

interface StoredResult {
  id: string; productId: string; methodologyVersionId: string;
  payload: unknown; confidence: number; worstSeverity: Severity | null; computedAt: string;
}

/**
 * In-memory stand-in for ClassificationRepository. Same public contract, no
 * database: keeps the tests deterministic and offline.
 */
export class FakeClassificationRepository {
  // Part of the structural contract; never dereferenced.
  readonly prisma = undefined as unknown as PrismaService;

  private readonly ingredients: SeededIngredient[];
  private readonly versions: SeededVersion[];
  private readonly profiles: SeededProfile[];
  private readonly products: Map<string, ProductRow>;
  private readonly results: Map<string, StoredResult> = new Map();
  private sequence = 0;

  constructor(seed: SeedData) {
    this.ingredients = seed.ingredients.map((i) => ({ ...i, synonyms: [...i.synonyms] }));
    this.versions = seed.versions.map((v) => ({ ...v, rules: v.rules.map((r) => ({ ...r })) }));
    this.profiles = seed.profiles.map((p) => ({ ...p, modifiers: p.modifiers.map((m) => ({ ...m })) }));
    this.products = new Map<string, ProductRow>(
      seed.products.map((p) => [p.id, { id: p.id, name: p.name, ingredients: p.ingredients.map((raw, i) => ({ position: i + 1, raw })) }]),
    );
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async createProduct(name: string, rawIngredients: string[]): Promise<{ id: string; name: string }> {
    const id = this.nextId('product');
    this.products.set(id, { id, name, ingredients: rawIngredients.map((raw, i) => ({ position: i + 1, raw })) });
    return { id, name };
  }

  async findProductWithIngredients(id: string): Promise<ProductRow | null> {
    const product = this.products.get(id);
    return product ? cloneRow(product) : null;
  }

  async listProducts(): Promise<ProductRow[]> {
    return [...this.products.values()].map(cloneRow);
  }

  async findActiveMethodology(): Promise<MethodologyVersionView | null> {
    const version = this.versions.find((v) => v.status === 'active');
    return version ? toView(version) : null;
  }

  async findMethodologyById(id: string): Promise<MethodologyVersionView | null> {
    const version = this.versions.find((v) => v.id === id);
    return version ? toView(version) : null;
  }

  async findMethodologyByCode(code: string): Promise<MethodologyVersionView | null> {
    const version = this.versions.find((v) => v.code === code);
    return version ? toView(version) : null;
  }

  async publishVersion(input: MethodologyVersionInput): Promise<MethodologyVersionView> {
    if (this.versions.some((v) => v.code === input.code)) {
      throw new MethodologyVersionExistsError(input.code);
    }
    const unknown = input.rules.filter((rule) => !this.ingredients.some((i) => i.id === rule.ingredientId));
    if (unknown.length > 0) {
      throw new BadRequestError('unknown_ingredient_in_rule', 'Rule references an unknown ingredient.', { ingredient_ids: unknown.map((u) => u.ingredientId) });
    }
    for (const version of this.versions) {
      if (version.status === 'active') version.status = 'retired';
    }
    const version: SeededVersion = { id: this.nextId('version'), code: input.code, status: 'active', rules: input.rules.map((rule) => ({ ...rule })) };
    this.versions.push(version);
    return toView(version);
  }

  async findRulesByVersion(methodologyVersionId: string): Promise<RuleView[]> {
    const version = this.versions.find((v) => v.id === methodologyVersionId);
    if (!version) return [];
    return version.rules.map((rule) => ({
      ingredientId: rule.ingredientId,
      ingredientName: this.ingredients.find((i) => i.id === rule.ingredientId)?.name ?? '',
      severity: rule.severity,
      source: rule.source,
    }));
  }

  async findIngredients(): Promise<IngredientInfo[]> {
    return this.ingredients.map((i) => ({ id: i.id, name: i.name, synonyms: [...i.synonyms] }));
  }

  async findProfileWithModifiers(id: string): Promise<ProfileView | null> {
    const profile = this.profiles.find((p) => p.id === id);
    if (!profile) return null;
    return { id: profile.id, name: profile.name, modifiers: profile.modifiers.map((m) => ({ ingredientId: m.ingredientId, severity: m.severity, source: m.source, reason: m.reason })) };
  }

  async upsertResult(input: { productId: string; methodologyVersionId: string; payload: object; confidence: number; worstSeverity: Severity | null }): Promise<{ id: string }> {
    const key = `${input.productId}:${input.methodologyVersionId}`;
    const existing = this.results.get(key);
    const now = new Date().toISOString();
    if (existing) {
      existing.payload = input.payload;
      existing.confidence = input.confidence;
      existing.worstSeverity = input.worstSeverity;
      existing.computedAt = now;
      return { id: existing.id };
    }
    const row: StoredResult = { id: this.nextId('result'), productId: input.productId, methodologyVersionId: input.methodologyVersionId, payload: input.payload, confidence: input.confidence, worstSeverity: input.worstSeverity, computedAt: now };
    this.results.set(key, row);
    return { id: row.id };
  }

  async findResultsByProduct(productId: string, methodologyVersionId?: string): Promise<StoredResultView[]> {
    return [...this.results.values()]
      .filter((result) => result.productId === productId && (!methodologyVersionId || result.methodologyVersionId === methodologyVersionId))
      .map((result) => ({
        id: result.id,
        productId: result.productId,
        methodologyVersionId: result.methodologyVersionId,
        methodologyVersionCode: this.versions.find((v) => v.id === result.methodologyVersionId)?.code ?? '',
        payload: result.payload,
        confidence: result.confidence,
        worstSeverity: result.worstSeverity,
        computedAt: result.computedAt,
      }));
  }
}

function toView(version: SeededVersion): MethodologyVersionView {
  return { id: version.id, code: version.code, status: version.status };
}

function cloneRow(product: ProductRow): ProductRow {
  return { ...product, ingredients: [...product.ingredients].sort((a, b) => a.position - b.position).map((line) => ({ ...line })) };
}
```

Wait — the fake's upsertResult input type vs the repository's UpsertResultInput: the repository declares `payload: object`. The fake should match: `payload: object` ✓ I wrote it.

The repository's UpsertResultInput export — the fake could import it; inline the structural shape (fine, must match: productId, methodologyVersionId, payload: object, confidence, worstSeverity ✓).

Hmm — but the service calls `repository.upsertResult({ …, payload: base, … })` where the parameter type is ClassificationRepository — `base` (ClassificationResponse interface) is assignable to `object` ✓.

And in the fake, `existing.payload = input.payload` (StoredResult.payload unknown ✓).

Now — one more: `FakeClassificationRepository` must be assignable to `ClassificationRepository`: the repository has public member `prisma` (readonly PrismaService) ✓ the fake has it; methods: createProduct ✓, findProductWithIngredients ✓, listProducts ✓, findActiveMethodology ✓, findMethodologyById ✓, findMethodologyByCode ✓, publishVersion ✓, findRulesByVersion ✓, findIngredients ✓, findProfileWithModifiers ✓, upsertResult ✓, findResultsByProduct ✓. Method parameter/return compatibility: the repository's `upsertResult(input: UpsertResultInput)` — the fake's parameter is the same shape ✓. Return Promise ✓.

TS checks the fake → repository: for each of the repository's public members, the fake must have a compatible one. The fake's extra private is OK (the source has private → the target must be... wait, the earlier rule: when the source has a private member, assignability to a different class type is blocked?! Let me re-verify the exact rule:

TypeScript's structural typing with private/protected: "If S has a private member, then S is assignable to T only if T is a class and S is T or a subclass of T"? No — that's when T has the private. The rule (from the spec/behavior):

- If the target T has a private/protected member, the source S must be the same class (or a subclass) — i.e., private members on the target create nominality.
- If the source S has a private member and the target T doesn't, S is assignable to T normally (the extra private is ignored).

Yes — e.g., `class A { private x; f() {} }` can be assigned to `interface I { f(): void }`? I'm pretty sure yes. The nominality comes from the target's private. Correct.

But ClassificationRepository is a class target with no private → structural ✓.

Also, `buildService` returns `{ service: ClassificationService, repository: FakeClassificationRepository }` — and in the spec we use `new ClassificationService(repository)`? buildService already constructs. In the no-active test we need a custom seed → `buildService({ withActiveVersion: false })` ✓.

## Now the repository file — verify the prisma query types:

`findUnique({ where: { status: 'active' } })` — status is unique ✓ the generated where accepts it.

`productIngredient.createMany` — PG ✓.

`classificationResult.upsert` where composite unique `productId_methodologyVersionId` ✓ (the generated name for @@unique([productId, methodologyVersionId]) → `productId_methodologyVersionId`) ✓.

`methodologyVersion.create` with a nested rules create ✓.

`rule.findMany` include ingredient select name ✓.

`ingredient.findMany` include synonyms select term orderBy term ✓.

`familyProfile.findUnique` include modifiers ✓.

`classificationResult.findMany` include methodologyVersion select code ✓.

## The schema — `ProductIngredient` relation name: the product side's field `ingredients ProductIngredient[]`, and the productIngredient side's `product` — Prisma names the relation by inference (single pair) ✓.

Rule's relations: two models with multiple relations between them? MethodologyVersion ↔ Rule: one pair ✓. Ingredient ↔ Rule ✓ one pair. Ingredient ↔ ProfileModifier ✓. Product ↔ ClassificationResult ✓. MethodologyVersion ↔ ClassificationResult ✓. No ambiguity.

## The enum in the SQL — created before the tables ✓.

## The migration filename's date format — any name works.

Now the seed: `prisma.methodologyVersion.findUnique({ where: { status: 'active' } })` ✓.

The seed's severity strings — the generated client's type expects the $Enums.Severity or the literal 'watch' — a string literal is assignable ✓.

`product.create({ data: { name, ingredients: { create: [...] } } })` — the nested `ingredients` create under product — the field name `ingredients` ✓.

## The package.json postinstall: `"postinstall": "prisma generate"` — requires the prisma devDep installed first — postinstall runs after all deps are installed ✓.

## Re-check the `vitest` run: `vitest run` (non-watch) ✓ CI-friendly.

## Also — a `.gitignore`? Not asked for. Skip. A `README.md`? Not asked for — skip (discipline).

Hmm, "never a fragment" — deliver the complete files. Also, "don't restate files you're not changing" — no existing files; all new.

## One more design question: `GET /classifications` is required to have `product_id` — "results from the previous version remain retrievable" ✓.

## Now — I'll write the final content of each file. Note: `useDefineForClassFields: false` and parameter properties — with ES2022 target, Nest's DI relies on design:paramtypes ✓ emitted with emitDecoratorMetadata.

Actually wait — with `useDefineForClassFields: false`, parameter properties still work with decorators ✓ (Nest's docs recommend exactly this for ESM).

## tsconfig include — only src; the tests are compiled by vitest (esbuild), not tsc — but a `tsc -p` with only src will type-check src; the tests are type-checked... not in the build. Fine (vitest esbuild doesn't type-check — runtime only). To type-check the tests too, we can include test in a separate tsconfig — but the build's rootDir src conflicts. Keep the single tsconfig for src (the build artifact). The tests are type-checked in the editor. Acceptable. Hmm — should I add `"tsconfig": ...` for vitest? Vitest uses esbuild with tsconfig's compilerOptions partially (target, etc.) — fine.

But — vitest's esbuild reads the tsconfig for the `useDefineForClassFields`/decorator settings? esbuild handles decorators per tsconfig's experimentalDecorators ✓ (esbuild supports experimentalDecorators; emitDecoratorMetadata is not supported by esbuild!!).

⚠️ Critical: esbuild does not support emitDecoratorMetadata. The controller test via Test.createTestingModule relies on design:paramtypes metadata for DI! Without decorator metadata, Nest can't resolve the constructor dependencies → DI error at module compile... but I'm overriding the service provider with useValue — Nest still needs to know the constructor's parameter types to match providers. If the metadata is absent → "Nest can't resolve dependencies of the ClassificationController (?)".

Does Vitest support emitDecoratorMetadata? No — vitest is Vite/esbuild-based; esbuild has no emitDecoratorMetadata. There's a workaround: the `esbuild` option `tsconfigRaw`... esbuild fundamentally can't emit it. Common solution in Nest+vitest: `swc` plugin (@vitest-plugin/swc or unplugin-swc) for full TS support including decorator metadata.

Options:
a) Add `@vitest/plugin...`? The actual packages: `@swc/core` + `unplugin-swc` or `@vitest/...`? Hmm, wait — is there an official one? Vite has a `vite-plugin-swc` (community). There's also `unplugin-swc`.
b) Avoid DI metadata dependence in the controller test: test the controller without Nest DI — instantiate directly: `const controller = new ClassificationController(serviceStub as unknown as ClassificationService);` — direct constructor call bypasses DI entirely → no decorator metadata needed! The controller is just a class; `new` works. Decorators on the class are processed by esbuild (it supports the syntax of experimentalDecorators, and decorators are emitted for classes/methods — esbuild supports experimentalDecorators for class/method decorators, yes — it just can't emit design:type metadata). The runtime decorators (@Controller, @Post) call the decorator function at class definition — esbuild emits the decorator application (transforming legacy decorators to __decorate calls) ✓. The decorator functions from @nestjs/common run fine. The metadata absence only affects DI resolution — which I bypass with a direct `new`.

So: in the controller test, skip @nestjs/testing; `new ClassificationController(stub)`.

But wait — esbuild + legacy decorators: esbuild supports `experimentalDecorators: true` (reads the tsconfig) ✓ transforms them. And `emitDecoratorMetadata` — esbuild ignores (no support) → no design:paramtypes → fine since no DI.

And the service's constructor (no decorators) — direct new ✓. The fake ✓. The filter is direct new ✓.

So drop the @nestjs/testing devDep? The layout/stack says NestJS; the testing library isn't strictly needed. Keep the deps lean: remove @nestjs/testing.

Hmm — but the runtime decorator metadata: `@Controller()` without metadata — the decorator function doesn't require metadata at decoration time (the metadata is read at DI time) ✓. The `@Post('products')` route decorator — stores metadata in the prototype (own property) — used when Nest registers the controller via the module — I'm not registering via the module in the test ✓. main.ts's real app: tsc build emits the metadata ✓ DI works.

OK — controller test via direct instantiation. This removes @nestjs/testing and the metadata risk.

Update the buildController helper:
```ts
function buildController() {
  const calls: Record<string, unknown> = {};
  const serviceStub = { ... };
  const controller = new ClassificationController(serviceStub as unknown as ClassificationService);
  return { controller, calls };
}
```
`serviceStub as unknown as ClassificationService` — a cast silences the structural mismatch (the stub lacks the public `repository` member). A cast is fine in tests. Actually — could I make the stub structurally complete? Add `repository: undefined as unknown as ClassificationRepository`?? The controller's type expects the service type; the stub would need all service public members: repository + 4 methods. Possible but ugly; the cast is clearer.

Hmm wait — with `new ClassificationController(stub as unknown as ClassificationService)`, calling `controller.createProduct(body)` runs the real controller code → the validation → the stub's service methods → the assertions on calls ✓.

Now — esbuild legacy decorators in the spec file? The spec has no decorators ✓. The imported controller class file has decorators — esbuild transforms with experimentalDecorators from the tsconfig ✓. Does Vitest read the tsconfig? Vite reads tsconfig.json for the esbuild options (target, jsx, useDefineForClassFields, experimentalDecorators? — Vite reads `experimentalDecorators` and `useDefineForClassFields` from the tsconfig — yes, Vite supports passing these to esbuild (Vite 4+ reads the tsconfig fields: useDefineForClassFields, experimentalDecorators... hmm, does Vite actually pass `experimentalDecorators`? There's `esbuild.tsconfigRaw`... Vite automatically reads the tsconfig.json and applies `compilerOptions.useDefineForClassFields` and `experimentalDecorators`? I recall Vite handles `experimentalDecorators` (it's in the list of tsconfig fields Vite understands: target, useDefineForClassFields, experimentalDecorators, paths...). Yes — Vite's tsconfck reads those. Good.

Just in case, add an explicit vitest config that sets the esbuild tsconfigRaw:
```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    target: 'es2022',
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
  },
  test: { environment: 'node', include: ['test/**/*.spec.ts'] },
});
```
Hmm — is vitest.config.ts "a file not asked for"? It configures the test behavior (decorators) — defensible as part of making the tests run. I'll include it; a small file. Actually, `esbuild.tsconfigRaw` — the correct API: the `esbuild` option accepts esbuild options; `tsconfigRaw` is an esbuild option ✓.

Wait — but with tsconfigRaw, does esbuild ignore the actual tsconfig's paths/target? Set the target es2022 explicitly ✓. Fine.

And the `import 'reflect-metadata'` at the top of the spec — needed? The controller class file: the @nestjs/common decorators — at decoration time, do they use Reflect.defineMetadata? The `@Injectable()` decorator uses Reflect.defineMetadata(ParamtypesMetadata...) — reads the design:paramtypes (absent → undefined, handled) and sets 'reflect.metadata'... Reflect.defineMetadata — needs the reflect-metadata polyfill! If the spec imports the controller (which imports @nestjs/common), class evaluation runs the decorators → `Reflect.defineMetadata` is called → if reflect-metadata isn't loaded → TypeError. @nestjs/common's index — does it import reflect-metadata? @nestjs/common has a dependency on...? NestJS's `@Injectable` implementation: `Reflect.defineMetadata(PARAMTYPES_METADATA, ...)`? It uses `Reflect.getMetadata`/`defineMetadata` directly — relies on the global Reflect.metadata — provided by reflect-metadata or native (Node has no native Reflect.metadata!). So the spec must import 'reflect-metadata' before importing the Nest classes. ✓ I'll include `import 'reflect-metadata';` as the first import in the spec and in fixtures (the spec is the entry; the import order: the spec's first line). Vitest executes the spec module first, then its imports in order — as long as 'reflect-metadata' is before the Nest-dependent imports, it's fine? ES module imports are hoisted! All imports are evaluated before the module body, in declaration order. `import 'reflect-metadata'` is listed first → evaluated first ✓ (ESM evaluates imports in source order). ✓

Also main.ts imports reflect-metadata first ✓ (already).

## One more potential esbuild issue: the controller file's `@Post('products')` etc. — fine.

## `@Controller()` with no argument — the controller path defaults to '' → routes are absolute ✓.

## Confirm: `@Get('classifications')` with query — Nest: `@Query('product_id')` ✓.

## Now — `noImplicitOverride` with the fake's methods: the fake doesn't extend → no override ✓.

## `strict` + `exactOptionalPropertyTypes`? Not enabled (not part of strict) — the `reason?: string` is OK.

## The service's `applyProfile` modifiers parameter type: `ProfileView['modifiers']` — import the ProfileView type? The service already imports types from the repository (Severity, etc.). Use `ProfileView` in the signature? applyProfile(base, profile: ProfileView) — cleaner: pass the whole profile view:
```ts
private applyProfile(base: ClassificationResponse, profile: ProfileView): ClassificationResponse {
  const modifierByIngredient = new Map(profile.modifiers.map((m) => [m.ingredientId, m]));
  …
  return { ...base, profile: { id: profile.id, name: profile.name }, ingredients, summary };
}
```
✓ Import ProfileView (type) in the service.

classify: `const profile = profileId ? await this.repository.findProfileWithModifiers(profileId) : null;` then `profile ? this.applyProfile(base, profile) : base`.

## The service's imports from the repository: `ClassificationRepository` (value, DI), types: `IngredientInfo, ProfileView, ProductRow, ResolvedRuleInput, RuleView, Severity` — import type separately.

## The DISCLAIMER export — the test can assert a non-empty string ✓.

## Let me write the final test for "publish": also assert that the v1 result's worstSeverity is preserved? Optional; the payload comparison suffices.

## Count assertion: the seed's `rescanned_products` = 3 (night, peeling, shuffled).

## Also, after publish, classify(SHUFFLED_NIGHT_CREAM)? Not needed.

## Re-verify the coexistence assertion: v1's payload's Limonene status is 'clear' — v1's rules: benzoyl restricted, retinyl watch, salicylic watch. Limonene has no rule → clear ✓. v2's rules: limonene watch, retinyl restricted → Limonene flagged watch ✓, retinyl restricted ✓.

## Also assert that `after` (classify after publish) uses 2024.2 ✓ and that its retinyl severity is restricted (base, no profile) ✓.

## Now, let me also double-check that `toEqual` on the whole ClassificationResponse across re-runs: both objects have the same key order? toEqual ignores key order ✓.

## `expect(second).toEqual(first)` — first includes `methodology_version: '2024.1'` etc. ✓ deterministic.

## `unknowns` — NIGHT_CREAM: ['mystery butter x'] ✓.

## `PEELING_GEL` is used? I defined it but may not use it in the tests — used in the publish test? Not needed. Keep the seed product (realism) — or reference it in the resolution test? The resolution test creates its own product. PEELING_GEL can remain unused in the tests but present in the seed — fine (it's seed data, not test scaffolding). Actually, use PEELING_GEL in the "synonym resolves" test: Salixylic Acid in the peeling gel resolves. Restructure the resolution test to use the seeded PEELING_GEL + a created product for the BHA/Caféine case. Simpler: keep the created-product approach; PEELING_GEL is just seed data. Hmm — an unused export isn't a lint issue. But cleaner: use PEELING_GEL in the typo test:
```ts
const result = await service.classify(PEELING_GEL);
const salicylic = result.ingredients.find((f) => f.input === 'Salixylic Acid')!;
expect(salicylic).toMatchObject({ resolved: 'Salicylic acid', status: 'flagged', severity: 'watch' });
const tocopherol = result.ingredients.find((f) => f.input === 'T0COPHEROL')!;
expect(tocopherol).toMatchObject({ resolved: 'Tocopherol', status: 'clear' });
expect(result.unknowns).toEqual([]);
expect(result.confidence).toBe(1);
```
And a separate created product for the accent + case + whitespace + BHA:
```ts
const { id } = await service.createProduct('Accent cream', ['Caféine', 'Retinyl  Palmitate', 'bha']);
…
```
Good — covers all normalizations.

## `bha` lowercase raw → 'bha' → synonym ✓ demonstrates case insensitivity.

## Now — I'll write out everything. Also confirm no file has stray syntax.

Let me also re-verify the repository's `findMethodologyByCode` return type used in the service's publish: `existing` truthiness ✓.

The service's publishVersion: after the repository.publishVersion, `rescoreVersion(version.id)`.

One subtle point: `rescoreVersion` calls `findMethodologyById` ✓ exists.

## The service's listStoredResults is a public pass-through ✓ (the controller calls it).

## Confirm: the service has zero Prisma imports ✓.

## The repository has zero business logic (pure data) ✓ — the publishVersion transaction includes the retirement (a data operation, OK).

## The migration: the JSONB type ✓; `payload JSONB NOT NULL`.

## The `confidence` DOUBLE PRECISION ✓.

## Also the `@@map` names — confirm the SQL table names match: ingredients, ingredient_synonyms, methodology_versions, rules, family_profiles, profile_modifiers, products, product_ingredients, classification_results ✓.

## The column `published_at` nullable ✓; `worst_severity` nullable enum ✓; `raw_name` ✓; `position` INTEGER ✓.

## Foreign keys as listed ✓.

## The unique `methodology_versions_status_key` — a unique index on the enum column ✓ (Prisma creates a unique index for @unique on any column) ✓.

Now — a potential Prisma gotcha: `@unique` on an enum field — supported ✓.

`findUnique({ where: { status: 'active' } })` — the generated unique-where accepts `status` ✓.

## The seed's `findUnique({ where: { status: 'active' } })` ✓.

Now let me write the `src/classification/classification.module.ts` — providers [ClassificationService, ClassificationRepository], controllers [ClassificationController], imports [PrismaModule] ✓.

## Final check of the format requirements: "For each file, a level-3 heading containing only the repository-relative path, immediately followed by a single fenced block containing only that file's content." Start with the first heading. Nothing outside the pattern. I'll output exactly that — no intro prose.

Order: package.json, tsconfig.json, vitest.config.ts, prisma files, src files, test files.

Now let me mentally compile each file for TS errors.

### api-error.filter.ts

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

/**
 * Every error in the API uses a single envelope:
 * { "error": { "code": "snake_case", "message": "...", "details": {} } }
 * `code` is the stable contract; `message` is developer-facing; `details` is always an object.
 */
export class ApiError extends HttpException {
  constructor(
    readonly code: string,
    readonly message: string,
    status: HttpStatus,
    readonly details: Record<string, unknown> = {},
  ) {
    super({ error: { code, message, details } }, status);
  }
}
```
Wait — `readonly message` — HttpException already has a `message` property? HttpException's instance: does it have `this.message`? HttpException class: does it have a `message` property? It has getStatus(), getResponse(). The base Error has a `message` property (Error.message). HttpException extends Error? Yes, `class HttpException extends Error`. So redeclaring `message` as a parameter property → conflicts? Redeclaring a property inherited from Error: TS allows shadowing in a derived class? An Error.message parameter property — the type is string ✓ compatible. TS: the derived class can redeclare a property inherited from a base class as long as the types are compatible — Error.message: string ✓. OK. But `code` — Error has no code ✓. `details` ✓.

Hmm — actually, shadowing `message` is fine.

```ts
export class BadRequestError extends ApiError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(code, message, HttpStatus.BAD_REQUEST, details);
  }
}

export class ProductNotFoundError extends ApiError {
  constructor(productId: string) {
    super('product_not_found', `Product "${productId}" was not found.`, HttpStatus.NOT_FOUND, { product_id: productId });
  }
}

export class ProfileNotFoundError extends ApiError {
  constructor(profileId: string) {
    super('profile_not_found', `Family profile "${profileId}" was not found.`, HttpStatus.NOT_FOUND, { profile_id: profileId });
  }
}

export class MethodologyVersionNotFoundError extends ApiError {
  constructor(methodologyVersionId: string) {
    super('methodology_version_not_found', `Methodology version "${methodologyVersionId}" was not found.`, HttpStatus.NOT_FOUND, { methodology_version_id: methodologyVersionId });
  }
}

export class NoActiveMethodologyError extends ApiError {
  constructor() {
    super('no_active_methodology', 'No methodology version is active; publish one before classifying.', HttpStatus.CONFLICT, {});
  }
}

export class MethodologyVersionExistsError extends ApiError {
  constructor(code: string) {
    super('methodology_version_exists', `Methodology version "${code}" is already published.`, HttpStatus.CONFLICT, { code });
  }
}

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

@Catch()
export class ApiEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse() as {
      status(code: number): { json(body: unknown): void };
    };

    if (exception instanceof ApiError) {
      const envelope: ErrorEnvelope = { error: { code: exception.code, message: exception.message, details: exception.details } };
      response.status(exception.getStatus()).json(envelope);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        response.status(status).json({ error: { code: 'http_error', message: payload, details: { http_status: status } } });
        return;
      }
      const body = payload as Record<string, unknown>;
      const code = typeof body.code === 'string' ? body.code : 'http_error';
      const message = typeof body.message === 'string' ? body.message : Array.isArray(body.message) ? body.message.join('; ') : String(status);
      const details = body.details && typeof body.details === 'object' ? (body.details as Record<string, unknown>) : {};
      response.status(status).json({ error: { code, message, details } });
      return;
    }

    console.error('Unhandled exception:', exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: { code: 'internal_error', message: 'Unexpected server error.', details: {} } });
  }
}
```
`getResponse()` returns any → the cast to a minimal shape ✓. `exception.message` — ApiError.message ✓.

### prisma.service.ts ✓ (above).

### repository — write in full (above). Import { Injectable } + { Prisma } + PrismaService.

Wait — the Prisma import: `import { Prisma } from '@prisma/client';` used only in a type cast — a value import is fine.

`payload: input.payload as Prisma.InputJsonValue` ✓.

### service — write in full. Note: import `@Injectable` from @nestjs/common ✓.

Let me draft the entire service file:

```ts
import { Injectable } from '@nestjs/common';
import {
  BadRequestError,
  MethodologyVersionExistsError,
  MethodologyVersionNotFoundError,
  NoActiveMethodologyError,
  ProfileNotFoundError,
  ProductNotFoundError,
} from '../common/api-error.filter.js';
import type {
  IngredientInfo,
  ProfileView,
  ProductRow,
  ResolvedRuleInput,
  RuleView,
  Severity,
} from './classification.repository.js';
import type { ClassificationRepository } from './classification.repository.js';
```
Hmm, two imports from the same module (a value + a type) — combine: `import { type ClassificationRepository, ... }`? Cleaner: one `import type {...}` line for all types including ClassificationRepository? ClassificationRepository is used only as a type in the constructor parameter (DI metadata is emitted by tsc for the constructor parameter type — the metadata needs the class as a value at decoration time: `design:paramtypes` references the class object! A type-only import is erased → the metadata becomes Object → DI fails in the real app!!

⚠️ Important: with tsc (the real build), `constructor(readonly repository: ClassificationRepository)` emits design:paramtypes [ClassificationRepository] — needs the class as a value import. If I use `import type`, tsc emits... does tsc emit the metadata from a type-only import? With `import type`, tsc doesn't emit a require → the metadata is... I think tsc emits Object for a type-only imported parameter (because it can't reference it). That would break Nest's DI at runtime.

So: ClassificationRepository must be a value import: `import { ClassificationRepository } from './classification.repository.js';` and the other types can be type imports. Two import statements from the same module are allowed (one a value import for the class, one `import type` for the interfaces). ✓

Same for the controller: `import { ClassificationService } from './classification.service.js';` (a value for DI metadata) + `import type { RuleDraft } from './classification.service.js';` ✓.

In the test (esbuild, no metadata) the distinction doesn't matter, but consistency is fine.

### The service file (final):

```ts
import { Injectable } from '@nestjs/common';
import {
  BadRequestError,
  MethodologyVersionExistsError,
  MethodologyVersionNotFoundError,
  NoActiveMethodologyError,
  ProfileNotFoundError,
  ProductNotFoundError,
} from '../common/api-error.filter.js';
import { ClassificationRepository } from './classification.repository.js';
import type {
  IngredientInfo,
  ProfileView,
  ProductRow,
  ResolvedRuleInput,
  RuleView,
  Severity,
} from './classification.repository.js';

/** Shown on every classification; the API never issues a binary safe/toxic verdict. */
export const DISCLAIMER =
  'Informational screening only. Findings are not a safety or regulatory judgment, and the absence of a flag does not mean a product is safe. Unknown ingredients could not be matched to a known substance and should be verified manually.';

export type FindingStatus = 'flagged' | 'clear' | 'unknown';
export type FindingOrigin = 'base' | 'profile_modifier';

export interface ClassificationFinding {
  /** The raw INCI entry exactly as stored on the product. */
  input: string;
  /** Lower-cased, accent-free, whitespace-collapsed form used for matching. */
  normalized: string;
  /** Canonical ingredient name when the input resolved, else null. */
  resolved: string | null;
  /** Internal ingredient id when the input resolved, else null. */
  ingredient_id: string | null;
  status: FindingStatus;
  flagged: boolean;
  /** Final severity after profile modifiers. */
  severity: Severity | null;
  /** Severity from the active methodology's base rules (null when the base did not flag it). */
  base_severity: Severity | null;
  /** Final source citation (profile modifier's when the profile tightened the finding). */
  source: string | null;
  /** Base rule citation, kept for traceability when the profile tightened the finding. */
  base_source: string | null;
  origin: FindingOrigin;
  note: string | null;
}

export interface ClassificationSummary {
  watch: number;
  restricted: number;
  banned: number;
}

export interface ClassificationResponse {
  product_id: string;
  methodology_version: string;
  profile: { id: string; name: string } | null;
  ingredients: ClassificationFinding[];
  /** Normalized inputs that could not be resolved to a known ingredient, sorted. */
  unknowns: string[];
  /** Share of listed ingredients that resolved to a known substance (1 = all known). */
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

export interface RuleDraft {
  /** Ingredient canonical name or synonym. */
  ingredient: string;
  severity: Severity;
  source: string;
}

const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };

interface IndexedIngredient {
  id: string;
  name: string;
}

@Injectable()
export class ClassificationService {
  constructor(readonly repository: ClassificationRepository) {}

  async createProduct(name: string, rawIngredients: string[]): Promise<{ id: string; name: string }> {
    return this.repository.createProduct(name, rawIngredients);
  }

  /**
   * Classify a product under the active methodology, optionally tightened by a
   * family profile. The profile-independent base result is stored under
   * (product, methodologyVersion) on every call; profile modifiers are applied
   * on top for the response and never persisted.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationResponse> {
    const product = await this.repository.findProductWithIngredients(productId);
    if (!product) throw new ProductNotFoundError(productId);

    const methodology = await this.repository.findActiveMethodology();
    if (!methodology) throw new NoActiveMethodologyError();

    const profile = profileId ? await this.repository.findProfileWithModifiers(profileId) : null;
    if (profileId && !profile) throw new ProfileNotFoundError(profileId);

    const [rules, ingredients] = await Promise.all([
      this.repository.findRulesByVersion(methodology.id),
      this.repository.findIngredients(),
    ]);

    const base = this.buildBaseClassification(product, methodology.code, rules, buildIngredientIndex(ingredients));
    await this.repository.upsertResult({
      productId: product.id,
      methodologyVersionId: methodology.id,
      payload: base,
      confidence: base.confidence,
      worstSeverity: worstSeverityOf(base.summary),
    });

    return profile ? this.applyProfile(base, profile) : base;
  }

  /**
   * Publish a new (immutable) methodology version: it becomes the active one,
   * the previous active version is retired, and every product is re-scored
   * against it. Results of earlier versions remain stored and retrievable.
   */
  async publishVersion(input: { code: string; rules: RuleDraft[] }): Promise<{
    id: string;
    code: string;
    status: 'active';
    published: boolean;
    rescanned_products: number;
  }> {
    const existing = await this.repository.findMethodologyByCode(input.code);
    if (existing) throw new MethodologyVersionExistsError(existing.code);

    const index = buildIngredientIndex(await this.repository.findIngredients());
    const resolved: ResolvedRuleInput[] = [];
    const missing: string[] = [];
    for (const draft of input.rules) {
      const entry = index.get(normalizeTerm(draft.ingredient));
      if (!entry) {
        missing.push(draft.ingredient);
        continue;
      }
      resolved.push({ ingredientId: entry.id, severity: draft.severity, source: draft.source });
    }
    if (missing.length > 0) {
      throw new BadRequestError(
        'unknown_ingredient_in_rule',
        'Every rule must reference a known ingredient (canonical name or synonym).',
        { ingredients: missing },
      );
    }

    const version = await this.repository.publishVersion({ code: input.code, rules: resolved });
    const rescannedProducts = await this.rescoreVersion(version.id);
    return { id: version.id, code: version.code, status: 'active', published: true, rescanned_products: rescannedProducts };
  }

  /**
   * Re-score every product against a methodology version. Idempotent: the
   * payload is a pure function of (ingredients, rules, synonyms) and results
   * are upserted on (product, methodologyVersion), so repeating it is a no-op.
   */
  async rescoreVersion(methodologyVersionId: string): Promise<number> {
    const version = await this.repository.findMethodologyById(methodologyVersionId);
    if (!version) throw new MethodologyVersionNotFoundError(methodologyVersionId);

    const [rules, ingredients, products] = await Promise.all([
      this.repository.findRulesByVersion(methodologyVersionId),
      this.repository.findIngredients(),
      this.repository.listProducts(),
    ]);
    const index = buildIngredientIndex(ingredients);
    for (const product of products) {
      const base = this.buildBaseClassification(product, version.code, rules, index);
      await this.repository.upsertResult({
        productId: product.id,
        methodologyVersionId,
        payload: base,
        confidence: base.confidence,
        worstSeverity: worstSeverityOf(base.summary),
      });
    }
    return products.length;
  }

  async listStoredResults(productId: string, methodologyVersionId?: string) {
    return this.repository.findResultsByProduct(productId, methodologyVersionId);
  }

  private buildBaseClassification(
    product: ProductRow,
    methodologyVersion: string,
    rules: RuleView[],
    index: Map<string, IndexedIngredient>,
  ): ClassificationResponse {
    const ruleByIngredient = new Map(rules.map((rule) => [rule.ingredientId, rule]));

    const findings: ClassificationFinding[] = product.ingredients.map((line) => {
      const normalized = normalizeTerm(line.raw);
      const entry = index.get(normalized);
      if (!entry) {
        return {
          input: line.raw,
          normalized,
          resolved: null,
          ingredient_id: null,
          status: 'unknown',
          flagged: false,
          severity: null,
          base_severity: null,
          source: null,
          base_source: null,
          origin: 'base',
          note: null,
        };
      }
      const rule = ruleByIngredient.get(entry.id) ?? null;
      return {
        input: line.raw,
        normalized,
        resolved: entry.name,
        ingredient_id: entry.id,
        status: rule ? 'flagged' : 'clear',
        flagged: rule !== null,
        severity: rule ? rule.severity : null,
        base_severity: rule ? rule.severity : null,
        source: rule ? rule.source : null,
        base_source: rule ? rule.source : null,
        origin: 'base',
        note: null,
      };
    });

    // Stable order: byte-wise by normalized name, then raw input. Sorting (not
    // the stored INCI position) is what makes results independent of the order
    // the ingredients were entered in.
    findings.sort(compareStable);

    const unknownFindings = findings.filter((finding) => finding.status === 'unknown');
    const unknowns = uniqueSorted(unknownFindings.map((finding) => finding.normalized));
    const total = findings.length;
    const confidence = total === 0 ? 1 : round4((total - unknownFindings.length) / total);

    const summary: ClassificationSummary = { watch: 0, restricted: 0, banned: 0 };
    for (const finding of findings) {
      if (finding.severity) summary[finding.severity] += 1;
    }

    return {
      product_id: product.id,
      methodology_version: methodologyVersion,
      profile: null,
      ingredients: findings,
      unknowns,
      confidence,
      summary,
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Precedence: base rules first, then the profile's contextual modifiers.
   * Modifiers only tighten — they can escalate a flagged ingredient or introduce
   * a new flag, but never loosen a base finding.
   */
  private applyProfile(base: ClassificationResponse, profile: ProfileView): ClassificationResponse {
    const modifierByIngredient = new Map(profile.modifiers.map((modifier) => [modifier.ingredientId, modifier]));

    const ingredients = base.ingredients.map((finding) => {
      if (finding.status === 'unknown') return finding;
      const modifier = finding.ingredient_id ? modifierByIngredient.get(finding.ingredient_id) : undefined;
      if (!modifier) return finding;
      if (finding.base_severity !== null && SEVERITY_RANK[modifier.severity] <= SEVERITY_RANK[finding.base_severity]) {
        return finding; // modifiers tighten only
      }
      return {
        ...finding,
        status: 'flagged',
        flagged: true,
        severity: modifier.severity,
        source: modifier.source,
        origin: 'profile_modifier',
        note: modifier.reason ?? null,
      };
    });

    const summary: ClassificationSummary = { watch: 0, restricted: 0, banned: 0 };
    for (const finding of ingredients) {
      if (finding.severity) summary[finding.severity] += 1;
    }

    return { ...base, profile: { id: profile.id, name: profile.name }, ingredients, summary };
  }
}

/** Lower-case, strip accents, collapse whitespace. Deterministic across environments. */
export function normalizeTerm(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}

function buildIngredientIndex(ingredients: IngredientInfo[]): Map<string, IndexedIngredient> {
  const index = new Map<string, IndexedIngredient>();
  for (const ingredient of ingredients) {
    index.set(normalizeTerm(ingredient.name), { id: ingredient.id, name: ingredient.name });
  }
  for (const ingredient of ingredients) {
    for (const synonym of ingredient.synonyms) {
      // Canonical names always win; the first synonym wins a synonym collision.
      if (!index.has(normalizeTerm(synonym))) {
        index.set(normalizeTerm(synonym), { id: ingredient.id, name: ingredient.name });
      }
    }
  }
  return index;
}

function compareStable(a: ClassificationFinding, b: ClassificationFinding): number {
  return a.normalized < b.normalized ? -1 : a.normalized > b.normalized ? 1 : a.input < b.input ? -1 : a.input > b.input ? 1 : 0;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function worstSeverityOf(summary: ClassificationSummary): Severity | null {
  if (summary.banned > 0) return 'banned';
  if (summary.restricted > 0) return 'restricted';
  if (summary.watch > 0) return 'watch';
  return null;
}
```

Type check: `summary[finding.severity] += 1` — finding.severity: Severity (truthy) ✓ indexing into ClassificationSummary ✓.

`new Map(rules.map((rule) => [rule.ingredientId, rule]))` — tuple inference: map returns (string | RuleView)[] → the Map constructor needs [string, RuleView][] → error! Fix: `new Map<string, RuleView>(rules.map((rule) => [rule.ingredientId, rule]))` — with the explicit generic, the callback is contextually typed? The constructor parameter `Iterable<readonly [K, V]>`; the array literal from map — does the map callback's return get contextually typed to readonly [K, V]? Contextual typing flows: the argument must be Iterable<readonly [K,V]>; the argument is `string[]`... hmm, the map callback's return type is inferred independently unless there's contextual typing from the expected argument type. The expected argument type `Iterable<readonly [K, V]>` → the array `T[]` must be assignable → T must be readonly [K,V] → does TS contextually type the array literal element? The map callback isn't contextually typed by that... actually, TS does contextual typing here: `rules.map((rule) => [rule.ingredientId, rule])` — the expected type of the whole expression is `Iterable<readonly [string, RuleView]>` → the array literal gets a contextual element type `readonly [string, RuleView]` → the tuple literal is checked ✓. This works in TS (the common pattern `new Map(arr.map(x => [k, v]))` errors without generics but works with `new Map<K,V>(arr.map(x => [k,v]))`). Yes, I've seen it work. To be safe, write it explicitly:
```ts
const ruleByIngredient = new Map<string, RuleView>();
for (const rule of rules) ruleByIngredient.set(rule.ingredientId, rule);
```
A loop — zero ambiguity. I'll use the loop. Same for the modifierByIngredient loop. And the findings map is fine (the callback returns a typed object).

The `findings.sort(compareStable)` — the comparator returns a number ✓.

`modifier.reason ?? null` — reason?: string | undefined ✓.

The applyProfile return spreads base — includes the old summary, then the new summary property is set later? `{ ...base, profile, ingredients, summary }` — summary is after the spread ✓ overridden.

### The repository file (final) — as drafted. Confirm the `Prisma` import use: the cast. `import { Prisma } from '@prisma/client';` — hmm, only for types → `import type { Prisma }`? The Prisma namespace has types; `import type { Prisma } from '@prisma/client'` works (namespace type import) ✓ and avoids a runtime import — but the repository already imports PrismaService (runtime) from the prisma module, which imports @prisma/client — the module graph already loads the client. Use `import type { Prisma }`.

Wait — the cast `input.payload as Prisma.InputJsonValue` — a type-only reference ✓.

### The controller (final) — as drafted; imports:
```ts
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { BadRequestError } from '../common/api-error.filter.js';
import { ClassificationService } from './classification.service.js';
import type { RuleDraft } from './classification.service.js';
```

Methods as drafted. Re-check the `publishMethodologyVersion` rule mapping:
```ts
const rules: RuleDraft[] = rulesRaw.map((entry, position) => {
  if (typeof entry !== 'object' || entry === null) {
    throw new BadRequestError('invalid_request', `rules[${position}] must be an object.`, { field: `rules[${position}]` });
  }
  const rule = entry as Record<string, unknown>;
  const ingredient = nonEmptyString(rule, 'ingredient');
  const severity = rule.severity;
  if (typeof severity !== 'string' || !SEVERITIES.includes(severity as Severity)?
```
SEVERITIES: `const SEVERITIES: readonly RuleDraft['severity'][] = ['watch', 'restricted', 'banned'];` then `!SEVERITIES.includes(severity)` — severity: unknown → includes(severity) — does readonly Severity[].includes take a Severity argument? Array.prototype.includes(searchElement: Severity) — passing unknown errors. Cast: `SEVERITIES.includes(severity as RuleDraft['severity'])` after a typeof string check → `severity` is string → `as Severity` is still needed. Write:
```ts
const severity = rule.severity as string | undefined;
if (!severity || !(SEVERITIES as readonly string[]).includes(severity)) { throw … }
```
Simplest: `(SEVERITIES as readonly string[]).includes(String(severity))`? Ugly. Do:
```ts
if (typeof severity !== 'string' || !SEVERITIES.some((s) => s === severity)) {
  throw new BadRequestError('invalid_severity', `rules[${position}].severity must be one of: ${SEVERITIES.join(', ')}.`, { field: `rules[${position}].severity` });
}
return { ingredient, severity, source: nonEmptyString(rule, 'source') };
```
`SEVERITIES.some((s) => s === severity)` — s: Severity, severity: unknown → the `s === severity` comparison with unknown is allowed? Comparing unknown with string via ===: TS allows === between any and unknown? The `===` operator requires the operands to be comparable — is unknown comparable with anything? I think `severity === s` with severity: unknown is allowed (does unknown participate in ===?). Hmm, actually does TS error with "Operator '===' cannot be applied to types 'string' and 'unknown'"? No — comparison with unknown: I think it's allowed. To be safe: `String(severity)`? Let me do:
```ts
const severity = rule.severity;
const isSeverity = typeof severity === 'string' && SEVERITIES.includes(severity);
```
With severity: unknown, `SEVERITY.includes(severity)` — narrows via &&: after `typeof severity === 'string'` → severity: string; `SEVERITIES.includes(string)` — includes expects a Severity → string not assignable → error. Ugh. Cast: `SEVERITIES.includes(severity as RuleDraft['severity'])` — after the typeof check, a string→Severity cast is allowed (a narrowing cast) ✓.

Final:
```ts
const severity = rule.severity;
if (typeof severity !== 'string' || !SEVERITIES.includes(severity as RuleDraft['severity'])) {
  throw new BadRequestError('invalid_severity', …);
}
```
✓.

The `source` check comes after — but the ingredient/severity/source order: check ingredient, then severity, then source ✓.

### main.ts, app.module.ts, prisma.module.ts — as drafted.

### The full spec file — let me assemble it (carefully, completely).

```ts
import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ClassificationController } from '../src/classification/classification.controller.js';
import { ClassificationService } from '../src/classification/classification.service.js';
import type { ClassificationResponse } from '../src/classification/classification.service.js';
import {
  ApiEnvelopeFilter,
  ProductNotFoundError,
} from '../src/common/api-error.filter.js';
import type { ClassificationRepository } from '../src/classification/classification.repository.js';
import { FakeClassificationRepository } from './fake-repository.js';
import {
  buildService,
  CHILD_PROFILE,
  NIGHT_CREAM,
  PEELING_GEL,
  PREGNANCY_PROFILE,
  SHUFFLED_NIGHT_CREAM,
  V1,
} from './fixtures.js';
```
Wait — V1 is used in the listStoredResults filter ✓.

Hmm, `import type { ClassificationRepository }` — used in the stub cast `as unknown as ClassificationService`? The stub cast only needs ClassificationService. The type import of ClassificationRepository — use it in the buildController stub? The stub is cast to `as unknown as ClassificationService` — no need for the repository type. Drop the import. Actually, the serviceStub needs to satisfy... via a double cast it's fine. Drop it.

The service describe:

```ts
describe('ClassificationService', () => {
  let service: ClassificationService;

  beforeEach(() => {
    service = buildService().service;
  });

  it('resolves case variants, double spaces, accents and OCR typos through synonyms', async () => {
    const { id } = await service.createProduct('Acne balm', ['Salixylic Acid', 'bha', 'Aqua']);
    const result = await service.classify(id);

    expect(result.ingredients.find((f) => f.input === 'Salixylic Acid')?.resolved).toBe('Salicylic acid');
    expect(result.ingredients.find((f) => f.input === 'bha')?.resolved).toBe('Salicylic acid');

    const { id: id2 } = await service.createProduct('Accent cream', ['Caféine', 'Retinyl  Palmitate', 'T0COPHEROL']);
    const second = await service.classify(id2);
    expect(second.ingredients.find((f) => f.input === 'Caféine')?.resolved).toBe('Caffeine');
    expect(second.ingredients.find((f) => f.input === 'Retinyl  Palmitate')?.resolved).toBe('Retinyl palmitate');
    expect(second.ingredients.find((f) => f.input === 'T0COPHEROL')?.resolved).toBe('Tocopherol');
    expect(second.unknowns).toEqual([]);
    expect(second.confidence).toBe(1);
  });
```
Note: 'Salixylic Acid' and 'bha' both → Salicylic acid → two findings both flagged as watch. Fine.

```ts
  it('flags ingredients from the active methodology with severity and source citation', async () => {
    const { id } = await service.createProduct('Cream', ['Aqua', 'Retinyl palmitate', 'Benzoyl peroxide', 'Tocopherol']);
    const result = await service.classify(id);

    expect(result.ingredients.find((f) => f.input === 'Retinyl palmitate')).toMatchObject({
      status: 'flagged', flagged: true, severity: 'watch', source: 'Curated watch list, 2024-01', origin: 'base',
    });
    expect(result.ingredients.find((f) => f.input === 'Benzoyl peroxide')).toMatchObject({
      status: 'flagged', severity: 'restricted', source: 'EU Reg 1223/2009, Annex III, 315-1',
    });
    expect(result.ingredients.find((f) => f.input === 'Aqua')).toMatchObject({ status: 'clear', flagged: false, severity: null, source: null });
    expect(result.summary).toEqual({ watch: 1, restricted: 1, banned: 0 });
    expect(result.disclaimer).toContain('Informational');
    // No binary verdict fields anywhere in the payload.
    expect(result).not.toHaveProperty('safe');
    expect(result).not.toHaveProperty('toxic');
  });

  it('lists unknown ingredients and lowers confidence proportionally', async () => {
    const result = await service.classify(NIGHT_CREAM);

    expect(result.ingredients.find((f) => f.input === 'Mystery Butter X')).toMatchObject({
      status: 'unknown', resolved: null, flagged: false, severity: null,
    });
    expect(result.unknowns).toEqual(['mystery butter x']);
    expect(result.confidence).toBe(0.8333); // 5 of 6 listed ingredients resolved

    const { id } = await service.createProduct('Known only', ['Aqua', 'Tocopherol']);
    const known = await service.classify(id);
    expect(known.confidence).toBe(1);
    expect(result.confidence).toBeLessThan(known.confidence);
  });
```

```ts
  it('profile modifiers tighten findings: introduce new flags and escalate severities', async () => {
    const base = await service.classify(NIGHT_CREAM);
    expect(base.ingredients.find((f) => f.resolved === 'Limonene')).toMatchObject({ status: 'clear', flagged: false, origin: 'base' });

    const child = await service.classify(NIGHT_CREAM, CHILD_PROFILE);
    expect(child.profile).toEqual({ id: CHILD_PROFILE, name: 'child_under_3' });
    expect(child.ingredients.find((f) => f.resolved === 'Limonene')).toMatchObject({
      status: 'flagged', flagged: true, severity: 'restricted', origin: 'profile_modifier',
      source: 'AAP position paper, 2023', base_severity: null,
    });

    const pregnancy = await service.classify(NIGHT_CREAM, PREGNANCY_PROFILE);
    expect(pregnancy.ingredients.find((f) => f.resolved === 'Retinyl palmitate')).toMatchObject({
      status: 'flagged', severity: 'banned', base_severity: 'watch',
      base_source: 'Curated watch list, 2024-01', source: 'FDA 2023 advisory on retinoids', origin: 'profile_modifier',
    });
    // Confidence is unaffected by the profile; only flags change.
    expect(pregnancy.confidence).toBe(base.confidence);
    expect(pregnancy.summary).toEqual({ watch: 0, restricted: 0, banned: 1 });
  });
```
Verify pregnancy summary: NIGHT_CREAM flags: retinyl (now banned), others clear → {watch:0, restricted:0, banned:1} ✓.

```ts
  it('rejects an unknown profile without side effects', async () => {
    await expect(service.classify(NIGHT_CREAM, 'no-such-profile')).rejects.toMatchObject({ code: 'profile_not_found' });
    expect(await service.listStoredResults(NIGHT_CREAM)).toHaveLength(0);
  });
```
Nice — no stored result on failure ✓ (the upsert is after the profile check).

Wait — order in classify: the profile check is before the upsert ✓.

```ts
  it('rejects classification when no methodology version is active', async () => {
    const inactive = buildService({ withActiveVersion: false }).service;
    await expect(inactive.classify(NIGHT_CREAM)).rejects.toMatchObject({ code: 'no_active_methodology' });
  });

  it('rejects a missing product', async () => {
    await expect(service.classify('no-such-product')).rejects.toMatchObject({ code: 'product_not_found' });
  });
```

```ts
  it('is identical across reruns and across shuffled ingredient order', async () => {
    const first = await service.classify(NIGHT_CREAM);
    const second = await service.classify(NIGHT_CREAM);
    expect(second).toEqual(first);

    const shuffled = await service.classify(SHUFFLED_NIGHT_CREAM);
    expect(shuffled.ingredients).toEqual(first.ingredients);
    expect(shuffled.unknowns).toEqual(first.unknowns);
    expect(shuffled.confidence).toBe(first.confidence);
    expect(shuffled.summary).toEqual(first.summary);

    // The stored result is deterministic too.
    const stored = await service.listStoredResults(NIGHT_CREAM);
    expect(stored).toHaveLength(1);
    expect(stored[0].payload).toEqual(first);
  });
```
Wait — SHUFFLED_NIGHT_CREAM = the same ingredient strings in reverse order. first.ingredients is sorted by normalized — both sort identically ✓. But `input` values are identical strings ✓. Deep equal ✓.

Hmm — `stored[0].payload` — the stored payload = base = `first` (first was called without a profile) ✓.

```ts
  it('stores the profile-independent base result under (product, version)', async () => {
    const withProfile = await service.classify(NIGHT_CREAM, PREGNANCY_PROFILE);
    const withoutProfile = await service.classify(NIGHT_CREAM);

    const stored = await service.listStoredResults(NIGHT_CREAM);
    expect(stored).toHaveLength(1);
    const payload = stored[0].payload as ClassificationResponse;
    expect(payload).toEqual(withoutProfile);
    expect(payload.profile).toBeNull();
    expect(withProfile.profile).toEqual({ id: PREGNANCY_PROFILE, name: 'pregnancy' });
  });
```

```ts
  it('publishing a new version rescans all products idempotently and keeps previous results', async () => {
    const before = await service.classify(NIGHT_CREAM);
    expect(before.methodology_version).toBe('2024.1');
    expect(before.ingredients.find((f) => f.resolved === 'Limonene')?.status).toBe('clear');

    const published = await service.publishVersion({
      code: '2024.2',
      rules: [
        { ingredient: 'Limonene', severity: 'watch', source: 'Curated watch list, 2024-02' },
        { ingredient: 'Retinyl palmitate', severity: 'restricted', source: 'Curated watch list, 2024-02' },
      ],
    });
    expect(published).toMatchObject({ code: '2024.2', status: 'active', published: true, rescanned_products: 3 });

    const after = await service.classify(NIGHT_CREAM);
    expect(after.methodology_version).toBe('2024.2');
    expect(after.ingredients.find((f) => f.resolved === 'Limonene')?.severity).toBe('watch');
    expect(after.ingredients.find((f) => f.resolved === 'Retinyl palmitate')?.severity).toBe('restricted');

    // Idempotent re-scoring: repeating it adds nothing and changes nothing.
    expect(await service.rescoreVersion(published.id)).toBe(3);
    expect(await service.rescoreVersion(published.id)).toBe(3);

    // Both versions' results coexist and stay retrievable.
    const stored = await service.listStoredResults(NIGHT_CREAM);
    expect(stored).toHaveLength(2);
    const v1 = stored.find((row) => row.methodologyVersionCode === '2024.1');
    const v2 = stored.find((row) => row.methodologyVersionCode === '2024.2');
    expect(v1?.payload).toBeTypeOf('object');
    expect((v2?.payload as ClassificationResponse).ingredients.find((f) => f.resolved === 'Limonene')?.status).toBe('flagged');
    expect((v1?.payload as ClassificationResponse).ingredients.find((f) => f.resolved === 'Limonene')?.status).toBe('clear');

    const onlyV1 = await service.listStoredResults(NIGHT_CREAM, V1);
    expect(onlyV1).toHaveLength(1);
    expect(onlyV1[0].methodologyVersionCode).toBe('2024.1');
  });
```
`v1?.payload` — v1 could be undefined; `expect(v1?.payload).toBeTypeOf('object')` is fine. Actually, I'll assert existence explicitly: `expect(v1).toBeDefined(); expect(v2).toBeDefined();` then use `v1!`? Non-null after toBeDefined isn't narrowed by TS... toBeDefined doesn't narrow. Use:
```ts
expect(stored.map((row) => row.methodologyVersionCode).sort()).toEqual(['2024.1', '2024.2']);
const v1 = stored.find((row) => row.methodologyVersionCode === '2024.1')!;
const v2 = stored.find((row) => row.methodologyVersionCode === '2024.2')!;
```
`!` is fine in tests.

`rescanned_products: 3` — the seed has 3 products ✓.

```ts
  it('rejects duplicate version codes and rules with unknown ingredients', async () => {
    await expect(service.publishVersion({ code: '2024.1', rules: [] })).rejects.toMatchObject({ code: 'methodology_version_exists' });
    await expect(
      service.publishVersion({ code: '2024.2', rules: [{ ingredient: 'Unobtainium', severity: 'watch', source: 'S' }] }),
    ).rejects.toMatchObject({ code: 'unknown_ingredient_in_rule', details: { ingredients: ['Unobtainium'] } });
    // The active methodology is untouched by a failed publish.
    expect((await service.classify(NIGHT_CREAM)).methodology_version).toBe('2024.1');
  });
});
```

The controller describe:
```ts
describe('ClassificationController', () => {
  function buildController() {
    const calls: Record<string, unknown> = {};
    const serviceStub = {
      createProduct: async (name: string, ingredients: string[]) => {
        calls.createProduct = [name, ingredients];
        return { id: 'p-new', name };
      },
      classify: async (productId: string, profileId?: string) => {
        calls.classify = [productId, profileId];
        return { product_id: productId };
      },
      publishVersion: async (input: { code: string; rules: unknown[] }) => {
        calls.publishVersion = input;
        return { code: input.code };
      },
      listStoredResults: async (productId: string, versionId?: string) => {
        calls.listStoredResults = [productId, versionId];
        return [];
      },
    };
    const controller = new ClassificationController(serviceStub as unknown as ClassificationService);
    return { controller, calls };
  }

  it('forwards valid bodies to the service', async () => {
    const { controller, calls } = buildController();

    await controller.createProduct({ name: 'Cream', ingredients: ['Aqua', 'Limonene'] });
    expect(calls.createProduct).toEqual(['Cream', ['Aqua', 'Limonene']]);

    await controller.classify({ product_id: 'p1', profile_id: 'pf1' });
    expect(calls.classify).toEqual(['p1', 'pf1']);

    await controller.classify({ product_id: 'p1' });
    expect(calls.classify).toEqual(['p1', undefined]);

    await controller.publishMethodologyVersion({
      code: '2025.1',
      rules: [{ ingredient: 'Limonene', severity: 'banned', source: 'Reg X' }],
    });
    expect(calls.publishVersion).toEqual({ code: '2025.1', rules: [{ ingredient: 'Limonene', severity: 'banned', source: 'Reg X' }] });

    await controller.listClassifications('p1', 'v1');
    expect(calls.listStoredResults).toEqual(['p1', 'v1']);
  });

  it('rejects invalid input with envelope error codes', async () => {
    const { controller } = buildController();

    await expect(controller.createProduct('oops')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(controller.createProduct({ name: '', ingredients: [] })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(controller.createProduct({ name: 'X', ingredients: ['ok', ''] })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(controller.classify({ product_id: 7 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(controller.classify({ product_id: 'p1', profile_id: '' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(controller.listClassifications('', undefined)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      controller.publishMethodologyVersion({ code: 'c', rules: [{ ingredient: 'Limonene', severity: 'meh', source: 's' }] }),
    ).rejects.toMatchObject({ code: 'invalid_severity' });
    await expect(
      controller.publishMethodologyVersion({ code: 'c', rules: [{ ingredient: 'Limonene', severity: 'watch' }] }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
```
Wait — the serviceStub's classify is called with (productId, profileId?) — when the controller calls `this.service.classify(productId, profileId)` with profileId undefined → the stub receives undefined → calls.classify = ['p1', undefined] ✓. But the controller's call: `return this.service.classify(productId, profileId);` — profileId: string | undefined — calling with an explicit undefined ✓ the stub records undefined ✓.

Hmm — `controller.listClassifications('', undefined)` — the controller signature `(productId?: string, methodologyVersionId?: string)` — the nonEmptyString on '' throws ✓.

The filter describe as drafted.

One issue — `buildService()` per beforeEach — a fresh repository per test ✓ isolated.

Now — the `V1` export from the fixtures = 'version-2024.1' ✓ matches the seed's id.

Now let me re-verify the fake's `publishVersion` when the service already checks the code — the test "duplicate version code" — the service's findMethodologyByCode('2024.1') → found → throws before the repository ✓.

Now the "rescanned_products: 3" — the fake's listProducts returns 3 seed products ✓.

Potential pitfall — the `published` return from the service: `{ id, code, status: 'active', published: true, rescanned_products }` — matchObject ✓.

Now — the spec imports `ClassificationService` (a value) — used in `buildService().service`'s type and the cast — ✓ a value import is fine.

`import type { ClassificationResponse }` ✓ used in a cast.

Now the fixtures file — verify the import of FakeClassificationRepository + the ClassificationService value import ✓.

Now — the fake's `findResultsByProduct` — the service's `listStoredResults` returns them; the spec uses `.payload` etc. ✓.

Also — the spec's `stored[0].payload` — the type StoredResultView.payload: unknown → the cast to ClassificationResponse in the "stores profile-independent" test: `const payload = stored[0].payload as ClassificationResponse;` ✓. In the determinism test: `expect(stored[0].payload).toEqual(first)` — unknown vs object — toEqual accepts unknown ✓.

Now — the fake's `upsertResult` input `payload: object` — the service passes `base` (a ClassificationResponse) — assignable to object ✓.

The repository's `upsertResult` parameter `UpsertResultInput` with `payload: object` ✓.

Now — the repository's `findResultsByProduct` mapping `payload: result.payload` — Prisma's JsonValue → StoredResultView.payload unknown ✓.

`worstSeverity: result.worstSeverity` — Prisma's $Enums.Severity | null → the repository's Severity union — is $Enums.Severity a string enum type assignable to 'watch'|...? Prisma generates `Severity = { watch: 'watch', ... }` and type Severity = $Enums.Severity — a union of the literals? Prisma's enum type: `export const Severity = { watch: 'watch', restricted: 'restricted', banned: 'banned' } as const; export type Severity = (typeof Severity)[keyof typeof Severity]` → a union of literals ✓ assignable ✓.

Similarly for the status mapping `version.status` → 'draft'|'active'|'retired' ✓.

The rule's severity ✓.

Now — the repository's `publishVersion` nested create severity: `rule.severity` (the repository's Severity) → the Prisma enum field expects $Enums.Severity — same union ✓.

### The seed's `severity: 'restricted'` literal → assignable to the enum field type ✓.

### The `prisma/seed.ts` tsconfig — tsx handles it (esbuild, no strict check) ✓.

Now — the **vitest.config.ts**:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    target: 'es2022',
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});
```
Hmm — the esbuild option at the top level of the vite config applies to all transforms (including .ts in src) ✓.

Wait — does vitest pick up the `vitest.config.ts` that has the top-level `esbuild`? The vitest config extends the vite user config — yes, esbuild is honored.

Also the `.js` → `.ts` resolution — Vite handles it ✓ (I trust it).

Alternatively, to be even safer, I could name the test imports without the `.js`... no — keep consistency; Vite resolves.

Hmm, actually — let me reconsider. Is it true that Vite/Vitest resolves `./x.js` to `./x.ts`? Vite docs "TypeScript" section: "Vite supports... importing TS files with .js extension"? I recall the `resolve.extensions` and a special case in `tryFsResolve`: `if (isTS && id.endsWith('.js')) try .ts`. Yes — Vite 4+ has exactly this ("TypeScript-style imports" support). And Vitest uses Vite's resolver via vite-node. Confident.

### tsconfig — `"types": ["node"]` too? @types/node is present; by default all @types are included ✓.

### package.json — add `"postinstall": "prisma generate"`.

Hmm — one risk: `prisma generate` in postinstall without DATABASE_URL — generate doesn't need the DB ✓ (only the env reference in the schema).

### .env example? "No secrets in the repository" — a `.env.example` with a placeholder DATABASE_URL? Not asked for; the env convention is documented in the schema. Skip.

Now — the migration_lock.toml content:
```toml
# Please do not edit this file manually
# It should be added to your version control system.
provider = "postgresql"
```

Now — the final review of the schema file's syntax. Also add the `createdAt` fields as designed. Confirm the `@@unique` syntax.

One thing: `MethodologyVersion.status MethodologyStatus @unique @default(draft)` — the attribute order is fine.

Also — `IngredientSynonym.term @unique` — but the term is stored normalized? The seed stores the given term (e.g., 'beta-hydroxy acid') — the service normalizes on read; a uniqueness on the raw term — two synonyms differing only by case would collide at read but not in the DB — tolerable (documented: store terms normalized). For safety, store normalized in the seed? The service's index normalizes on read anyway → duplicates collapse deterministically. Keep the seed simple; a comment in the schema: `// Matching terms, normalised form recommended`? Comments in Prisma are fine. I'll add a short comment.

Now — the repository's `findIngredients` includes the synonyms orderBy term ✓.

Also the schema relation from IngredientSynonym to Ingredient is onDelete: Cascade — in the schema: `ingredient Ingredient @relation(fields: [ingredientId], references: [id], onDelete: Cascade)` ✓ matches the SQL.

Rule → ingredient: no onDelete → restrict ✓ matches.

ProfileModifier → profile Cascade, → ingredient restrict ✓.

ProductIngredient → product Cascade ✓.

ClassificationResult → product Cascade, → version restrict ✓.

Rule → version Cascade ✓.

Now — let me write out the SQL migration exactly as derived.

Also `published_at` — `TIMESTAMP(3)` ✓.

Let me double-check the prisma schema enum → SQL type name "MethodologyStatus" (quotes) ✓ and "Severity" ✓.

Now — the `src/classification/classification.module.ts` file.

Also — the app name in `src/main.ts`? `NestFactory.create(AppModule)` is fine.

Logging too? Nest logs by default. Fine.

Now — the discipline check on extra files: vitest.config.ts — justified (tests must run decorators). package.json/tsconfig — necessary. prisma/seed.ts — the synonym fixture (the task mentions the fixture). All good.

One more — the layout convention says tests are `test/<feature>.spec.ts` — mine: `test/classification.spec.ts` ✓ (the feature name "classification" matches the folder `src/classification`).

Now, the potential issue: **the spec imports `../src/classification/classification.controller.js`** — the controller imports the service → the service imports the repository → the repository imports the prisma.service → which imports @prisma/client (runtime, value import in prisma.service.ts: `import { PrismaClient } from '@prisma/client'`).

⚠️ In the test run, `@prisma/client` is loaded! If the client isn't generated (postinstall didn't run / the engine is missing), the import throws "did you run prisma generate?". With the postinstall generate, it works. But the engine download at install time requires network — standard. Also — importing @prisma/client at module load: the generated client module loads fine without a DB connection (lazy) ✓. The `PrismaClient` class is instantiated only in PrismaService (which we don't instantiate in the tests — the fake uses a dummy) ✓. So the tests need the generated client but no DB ✓. Acceptable and standard.

Alternatively, I could avoid the repository's import chain in the tests: the fake doesn't import the repository (type-only) ✓, but the spec imports the service → the service imports the repository (value) → the prisma chain. Unavoidable (the service needs the class for DI metadata in the real build). So tests require `prisma generate` — I'll note it in the package.json script? A comment? JSON can't have comments. Fine — postinstall handles it.

Hmm — but `import { PrismaClient } from '@prisma/client'` when not generated: the default @prisma/client index throws a helpful error at import. With postinstall, it's generated. OK.

Now — one more subtlety: the fake's `prisma` dummy — `undefined as unknown as PrismaService` — but the fake's structural type requires `prisma: PrismaService` ✓.

Also — `FakeClassificationRepository` is assigned to `ClassificationRepository` in `buildService`: `new ClassificationService(repository)` with repository: FakeClassificationRepository — TS checks the assignability: the repository class's public members — all present ✓. But wait — the repository has a constructor `constructor(readonly prisma: PrismaService)` — the resulting instance type includes `prisma: PrismaService` ✓ the fake has it ✓.

Methods — compare signatures: the repository's `findProfileWithModifiers(id: string): Promise<ProfileView | null>`; the fake's identical ✓.

The repository's `upsertResult(input: UpsertResultInput): Promise<{ id: string }>` — the fake's parameter type must be compatible: parameter types are checked bivariantly for methods (method syntax → bivariant) ✓ fine.

Now — the `StoredResultView` export is used in the spec? Via listStoredResults' return type inference ✓ no direct import needed.

Also — the `V1` constant is used ✓.

Now — let me confirm the `beforeEach` import used ✓, `afterEach` used in the filter describe ✓, `vi` used ✓.

The filter's test — `expect(state.body).toEqual({ error: { code: 'product_not_found', message: expect.any(String), details: { product_id: 'p-404' } } })` — toEqual with an expect.any inside ✓.

The `HttpException('Invalid JSON', 400)` — getResponse() returns the string 'Invalid JSON' (when the response arg is a string) → my filter's string branch → code 'http_error', message 'Invalid JSON' ✓.

Now — the console.error spy test: the filter calls `console.error('Unhandled exception:', exception)` — the spy silences it ✓ restore in afterEach ✓.

Now — let me think about whether `@Catch()` without arguments + the global filter catches everything ✓.

**Nest's global prefix?** None.

**CORS?** Not needed.

Now — the `main.ts`'s `void bootstrap();` top-level — fine with ESM.

Now — let me write out `src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ClassificationModule } from './classification/classification.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, ClassificationModule],
})
export class AppModule {}
```

Now — the complete seed file (above). Confirm the import type for `PrismaClient` — the value import (instantiated) ✓.

The seed's modifier loop — the child's modifiers array with `severity: 'restricted' as const` — the upsert's create expects the enum ✓ a literal is fine.

Now — one more: the seed's `prisma.methodologyVersion.findUnique({ where: { code: '2024.1' } })` returns a full record or null ✓.

Also, if the DB is fresh but a version with status active exists (some other seed?) — handled by the retirement branch.

Now — the final check on the **test "rejects an unknown profile without side effects"**: classify(NIGHT_CREAM, 'no-such-profile') — order: product found → active found → profile lookup null → throws before the upsert ✓ listStoredResults length 0 ✓ (a fresh repository, no prior classify on NIGHT_CREAM in that test) ✓.

And "rejects classification when no methodology is active" — buildService({withActiveVersion:false}) — the classify order: product found → active null → throws ✓.

Now — `buildService(options)` — in the beforeEach: `service = buildService().service;` ✓.

Now — the determinism test's `expect(second).toEqual(first)` — but does the `first` response include a `profile: null` property? The base response has profile: null ✓ both.

The key order in `JSON.stringify` is irrelevant to toEqual ✓.

Now — the `confidence` float equality: both computed identically 0.8333 → toBe is fine.

Now — a subtle: in the determinism test, `stored[0].payload` — the fake stores a reference to `base` (the same object). `first` is the same object (returned without a profile). toEqual trivially ✓. And `second` — a new object with equal content ✓.

Now — the "publish" test's first action `before = await service.classify(NIGHT_CREAM)` — stores the v1 result. Then publish → rescore → upserts v2 for all 3 products (night already has a v1 row; adds a v2 row). `stored` length 2 ✓.

Then the `rescoreVersion` call — each returns 3 ✓.

`onlyV1` — the listStoredResults filter by V1 id ✓ length 1.

Now — confirm the fake's `findResultsByProduct`'s versionCode lookup ✓.

Now — let me assemble the controller file fully (the helpers are private module functions).

Also — the controller's `createProduct` returns `this.service.createProduct(name, ingredients)` — the ingredients are the validated array (the original strings, not trimmed) ✓.

Now — the final version of the validation helpers (in the controller file, after the class).

Now — the `SEVERITIES` constant: `const SEVERITIES: readonly RuleDraft['severity'][] = ['watch', 'restricted', 'banned'];`

The `includes(severity as RuleDraft['severity'])` — readonly array's includes ✓.

Now — let me re-scan for strict null issues in the controller: `@Query('product_id') productId?: string` — Nest's runtime may pass a string; my `nonEmptyString({ product_id: productId }, 'product_id')` — the object literal's value type is string | undefined ✓ nonEmptyString handles it.

Now — the repository's `findProductWithIngredients` — `where: { id }` — id: string ✓.

Now — Prisma's `product.create({ data: { name } })` — returns a Product ✓.

Now — `createMany`'s data array ✓.

Now — the repository's `publishVersion` — the nested `rules: { create: input.rules.map(...) }` — inside the tx create ✓.

All checked. Also confirm I'm not using any Node APIs in the service (no fs) ✓.

Now — the **file order** in the answer: I'll output:

1. package.json
2. tsconfig.json
3. vitest.config.ts
4. prisma/schema.prisma
5. prisma/migrations/migration_lock.toml
6. prisma/migrations/20240601000000_init/migration.sql
7. prisma/seed.ts
8. src/main.ts
9. src/app.module.ts
10. src/common/api-error.filter.ts
11. src/prisma/prisma.module.ts
12. src/prisma/prisma.service.ts
13. src/classification/classification.module.ts
14. src/classification/classification.repository.ts
15. src/classification/classification.service.ts
16. src/classification/classification.controller.ts
17. test/fixtures.ts
18. test/fake-repository.ts
19. test/classification.spec.ts

Let me now write each file in full and final form.

Wait — one more confirmation on the **repository's `publishVersion`**: after the transaction, return the view. Also — `publishedAt: new Date()` — fine (metadata only).

Also, **the repository's `createProduct`** — name is already trimmed by the controller? The controller passes the raw name (validated non-empty). The service passes it through. The repository stores it as-is. Fine.

Now, the **spec's `import type { ClassificationResponse }`** — used in two casts ✓.

Also — the spec's unused import check: `HttpStatus` is used in the filter test? I use `new HttpException('Invalid JSON', 400)` — a numeric 400 instead of HttpStatus — then the HttpStatus import is unused → drop it or use HttpStatus.BAD_REQUEST. Use `HttpStatus.BAD_REQUEST` and keep the import ✓.

`ArgumentsHost` type import used in the cast ✓.

Now — the `vi` import — used in the console spy ✓.

Now — one more possible esbuild/TS issue in the spec: `expect(...).rejects.toMatchObject` — vitest's type ✓.

The `calls` record — `expect(calls.classify).toEqual(['p1', undefined])` — the recorded array is ['p1', undefined] — toEqual(['p1', undefined]) — does toEqual treat [ 'p1', undefined ] and ['p1']? Vitest's toEqual ignores undefined properties in objects, and in arrays? Array equality with undefined elements: toEqual(['p1', undefined]) vs the received ['p1', undefined] — equal ✓. And when the profile is provided, calls.classify = ['p1','pf1'] ✓.

Hmm — but in the "forwards valid bodies" test, `calls.classify` is overwritten between the two classify calls; the assertion is right after each call ✓ sequential.

Now — the stub's `classify: async (productId: string, profileId?: string)` — the controller calls `this.service.classify(productId, profileId)` — TS: the controller's service type is ClassificationService; calling classify(productId: string, profileId?: string) ✓.

Now — the `buildController` stub's `publishVersion: async (input: { code: string; rules: unknown[] })` — the controller calls the service.publishVersion({ code, rules: RuleDraft[] }) — through the stub cast — the runtime is fine ✓.

Now — the **fixture's SEED product's double space** 'Retinyl  Palmitate' is preserved ✓ (no trim on storage — the repository stores rawName as passed; the fake stores it as passed ✓; the real repository stores the raw string — the controller doesn't trim individual ingredients; the raw is preserved — fine, normalization handles it).

Wait — the real repository's createProduct: `rawName` — I wrote `rawName` (not trimmed) in the earlier draft ✓ keep the raw exactly.

Now — the **seed.ts** product 'Night cream' includes 'Retinyl  Palmitate' (double space) ✓.

Now — let me double-check the `prisma/seed.ts` — `import { PrismaClient } from '@prisma/client';` ✓; the upsert function; the main; the finally disconnect ✓.

The seed's `findUnique({ where: { status: 'active' } })` — the unique where on status ✓.

Now — the `package.json` — add `"description"`, fine. Scripts: build, start, test, prisma:*.

Also — the `engines` node >=20 ✓.

Now — the **tsconfig** — `"module": "NodeNext"` requires `"moduleResolution": "NodeNext"` (implicit) — set it explicitly.

`"target": "ES2022"` ✓.

`"strict": true` ✓.

`"emitDecoratorMetadata": true`, `"experimentalDecorators": true` ✓.

`"useDefineForClassFields": false` ✓ (Nest ESM).

`"skipLibCheck": true` ✓ (avoids prisma type quirks).

`"outDir": "dist"`, `"rootDir": "src"` ✓.

`"sourceMap": true` is optional.

`"forceConsistentCasingInFileNames": true`.

`"noImplicitOverride": true`? Fine but the fake doesn't override; keep it off to reduce friction — drop it.

Now — one more consideration: **`import 'reflect-metadata'` in main.ts** — Nest 10 actually bundles the reflect-metadata import in @nestjs/core (it's a dependency and core imports it). An explicit import is harmless ✓ keep it.

Now — potential issue: **the `@Post('products')` route + the body parser** default ✓.

Now — I'll write the final answer. Also, double-check that no file references something undefined.

The fake-repository.ts imports: `BadRequestError, MethodologyVersionExistsError` from api-error.filter ✓ both exist. `PrismaService` type ✓. Repository types: ClassificationRepository (used in a comment? I said the fake is structurally compatible — I don't actually reference ClassificationRepository in the code... I don't reference it in a comment. Drop the import), IngredientInfo, MethodologyStatus, MethodologyVersionInput, MethodologyVersionView, ProfileView, ProductRow, RuleView, Severity, StoredResultView ✓ all used:
- IngredientInfo: findIngredients return ✓
- MethodologyStatus: SeededVersion.status ✓
- MethodologyVersionInput: publishVersion parameter ✓
- MethodologyVersionView: return ✓
- ProfileView: findProfileWithModifiers ✓
- ProductRow: products map + returns ✓
- RuleView: findRulesByVersion ✓
- Severity: various ✓
- StoredResultView: findResultsByProduct ✓

The fake's `upsertResult` parameter — I inline the shape `{ productId: string; methodologyVersionId: string; payload: object; confidence: number; worstSeverity: Severity | null }` — matches UpsertResultInput ✓ (I don't import UpsertResultInput — fine).

Now — the spec: check the imports are used: ClassificationController ✓, ClassificationService (the cast + the type of the service variable) ✓, ClassificationResponse (a cast) ✓, ApiEnvelopeFilter ✓, ProductNotFoundError ✓, HttpException ✓, HttpStatus ✓, ArgumentsHost ✓, FakeClassificationRepository — used? buildService wraps it; the spec may not use it directly → drop the import from the spec (used only in the fixtures). ✓ Drop.

The fixture's exports used in the spec: buildService, CHILD_PROFILE, NIGHT_CREAM, PEELING_GEL, PREGNANCY_PROFILE, SHUFFLED_NIGHT_CREAM, V1 ✓ (PEELING_GEL — is it used? I planned the resolution test to use a created product; PEELING_GEL is unused in the spec → an unused export is fine (it's in the fixtures, not an import). But I won't import it in the spec. Or use it: let me use PEELING_GEL in the resolution test for the Salixylic acid case — yes, use it (avoids an unused export and adds realism):

```ts
it('resolves case variants, accents, double spaces and OCR typos through synonyms', async () => {
  const peeling = await service.classify(PEELING_GEL);
  expect(peeling.ingredients.find((f) => f.input === 'Salixylic Acid')).toMatchObject({
    resolved: 'Salicylic acid', status: 'flagged', severity: 'watch', source: 'Curated watch list, 2024-01',
  });
  expect(peeling.ingredients.find((f) => f.input === 'T0COPHEROL')).toMatchObject({ resolved: 'Tocopherol', status: 'clear' });
  expect(peeling.unknowns).toEqual([]);
  expect(peeling.confidence).toBe(1);

  const { id } = await service.createProduct('Accent cream', ['Caféine', 'Retinyl  Palmitate', 'bha', 'WATER']);
  const result = await service.classify(id);
  expect(result.ingredients.find((f) => f.input === 'Caféine')).toMatchObject({ resolved: 'Caffeine', status: 'clear' });
  expect(result.ingredients.find((f) => f.input === 'Retinyl  Palmitate')).toMatchObject({ resolved: 'Retinyl palmitate', status: 'flagged', severity: 'watch' });
  expect(result.ingredients.find((f) => f.input === 'bha')).toMatchObject({ resolved: 'Salicylic acid', status: 'flagged' });
  expect(result.ingredients.find((f) => f.input === 'WATER')).toMatchObject({ resolved: 'Aqua', status: 'clear' });
  expect(result.confidence).toBe(1);
});
```
'WATER' → 'water' → the Aqua synonym ✓ a nice touch.

Now the fixture imports in the spec: PEELING_GEL ✓ used.

Now — the `V1` used ✓.

Also — confirm the `SHUFFLED_NIGHT_CREAM` in the fixture = the reversed copy: `[...NIGHT_CREAM_INCI].reverse()` ✓ different order.

Now — in the fixture, `NIGHT_CREAM_INCI` is exported (used internally + maybe in the spec? The spec doesn't need it; keep the export? An unused export is fine — I'll export it for clarity; or not. I'll keep the export (harmless)).

Now — the final check on the **service's `publishVersion`**: `existing.code` for the error — ✓.

Now — the **error's details** `ingredients: missing` — an array in details — details is an object with an array value ✓ fine ("details is an object, never null").

Now — the **controller's GET** route: `@Get('classifications')` — query validation:
```ts
listClassifications(@Query('product_id') productId?: string, @Query('methodology_version_id') methodologyVersionId?: string) {
  return this.service.listStoredResults(
    nonEmptyString({ product_id: productId }, 'product_id'),
    optionalNonEmptyString({ methodology_version_id: methodologyVersionId }, 'methodology_version_id'),
  );
}
```
✓.

Now — let me write everything out. One more format note: a fenced block for each file with the appropriate language tag (ts/prisma/sql/toml/json). The heading must contain only the path.

Also — "start with the first heading." No prose before or between (the prose is ignored anyway, but keep it to zero).

Let me also re-verify the **migration SQL** for the unique index names for composite uniques: Prisma's naming: `classification_results_product_id_methodology_version_id_key` ✓; `rules_methodology_version_id_ingredient_id_key` ✓; `profile_modifiers_profile_id_ingredient_id_key` ✓; `product_ingredients_product_id_position_key` ✓.

FK constraint naming: `classification_results_product_id_fkey`, `classification_results_methodology_version_id_fkey`, `rules_methodology_version_id_fkey`, `rules_ingredient_id_fkey`, `profile_modifiers_profile_id_fkey`, `profile_modifiers_ingredient_id_fkey`, `product_ingredients_product_id_fkey`, `ingredient_synonyms_ingredient_id_fkey` ✓.

Now, the **`methodology_versions_status_key`** unique index — created.

The SQL's `CREATE UNIQUE INDEX "methodology_versions_status_key" ON "methodology_versions"("status");` ✓.

Now — the final sanity check of the Prisma schema: the `Product` model's relation field name `ingredients` and the ProductIngredient model — Prisma's relation inference: two models with exactly one relation between them (Product ↔ ProductIngredient) — the fields: Product.ingredients (list), ProductIngredient.product (single) — inferred as one relation ✓.

Ingredient ↔ IngredientSynonym ✓. MethodologyVersion ↔ Rule ✓. MethodologyVersion ↔ ClassificationResult ✓. Product ↔ ClassificationResult ✓. Ingredient ↔ Rule ✓. Ingredient ↔ ProfileModifier ✓. FamilyProfile ↔ ProfileModifier ✓. All single pairs ✓.

The `@default(uuid())` + `@db.Uuid` ✓.

`payload Json` — maps to JSONB by default in PG ✓.

Now — I'll write the answer. Also, confirm the service file has no `Prisma` import ✓.

One more possible strict error in the service: `const [rules, ingredients] = await Promise.all([...])` — types inferred ✓.

`ruleByIngredient` loop construction:
```ts
const ruleByIngredient = new Map<string, RuleView>();
for (const rule of rules) {
  ruleByIngredient.set(rule.ingredientId, rule);
}
```
✓.

applyProfile:
```ts
const modifierByIngredient = new Map<string, ProfileView['modifiers'][number]>();
for (const modifier of profile.modifiers) {
  modifierByIngredient.set(modifier.ingredientId, modifier);
}
```
`ProfileView['modifiers'][number]` — a bit awkward; import the ProfileModifierView type instead? I defined ProfileModifierView in the repository — import it (type) and use it ✓ cleaner. Add it to the service's type imports.

Now the final service imports:
```ts
import { Injectable } from '@nestjs/common';
import { BadRequestError, MethodologyVersionExistsError, MethodologyVersionNotFoundError, NoActiveMethodologyError, ProfileNotFoundError, ProductNotFoundError } from '../common/api-error.filter.js';
import { ClassificationRepository } from './classification.repository.js';
import type { IngredientInfo, ProfileModifierView, ProfileView, ProductRow, ResolvedRuleInput, RuleView, Severity } from './classification.repository.js';
```
✓.

Controller imports:
```ts
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { BadRequestError } from '../common/api-error.filter.js';
import { ClassificationService } from './classification.service.js';
import type { RuleDraft } from './classification.service.js';
```
✓.

Now — the `api-error.filter.ts`'s `@Catch()` import ✓.

Also — `ErrorEnvelope` interface — used once; fine.

Let me write the final spec's filter section precisely:

```ts
describe('ApiEnvelopeFilter', () => {
  function fakeHost() {
    const state: { status: number; body: unknown } = { status: 0, body: undefined };
    const response = {
      status(code: number) {
        state.status = code;
        return { json(body: unknown) { state.body = body; } };
      },
    };
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
    return { state, host };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders ApiError as the documented envelope', () => {
    const { state, host } = fakeHost();
    new ApiEnvelopeFilter().catch(new ProductNotFoundError('p-404'), host);
    expect(state.status).toBe(404);
    expect(state.body).toEqual({
      error: { code: 'product_not_found', message: expect.any(String), details: { product_id: 'p-404' } },
    });
  });

  it('renders foreign HttpExceptions with the same envelope', () => {
    const { state, host } = fakeHost();
    new ApiEnvelopeFilter().catch(new HttpException('Invalid JSON', HttpStatus.BAD_REQUEST), host);
    expect(state.status).toBe(400);
    expect(state.body).toMatchObject({ error: { code: 'http_error', message: 'Invalid JSON' } });
  });

  it('falls back to internal_error for unexpected exceptions', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { state, host } = fakeHost();
    new ApiEnvelopeFilter().catch(new Error('boom'), host);
    expect(state.status).toBe(500);
    expect(state.body).toEqual({ error: { code: 'internal_error', message: expect.any(String), details: {} } });
  });
});
```

`catch` — a method named catch on my class — calling `filter.catch(...)` is fine.

Now — one more: the `ProductNotFoundError`'s message includes quotes; expect.any(String) ✓.

Now — the final fixture file:

```ts
import { ClassificationService } from '../src/classification/classification.service.js';
import { FakeClassificationRepository, type SeedData } from './fake-repository.js';
```
`import { FakeClassificationRepository, type SeedData }` — an inline type modifier ✓ TS 4.5+.

The rest as drafted. `buildService` returns `{ service, repository }`.

Now — let me write it all out. Also, note the spec's `beforeEach` — the import ✓.

Confirm the spec file has no `@nestjs/testing` import ✓ removed.

The package.json devDeps — without @nestjs/testing:
devDeps: @types/node, prisma, tsx, typescript, vitest ✓.

Also — is `rxjs` needed? @nestjs/common's peer? Nest 10 lists rxjs as a peer dependency (yes, rxjs ^7). Include it in deps ✓.

Now — the final check on the vitest version: `^1.6.0` — supports `test.include` etc. ✓. Or `^2.1.0`? 1.6 is fine with vite 5. Keep 1.6.

`tsx ^4.16.2` ✓.

`typescript ^5.5.3` ✓.

`@types/node ^20` ✓.

`@nestjs/* ^10.3.9` ✓.

`@prisma/client`/`prisma ^5.16.1` ✓.

Now — generate the answer. Watch the fence language tags: json for package.json, json for tsconfig, ts for TS files, prisma for the schema, sql for the migration, toml for the lock.

The heading must contain only the path. Let me finalize.

Actually — one more thought on **`prisma/migrations/20240601000000_init/migration.sql`** — the path contains digits; fine.

And the **migration_lock.toml** path `prisma/migrations/migration_lock.toml` ✓.

Let me also reconsider whether `GET /classifications` needs a `profile_id`... no.

And — the requirement "stored classification results keyed by (product, methodologyVersion)" — my StoredResultView includes methodologyVersionCode (a nice touch).

I think I'm ready. Also — a quick re-scan of the fake's `findProductWithIngredients` — returns a clone ✓.

And the fake's `publishVersion` — the `unknown` filter — the service pre-validates, so it's rarely triggered ✓.

The `nextId` for products in the fake — 'product-1' etc. — the seeded ones have their own ids ✓ no collision (the sequence starts at 0 → 'product-1'... the seed ids are different ✓).

Now — writing.

One more micro-detail: the service's `createProduct` — the controller already validates; the service delegates ✓.

And the controller's `createProduct` — the body's ingredients array elements — nonEmptyString on each via stringArray ✓.

Also — the `objectBody` for the `@Body()` when there's no body → undefined → typeof undefined !== 'object' → throws invalid_request ✓.

Final: the response of `POST /classifications` is the ClassificationResponse (201 by default for POST — fine).

I'll now write out the files.

Also, I'll double-check the `compareStable` function's chaining:
```ts
function compareStable(a: ClassificationFinding, b: ClassificationFinding): number {
  if (a.normalized !== b.normalized) return a.normalized < b.normalized ? -1 : 1;
  if (a.input !== b.input) return a.input < b.input ? -1 : 1;
  return 0;
}
```
Cleaner ✓.

`uniqueSorted`:
```ts
function uniqueSorted(values: string[]): string[] {
  const unique = [...new Set(values)];
  unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return unique;
}
```
✓.

Done thinking; I'll produce the answer.
```

## reply

### package.json
```json
{
  "name": "ingredient-classifier",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Classifies cosmetics from INCI ingredient lists against versioned, immutable methodology rules and family profile modifiers.",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "tsx prisma/seed.ts"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  },
  "postinstall": "prisma generate",
  "dependencies": {
    "@nestjs/common": "^10.3.9",
    "@nestjs/core": "^10.3.9",
    "@nestjs/platform-express": "^10.3.9",
    "@prisma/client": "^5.16.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.9",
    "prisma": "^5.16.1",
    "tsx": "^4.16.2",
    "typescript": "^5.5.3",
    "vitest": "^1.6.0"
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
    "rootDir": "src",
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"]
}
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    target: 'es2022',
    // esbuild cannot emit decorator metadata; the tests instantiate the
    // NestJS classes directly instead of going through the DI container.
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});
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

enum Severity {
  watch
  restricted
  banned
}

enum MethodologyStatus {
  draft
  active
  retired
}

model Ingredient {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @unique
  createdAt DateTime @default(now()) @map("created_at")

  synonyms  IngredientSynonym[]
  rules     Rule[]
  modifiers ProfileModifier[]

  @@map("ingredients")
}

// Matching terms (lower-case, accent-free form recommended); resolution
// normalises both the raw input and the stored term before lookup.
model IngredientSynonym {
  id           String     @id @default(uuid()) @db.Uuid
  term         String     @unique
  ingredientId String     @map("ingredient_id") @db.Uuid
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id], onDelete: Cascade)

  @@map("ingredient_synonyms")
}

// A methodology version is immutable once published: rules are only ever
// created, never updated. At most one version holds the "active" status.
model MethodologyVersion {
  id          String            @id @default(uuid()) @db.Uuid
  code        String            @unique
  status      MethodologyStatus @unique @default(draft)
  publishedAt DateTime?         @map("published_at")
  createdAt   DateTime          @default(now()) @map("created_at")

  rules   Rule[]
  results ClassificationResult[]

  @@map("methodology_versions")
}

model Rule {
  id                   String   @id @default(uuid()) @db.Uuid
  methodologyVersionId String   @map("methodology_version_id") @db.Uuid
  ingredientId         String   @map("ingredient_id") @db.Uuid
  severity             Severity
  source               String

  methodologyVersion MethodologyVersion @relation(fields: [methodologyVersionId], references: [id], onDelete: Cascade)
  ingredient         Ingredient         @relation(fields: [ingredientId], references: [id])

  @@unique([methodologyVersionId, ingredientId])
  @@map("rules")
}

model FamilyProfile {
  id          String   @id @default(uuid()) @db.Uuid
  name        String   @unique
  description String?

  modifiers ProfileModifier[]

  @@map("family_profiles")
}

// Contextual modifier: under this profile the ingredient is flagged at at
// least `severity`. Modifiers tighten base rules; they never loosen them.
model ProfileModifier {
  id           String   @id @default(uuid()) @db.Uuid
  profileId    String   @map("profile_id") @db.Uuid
  ingredientId String   @map("ingredient_id") @db.Uuid
  severity     Severity
  source       String
  reason       String?

  profile    FamilyProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
  ingredient Ingredient    @relation(fields: [ingredientId], references: [id])

  @@unique([profileId, ingredientId])
  @@map("profile_modifiers")
}

model Product {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  ingredients ProductIngredient[]
  results     ClassificationResult[]

  @@map("products")
}

model ProductIngredient {
  id        String  @id @default(uuid()) @db.Uuid
  productId String  @map("product_id") @db.Uuid
  position  Int
  rawName   String  @map("raw_name")

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([productId, position])
  @@map("product_ingredients")
}

// Profile-independent base classification, keyed by (product,
// methodologyVersion): re-scoring is an idempotent upsert.
model ClassificationResult {
  id                   String    @id @default(uuid()) @db.Uuid
  productId            String    @map("product_id") @db.Uuid
  methodologyVersionId String    @map("methodology_version_id") @db.Uuid
  payload              Json
  confidence           Float
  worstSeverity        Severity? @map("worst_severity")
  computedAt           DateTime  @default(now()) @map("computed_at")

  product            Product            @relation(fields: [productId], references: [id], onDelete: Cascade)
  methodologyVersion MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])

  @@unique([productId, methodologyVersionId])
  @@map("classification_results")
}
```

### prisma/migrations/migration_lock.toml
```toml
# Please do not edit this file manually
# It should be added to your version control system.
provider = "postgresql"
```

### prisma/migrations/20240601000000_init/migration.sql
```sql
-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('watch', 'restricted', 'banned');

CREATE TYPE "MethodologyStatus" AS ENUM ('draft', 'active', 'retired');

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_synonyms" (
    "id" UUID NOT NULL,
    "term" TEXT NOT NULL,
    "ingredient_id" UUID NOT NULL,

    CONSTRAINT "ingredient_synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_versions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "MethodologyStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "methodology_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" UUID NOT NULL,
    "methodology_version_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "severity" "Severity" NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_profiles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "family_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_modifiers" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "severity" "Severity" NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT,

    CONSTRAINT "profile_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_ingredients" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "raw_name" TEXT NOT NULL,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classification_results" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "methodology_version_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "worst_severity" "Severity",
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classification_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_name_key" ON "ingredients"("name");

CREATE UNIQUE INDEX "ingredient_synonyms_term_key" ON "ingredient_synonyms"("term");

CREATE UNIQUE INDEX "methodology_versions_code_key" ON "methodology_versions"("code");

CREATE UNIQUE INDEX "methodology_versions_status_key" ON "methodology_versions"("status");

CREATE UNIQUE INDEX "rules_methodology_version_id_ingredient_id_key" ON "rules"("methodology_version_id", "ingredient_id");

CREATE UNIQUE INDEX "family_profiles_name_key" ON "family_profiles"("name");

CREATE UNIQUE INDEX "profile_modifiers_profile_id_ingredient_id_key" ON "profile_modifiers"("profile_id", "ingredient_id");

CREATE UNIQUE INDEX "product_ingredients_product_id_position_key" ON "product_ingredients"("product_id", "position");

CREATE UNIQUE INDEX "classification_results_product_id_methodology_version_id_key" ON "classification_results"("product_id", "methodology_version_id");

-- AddForeignKey
ALTER TABLE "ingredient_synonyms" ADD CONSTRAINT "ingredient_synonyms_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rules" ADD CONSTRAINT "rules_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rules" ADD CONSTRAINT "rules_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "profile_modifiers" ADD CONSTRAINT "profile_modifiers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "family_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "profile_modifiers" ADD CONSTRAINT "profile_modifiers_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

### prisma/seed.ts
```ts
import { PrismaClient } from '@prisma/client';

/**
 * Baseline dataset for local development. Idempotent: safe to run repeatedly.
 * This file is the source of the synonym / OCR-typo fixtures the classifier
 * resolves raw INCI entries against (e.g. "t0copherol" -> "Tocopherol",
 * "salixylic acid" -> "Salicylic acid", "caféine" -> "Caffeine").
 */
const prisma = new PrismaClient();

async function upsertIngredient(name: string, synonyms: string[]) {
  const ingredient = await prisma.ingredient.upsert({
    where: { name },
    update: {},
    create: { name },
  });
  for (const term of synonyms) {
    await prisma.ingredientSynonym.upsert({
      where: { term },
      update: { ingredientId: ingredient.id },
      create: { ingredientId: ingredient.id, term },
    });
  }
  return ingredient;
}

async function main() {
  const [aqua, caffeine, limonene, salicylic, tocopherol, retinyl, benzoyl] = await Promise.all([
    upsertIngredient('Aqua', ['water']),
    upsertIngredient('Caffeine', ['cafeine']),
    upsertIngredient('Limonene', []),
    upsertIngredient('Salicylic acid', ['salixylic acid', 'bha', 'beta-hydroxy acid']),
    upsertIngredient('Tocopherol', ['t0copherol', 'vitamin e']),
    upsertIngredient('Retinyl palmitate', ['retinyl-palmitate']),
    upsertIngredient('Benzoyl peroxide', []),
  ]);

  const existingVersion = await prisma.methodologyVersion.findUnique({ where: { code: '2024.1' } });
  if (!existingVersion) {
    const active = await prisma.methodologyVersion.findUnique({ where: { status: 'active' } });
    if (active) {
      await prisma.methodologyVersion.update({ where: { id: active.id }, data: { status: 'retired' } });
    }
    await prisma.methodologyVersion.create({
      data: {
        code: '2024.1',
        status: 'active',
        publishedAt: new Date(),
        rules: {
          create: [
            { ingredientId: benzoyl.id, severity: 'restricted', source: 'EU Reg 1223/2009, Annex III, 315-1' },
            { ingredientId: retinyl.id, severity: 'watch', source: 'Curated watch list, 2024-01' },
            { ingredientId: salicylic.id, severity: 'watch', source: 'Curated watch list, 2024-01' },
          ],
        },
      },
    });
  }

  const child = await prisma.familyProfile.upsert({
    where: { name: 'child_under_3' },
    update: {},
    create: { name: 'child_under_3', description: 'Child under 3 years old.' },
  });
  const childModifiers = [
    {
      ingredientId: limonene.id,
      severity: 'restricted' as const,
      source: 'AAP position paper, 2023',
      reason: 'Strong fragrance; skin sensitivity in young children.',
    },
    {
      ingredientId: retinyl.id,
      severity: 'banned' as const,
      source: 'FDA 2023 advisory on retinoids',
      reason: 'Retinoids are avoided for children.',
    },
  ];
  for (const modifier of childModifiers) {
    await prisma.profileModifier.upsert({
      where: { profileId_ingredientId: { profileId: child.id, ingredientId: modifier.ingredientId } },
      update: modifier,
      create: { profileId: child.id, ...modifier },
    });
  }

  const pregnancy = await prisma.familyProfile.upsert({
    where: { name: 'pregnancy' },
    update: {},
    create: { name: 'pregnancy', description: 'Pregnancy or breastfeeding.' },
  });
  await prisma.profileModifier.upsert({
    where: { profileId_ingredientId: { profileId: pregnancy.id, ingredientId: retinyl.id } },
    update: {
      severity: 'banned' as const,
      source: 'FDA 2023 advisory on retinoids',
      reason: 'Retinoids are contraindicated in pregnancy.',
    },
    create: {
      profileId: pregnancy.id,
      ingredientId: retinyl.id,
      severity: 'banned',
      source: 'FDA 2023 advisory on retinoids',
      reason: 'Retinoids are contraindicated in pregnancy.',
    },
  });

  const products: Array<{ name: string; inci: string[] }> = [
    {
      name: 'Night cream',
      inci: ['Aqua', 'Retinyl  Palmitate', 'T0COPHEROL', 'Limonene', 'Caféine', 'Mystery Butter X'],
    },
    { name: 'Peeling gel', inci: ['Salixylic Acid', 'Aqua', 'T0COPHEROL'] },
  ];
  for (const product of products) {
    const existing = await prisma.product.findFirst({ where: { name: product.name } });
    if (!existing) {
      await prisma.product.create({
        data: {
          name: product.name,
          ingredients: {
            create: product.inci.map((rawName, index) => ({ position: index + 1, rawName })),
          },
        },
      });
    }
  }

  const counts = await Promise.all([
    prisma.ingredient.count(),
    prisma.ingredientSynonym.count(),
    prisma.methodologyVersion.count(),
    prisma.familyProfile.count(),
    prisma.product.count(),
  ]);
  // eslint-disable-next-line no-console
  console.log(
    `Seeded: ${counts[0]} ingredients, ${counts[1]} synonyms, ` +
      `${counts[2]} methodology versions, ${counts[3]} profiles, ${counts[4]} products.`,
  );
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

### src/main.ts
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ApiEnvelopeFilter } from './common/api-error.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiEnvelopeFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { ClassificationModule } from './classification/classification.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, ClassificationModule],
})
export class AppModule {}
```

### src/common/api-error.filter.ts
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

/**
 * Every error in the API uses a single envelope:
 * { "error": { "code": "snake_case", "message": "...", "details": {} } }
 * `code` is the stable contract, `message` is developer-facing English, and
 * `details` is always an object (never null).
 */
export class ApiError extends HttpException {
  constructor(
    readonly code: string,
    readonly message: string,
    status: HttpStatus,
    readonly details: Record<string, unknown> = {},
  ) {
    super({ error: { code, message, details } }, status);
  }
}

export class BadRequestError extends ApiError {
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(code, message, HttpStatus.BAD_REQUEST, details);
  }
}

export class ProductNotFoundError extends ApiError {
  constructor(productId: string) {
    super('product_not_found', `Product "${productId}" was not found.`, HttpStatus.NOT_FOUND, {
      product_id: productId,
    });
  }
}

export class ProfileNotFoundError extends ApiError {
  constructor(profileId: string) {
    super('profile_not_found', `Family profile "${profileId}" was not found.`, HttpStatus.NOT_FOUND, {
      profile_id: profileId,
    });
  }
}

export class MethodologyVersionNotFoundError extends ApiError {
  constructor(methodologyVersionId: string) {
    super(
      'methodology_version_not_found',
      `Methodology version "${methodologyVersionId}" was not found.`,
      HttpStatus.NOT_FOUND,
      { methodology_version_id: methodologyVersionId },
    );
  }
}

export class NoActiveMethodologyError extends ApiError {
  constructor() {
    super(
      'no_active_methodology',
      'No methodology version is active; publish one before classifying.',
      HttpStatus.CONFLICT,
      {},
    );
  }
}

export class MethodologyVersionExistsError extends ApiError {
  constructor(code: string) {
    super('methodology_version_exists', `Methodology version "${code}" is already published.`, HttpStatus.CONFLICT, {
      code,
    });
  }
}

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

@Catch()
export class ApiEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse() as {
      status(code: number): { json(body: unknown): void };
    };

    if (exception instanceof ApiError) {
      const envelope: ErrorEnvelope = {
        error: { code: exception.code, message: exception.message, details: exception.details },
      };
      response.status(exception.getStatus()).json(envelope);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        response.status(status).json({ error: { code: 'http_error', message: payload, details: { http_status: status } } });
        return;
      }
      const body = payload as Record<string, unknown>;
      const code = typeof body.code === 'string' ? body.code : 'http_error';
      const message =
        typeof body.message === 'string'
          ? body.message
          : Array.isArray(body.message)
            ? body.message.join('; ')
            : `HTTP ${status}`;
      const details = body.details && typeof body.details === 'object' ? (body.details as Record<string, unknown>) : {};
      response.status(status).json({ error: { code, message, details } });
      return;
    }

    // eslint-disable-next-line no-console
    console.error('Unhandled exception:', exception);
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: { code: 'internal_error', message: 'Unexpected server error.', details: {} } });
  }
}
```

### src/prisma/prisma.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### src/prisma/prisma.service.ts
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

### src/classification/classification.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ClassificationController } from './classification.controller.js';
import { ClassificationRepository } from './classification.repository.js';
import { ClassificationService } from './classification.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
})
export class ClassificationModule {}
```

### src/classification/classification.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type Severity = 'watch' | 'restricted' | 'banned';
export type MethodologyStatus = 'draft' | 'active' | 'retired';

export interface ProductRow {
  id: string;
  name: string;
  ingredients: Array<{ position: number; raw: string }>;
}

export interface MethodologyVersionView {
  id: string;
  code: string;
  status: MethodologyStatus;
}

export interface RuleView {
  ingredientId: string;
  ingredientName: string;
  severity: Severity;
  source: string;
}

export interface ResolvedRuleInput {
  ingredientId: string;
  severity: Severity;
  source: string;
}

export interface MethodologyVersionInput {
  code: string;
  rules: ResolvedRuleInput[];
}

export interface IngredientInfo {
  id: string;
  name: string;
  synonyms: string[];
}

export interface ProfileModifierView {
  ingredientId: string;
  severity: Severity;
  source: string;
  reason?: string | null;
}

export interface ProfileView {
  id: string;
  name: string;
  modifiers: ProfileModifierView[];
}

export interface UpsertResultInput {
  productId: string;
  methodologyVersionId: string;
  payload: object;
  confidence: number;
  worstSeverity: Severity | null;
}

export interface StoredResultView {
  id: string;
  productId: string;
  methodologyVersionId: string;
  methodologyVersionCode: string;
  payload: unknown;
  confidence: number;
  worstSeverity: Severity | null;
  computedAt: string;
}

@Injectable()
export class ClassificationRepository {
  constructor(readonly prisma: PrismaService) {}

  async createProduct(name: string, rawIngredients: string[]): Promise<{ id: string; name: string }> {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({ data: { name } });
      if (rawIngredients.length > 0) {
        await tx.productIngredient.createMany({
          data: rawIngredients.map((rawName, index) => ({
            productId: product.id,
            position: index + 1,
            rawName,
          })),
        });
      }
      return { id: product.id, name: product.name };
    });
  }

  async findProductWithIngredients(id: string): Promise<ProductRow | null> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { ingredients: { orderBy: { position: 'asc' } } },
    });
    if (!product) return null;
    return {
      id: product.id,
      name: product.name,
      ingredients: product.ingredients.map((line) => ({ position: line.position, raw: line.rawName })),
    };
  }

  async listProducts(): Promise<ProductRow[]> {
    const products = await this.prisma.product.findMany({
      orderBy: { id: 'asc' },
      include: { ingredients: { orderBy: { position: 'asc' } } },
    });
    return products.map((product) => ({
      id: product.id,
      name: product.name,
      ingredients: product.ingredients.map((line) => ({ position: line.position, raw: line.rawName })),
    }));
  }

  async findActiveMethodology(): Promise<MethodologyVersionView | null> {
    const version = await this.prisma.methodologyVersion.findUnique({ where: { status: 'active' } });
    return version ? { id: version.id, code: version.code, status: version.status } : null;
  }

  async findMethodologyById(id: string): Promise<MethodologyVersionView | null> {
    const version = await this.prisma.methodologyVersion.findUnique({ where: { id } });
    return version ? { id: version.id, code: version.code, status: version.status } : null;
  }

  async findMethodologyByCode(code: string): Promise<MethodologyVersionView | null> {
    const version = await this.prisma.methodologyVersion.findUnique({ where: { code } });
    return version ? { id: version.id, code: version.code, status: version.status } : null;
  }

  /**
   * Publishes a new active version: the previous active version is retired in
   * the same transaction, and the new version's rules are created. Version
   * content is never modified afterwards (immutability by construction).
   */
  async publishVersion(input: MethodologyVersionInput): Promise<MethodologyVersionView> {
    const version = await this.prisma.$transaction(async (tx) => {
      const active = await tx.methodologyVersion.findUnique({ where: { status: 'active' } });
      if (active) {
        await tx.methodologyVersion.update({ where: { id: active.id }, data: { status: 'retired' } });
      }
      return tx.methodologyVersion.create({
        data: {
          code: input.code,
          status: 'active',
          publishedAt: new Date(),
          rules: {
            create: input.rules.map((rule) => ({
              ingredientId: rule.ingredientId,
              severity: rule.severity,
              source: rule.source,
            })),
          },
        },
      });
    });
    return { id: version.id, code: version.code, status: version.status };
  }

  async findRulesByVersion(methodologyVersionId: string): Promise<RuleView[]> {
    const rules = await this.prisma.rule.findMany({
      where: { methodologyVersionId },
      include: { ingredient: { select: { name: true } } },
    });
    return rules.map((rule) => ({
      ingredientId: rule.ingredientId,
      ingredientName: rule.ingredient.name,
      severity: rule.severity,
      source: rule.source,
    }));
  }

  async findIngredients(): Promise<IngredientInfo[]> {
    const ingredients = await this.prisma.ingredient.findMany({
      orderBy: { name: 'asc' },
      include: { synonyms: { orderBy: { term: 'asc' }, select: { term: true } } },
    });
    return ingredients.map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      synonyms: ingredient.synonyms.map((synonym) => synonym.term),
    }));
  }

  async findProfileWithModifiers(id: string): Promise<ProfileView | null> {
    const profile = await this.prisma.familyProfile.findUnique({
      where: { id },
      include: { modifiers: true },
    });
    if (!profile) return null;
    return {
      id: profile.id,
      name: profile.name,
      modifiers: profile.modifiers.map((modifier) => ({
        ingredientId: modifier.ingredientId,
        severity: modifier.severity,
        source: modifier.source,
        reason: modifier.reason,
      })),
    };
  }

  /** Idempotent upsert keyed by (product, methodologyVersion). */
  async upsertResult(input: UpsertResultInput): Promise<{ id: string }> {
    const result = await this.prisma.classificationResult.upsert({
      where: {
        productId_methodologyVersionId: {
          productId: input.productId,
          methodologyVersionId: input.methodologyVersionId,
        },
      },
      update: {
        payload: input.payload as Prisma.InputJsonValue,
        confidence: input.confidence,
        worstSeverity: input.worstSeverity,
        computedAt: new Date(),
      },
      create: {
        productId: input.productId,
        methodologyVersionId: input.methodologyVersionId,
        payload: input.payload as Prisma.InputJsonValue,
        confidence: input.confidence,
        worstSeverity: input.worstSeverity,
      },
    });
    return { id: result.id };
  }

  async findResultsByProduct(productId: string, methodologyVersionId?: string): Promise<StoredResultView[]> {
    const results = await this.prisma.classificationResult.findMany({
      where: { productId, ...(methodologyVersionId ? { methodologyVersionId } : {}) },
      orderBy: { computedAt: 'asc' },
      include: { methodologyVersion: { select: { code: true } } },
    });
    return results.map((result) => ({
      id: result.id,
      productId: result.productId,
      methodologyVersionId: result.methodologyVersionId,
      methodologyVersionCode: result.methodologyVersion.code,
      payload: result.payload,
      confidence: result.confidence,
      worstSeverity: result.worstSeverity,
      computedAt: result.computedAt.toISOString(),
    }));
  }
}
```

### src/classification/classification.service.ts
```ts
import { Injectable } from '@nestjs/common';
import {
  BadRequestError,
  MethodologyVersionExistsError,
  MethodologyVersionNotFoundError,
  NoActiveMethodologyError,
  ProfileNotFoundError,
  ProductNotFoundError,
} from '../common/api-error.filter.js';
import { ClassificationRepository } from './classification.repository.js';
import type {
  IngredientInfo,
  ProfileModifierView,
  ProfileView,
  ProductRow,
  ResolvedRuleInput,
  RuleView,
  Severity,
} from './classification.repository.js';

/** Shown on every classification; the API never issues a binary safe/toxic verdict. */
export const DISCLAIMER =
  'Informational screening only. Findings are not a safety or regulatory judgment, and the absence of a ' +
  'flag does not mean a product is safe. Unknown ingredients could not be matched to a known substance ' +
  'and should be verified manually.';

export type FindingStatus = 'flagged' | 'clear' | 'unknown';
export type FindingOrigin = 'base' | 'profile_modifier';

export interface ClassificationFinding {
  /** Raw INCI entry exactly as stored on the product. */
  input: string;
  /** Lower-cased, accent-free, whitespace-collapsed form used for matching. */
  normalized: string;
  /** Canonical ingredient name when the input resolved, else null. */
  resolved: string | null;
  /** Internal ingredient id when the input resolved, else null. */
  ingredient_id: string | null;
  status: FindingStatus;
  flagged: boolean;
  /** Final severity after profile modifiers. */
  severity: Severity | null;
  /** Severity from the active methodology's base rules (null when the base did not flag it). */
  base_severity: Severity | null;
  /** Final source citation (the profile modifier's when the profile tightened the finding). */
  source: string | null;
  /** Base rule citation, kept for traceability when the profile tightened the finding. */
  base_source: string | null;
  origin: FindingOrigin;
  note: string | null;
}

export interface ClassificationSummary {
  watch: number;
  restricted: number;
  banned: number;
}

export interface ClassificationResponse {
  product_id: string;
  methodology_version: string;
  profile: { id: string; name: string } | null;
  ingredients: ClassificationFinding[];
  /** Normalized inputs that could not be resolved to a known ingredient, sorted. */
  unknowns: string[];
  /** Share of listed ingredients that resolved to a known substance (1 = all known). */
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

export interface RuleDraft {
  /** Ingredient canonical name or synonym. */
  ingredient: string;
  severity: Severity;
  source: string;
}

const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };

interface IndexedIngredient {
  id: string;
  name: string;
}

@Injectable()
export class ClassificationService {
  constructor(readonly repository: ClassificationRepository) {}

  async createProduct(name: string, rawIngredients: string[]): Promise<{ id: string; name: string }> {
    return this.repository.createProduct(name, rawIngredients);
  }

  /**
   * Classify a product under the active methodology, optionally tightened by a
   * family profile. The profile-independent base result is stored under
   * (product, methodologyVersion) on every call; profile modifiers are applied
   * on top for the response only and are never persisted.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationResponse> {
    const product = await this.repository.findProductWithIngredients(productId);
    if (!product) throw new ProductNotFoundError(productId);

    const methodology = await this.repository.findActiveMethodology();
    if (!methodology) throw new NoActiveMethodologyError();

    const profile = profileId ? await this.repository.findProfileWithModifiers(profileId) : null;
    if (profileId && !profile) throw new ProfileNotFoundError(profileId);

    const [rules, ingredients] = await Promise.all([
      this.repository.findRulesByVersion(methodology.id),
      this.repository.findIngredients(),
    ]);

    const base = this.buildBaseClassification(product, methodology.code, rules, buildIngredientIndex(ingredients));
    await this.repository.upsertResult({
      productId: product.id,
      methodologyVersionId: methodology.id,
      payload: base,
      confidence: base.confidence,
      worstSeverity: worstSeverityOf(base.summary),
    });

    return profile ? this.applyProfile(base, profile) : base;
  }

  /**
   * Publish a new (immutable) methodology version: it becomes the active one,
   * the previous active version is retired, and every product is re-scored
   * against it. Results of earlier versions remain stored and retrievable.
   */
  async publishVersion(input: { code: string; rules: RuleDraft[] }): Promise<{
    id: string;
    code: string;
    status: 'active';
    published: boolean;
    rescanned_products: number;
  }> {
    const existing = await this.repository.findMethodologyByCode(input.code);
    if (existing) throw new MethodologyVersionExistsError(existing.code);

    const index = buildIngredientIndex(await this.repository.findIngredients());
    const resolved: ResolvedRuleInput[] = [];
    const missing: string[] = [];
    for (const draft of input.rules) {
      const entry = index.get(normalizeTerm(draft.ingredient));
      if (!entry) {
        missing.push(draft.ingredient);
        continue;
      }
      resolved.push({ ingredientId: entry.id, severity: draft.severity, source: draft.source });
    }
    if (missing.length > 0) {
      throw new BadRequestError(
        'unknown_ingredient_in_rule',
        'Every rule must reference a known ingredient (canonical name or synonym).',
        { ingredients: missing },
      );
    }

    const version = await this.repository.publishVersion({ code: input.code, rules: resolved });
    const rescannedProducts = await this.rescoreVersion(version.id);
    return {
      id: version.id,
      code: version.code,
      status: 'active',
      published: true,
      rescanned_products: rescannedProducts,
    };
  }

  /**
   * Re-score every product against a methodology version. Idempotent: the
   * payload is a pure function of (ingredients, rules, synonyms) and results
   * are upserted on (product, methodologyVersion), so repeating it is a no-op.
   */
  async rescoreVersion(methodologyVersionId: string): Promise<number> {
    const version = await this.repository.findMethodologyById(methodologyVersionId);
    if (!version) throw new MethodologyVersionNotFoundError(methodologyVersionId);

    const [rules, ingredients, products] = await Promise.all([
      this.repository.findRulesByVersion(methodologyVersionId),
      this.repository.findIngredients(),
      this.repository.listProducts(),
    ]);
    const index = buildIngredientIndex(ingredients);
    for (const product of products) {
      const base = this.buildBaseClassification(product, version.code, rules, index);
      await this.repository.upsertResult({
        productId: product.id,
        methodologyVersionId,
        payload: base,
        confidence: base.confidence,
        worstSeverity: worstSeverityOf(base.summary),
      });
    }
    return products.length;
  }

  async listStoredResults(productId: string, methodologyVersionId?: string) {
    return this.repository.findResultsByProduct(productId, methodologyVersionId);
  }

  private buildBaseClassification(
    product: ProductRow,
    methodologyVersion: string,
    rules: RuleView[],
    index: Map<string, IndexedIngredient>,
  ): ClassificationResponse {
    const ruleByIngredient = new Map<string, RuleView>();
    for (const rule of rules) {
      ruleByIngredient.set(rule.ingredientId, rule);
    }

    const findings: ClassificationFinding[] = product.ingredients.map((line) => {
      const normalized = normalizeTerm(line.raw);
      const entry = index.get(normalized);
      if (!entry) {
        return {
          input: line.raw,
          normalized,
          resolved: null,
          ingredient_id: null,
          status: 'unknown',
          flagged: false,
          severity: null,
          base_severity: null,
          source: null,
          base_source: null,
          origin: 'base',
          note: null,
        };
      }
      const rule = ruleByIngredient.get(entry.id) ?? null;
      return {
        input: line.raw,
        normalized,
        resolved: entry.name,
        ingredient_id: entry.id,
        status: rule ? 'flagged' : 'clear',
        flagged: rule !== null,
        severity: rule ? rule.severity : null,
        base_severity: rule ? rule.severity : null,
        source: rule ? rule.source : null,
        base_source: rule ? rule.source : null,
        origin: 'base',
        note: null,
      };
    });

    // Stable byte-wise order (normalized name, then raw input). Sorting rather
    // than using the stored INCI position is what makes results independent of
    // the order the ingredients were entered in.
    findings.sort(compareStable);

    const unknownFindings = findings.filter((finding) => finding.status === 'unknown');
    const unknowns = uniqueSorted(unknownFindings.map((finding) => finding.normalized));
    const total = findings.length;
    const confidence = total === 0 ? 1 : round4((total - unknownFindings.length) / total);

    const summary: ClassificationSummary = { watch: 0, restricted: 0, banned: 0 };
    for (const finding of findings) {
      if (finding.severity) summary[finding.severity] += 1;
    }

    return {
      product_id: product.id,
      methodology_version: methodologyVersion,
      profile: null,
      ingredients: findings,
      unknowns,
      confidence,
      summary,
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Defined precedence: the active methodology's base rules first, then the
   * profile's contextual modifiers. Modifiers only tighten: they may escalate
   * a flagged ingredient or introduce a new flag, but never loosen a base
   * finding.
   */
  private applyProfile(base: ClassificationResponse, profile: ProfileView): ClassificationResponse {
    const modifierByIngredient = new Map<string, ProfileModifierView>();
    for (const modifier of profile.modifiers) {
      modifierByIngredient.set(modifier.ingredientId, modifier);
    }

    const ingredients = base.ingredients.map((finding) => {
      if (finding.status === 'unknown') return finding;
      const modifier = finding.ingredient_id ? modifierByIngredient.get(finding.ingredient_id) : undefined;
      if (!modifier) return finding;
      if (finding.base_severity !== null && SEVERITY_RANK[modifier.severity] <= SEVERITY_RANK[finding.base_severity]) {
        return finding; // modifiers tighten only
      }
      return {
        ...finding,
        status: 'flagged',
        flagged: true,
        severity: modifier.severity,
        source: modifier.source,
        origin: 'profile_modifier',
        note: modifier.reason ?? null,
      };
    });

    const summary: ClassificationSummary = { watch: 0, restricted: 0, banned: 0 };
    for (const finding of ingredients) {
      if (finding.severity) summary[finding.severity] += 1;
    }

    return { ...base, profile: { id: profile.id, name: profile.name }, ingredients, summary };
  }
}

/** Lower-case, strip accents, collapse whitespace. Deterministic across environments. */
export function normalizeTerm(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}

function buildIngredientIndex(ingredients: IngredientInfo[]): Map<string, IndexedIngredient> {
  const index = new Map<string, IndexedIngredient>();
  for (const ingredient of ingredients) {
    index.set(normalizeTerm(ingredient.name), { id: ingredient.id, name: ingredient.name });
  }
  for (const ingredient of ingredients) {
    for (const synonym of ingredient.synonyms) {
      // Canonical names always win; the first synonym wins a synonym collision.
      const term = normalizeTerm(synonym);
      if (!index.has(term)) {
        index.set(term, { id: ingredient.id, name: ingredient.name });
      }
    }
  }
  return index;
}

function compareStable(a: ClassificationFinding, b: ClassificationFinding): number {
  if (a.normalized !== b.normalized) return a.normalized < b.normalized ? -1 : 1;
  if (a.input !== b.input) return a.input < b.input ? -1 : 1;
  return 0;
}

function uniqueSorted(values: string[]): string[] {
  const unique = [...new Set(values)];
  unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return unique;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function worstSeverityOf(summary: ClassificationSummary): Severity | null {
  if (summary.banned > 0) return 'banned';
  if (summary.restricted > 0) return 'restricted';
  if (summary.watch > 0) return 'watch';
  return null;
}
```

### src/classification/classification.controller.ts
```ts
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { BadRequestError } from '../common/api-error.filter.js';
import { ClassificationService } from './classification.service.js';
import type { RuleDraft } from './classification.service.js';

const SEVERITIES: readonly RuleDraft['severity'][] = ['watch', 'restricted', 'banned'];

@Controller()
export class ClassificationController {
  constructor(readonly service: ClassificationService) {}

  @Post('products')
  createProduct(@Body() body: unknown) {
    const data = objectBody(body);
    const name = nonEmptyString(data, 'name');
    const ingredients = stringArray(data, 'ingredients');
    return this.service.createProduct(name, ingredients);
  }

  @Post('classifications')
  classify(@Body() body: unknown) {
    const data = objectBody(body);
    const productId = nonEmptyString(data, 'product_id');
    const profileId = optionalNonEmptyString(data, 'profile_id');
    return this.service.classify(productId, profileId);
  }

  @Get('classifications')
  listClassifications(@Query('product_id') productId?: string, @Query('methodology_version_id') methodologyVersionId?: string) {
    const requiredProductId = nonEmptyString({ product_id: productId }, 'product_id');
    const versionId = optionalNonEmptyString({ methodology_version_id: methodologyVersionId }, 'methodology_version_id');
    return this.service.listStoredResults(requiredProductId, versionId);
  }

  @Post('methodology-versions')
  publishMethodologyVersion(@Body() body: unknown) {
    const data = objectBody(body);
    const code = nonEmptyString(data, 'code');
    const rulesRaw = array(data, 'rules');
    const rules: RuleDraft[] = rulesRaw.map((entry, position) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new BadRequestError('invalid_request', `rules[${position}] must be an object.`, {
          field: `rules[${position}]`,
        });
      }
      const rule = entry as Record<string, unknown>;
      const ingredient = nonEmptyString(rule, 'ingredient');
      const severity = rule.severity;
      if (typeof severity !== 'string' || !SEVERITIES.includes(severity as RuleDraft['severity'])) {
        throw new BadRequestError(
          'invalid_severity',
          `rules[${position}].severity must be one of: ${SEVERITIES.join(', ')}.`,
          { field: `rules[${position}].severity` },
        );
      }
      const source = nonEmptyString(rule, 'source');
      return { ingredient, severity, source };
    });
    return this.service.publishVersion({ code, rules });
  }
}

function objectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestError('invalid_request', 'Request body must be a JSON object.', {});
  }
  return body as Record<string, unknown>;
}

function nonEmptyString(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be a non-empty string.`, { field });
  }
  return value;
}

function optionalNonEmptyString(data: Record<string, unknown>, field: string): string | undefined {
  const value = data[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be a non-empty string when provided.`, {
      field,
    });
  }
  return value;
}

function stringArray(data: Record<string, unknown>, field: string): string[] {
  const value = data[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be an array of non-empty strings.`, {
      field,
    });
  }
  return value;
}

function array(data: Record<string, unknown>, field: string): unknown[] {
  const value = data[field];
  if (!Array.isArray(value)) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be an array.`, { field });
  }
  return value;
}
```

### test/fixtures.ts
```ts
import { ClassificationService } from '../src/classification/classification.service.js';
import { FakeClassificationRepository, type SeedData } from './fake-repository.js';

export const NIGHT_CREAM = 'product-night-cream';
export const PEELING_GEL = 'product-peeling-gel';
export const SHUFFLED_NIGHT_CREAM = 'product-night-cream-shuffled';
export const V1 = 'version-2024.1';
export const CHILD_PROFILE = 'profile-child-under-3';
export const PREGNANCY_PROFILE = 'profile-pregnancy';

const INGREDIENTS = {
  aqua: 'ing-aqua',
  caffeine: 'ing-caffeine',
  limonene: 'ing-limonene',
  salicylic: 'ing-salicylic-acid',
  tocopherol: 'ing-tocopherol',
  retinyl: 'ing-retinyl-palmitate',
  benzoyl: 'ing-benzoyl-peroxide',
};

export const NIGHT_CREAM_INCI = [
  'Aqua',
  'Retinyl  Palmitate',
  'T0COPHEROL',
  'Limonene',
  'Caféine',
  'Mystery Butter X',
];

export interface SeedOptions {
  withActiveVersion?: boolean;
}

export function makeSeed(options: SeedOptions = {}): SeedData {
  const active = options.withActiveVersion !== false;
  return {
    ingredients: [
      { id: INGREDIENTS.aqua, name: 'Aqua', synonyms: ['water'] },
      { id: INGREDIENTS.caffeine, name: 'Caffeine', synonyms: ['cafeine'] },
      { id: INGREDIENTS.limonene, name: 'Limonene', synonyms: [] },
      { id: INGREDIENTS.salicylic, name: 'Salicylic acid', synonyms: ['salixylic acid', 'bha', 'beta-hydroxy acid'] },
      { id: INGREDIENTS.tocopherol, name: 'Tocopherol', synonyms: ['t0copherol', 'vitamin e'] },
      { id: INGREDIENTS.retinyl, name: 'Retinyl palmitate', synonyms: ['retinyl-palmitate'] },
      { id: INGREDIENTS.benzoyl, name: 'Benzoyl peroxide', synonyms: [] },
    ],
    versions: [
      {
        id: V1,
        code: '2024.1',
        status: active ? 'active' : 'retired',
        rules: [
          { ingredientId: INGREDIENTS.benzoyl, severity: 'restricted', source: 'EU Reg 1223/2009, Annex III, 315-1' },
          { ingredientId: INGREDIENTS.retinyl, severity: 'watch', source: 'Curated watch list, 2024-01' },
          { ingredientId: INGREDIENTS.salicylic, severity: 'watch', source: 'Curated watch list, 2024-01' },
        ],
      },
    ],
    profiles: [
      {
        id: CHILD_PROFILE,
        name: 'child_under_3',
        modifiers: [
          {
            profileId: CHILD_PROFILE,
            ingredientId: INGREDIENTS.limonene,
            severity: 'restricted',
            source: 'AAP position paper, 2023',
            reason: 'Strong fragrance; skin sensitivity in young children.',
          },
          {
            profileId: CHILD_PROFILE,
            ingredientId: INGREDIENTS.retinyl,
            severity: 'banned',
            source: 'FDA 2023 advisory on retinoids',
            reason: 'Retinoids are avoided for children.',
          },
        ],
      },
      {
        id: PREGNANCY_PROFILE,
        name: 'pregnancy',
        modifiers: [
          {
            profileId: PREGNANCY_PROFILE,
            ingredientId: INGREDIENTS.retinyl,
            severity: 'banned',
            source: 'FDA 2023 advisory on retinoids',
            reason: 'Retinoids are contraindicated in pregnancy.',
          },
        ],
      },
    ],
    products: [
      { id: NIGHT_CREAM, name: 'Night cream', ingredients: NIGHT_CREAM_INCI },
      { id: PEELING_GEL, name: 'Peeling gel', ingredients: ['Salixylic Acid', 'Aqua', 'T0COPHEROL'] },
      { id: SHUFFLED_NIGHT_CREAM, name: 'Night cream (re-entered)', ingredients: [...NIGHT_CREAM_INCI].reverse() },
    ],
  };
}

export function buildService(options: SeedOptions = {}): {
  service: ClassificationService;
  repository: FakeClassificationRepository;
} {
  const repository = new FakeClassificationRepository(makeSeed(options));
  return { service: new ClassificationService(repository), repository };
}
```

### test/fake-repository.ts
```ts
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { BadRequestError, MethodologyVersionExistsError } from '../src/common/api-error.filter.js';
import type {
  IngredientInfo,
  MethodologyStatus,
  MethodologyVersionInput,
  MethodologyVersionView,
  ProfileView,
  ProductRow,
  RuleView,
  Severity,
  StoredResultView,
} from '../src/classification/classification.repository.js';

export interface SeededIngredient {
  id: string;
  name: string;
  synonyms: string[];
}

export interface SeededRule {
  ingredientId: string;
  severity: Severity;
  source: string;
}

export interface SeededVersion {
  id: string;
  code: string;
  status: MethodologyStatus;
  rules: SeededRule[];
}

export interface SeededModifier {
  profileId: string;
  ingredientId: string;
  severity: Severity;
  source: string;
  reason?: string;
}

export interface SeededProfile {
  id: string;
  name: string;
  modifiers: SeededModifier[];
}

export interface SeededProduct {
  id: string;
  name: string;
  ingredients: string[];
}

export interface SeedData {
  ingredients: SeededIngredient[];
  versions: SeededVersion[];
  profiles: SeededProfile[];
  products: SeededProduct[];
}

interface StoredResult {
  id: string;
  productId: string;
  methodologyVersionId: string;
  payload: unknown;
  confidence: number;
  worstSeverity: Severity | null;
  computedAt: string;
}

/**
 * In-memory stand-in for ClassificationRepository. Same public contract, no
 * database: keeps the tests deterministic and offline.
 */
export class FakeClassificationRepository {
  // Part of the structural contract; never dereferenced.
  readonly prisma = undefined as unknown as PrismaService;

  private readonly ingredients: SeededIngredient[];
  private readonly versions: SeededVersion[];
  private readonly profiles: SeededProfile[];
  private readonly products: Map<string, ProductRow>;
  private readonly results: Map<string, StoredResult> = new Map();
  private sequence = 0;

  constructor(seed: SeedData) {
    this.ingredients = seed.ingredients.map((ingredient) => ({ ...ingredient, synonyms: [...ingredient.synonyms] }));
    this.versions = seed.versions.map((version) => ({ ...version, rules: version.rules.map((rule) => ({ ...rule })) }));
    this.profiles = seed.profiles.map((profile) => ({
      ...profile,
      modifiers: profile.modifiers.map((modifier) => ({ ...modifier })),
    }));
    this.products = new Map<string, ProductRow>(
      seed.products.map((product) => [
        product.id,
        {
          id: product.id,
          name: product.name,
          ingredients: product.ingredients.map((raw, index) => ({ position: index + 1, raw })),
        },
      ]),
    );
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async createProduct(name: string, rawIngredients: string[]): Promise<{ id: string; name: string }> {
    const id = this.nextId('product');
    this.products.set(id, {
      id,
      name,
      ingredients: rawIngredients.map((raw, index) => ({ position: index + 1, raw })),
    });
    return { id, name };
  }

  async findProductWithIngredients(id: string): Promise<ProductRow | null> {
    const product = this.products.get(id);
    return product ? cloneRow(product) : null;
  }

  async listProducts(): Promise<ProductRow[]> {
    return [...this.products.values()].map(cloneRow);
  }

  async findActiveMethodology(): Promise<MethodologyVersionView | null> {
    const version = this.versions.find((candidate) => candidate.status === 'active');
    return version ? toView(version) : null;
  }

  async findMethodologyById(id: string): Promise<MethodologyVersionView | null> {
    const version = this.versions.find((candidate) => candidate.id === id);
    return version ? toView(version) : null;
  }

  async findMethodologyByCode(code: string): Promise<MethodologyVersionView | null> {
    const version = this.versions.find((candidate) => candidate.code === code);
    return version ? toView(version) : null;
  }

  async publishVersion(input: MethodologyVersionInput): Promise<MethodologyVersionView> {
    if (this.versions.some((version) => version.code === input.code)) {
      throw new MethodologyVersionExistsError(input.code);
    }
    const unknown = input.rules.filter((rule) => !this.ingredients.some((ingredient) => ingredient.id === rule.ingredientId));
    if (unknown.length > 0) {
      throw new BadRequestError('unknown_ingredient_in_rule', 'Rule references an unknown ingredient.', {
        ingredient_ids: unknown.map((rule) => rule.ingredientId),
      });
    }
    for (const version of this.versions) {
      if (version.status === 'active') version.status = 'retired';
    }
    const version: SeededVersion = {
      id: this.nextId('version'),
      code: input.code,
      status: 'active',
      rules: input.rules.map((rule) => ({ ...rule })),
    };
    this.versions.push(version);
    return toView(version);
  }

  async findRulesByVersion(methodologyVersionId: string): Promise<RuleView[]> {
    const version = this.versions.find((candidate) => candidate.id === methodologyVersionId);
    if (!version) return [];
    return version.rules.map((rule) => ({
      ingredientId: rule.ingredientId,
      ingredientName: this.ingredients.find((ingredient) => ingredient.id === rule.ingredientId)?.name ?? '',
      severity: rule.severity,
      source: rule.source,
    }));
  }

  async findIngredients(): Promise<IngredientInfo[]> {
    return this.ingredients.map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      synonyms: [...ingredient.synonyms],
    }));
  }

  async findProfileWithModifiers(id: string): Promise<ProfileView | null> {
    const profile = this.profiles.find((candidate) => candidate.id === id);
    if (!profile) return null;
    return {
      id: profile.id,
      name: profile.name,
      modifiers: profile.modifiers.map((modifier) => ({
        ingredientId: modifier.ingredientId,
        severity: modifier.severity,
        source: modifier.source,
        reason: modifier.reason,
      })),
    };
  }

  async upsertResult(input: {
    productId: string;
    methodologyVersionId: string;
    payload: object;
    confidence: number;
    worstSeverity: Severity | null;
  }): Promise<{ id: string }> {
    const key = `${input.productId}:${input.methodologyVersionId}`;
    const existing = this.results.get(key);
    const now = new Date().toISOString();
    if (existing) {
      existing.payload = input.payload;
      existing.confidence = input.confidence;
      existing.worstSeverity = input.worstSeverity;
      existing.computedAt = now;
      return { id: existing.id };
    }
    const row: StoredResult = {
      id: this.nextId('result'),
      productId: input.productId,
      methodologyVersionId: input.methodologyVersionId,
      payload: input.payload,
      confidence: input.confidence,
      worstSeverity: input.worstSeverity,
      computedAt: now,
    };
    this.results.set(key, row);
    return { id: row.id };
  }

  async findResultsByProduct(productId: string, methodologyVersionId?: string): Promise<StoredResultView[]> {
    return [...this.results.values()]
      .filter(
        (result) =>
          result.productId === productId &&
          (!methodologyVersionId || result.methodologyVersionId === methodologyVersionId),
      )
      .map((result) => ({
        id: result.id,
        productId: result.productId,
        methodologyVersionId: result.methodologyVersionId,
        methodologyVersionCode: this.versions.find((version) => version.id === result.methodologyVersionId)?.code ?? '',
        payload: result.payload,
        confidence: result.confidence,
        worstSeverity: result.worstSeverity,
        computedAt: result.computedAt,
      }));
  }
}

function toView(version: SeededVersion): MethodologyVersionView {
  return { id: version.id, code: version.code, status: version.status };
}

function cloneRow(product: ProductRow): ProductRow {
  return {
    ...product,
    ingredients: [...product.ingredients].sort((a, b) => a.position - b.position).map((line) => ({ ...line })),
  };
}
```

### test/classification.spec.ts
```ts
import 'reflect-metadata';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassificationController } from '../src/classification/classification.controller.js';
import { ClassificationService } from '../src/classification/classification.service.js';
import type { ClassificationResponse } from '../src/classification/classification.service.js';
import { ApiEnvelopeFilter, ProductNotFoundError } from '../src/common/api-error.filter.js';
import {
  buildService,
  CHILD_PROFILE,
  NIGHT_CREAM,
  PEELING_GEL,
  PREGNANCY_PROFILE,
  SHUFFLED_NIGHT_CREAM,
  V1,
} from './fixtures.js';

describe('ClassificationService', () => {
  let service: ClassificationService;

  beforeEach(() => {
    service = buildService().service;
  });

  it('resolves case variants, accents, double spaces and OCR typos through synonyms', async () => {
    const peeling = await service.classify(PEELING_GEL);
    expect(peeling.ingredients.find((finding) => finding.input === 'Salixylic Acid')).toMatchObject({
      resolved: 'Salicylic acid',
      status: 'flagged',
      severity: 'watch',
      source: 'Curated watch list, 2024-01',
    });
    expect(peeling.ingredients.find((finding) => finding.input === 'T0COPHEROL')).toMatchObject({
      resolved: 'Tocopherol',
      status: 'clear',
    });
    expect(peeling.unknowns).toEqual([]);
    expect(peeling.confidence).toBe(1);

    const { id } = await service.createProduct('Accent cream', ['Caféine', 'Retinyl  Palmitate', 'bha', 'WATER']);
    const result = await service.classify(id);
    expect(result.ingredients.find((finding) => finding.input === 'Caféine')).toMatchObject({
      resolved: 'Caffeine',
      status: 'clear',
    });
    expect(result.ingredients.find((finding) => finding.input === 'Retinyl  Palmitate')).toMatchObject({
      resolved: 'Retinyl palmitate',
      status: 'flagged',
      severity: 'watch',
    });
    expect(result.ingredients.find((finding) => finding.input === 'bha')).toMatchObject({
      resolved: 'Salicylic acid',
      status: 'flagged',
    });
    expect(result.ingredients.find((finding) => finding.input === 'WATER')).toMatchObject({
      resolved: 'Aqua',
      status: 'clear',
    });
    expect(result.confidence).toBe(1);
  });

  it('flags ingredients from the active methodology with severity and source citation', async () => {
    const { id } = await service.createProduct('Cream', ['Aqua', 'Retinyl palmitate', 'Benzoyl peroxide', 'Tocopherol']);
    const result = await service.classify(id);

    expect(result.ingredients.find((finding) => finding.input === 'Retinyl palmitate')).toMatchObject({
      status: 'flagged',
      flagged: true,
      severity: 'watch',
      source: 'Curated watch list, 2024-01',
      origin: 'base',
    });
    expect(result.ingredients.find((finding) => finding.input === 'Benzoyl peroxide')).toMatchObject({
      status: 'flagged',
      severity: 'restricted',
      source: 'EU Reg 1223/2009, Annex III, 315-1',
    });
    expect(result.ingredients.find((finding) => finding.input === 'Aqua')).toMatchObject({
      status: 'clear',
      flagged: false,
      severity: null,
      source: null,
    });
    expect(result.summary).toEqual({ watch: 1, restricted: 1, banned: 0 });
    expect(result.disclaimer).toContain('Informational');
    // No binary verdict fields anywhere in the payload.
    expect(result).not.toHaveProperty('safe');
    expect(result).not.toHaveProperty('toxic');
  });

  it('lists unknown ingredients and lowers confidence proportionally', async () => {
    const result = await service.classify(NIGHT_CREAM);

    expect(result.ingredients.find((finding) => finding.input === 'Mystery Butter X')).toMatchObject({
      status: 'unknown',
      resolved: null,
      flagged: false,
      severity: null,
    });
    expect(result.unknowns).toEqual(['mystery butter x']);
    expect(result.confidence).toBe(0.8333); // 5 of the 6 listed ingredients resolved

    const { id } = await service.createProduct('Known only', ['Aqua', 'Tocopherol']);
    const known = await service.classify(id);
    expect(known.confidence).toBe(1);
    expect(result.confidence).toBeLessThan(known.confidence);
  });

  it('profile modifiers tighten findings: introduce new flags and escalate severities', async () => {
    const base = await service.classify(NIGHT_CREAM);
    expect(base.ingredients.find((finding) => finding.resolved === 'Limonene')).toMatchObject({
      status: 'clear',
      flagged: false,
      origin: 'base',
    });

    const child = await service.classify(NIGHT_CREAM, CHILD_PROFILE);
    expect(child.profile).toEqual({ id: CHILD_PROFILE, name: 'child_under_3' });
    expect(child.ingredients.find((finding) => finding.resolved === 'Limonene')).toMatchObject({
      status: 'flagged',
      flagged: true,
      severity: 'restricted',
      origin: 'profile_modifier',
      source: 'AAP position paper, 2023',
      base_severity: null,
    });

    const pregnancy = await service.classify(NIGHT_CREAM, PREGNANCY_PROFILE);
    expect(pregnancy.ingredients.find((finding) => finding.resolved === 'Retinyl palmitate')).toMatchObject({
      status: 'flagged',
      severity: 'banned',
      base_severity: 'watch',
      base_source: 'Curated watch list, 2024-01',
      source: 'FDA 2023 advisory on retinoids',
      origin: 'profile_modifier',
    });

    // Confidence is unaffected by the profile; only flags change.
    expect(pregnancy.confidence).toBe(base.confidence);
    expect(pregnancy.summary).toEqual({ watch: 0, restricted: 0, banned: 1 });
  });

  it('rejects an unknown profile without side effects', async () => {
    await expect(service.classify(NIGHT_CREAM, 'no-such-profile')).rejects.toMatchObject({
      code: 'profile_not_found',
    });
    expect(await service.listStoredResults(NIGHT_CREAM)).toHaveLength(0);
  });

  it('rejects classification when no methodology version is active', async () => {
    const inactive = buildService({ withActiveVersion: false }).service;
    await expect(inactive.classify(NIGHT_CREAM)).rejects.toMatchObject({ code: 'no_active_methodology' });
  });

  it('rejects a missing product', async () => {
    await expect(service.classify('no-such-product')).rejects.toMatchObject({ code: 'product_not_found' });
  });

  it('is identical across reruns and across shuffled ingredient order', async () => {
    const first = await service.classify(NIGHT_CREAM);
    const second = await service.classify(NIGHT_CREAM);
    expect(second).toEqual(first);

    const shuffled = await service.classify(SHUFFLED_NIGHT_CREAM);
    expect(shuffled.ingredients).toEqual(first.ingredients);
    expect(shuffled.unknowns).toEqual(first.unknowns);
    expect(shuffled.confidence).toBe(first.confidence);
    expect(shuffled.summary).toEqual(first.summary);

    // The stored result is deterministic as well.
    const stored = await service.listStoredResults(NIGHT_CREAM);
    expect(stored).toHaveLength(1);
    expect(stored[0].payload).toEqual(first);
  });

  it('stores the profile-independent base result under (product, version)', async () => {
    const withProfile = await service.classify(NIGHT_CREAM, PREGNANCY_PROFILE);
    const withoutProfile = await service.classify(NIGHT_CREAM);

    const stored = await service.listStoredResults(NIGHT_CREAM);
    expect(stored).toHaveLength(1);
    const payload = stored[0].payload as ClassificationResponse;
    expect(payload).toEqual(withoutProfile);
    expect(payload.profile).toBeNull();
    expect(withProfile.profile).toEqual({ id: PREGNANCY_PROFILE, name: 'pregnancy' });
  });

  it('publishing a new version rescans all products idempotently and keeps previous results', async () => {
    const before = await service.classify(NIGHT_CREAM);
    expect(before.methodology_version).toBe('2024.1');
    expect(before.ingredients.find((finding) => finding.resolved === 'Limonene')?.status).toBe('clear');

    const published = await service.publishVersion({
      code: '2024.2',
      rules: [
        { ingredient: 'Limonene', severity: 'watch', source: 'Curated watch list, 2024-02' },
        { ingredient: 'Retinyl palmitate', severity: 'restricted', source: 'Curated watch list, 2024-02' },
      ],
    });
    expect(published).toMatchObject({
      code: '2024.2',
      status: 'active',
      published: true,
      rescanned_products: 3,
    });

    const after = await service.classify(NIGHT_CREAM);
    expect(after.methodology_version).toBe('2024.2');
    expect(after.ingredients.find((finding) => finding.resolved === 'Limonene')?.severity).toBe('watch');
    expect(after.ingredients.find((finding) => finding.resolved === 'Retinyl palmitate')?.severity).toBe(
      'restricted',
    );

    // Idempotent re-scoring: repeating it adds nothing and changes nothing.
    expect(await service.rescoreVersion(published.id)).toBe(3);
    expect(await service.rescoreVersion(published.id)).toBe(3);

    // Both versions' results coexist and stay retrievable.
    const stored = await service.listStoredResults(NIGHT_CREAM);
    expect(stored.map((row) => row.methodologyVersionCode).sort()).toEqual(['2024.1', '2024.2']);
    const v1 = stored.find((row) => row.methodologyVersionCode === '2024.1')!;
    const v2 = stored.find((row) => row.methodologyVersionCode === '2024.2')!;
    expect((v1.payload as ClassificationResponse).ingredients.find((finding) => finding.resolved === 'Limonene')?.status).toBe(
      'clear',
    );
    expect((v2.payload as ClassificationResponse).ingredients.find((finding) => finding.resolved === 'Limonene')?.status).toBe(
      'flagged',
    );

    const onlyV1 = await service.listStoredResults(NIGHT_CREAM, V1);
    expect(onlyV1).toHaveLength(1);
    expect(onlyV1[0].methodologyVersionCode).toBe('2024.1');
  });

  it('rejects duplicate version codes and rules with unknown ingredients', async () => {
    await expect(service.publishVersion({ code: '2024.1', rules: [] })).rejects.toMatchObject({
      code: 'methodology_version_exists',
    });
    await expect(
      service.publishVersion({
        code: '2024.2',
        rules: [{ ingredient: 'Unobtainium', severity: 'watch', source: 'S' }],
      }),
    ).rejects.toMatchObject({
      code: 'unknown_ingredient_in_rule',
      details: { ingredients: ['Unobtainium'] },
    });
    // A failed publish leaves the active methodology untouched.
    expect((await service.classify(NIGHT_CREAM)).methodology_version).toBe('2024.1');
  });
});

describe('ClassificationController', () => {
  function buildController() {
    const calls: Record<string, unknown> = {};
    const serviceStub = {
      createProduct: async (name: string, ingredients: string[]) => {
        calls.createProduct = [name, ingredients];
        return { id: 'p-new', name };
      },
      classify: async (productId: string, profileId?: string) => {
        calls.classify = [productId, profileId];
        return { product_id: productId };
      },
      publishVersion: async (input: { code: string; rules: unknown[] }) => {
        calls.publishVersion = input;
        return { code: input.code };
      },
      listStoredResults: async (productId: string, versionId?: string) => {
        calls.listStoredResults = [productId, versionId];
        return [];
      },
    };
    const controller = new ClassificationController(serviceStub as unknown as ClassificationService);
    return { controller, calls };
  }

  it('forwards valid bodies to the service', async () => {
    const { controller, calls } = buildController();

    await controller.createProduct({ name: 'Cream', ingredients: ['Aqua', 'Limonene'] });
    expect(calls.createProduct).toEqual(['Cream', ['Aqua', 'Limonene']]);

    await controller.classify({ product_id: 'p1', profile_id: 'pf1' });
    expect(calls.classify).toEqual(['p1', 'pf1']);

    await controller.classify({ product_id: 'p1' });
    expect(calls.classify).toEqual(['p1', undefined]);

    await controller.publishMethodologyVersion({
      code: '2025.1',
      rules: [{ ingredient: 'Limonene', severity: 'banned', source: 'Reg X' }],
    });
    expect(calls.publishVersion).toEqual({
      code: '2025.1',
      rules: [{ ingredient: 'Limonene', severity: 'banned', source: 'Reg X' }],
    });

    await controller.listClassifications('p1', 'v1');
    expect(calls.listStoredResults).toEqual(['p1', 'v1']);
  });

  it('rejects invalid input with envelope error codes', async () => {
    const { controller } = buildController();

    await expect(controller.createProduct('oops')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(controller.createProduct({ name: '', ingredients: [] })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(controller.createProduct({ name: 'X', ingredients: ['ok', ''] })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(controller.classify({ product_id: 7 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(controller.classify({ product_id: 'p1', profile_id: '' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(controller.listClassifications('', undefined)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      controller.publishMethodologyVersion({
        code: 'c',
        rules: [{ ingredient: 'Limonene', severity: 'meh', source: 's' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_severity' });
    await expect(
      controller.publishMethodologyVersion({
        code: 'c',
        rules: [{ ingredient: 'Limonene', severity: 'watch' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('ApiEnvelopeFilter', () => {
  function fakeHost() {
    const state: { status: number; body: unknown } = { status: 0, body: undefined };
    const response = {
      status(code: number) {
        state.status = code;
        return {
          json(body: unknown) {
            state.body = body;
          },
        };
      },
    };
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
    return { state, host };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders ApiError as the documented envelope', () => {
    const { state, host } = fakeHost();
    new ApiEnvelopeFilter().catch(new ProductNotFoundError('p-404'), host);
    expect(state.status).toBe(404);
    expect(state.body).toEqual({
      error: { code: 'product_not_found', message: expect.any(String), details: { product_id: 'p-404' } },
    });
  });

  it('renders foreign HttpExceptions with the same envelope', () => {
    const { state, host } = fakeHost();
    new ApiEnvelopeFilter().catch(new HttpException('Invalid JSON', HttpStatus.BAD_REQUEST), host);
    expect(state.status).toBe(400);
    expect(state.body).toMatchObject({ error: { code: 'http_error', message: 'Invalid JSON' } });
  });

  it('falls back to internal_error for unexpected exceptions', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { state, host } = fakeHost();
    new ApiEnvelopeFilter().catch(new Error('boom'), host);
    expect(state.status).toBe(500);
    expect(state.body).toEqual({
      error: { code: 'internal_error', message: expect.any(String), details: {} },
    });
  });
});
```


---

# repair1-set

## reasoning

```
Let me analyze the two errors:

1. **src/classification/classification.controller.ts(40,11)**: The `severity` property is typed as `string` instead of `Severity`. Looking at the controller code, in the `publishMethodologyVersion` method, the `rules` array is being built with `severity` as a `string` type. The issue is that `rule.severity` is of type `unknown` (from `Record<string, unknown>`), and even after the check, TypeScript doesn't narrow it to `Severity`. The `RuleDraft` interface expects `severity: Severity` (which is `'watch' | 'restricted' | 'banned'`). The fix is to cast `severity` to `RuleDraft['severity']` when building the object.

Looking at the controller code:
```ts
const severity = rule.severity;
if (typeof severity !== 'string' || !SEVERITIES.includes(severity as RuleDraft['severity'])) {
  throw new BadRequestError(...)
}
```

After this check, `severity` is still `string` from TypeScript's perspective. We need to cast it:
```ts
severity: severity as RuleDraft['severity'],
```

2. **src/classification/classification.service.ts(313,72)**: In `applyProfile`, the spread `{...finding, status: 'flagged', ...}` creates an object where `status` is inferred as `string` rather than `'flagged'` (which is a valid `FindingStatus`). The issue is that when you spread an object and override a property with a literal, TypeScript sometimes widens the literal type.

Looking at the `applyProfile` method:
```ts
return {
  ...finding,
  status: 'flagged',
  flagged: true,
  severity: modifier.severity,
  source: modifier.source,
  origin: 'profile_modifier',
  note: modifier.reason ?? null,
};
```

The `origin: 'profile_modifier'` is a `FindingOrigin` value, and `status: 'flagged'` is a `FindingStatus` value. But TypeScript is widening these to `string` in the context of the object spread.

The fix is to add `as const` to the literal values, or cast the whole object. Actually, the cleanest fix is to use `as const` on the string literals:

```ts
return {
  ...finding,
  status: 'flagged' as const,
  flagged: true,
  severity: modifier.severity,
  source: modifier.source,
  origin: 'profile_modifier' as const,
  note: modifier.reason ?? null,
};
```

Wait, let me re-read the error more carefully:

```
src/classification/classification.service.ts(313,72): error TS2322: Type '(ClassificationFinding | { status: string; ... origin: string; ... })[]' is not assignable to type 'ClassificationFinding[]'.
```

So the issue is that `status` and `origin` are being widened to `string`. The fix is to add `as const` to those literals.

Let me write the fixed files.

For the controller, the fix at line 40 is in the `return { ingredient, severity, source };` line. I need to change `severity` to `severity as RuleDraft['severity']`.

For the service, the fix is in the `applyProfile` method where we return the modified finding object. I need to add `as const` to `status: 'flagged'` and `origin: 'profile_modifier'`.

Let me write out the complete files.
```

## reply

### src/classification/classification.controller.ts
```ts
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { BadRequestError } from '../common/api-error.filter.js';
import { ClassificationService } from './classification.service.js';
import type { RuleDraft } from './classification.service.js';

const SEVERITIES: readonly RuleDraft['severity'][] = ['watch', 'restricted', 'banned'];

@Controller()
export class ClassificationController {
  constructor(readonly service: ClassificationService) {}

  @Post('products')
  createProduct(@Body() body: unknown) {
    const data = objectBody(body);
    const name = nonEmptyString(data, 'name');
    const ingredients = stringArray(data, 'ingredients');
    return this.service.createProduct(name, ingredients);
  }

  @Post('classifications')
  classify(@Body() body: unknown) {
    const data = objectBody(body);
    const productId = nonEmptyString(data, 'product_id');
    const profileId = optionalNonEmptyString(data, 'profile_id');
    return this.service.classify(productId, profileId);
  }

  @Get('classifications')
  listClassifications(@Query('product_id') productId?: string, @Query('methodology_version_id') methodologyVersionId?: string) {
    const requiredProductId = nonEmptyString({ product_id: productId }, 'product_id');
    const versionId = optionalNonEmptyString({ methodology_version_id: methodologyVersionId }, 'methodology_version_id');
    return this.service.listStoredResults(requiredProductId, versionId);
  }

  @Post('methodology-versions')
  publishMethodologyVersion(@Body() body: unknown) {
    const data = objectBody(body);
    const code = nonEmptyString(data, 'code');
    const rulesRaw = array(data, 'rules');
    const rules: RuleDraft[] = rulesRaw.map((entry, position) => {
      if (typeof entry !== 'object' || entry === null) {
        throw new BadRequestError('invalid_request', `rules[${position}] must be an object.`, {
          field: `rules[${position}]`,
        });
      }
      const rule = entry as Record<string, unknown>;
      const ingredient = nonEmptyString(rule, 'ingredient');
      const severity = rule.severity;
      if (typeof severity !== 'string' || !SEVERITIES.includes(severity as RuleDraft['severity'])) {
        throw new BadRequestError(
          'invalid_severity',
          `rules[${position}].severity must be one of: ${SEVERITIES.join(', ')}.`,
          { field: `rules[${position}].severity` },
        );
      }
      const source = nonEmptyString(rule, 'source');
      return { ingredient, severity: severity as RuleDraft['severity'], source };
    });
    return this.service.publishVersion({ code, rules });
  }
}

function objectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestError('invalid_request', 'Request body must be a JSON object.', {});
  }
  return body as Record<string, unknown>;
}

function nonEmptyString(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be a non-empty string.`, { field });
  }
  return value;
}

function optionalNonEmptyString(data: Record<string, unknown>, field: string): string | undefined {
  const value = data[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be a non-empty string when provided.`, {
      field,
    });
  }
  return value;
}

function stringArray(data: Record<string, unknown>, field: string): string[] {
  const value = data[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be an array of non-empty strings.`, {
      field,
    });
  }
  return value;
}

function array(data: Record<string, unknown>, field: string): unknown[] {
  const value = data[field];
  if (!Array.isArray(value)) {
    throw new BadRequestError('invalid_request', `Field "${field}" must be an array.`, { field });
  }
  return value;
}
```

### src/classification/classification.service.ts
```ts
import { Injectable } from '@nestjs/common';
import {
  BadRequestError,
  MethodologyVersionExistsError,
  MethodologyVersionNotFoundError,
  NoActiveMethodologyError,
  ProfileNotFoundError,
  ProductNotFoundError,
} from '../common/api-error.filter.js';
import { ClassificationRepository } from './classification.repository.js';
import type {
  IngredientInfo,
  ProfileModifierView,
  ProfileView,
  ProductRow,
  ResolvedRuleInput,
  RuleView,
  Severity,
} from './classification.repository.js';

/** Shown on every classification; the API never issues a binary safe/toxic verdict. */
export const DISCLAIMER =
  'Informational screening only. Findings are not a safety or regulatory judgment, and the absence of a ' +
  'flag does not mean a product is safe. Unknown ingredients could not be matched to a known substance ' +
  'and should be verified manually.';

export type FindingStatus = 'flagged' | 'clear' | 'unknown';
export type FindingOrigin = 'base' | 'profile_modifier';

export interface ClassificationFinding {
  /** Raw INCI entry exactly as stored on the product. */
  input: string;
  /** Lower-cased, accent-free, whitespace-collapsed form used for matching. */
  normalized: string;
  /** Canonical ingredient name when the input resolved, else null. */
  resolved: string | null;
  /** Internal ingredient id when the input resolved, else null. */
  ingredient_id: string | null;
  status: FindingStatus;
  flagged: boolean;
  /** Final severity after profile modifiers. */
  severity: Severity | null;
  /** Severity from the active methodology's base rules (null when the base did not flag it). */
  base_severity: Severity | null;
  /** Final source citation (the profile modifier's when the profile tightened the finding). */
  source: string | null;
  /** Base rule citation, kept for traceability when the profile tightened the finding. */
  base_source: string | null;
  origin: FindingOrigin;
  note: string | null;
}

export interface ClassificationSummary {
  watch: number;
  restricted: number;
  banned: number;
}

export interface ClassificationResponse {
  product_id: string;
  methodology_version: string;
  profile: { id: string; name: string } | null;
  ingredients: ClassificationFinding[];
  /** Normalized inputs that could not be resolved to a known ingredient, sorted. */
  unknowns: string[];
  /** Share of listed ingredients that resolved to a known substance (1 = all known). */
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

export interface RuleDraft {
  /** Ingredient canonical name or synonym. */
  ingredient: string;
  severity: Severity;
  source: string;
}

const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };

interface IndexedIngredient {
  id: string;
  name: string;
}

@Injectable()
export class ClassificationService {
  constructor(readonly repository: ClassificationRepository) {}

  async createProduct(name: string, rawIngredients: string[]): Promise<{ id: string; name: string }> {
    return this.repository.createProduct(name, rawIngredients);
  }

  /**
   * Classify a product under the active methodology, optionally tightened by a
   * family profile. The profile-independent base result is stored under
   * (product, methodologyVersion) on every call; profile modifiers are applied
   * on top for the response only and are never persisted.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationResponse> {
    const product = await this.repository.findProductWithIngredients(productId);
    if (!product) throw new ProductNotFoundError(productId);

    const methodology = await this.repository.findActiveMethodology();
    if (!methodology) throw new NoActiveMethodologyError();

    const profile = profileId ? await this.repository.findProfileWithModifiers(profileId) : null;
    if (profileId && !profile) throw new ProfileNotFoundError(profileId);

    const [rules, ingredients] = await Promise.all([
      this.repository.findRulesByVersion(methodology.id),
      this.repository.findIngredients(),
    ]);

    const base = this.buildBaseClassification(product, methodology.code, rules, buildIngredientIndex(ingredients));
    await this.repository.upsertResult({
      productId: product.id,
      methodologyVersionId: methodology.id,
      payload: base,
      confidence: base.confidence,
      worstSeverity: worstSeverityOf(base.summary),
    });

    return profile ? this.applyProfile(base, profile) : base;
  }

  /**
   * Publish a new (immutable) methodology version: it becomes the active one,
   * the previous active version is retired, and every product is re-scored
   * against it. Results of earlier versions remain stored and retrievable.
   */
  async publishVersion(input: { code: string; rules: RuleDraft[] }): Promise<{
    id: string;
    code: string;
    status: 'active';
    published: boolean;
    rescanned_products: number;
  }> {
    const existing = await this.repository.findMethodologyByCode(input.code);
    if (existing) throw new MethodologyVersionExistsError(existing.code);

    const index = buildIngredientIndex(await this.repository.findIngredients());
    const resolved: ResolvedRuleInput[] = [];
    const missing: string[] = [];
    for (const draft of input.rules) {
      const entry = index.get(normalizeTerm(draft.ingredient));
      if (!entry) {
        missing.push(draft.ingredient);
        continue;
      }
      resolved.push({ ingredientId: entry.id, severity: draft.severity, source: draft.source });
    }
    if (missing.length > 0) {
      throw new BadRequestError(
        'unknown_ingredient_in_rule',
        'Every rule must reference a known ingredient (canonical name or synonym).',
        { ingredients: missing },
      );
    }

    const version = await this.repository.publishVersion({ code: input.code, rules: resolved });
    const rescannedProducts = await this.rescoreVersion(version.id);
    return {
      id: version.id,
      code: version.code,
      status: 'active',
      published: true,
      rescanned_products: rescannedProducts,
    };
  }

  /**
   * Re-score every product against a methodology version. Idempotent: the
   * payload is a pure function of (ingredients, rules, synonyms) and results
   * are upserted on (product, methodologyVersion), so repeating it is a no-op.
   */
  async rescoreVersion(methodologyVersionId: string): Promise<number> {
    const version = await this.repository.findMethodologyById(methodologyVersionId);
    if (!version) throw new MethodologyVersionNotFoundError(methodologyVersionId);

    const [rules, ingredients, products] = await Promise.all([
      this.repository.findRulesByVersion(methodologyVersionId),
      this.repository.findIngredients(),
      this.repository.listProducts(),
    ]);
    const index = buildIngredientIndex(ingredients);
    for (const product of products) {
      const base = this.buildBaseClassification(product, version.code, rules, index);
      await this.repository.upsertResult({
        productId: product.id,
        methodologyVersionId,
        payload: base,
        confidence: base.confidence,
        worstSeverity: worstSeverityOf(base.summary),
      });
    }
    return products.length;
  }

  async listStoredResults(productId: string, methodologyVersionId?: string) {
    return this.repository.findResultsByProduct(productId, methodologyVersionId);
  }

  private buildBaseClassification(
    product: ProductRow,
    methodologyVersion: string,
    rules: RuleView[],
    index: Map<string, IndexedIngredient>,
  ): ClassificationResponse {
    const ruleByIngredient = new Map<string, RuleView>();
    for (const rule of rules) {
      ruleByIngredient.set(rule.ingredientId, rule);
    }

    const findings: ClassificationFinding[] = product.ingredients.map((line) => {
      const normalized = normalizeTerm(line.raw);
      const entry = index.get(normalized);
      if (!entry) {
        return {
          input: line.raw,
          normalized,
          resolved: null,
          ingredient_id: null,
          status: 'unknown' as FindingStatus,
          flagged: false,
          severity: null,
          base_severity: null,
          source: null,
          base_source: null,
          origin: 'base' as FindingOrigin,
          note: null,
        };
      }
      const rule = ruleByIngredient.get(entry.id) ?? null;
      return {
        input: line.raw,
        normalized,
        resolved: entry.name,
        ingredient_id: entry.id,
        status: rule ? ('flagged' as FindingStatus) : ('clear' as FindingStatus),
        flagged: rule !== null,
        severity: rule ? rule.severity : null,
        base_severity: rule ? rule.severity : null,
        source: rule ? rule.source : null,
        base_source: rule ? rule.source : null,
        origin: 'base' as FindingOrigin,
        note: null,
      };
    });

    // Stable byte-wise order (normalized name, then raw input). Sorting rather
    // than using the stored INCI position is what makes results independent of
    // the order the ingredients were entered in.
    findings.sort(compareStable);

    const unknownFindings = findings.filter((finding) => finding.status === 'unknown');
    const unknowns = uniqueSorted(unknownFindings.map((finding) => finding.normalized));
    const total = findings.length;
    const confidence = total === 0 ? 1 : round4((total - unknownFindings.length) / total);

    const summary: ClassificationSummary = { watch: 0, restricted: 0, banned: 0 };
    for (const finding of findings) {
      if (finding.severity) summary[finding.severity] += 1;
    }

    return {
      product_id: product.id,
      methodology_version: methodologyVersion,
      profile: null,
      ingredients: findings,
      unknowns,
      confidence,
      summary,
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Defined precedence: the active methodology's base rules first, then the
   * profile's contextual modifiers. Modifiers only tighten: they may escalate
   * a flagged ingredient or introduce a new flag, but never loosen a base
   * finding.
   */
  private applyProfile(base: ClassificationResponse, profile: ProfileView): ClassificationResponse {
    const modifierByIngredient = new Map<string, ProfileModifierView>();
    for (const modifier of profile.modifiers) {
      modifierByIngredient.set(modifier.ingredientId, modifier);
    }

    const ingredients: ClassificationFinding[] = base.ingredients.map((finding) => {
      if (finding.status === 'unknown') return finding;
      const modifier = finding.ingredient_id ? modifierByIngredient.get(finding.ingredient_id) : undefined;
      if (!modifier) return finding;
      if (finding.base_severity !== null && SEVERITY_RANK[modifier.severity] <= SEVERITY_RANK[finding.base_severity]) {
        return finding; // modifiers tighten only
      }
      return {
        ...finding,
        status: 'flagged' as FindingStatus,
        flagged: true,
        severity: modifier.severity,
        source: modifier.source,
        origin: 'profile_modifier' as FindingOrigin,
        note: modifier.reason ?? null,
      };
    });

    const summary: ClassificationSummary = { watch: 0, restricted: 0, banned: 0 };
    for (const finding of ingredients) {
      if (finding.severity) summary[finding.severity] += 1;
    }

    return { ...base, profile: { id: profile.id, name: profile.name }, ingredients, summary };
  }
}

/** Lower-case, strip accents, collapse whitespace. Deterministic across environments. */
export function normalizeTerm(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}

function buildIngredientIndex(ingredients: IngredientInfo[]): Map<string, IndexedIngredient> {
  const index = new Map<string, IndexedIngredient>();
  for (const ingredient of ingredients) {
    index.set(normalizeTerm(ingredient.name), { id: ingredient.id, name: ingredient.name });
  }
  for (const ingredient of ingredients) {
    for (const synonym of ingredient.synonyms) {
      // Canonical names always win; the first synonym wins a synonym collision.
      const term = normalizeTerm(synonym);
      if (!index.has(term)) {
        index.set(term, { id: ingredient.id, name: ingredient.name });
      }
    }
  }
  return index;
}

function compareStable(a: ClassificationFinding, b: ClassificationFinding): number {
  if (a.normalized !== b.normalized) return a.normalized < b.normalized ? -1 : 1;
  if (a.input !== b.input) return a.input < b.input ? -1 : 1;
  return 0;
}

function uniqueSorted(values: string[]): string[] {
  const unique = [...new Set(values)];
  unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return unique;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function worstSeverityOf(summary: ClassificationSummary): Severity | null {
  if (summary.banned > 0) return 'banned';
  if (summary.restricted > 0) return 'restricted';
  if (summary.watch > 0) return 'watch';
  return null;
}
```


---
