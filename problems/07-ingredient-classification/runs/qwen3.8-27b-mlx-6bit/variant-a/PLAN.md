## 1. Assumptions

| # | Decision | Why |
|---|----------|-----|
| 1 | Active version is the single row with `is_active = true`; publishing a new version atomically clears the old flag. | Simplest invariant, no "latest" query. |
| 2 | Stored results are keyed `(product_id, methodology_version_id)` with **no** profile; profile modifiers are applied only in the API response. | Spec says keyed by (product, methodologyVersion); profile is a read-time overlay. |
| 3 | Profile modifiers **tighten only**: they can escalate severity or add a flag, never de-escalate or remove one. | "Tighten certain rules" per spec. |
| 4 | Confidence = `max(0, 1 − 0.1 × unknownCount)`. | Deterministic, monotonic, easy to test. |
| 5 | Normalization pipeline: NFD-decompose → strip combining marks → lowercase → trim → collapse internal whitespace. | Handles accents, case, spacing in one pass. |
| 6 | Synonym/typo resolution is a **seeded lookup table** (exact match on normalized synonym text), not fuzzy. | Spec says "provided synonym fixtures"; deterministic. |
| 7 | Ingredient order in a product is irrelevant to the result (findings are sorted by `position` for stable output, but classification logic is order-independent). | Required by the shuffle test. |
| 8 | "Affected products" for re-scoring = every product with ≥ 1 row in `product_ingredients`. | No empty products to score. |
| 9 | Re-scoring is idempotent via `upsert` on the composite key `(product_id, methodology_version_id)`. | Running twice yields identical rows. |
| 10 | The disclaimer is a fixed English string returned with every classification. | Spec: "no binary safe/toxic". |
| 11 | Prisma migration is generated (`prisma migrate dev`) and committed as a `.sql` file under `prisma/migrations/`. | Convention requires a migration per schema change. |
| 12 | One NestJS feature module per domain area: `ingredient`, `product`, `methodology`, `profile`, `classification`. | Matches the `<feature>/<feature>.role.ts` layout. |
| 13 | Seed file (`prisma/seed.ts`) populates ingredients, synonyms (including OCR-typo fixtures), a default methodology version with rules, and two sample profiles. | Tests need deterministic data; seed is idempotent (upsert). |

## 2. Data model

All column names `snake_case` via Prisma `@map`. Table names `snake_case` via `@@map`.

| Table | Columns |
|-------|---------|
| `methodology_versions` | `id` INT PK AI, `version` INT UNIQUE NOT NULL, `name` TEXT NOT NULL, `is_active` BOOL DEFAULT false, `created_at` TIMESTAMPTZ DEFAULT now() |
| `ingredients` | `id` INT PK AI, `canonical_name` TEXT UNIQUE NOT NULL, `display_name` TEXT NOT NULL |
| `synonyms` | `id` INT PK AI, `ingredient_id` INT FK→ingredients.id NOT NULL, `synonym_text` TEXT UNIQUE NOT NULL *(normalized form)* |
| `rules` | `id` INT PK AI, `methodology_version_id` INT FK NOT NULL, `ingredient_id` INT FK NOT NULL, `severity` SEV_ENUM NOT NULL, `flag` TEXT NOT NULL, `source_citation` TEXT NOT NULL; **UNIQUE**(`methodology_version_id`, `ingredient_id`) |
| `profiles` | `id` INT PK AI, `name` TEXT NOT NULL, `description` TEXT NULL, `created_at` TIMESTAMPTZ DEFAULT now() |
| `profile_modifiers` | `id` INT PK AI, `profile_id` INT FK NOT NULL, `ingredient_id` INT FK NOT NULL, `severity` SEV_ENUM NOT NULL, `flag` TEXT NOT NULL, `source_citation` TEXT NOT NULL; **UNIQUE**(`profile_id`, `ingredient_id`) |
| `products` | `id` INT PK AI, `name` TEXT NOT NULL, `created_at` TIMESTAMPTZ DEFAULT now() |
| `product_ingredients` | `id` INT PK AI, `product_id` INT FK NOT NULL, `raw_text` TEXT NOT NULL, `position` INT NOT NULL; **UNIQUE**(`product_id`, `position`) |
| `classification_results` | `id` INT PK AI, `product_id` INT FK NOT NULL, `methodology_version_id` INT FK NOT NULL, `overall_confidence` REAL NOT NULL, `disclaimer` TEXT NOT NULL, `created_at` TIMESTAMPTZ DEFAULT now(), `updated_at` TIMESTAMPTZ; **UNIQUE**(`product_id`, `methodology_version_id`) |
| `classification_findings` | `id` INT PK AI, `classification_result_id` INT FK→classification_results.id NOT NULL, `raw_text` TEXT NOT NULL, `resolved_name` TEXT NULL, `ingredient_id` INT NULL *(no FK constraint; null when unknown)*, `is_unknown` BOOL DEFAULT false, `flag` TEXT NULL, `severity` SEV_ENUM NULL, `source_citation` TEXT NULL |

