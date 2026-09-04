# plan

## reasoning

```
Let me analyze the task carefully and produce a PLAN.md for the cosmetics ingredient scanner.

Key requirements:
1. Schema: ingredients + synonyms, rules grouped under immutable methodology versions, products with ingredient lists, stored classification results keyed by (product, methodologyVersion).
2. `classify(productId, profileId?)` — normalizes and resolves ingredients (synonyms, case, accents, OCR typos), applies active methodology's base rules, then profile's contextual modifiers by precedence. Output: per-ingredient findings (flag, severity, source citation), unrecognized as unknown, overall confidence, disclaimer — no binary safe/toxic.
3. Publishing a new methodology version triggers idempotent re-scoring of affected products; results from previous version remain retrievable.
4. Tests: profile flips a finding, unknown ingredient lowers confidence and is visible, synonym/typo resolves, same product identical across reruns and under shuffled ingredient order, both versions' results coexist.

Let me think through the design:

**Assumptions:**
- Active methodology version is the one with the highest `version` number (or a flag). I'll use a `isActive` boolean on methodology version, toggled atomically when publishing.
- "Affected products" for re-scoring = all products that have at least one ingredient stored.
- Profile "modifiers" tighten rules — meaning they can escalate severity or add new flags. Precedence: profile modifier > base rule (profile wins when both flag the same ingredient).
- Confidence: starts at 1.0, each unknown ingredient reduces it by a fixed fraction (e.g., 0.1 per unknown, floor at 0).
- Severity levels: banned > restricted > watch (ordinal for "flip" meaning profile can escalate).
- Normalization: lowercase, strip accents (NFD), trim. Synonym matching is exact after normalization. OCR typos are a fixed synonym fixture (map of typo → canonical name).
- The "provided synonym fixtures" means we ship a seed file with common typos/synonyms.
- Re-scoring is idempotent: keyed by (product, methodologyVersion), upsert semantics.
- Results are immutable once stored for a given version.

**Data model:**

Tables:
1. `methodology_version` — id, version (int, unique), name, created_at, is_active
2. `ingredient` — id, canonical_name (unique), display_name
3. `synonym` — id, ingredient_id (FK), synonym_text (normalized form)
4. `rule` — id, methodology_version_id (FK), ingredient_id (FK), severity (enum: banned/restricted/watch), source_citation, flag (string)
5. `profile` — id, name, description
6. `profile_modifier` — id, profile_id (FK), ingredient_id (FK), severity_override (enum), flag, source_citation
7. `product` — id, name, created_at
8. `product_ingredient` — id, product_id (FK), raw_text, position (int)
9. `classification_result` — id, product_id (FK), methodology_version_id (FK), profile_id (nullable FK), overall_confidence, disclaimer, created_at, updated_at. Unique on (product_id, methodology_version_id, profile_id).
10. `classification_finding` — id, classification_result_id (FK), ingredient_id (nullable FK — null if unknown), raw_text, resolved_name (nullable), is_unknown, flag, severity (nullable — null if unknown), source_citation (nullable)

Wait, let me reconsider. The profile is optional in `classify(productId, profileId?)`. So results are keyed by (product, methodologyVersion) per the spec. But if profile affects the result... Let me re-read: "stored classification results keyed by (product, methodologyVersion)". So the key is (product, methodologyVersion), and profile is a parameter that affects the classification but the stored result is per (product, version). Hmm, but then a profile flip would change the stored result?

Actually re-reading: "stored classification results keyed by (product, methodologyVersion)" — this is the storage key. The `classify` function takes an optional profileId and returns findings. The stored result is the classification without a profile (base). Or maybe the profile is part of the key?

The spec says "keyed by (product, methodologyVersion)" explicitly. So the stored result doesn't include profile in its key. The classify function can take a profile for ad-hoc evaluation, but the stored result is the base classification. Let me think about this differently:

- Stored results: one per (product, methodologyVersion). These are the "published" results.
- `classify(productId, profileId?)` is an API endpoint that computes the classification on-the-fly (or returns stored result + profile overlay).

Actually, I think the cleanest interpretation: `classify` always computes fresh. The stored results are for the re-scoring use case (point 3) and for retrieving historical results. The API `classify` computes the full classification including profile modifiers and returns it, but also stores the base (no-profile) result.

Wait, let me re-read point 3: "Publishing a new methodology version triggers idempotent re-scoring of affected products; results from the previous version remain retrievable." This means when you publish version N+1, you re-run classification for all products and store results under version N+1. The old version N results are still in the DB.

So the stored result is per (product, methodologyVersion) — no profile. The `classify` API endpoint takes an optional profileId and returns the classification with profile modifiers applied, but what it stores is the base result. Or maybe it stores per (product, version) always as the base, and the profile is just applied at query time.

I'll go with: stored results are base (no profile). The `classify` endpoint computes base + profile overlay in memory and returns the combined result. Storage is for re-scoring and historical retrieval.

Actually wait — if I store base results, then `classify` with a profile can just read the stored base and apply modifiers in memory. That's clean. But if there's no stored result yet (first time), it computes and stores.

Let me simplify: 
- `classify(productId, profileId?)` always computes from scratch (reads product ingredients, resolves, applies rules for active version, then profile modifiers if provided). It stores the result keyed by (product, activeVersionId) — upsert. If profileId is provided, the stored result is still the base (no profile), but the response includes profile-modified findings.

Hmm, that's a bit odd. Let me think again.

Actually the simplest: the stored result includes ALL findings (base + profile if provided). The key is (product, methodologyVersion, profileId nullable). But the spec says "keyed by (product, methodologyVersion)". 

OK I'll follow the spec literally: key is (product, methodologyVersion). The stored result is the classification for that product under that version. If classify is called with a profileId, it stores the base result (profile not in key) but returns the profile-modified findings in the response. The stored result is always the "no profile" baseline.

Wait, that means if you call classify twice with different profiles, the stored result is the same (base). The profile only affects the response. That makes sense for "retrievable" results — you get the base, and can apply any profile at query time.

Let me go with this design:
- Stored: (product_id, methodology_version_id) → base classification (no profile)
- API response: base + profile overlay if profileId provided
- Re-scoring: recompute base for all products under new version

**Types and signatures:**

Let me define the key types:

```typescript
// Enums
type Severity = 'banned' | 'restricted' | 'watch';