**Enum** `SEV_ENUM`: `BANNED`, `RESTRICTED`, `WATCH` (ordinal 3 > 2 > 1 for escalation comparisons).

## 3. Types and signatures

### Shared types (`src/classification/types.ts` — exported from the classification module)

```ts
export type Severity = 'banned' | 'restricted' | 'watch';

export interface IngredientFinding {
  rawText: string;
  resolvedName: string | null;   // null when unknown
  ingredientId: number | null;
  isUnknown: boolean;
  flag: string | null;
  severity: Severity | null;
  sourceCitation: string | null;
}

export interface ClassificationResponse {
  productId: number;
  methodologyVersionId: number;
  findings: IngredientFinding[];          // sorted by product_ingredients.position
  unknownIngredients: string[];           // rawText of each unknown, same order
  overallConfidence: number;              // 0..1
  disclaimer: string;                     // fixed English disclaimer
}

export interface ProfiledClassificationResponse extends ClassificationResponse {
  profileId: number;
}
```

### Errors (raised by services, mapped to the envelope by a global exception filter in `main.ts`)

```ts
export class ResourceNotFound extends Error { code = 'resource_not_found'; }
export class ConflictError      extends Error { code = 'conflict'; }
```

| Raiser | Condition |
|--------|-----------|
| `ResourceNotFound` | product id, profile id, or version id not found in DB |
| `ConflictError` | publishing a version that already exists (same integer) |

### Repository interfaces (each is a `@Injectable()`)

```ts
// ingredient.repository.ts
class IngredientRepository {
  findById(id: number): Promise<Ingredient | null>;
  findByName(canonicalName: string): Promise<Ingredient | null>;
  resolve(normalizedText: string): Promise<{ ingredient: Ingredient; matchedVia: 'canonical' | 'synonym' } | null>;
  list(): Promise<Ingredient[]>;
}

// product.repository.ts
class ProductRepository {
  findById(id: number): Promise<Product | null>;
  listWithIngredients(): Promise<Product[]>;   // products that have ≥1 product_ingredient
  list(): Promise<Product[]>;
  create(name: string, ingredients: string[]): Promise<Product>;
}

// methodology.repository.ts
class MethodologyRepository {
  getActive(): Promise<MethodologyVersion | null>;
  getById(id: number): Promise<MethodologyVersion | null>;
  getRules(versionId: number): Promise<Rule[]>;
  create(data: { version: number; name: string }): Promise<MethodologyVersion>;
  publish(versionId: number): Promise<void>;   // transactional: clear old is_active, set new
}

// profile.repository.ts
class ProfileRepository {
  findById(id: number): Promise<Profile | null>;
  getModifiers(profileId: number): Promise<ProfileModifier[]>;
}

// classification.repository.ts
class ClassificationRepository {
  upsert(result: Omit<ClassificationResult, 'id' | 'createdAt' | 'updatedAt'>,
         findings: Omit<ClassificationFinding, 'id'>[]): Promise<ClassificationResult>;
  findByProductAndVersion(productId: number, versionId: number): Promise<ClassificationResult | null>;
  findByProductId(productId: number): Promise<ClassificationResult[]>;
}
```

### Service signatures

```ts
// classification.service.ts
class ClassificationService {
  classify(productId: number, profileId?: number): Promise<ClassificationResponse | ProfiledClassificationResponse>;
  rescoreAll(versionId: number): Promise<void>;
}

// methodology.service.ts
class MethodologyService {
  publish(versionId: number): Promise<void>;   // triggers rescoreAll
}

// product.service.ts
class ProductService {
  create(name: string, ingredients: string[]): Promise<Product>;
  getWithIngredients(id: number): Promise<Product | null>;
}

// ingredient.service.ts
class IngredientService {
  list(): Promise<Ingredient[]>;
}

// profile.service.ts
class ProfileService {
  findById(id: number): Promise<Profile | null>;
}
```

### Controller endpoints

| Method | Path | Body / Params | Returns |
|--------|------|---------------|---------|
| POST | `/classify` | `{ productId: number, profileId?: number }` | `200 ClassificationResponse` |
| GET  | `/products/:id/results` | — | `200 ClassificationResponse[]` (all versions) |
| POST | `/products` | `{ name: string, ingredients: string[] }` | `201 Product` |
| GET  | `/ingredients` | — | `200 Ingredient[]` |
| POST | `/methodologies` | `{ version: number, name: string }` | `201 MethodologyVersion` |
| POST | `/methodologies/:id/publish` | — | `204` (triggers re-scoring) |
| GET  | `/profiles/:id` | — | `200 Profile` |

### Ordering rules

- **Publish before re-score.** `MethodologyService.publish` completes the DB flag swap in a transaction, **then** calls `ClassificationService.rescoreAll`. If re-scoring fails the version is already active; a manual retry is idempotent.
- **Re-score is order-independent.** Products are processed in any order; each upsert targets its own `(product, version)` key.
- **Findings are sorted by `position`** before being returned or stored, guaranteeing identical output regardless of insertion order.

## 4. Control flow

### `classify(productId, profileId?)`

| Step | Inside transaction? | Notes |
|------|---------------------|-------|
| 1. Load product + `product_ingredients` ordered by `position`. | No | Raise `ResourceNotFound` if product missing. |
| 2. Resolve each `raw_text`: normalize → exact canonical match → exact synonym match. Unmatched → unknown. | No | Pure in-memory + 2 indexed lookups. |
| 3. Load active methodology version + its rules (index by `ingredient_id`). | No | Raise `ResourceNotFound` if no active version. |
| 4. Build base findings: for each resolved ingredient, look up its rule. No rule → finding with null flag/severity (recognized but unflagged). | No | |
| 5. If `profileId` provided: load modifiers (index by `ingredient_id`). For each finding where both a base rule and a modifier exist: if modifier severity ordinal > rule severity ordinal, replace flag/severity/citation with modifier's. If only a modifier exists (no base rule), add the modifier's flag/severity/citation. | No | Tighten-only: never lower severity or remove a base flag. |
| 6. Compute `overallConfidence = max(0, 1 − 0.1 × unknownCount)`. | No | |
| 7. Build `disclaimer` (constant string). | No | |
| 8. **Upsert stored result** (base findings only, no profile overlay) + delete-and-insert findings rows, keyed by `(productId, activeVersionId)`. | **Yes** (single transaction wrapping upsert + findings insert) | Idempotent: same input → same rows. |
| 9. Return response (with profile overlay if step 5 ran). | No | |

### `publish(versionId)` → re-score

| Step | Inside transaction? | Notes |
|------|---------------------|-------|
| 1. In a transaction: set `is_active = false` on the current active row; set `is_active = true` on `versionId`. | **Yes** | Raise `ConflictError` if `versionId` not found or already active. |
| 2. After commit: call `rescoreAll(versionId)`. | No | Can run outside the publish transaction. |
| 3. `rescoreAll`: load all products with ingredients. For each, run steps 1–8 of `classify` (no profile). | Each product's step-8 upsert is its own transaction. | Products are independent; partial failure leaves some products unscored but retry is safe. |

### What must NOT be in a transaction

- No HTTP calls, no side-effect logging that could block commit.
- The re-score loop is **not** one giant transaction; each product's upsert is its own.

## 5. Tests