// DTOs / Interfaces
interface IngredientFinding {
  rawText: string;
  resolvedName: string | null; // null if unknown
  ingredientId: number | null;
  isUnknown: boolean;
  flag: string | null;
  severity: Severity | null;
  sourceCitation: string | null;
}

interface ClassificationResult {
  productId: number;
  methodologyVersionId: number;
  findings: IngredientFinding[];
  unknownIngredients: string[];
  overallConfidence: number; // 0..1
  disclaimer: string;
}

interface ProfiledClassificationResult extends ClassificationResult {
  profileId: number | null;
  profileModifiersApplied: number;
}
```

**Control flow for classify:**
1. Load product + its ingredients (ordered by position)
2. Resolve each raw text → canonical ingredient (via normalization + synonym lookup)
3. Get active methodology version
4. Load all rules for that version
5. For each resolved ingredient, find matching rule → finding
6. If profileId provided, load profile modifiers, apply with precedence (profile modifier overrides base rule for same ingredient)
7. Compute confidence: 1 - 0.1 * unknownCount, floor 0
8. Build disclaimer (static string)
9. Upsert stored result (base, no profile) keyed by (product, activeVersionId)
10. Return response (with or without profile overlay)

**Precedence for profile modifiers:**
- If a base rule flags ingredient X with severity S, and a profile modifier flags X with severity S':
  - If S' is higher than S (banned > restricted > watch): use S', flag from modifier
  - If S' is lower: still use S (profile only tightens)
  - If no base rule but profile modifier exists: use modifier's flag/severity
- "Tighten" means profile can only add or escalate, never de-escalate.

**Re-scoring flow:**
1. Publish new version (set is_active=true, old is_active=false) — transaction
2. For each product with ingredients:
   a. Run classification (same as classify but no profile)
   b. Upsert result keyed by (product, newVersionId)
3. Idempotent: running again for same version produces same results (upsert with same values)

Now let me think about file structure:

```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/ingredient/ingredient.module.ts
src/ingredient/ingredient.controller.ts
src/ingredient/ingredient.service.ts
src/ingredient/ingredient.repository.ts
src/product/product.module.ts
src/product/product.controller.ts
src/product/product.service.ts
src/product/product.repository.ts
src/methodology/methodology.module.ts
src/methodology/methodology.controller.ts
src/methodology/methodology.service.ts
src/methodology/methodology.repository.ts
src/classification/classification.module.ts
src/classification/classification.controller.ts
src/classification/classification.service.ts
src/classification/classification.repository.ts
src/profile/profile.module.ts
src/profile/profile.controller.ts
src/profile/profile.service.ts
src/profile/profile.repository.ts
test/classification.spec.ts
prisma/seed.ts  (synonym fixtures)
```

Hmm, but the conventions say `src/<feature>/<feature>.module.ts` etc. Let me align:

Features: ingredient, product, methodology, classification, profile

Actually, let me think about what's truly a separate feature vs. what's part of classification:
- ingredient: CRUD for ingredients + synonyms
- product: CRUD for products + their ingredient lists
- methodology: versioning, publishing
- classification: the classify endpoint, stored results
- profile: CRUD for profiles + modifiers

That's 5 features. Let me keep it that way.

Now for the manifest, I need to list every file I'll write. Let me be thorough but not excessive.

Let me also think about the Prisma schema more carefully:

```prisma
enum Severity {
  BANNED
  RESTRICTED
  WATCH
}

model MethodologyVersion {
  id          Int      @id @default(autoincrement())
  version     Int      @unique
  name        String
  isActive    Boolean  @default(false) @map("is_active")
  createdAt   DateTime @default(now()) @map("created_at")
  rules       Rule[]
  results     ClassificationResult[]
  
  @@map("methodology_versions")
}

model Ingredient {
  id          Int      @id @default(autoincrement())
  canonicalName String @unique @map("canonical_name")
  displayName String   @map("display_name")
  synonyms    Synonym[]
  rules       Rule[]
  modifiers   ProfileModifier[]
  
  @@map("ingredients")
}

model Synonym {
  id            Int      @id @default(autoincrement())
  ingredientId  Int      @map("ingredient_id")
  synonymText   String   @unique @map("synonym_text") // normalized form
  ingredient    Ingredient @relation(fields: [ingredientId], references: [id])
  
  @@map("synonyms")
}

model Rule {
  id                    Int      @id @default(autoincrement())
  methodologyVersionId  Int      @map("methodology_version_id")
  ingredientId          Int      @map("ingredient_id")
  severity              Severity
  flag                  String
  sourceCitation        String   @map("source_citation")
  version               MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])
  ingredient            Ingredient @relation(fields: [ingredientId], references: [id])
  
  @@unique([methodologyVersionId, ingredientId])
  @@map("rules")
}

model Profile {
  id          Int      @id @default(autoincrement())
  name        String
  description String?
  modifiers   ProfileModifier[]
  createdAt   DateTime @default(now()) @map("created_at")
  
  @@map("profiles")
}