| # | Test (one line) |
|---|-----------------|
| 1 | **Profile flips a finding:** base rule flags ingredient X as `watch`; profile modifier escalates to `banned` → response shows severity `banned` with the modifier's citation. |
| 2 | **Unknown ingredient lowers confidence and is visible:** product has 5 ingredients, 1 unresolvable → `overallConfidence = 0.8`, `unknownIngredients` contains the raw text, finding has `isUnknown: true`. |
| 3 | **Synonym/typo resolves:** raw text is a seeded OCR typo (e.g. `"gyceryl"` → canonical `"glycerol"`) → finding has `resolvedName: "glycerol"` and the correct rule's flag/severity. |
| 4 | **Identical across reruns:** call `classify` twice for the same product → deep-equal responses (findings array, confidence, disclaimer). |
| 5 | **Shuffled ingredient order:** create product A with ingredients `[a, b, c]` and product B with `[c, a, b]` (same set, different positions) → both responses have identical sets of findings sorted by position; confidence equal. |
| 6 | **Both versions coexist:** publish v1, classify → result stored under v1. Publish v2, re-score → result stored under v2. GET `/products/:id/results` returns entries for both versions; v1 findings are unchanged. |

All tests use an in-memory or test Postgres via Prisma, seeded from `prisma/seed.ts`.

## 6. Manifest

<!-- manifest
prisma/schema.prisma | reads: - | Full Prisma DDL for all 10 tables + Severity enum
prisma/seed.ts | reads: prisma/schema.prisma | Idempotent seed: ingredients, synonyms (incl. OCR typos), default methodology v1 with rules, 2 profiles with modifiers, 2 sample products
prisma/migrations/0001_init/migration.sql | reads: prisma/schema.prisma | Generated migration for initial schema
src/main.ts | reads: - | Bootstrap: NestFactory, global exception filter mapping domain errors to the error envelope
src/app.module.ts | reads: - | Root module importing all feature modules
src/ingredient/ingredient.module.ts | reads: - | Declares controller, provides+exports service and repository
src/ingredient/ingredient.controller.ts | reads: src/ingredient/ingredient.service.ts | GET /ingredients
src/ingredient/ingredient.service.ts | reads: src/ingredient/ingredient.repository.ts | Thin pass-through to repository
src/ingredient/ingredient.repository.ts | reads: - | Prisma queries for ingredients + synonym resolution
src/product/product.module.ts | reads: - | Declares controller, provides+exports service and repository
src/product/product.controller.ts | reads: src/product/product.service.ts | POST /products, GET /products/:id/results (delegates to classification for results)
src/product/product.service.ts | reads: src/product/product.repository.ts | create, getWithIngredients; raises ResourceNotFound
src/product/product.repository.ts | reads: - | Prisma CRUD for products + product_ingredients
src/methodology/methodology.module.ts | reads: - | Declares controller, provides+exports service and repository
src/methodology/methodology.controller.ts | reads: src/methodology/methodology.service.ts | POST /methodologies, POST /methodologies/:id/publish
src/methodology/methodology.service.ts | reads: src/methodology/methodology.repository.ts, src/classification/classification.service.ts | publish (tx) then rescoreAll
src/methodology/methodology.repository.ts | reads: - | Prisma queries + publish transaction
src/classification/classification.module.ts | reads: - | Declares controller, provides+exports service and repository
src/classification/classification.controller.ts | reads: src/classification/classification.service.ts | POST /classify
src/classification/classification.service.ts | reads: src/classification/classification.repository.ts, src/product/product.repository.ts, src/ingredient/ingredient.repository.ts, src/methodology/methodology.repository.ts, src/profile/profile.repository.ts | classify + rescoreAll logic
src/classification/classification.repository.ts | reads: - | Prisma upsert + read for classification_results / findings
src/classification/types.ts | reads: - | Severity, IngredientFinding, ClassificationResponse, ProfiledClassificationResponse, domain errors
src/profile/profile.module.ts | reads: - | Declares controller, provides+exports service and repository
src/profile/profile.controller.ts | reads: src/profile/profile.service.ts | GET /profiles/:id
src/profile/profile.service.ts | reads: src/profile/profile.repository.ts | findById; raises ResourceNotFound
src/profile/profile.repository.ts | reads: - | Prisma queries for profiles + modifiers
test/classification.spec.ts | reads: src/classification/classification.service.ts, prisma/seed.ts | 6 behaviour tests listed in section 5
-->