model ProfileModifier {
  id            Int      @id @default(autoincrement())
  profileId     Int      @map("profile_id")
  ingredientId  Int      @map("ingredient_id")
  severity      Severity
  flag          String
  sourceCitation String  @map("source_citation")
  profile       Profile @relation(fields: [profileId], references: [id])
  ingredient    Ingredient @relation(fields: [ingredientId], references: [id])
  
  @@unique([profileId, ingredientId])
  @@map("profile_modifiers")
}

model Product {
  id              Int      @id @default(autoincrement())
  name            String
  createdAt       DateTime @default(now()) @map("created_at")
  ingredients     ProductIngredient[]
  results         ClassificationResult[]
  
  @@map("products")
}

model ProductIngredient {
  id         Int     @id @default(autoincrement())
  productId  Int     @map("product_id")
  rawText    String  @map("raw_text")
  position   Int
  product    Product @relation(fields: [productId], references: [id])
  
  @@unique([productId, position])
  @@map("product_ingredients")
}

model ClassificationResult {
  id                    Int      @id @default(autoincrement())
  productId             Int      @map("product_id")
  methodologyVersionId  Int      @map("methodology_version_id")
  overallConfidence     Float    @map("overall_confidence")
  disclaimer            String
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")
  product               Product @relation(fields: [productId], references: [id])
  version               MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])
  findings              ClassificationFinding[]
  
  @@unique([productId, methodologyVersionId])
  @@map("classification_results")
}

model ClassificationFinding {
  id                    Int       @id @default(autoincrement())
  classificationResultId Int      @map("classification_result_id")
  rawText               String    @map("raw_text")
  resolvedName          String?   @map("resolved_name")
  ingredientId          Int?      @map("ingredient_id")
  isUnknown             Boolean   @default(false) @map("is_unknown")
  flag                  String?
  severity              Severity?
  sourceCitation        String?   @map("source_citation")
  result                ClassificationResult @relation(fields: [classificationResultId], references: [id])
  
  @@map("classification_findings")
}
```

Wait, ClassificationFinding has a nullable FK to ingredient. In Prisma that's fine — it's just a nullable Int column, no relation if it's nullable and we don't define the relation. Actually I could define a relation with optional. Let me keep it simple — just a nullable Int column without a formal relation to avoid complexity.

Actually for the plan, I don't need to write the full Prisma schema — I just need to describe the tables and columns in section 2. The implementer will write the schema.

Now let me think about what files I'll actually list in the manifest. The task says "List only files you will write." So I should list:

- prisma/schema.prisma
- prisma/seed.ts (synonym fixtures)
- src/main.ts
- src/app.module.ts
- src/ingredient/ingredient.module.ts
- src/ingredient/ingredient.controller.ts
- src/ingredient/ingredient.service.ts
- src/ingredient/ingredient.repository.ts
- src/product/product.module.ts
- src/product/product.controller.ts
- src/product/product.service.ts
- src/product/product.repository.ts
- src/methodology/methodology.module.ts
- src/methodology/methodology.controller.ts
- src/methodology/methodology.service.ts
- src/methodology/methodology.repository.ts
- src/classification/classification.module.ts
- src/classification/classification.controller.ts
- src/classification/classification.service.ts
- src/classification/classification.repository.ts
- src/profile/profile.module.ts
- src/profile/profile.controller.ts
- src/profile/profile.service.ts
- src/profile/profile.repository.ts
- test/classification.spec.ts

That's a lot. Let me think about whether I can consolidate. The conventions say one file per role per feature. I'll keep them separate.

Actually, do I need a migration file? The conventions say "Every schema change ships with a migration." But migrations are generated, not hand-written typically. I'll mention in assumptions that a migration is generated from the schema.

Let me now write the plan, being concise but complete. I need to watch my output limit.

Let me structure:

1. Assumptions — ~8-10 items
2. Data model — table descriptions
3. Types and signatures — interfaces, class methods, error types
4. Control flow — classify flow, publish/respcore flow
5. Tests — 5-6 test lines
6. Manifest — file list

Let me be terse.
```

## reply

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
