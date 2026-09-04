# 01-schema.prisma

## reasoning

```
Let me analyze the PLAN.md to write the complete Prisma schema file.

From the plan, I need:

1. **Enum**: `SEV_ENUM` with values `BANNED`, `RESTRICTED`, `WATCH` (but in Prisma, enum values are typically uppercase by convention, though the plan uses them as `BANNED`, `RESTRICTED`, `WATCH`)

Wait, looking more carefully at the plan:
- The type is `Severity = 'banned' | 'restricted' | 'watch'` (lowercase in TS)
- The enum in the DB is `SEV_ENUM`: `BANNED`, `RESTRICTED`, `WATCH`

In Prisma, enum values are typically uppercase. The TS type maps to lowercase strings. But actually in Prisma, the enum values in the schema are what's stored in the DB. The plan says `SEV_ENUM`: `BANNED`, `RESTRICTED`, `WATCH`. Let me use those as the Prisma enum values.

Actually wait - looking at the plan more carefully, it says:
- **Enum** `SEV_ENUM`: `BANNED`, `RESTRICTED`, `WATCH`

In Prisma, the enum type name and values. Let me think about naming conventions. The plan says column names are `snake_case` via `@map`. Table names are `snake_case` via `@@map`.

For the enum, Prisma uses PascalCase for enum names and values by convention. But the plan explicitly says `SEV_ENUM` with values `BANNED`, `RESTRICTED`, `WATCH`. Let me use those.

Actually, in Prisma, enum values must be UPPERCASE by default (they become the DB values). The Prisma type name can be anything valid. Let me use `Severity` as the Prisma enum name (PascalCase) and map it to `SEV_ENUM` in the DB. Wait, the plan says the enum is named `SEV_ENUM`. Let me re-read...

The plan says: **Enum** `SEV_ENUM`: `BANNED`, `RESTRICTED`, `WATCH` (ordinal 3 > 2 > 1 for escalation comparisons).

In Prisma, I'll define:
```prisma
enum SEV_ENUM {
  BANNED
  RESTRICTED
  WATCH
}
```

Wait, but Prisma enum names should be valid identifiers. `SEV_ENUM` is a valid identifier. And the values BANNED, RESTRICTED, WATCH are valid.

Actually, I need to reconsider. In Prisma, the enum type name in the schema is what you use in model fields. The plan says the TS type is `Severity = 'banned' | 'restricted' | 'watch'` (lowercase). But in the DB, it's stored as `BANNED`, `RESTRICTED`, `WATCH`. This is a mismatch that would need handling in the repository layer, but for the schema file, I'll just define the enum as specified.

Let me now list all 10 tables:

1. `methodology_versions` - id INT PK AI, version INT UNIQUE NOT NULL, name TEXT NOT NULL, is_active BOOL DEFAULT false, created_at TIMESTAMPTZ DEFAULT now()
2. `ingredients` - id INT PK AI, canonical_name TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL
3. `synonyms` - id INT PK AI, ingredient_id INT FK→ingredients.id NOT NULL, synonym_text TEXT UNIQUE NOT NULL
4. `rules` - id INT PK AI, methodology_version_id INT FK NOT NULL, ingredient_id INT FK NOT NULL, severity SEV_ENUM NOT NULL, flag TEXT NOT NULL, source_citation TEXT NOT NULL; UNIQUE(methodology_version_id, ingredient_id)
5. `profiles` - id INT PK AI, name TEXT NOT NULL, description TEXT NULL, created_at TIMESTAMPTZ DEFAULT now()
6. `profile_modifiers` - id INT PK AI, profile_id INT FK NOT NULL, ingredient_id INT FK NOT NULL, severity SEV_ENUM NOT NULL, flag TEXT NOT NULL, source_citation TEXT NOT NULL; UNIQUE(profile_id, ingredient_id)
7. `products` - id INT PK AI, name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now()
8. `product_ingredients` - id INT PK AI, product_id INT FK NOT NULL, raw_text TEXT NOT NULL, position INT NOT NULL; UNIQUE(product_id, position)
9. `classification_results` - id INT PK AI, product_id INT FK NOT NULL, methodology_version_id INT FK NOT NULL, overall_confidence REAL NOT NULL, disclaimer TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ; UNIQUE(product_id, methodology_version_id)
10. `classification_findings` - id INT PK AI, classification_result_id INT FK→classification_results.id NOT NULL, raw_text TEXT NOT NULL, resolved_name TEXT NULL, ingredient_id INT NULL (no FK constraint; null when unknown), is_unknown BOOL DEFAULT false, flag TEXT NULL, severity SEV_ENUM NULL, source_citation TEXT NULL

Now let me write the Prisma schema. I need to be careful about:
- Using `@map` for column names (snake_case)
- Using `@@map` for table names (snake_case)
- Model names in PascalCase
- Relations between models
- The Prisma datasource and generator blocks

For the datasource:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

For the generator:
```prisma
generator client {
  provider = "prisma-client-js"
}
```

Now let me think about the model naming. The convention says "Class: PascalCase". So models should be PascalCase:
- `MethodologyVersion` → `@@map("methodology_versions")`
- `Ingredient` → `@@map("ingredients")`
- `Synonym` → `@@map("synonyms")`
- `Rule` → `@@map("rules")`
- `Profile` → `@@map("profiles")`
- `ProfileModifier` → `@@map("profile_modifiers")`
- `Product` → `@@map("products")`
- `ProductIngredient` → `@@map("product_ingredients")`
- `ClassificationResult` → `@@map("classification_results")`
- `ClassificationFinding` → `@@map("classification_findings")`

For field naming, I'll use camelCase in Prisma and `@map` to snake_case:
- `id` → stays `id` (no map needed, or I could map it)
- Actually, `id` is already the same in both cases. But to be consistent with snake_case convention... actually `id` is the same. Let me not map single-word fields that are already the same.

Wait, let me reconsider. The convention says "Table and column: snake_case (via Prisma @map/@@map)." So ALL columns should be snake_case. For single words like `id`, `name`, they're already the same in snake_case. For multi-word fields like `canonicalName`, I need `@map("canonical_name")`.

Let me also think about the `id` fields. The plan says `id INT PK AI`. In Prisma, I'll use `Int @id @default(autoincrement())`.

For `created_at TIMESTAMPTZ DEFAULT now()`, in Prisma: `DateTime @default(now()) @map("created_at")`.

For `updated_at TIMESTAMPTZ` (no default specified in the plan, but it's a standard pattern), I'll use `DateTime? @map("updated_at")` or `DateTime @default(now()) @updatedAt @map("updated_at")`. The plan just says `updated_at TIMESTAMPTZ` without a default. Let me make it optional or use `@updatedAt`. Actually, looking at the plan again: `updated_at TIMESTAMPTZ` - no NOT NULL, no default. Let me make it `DateTime? @map("updated_at")`.

Wait, actually for `classification_results`, the plan says:
- `created_at TIMESTAMPTZ DEFAULT now()`
- `updated_at TIMESTAMPTZ`

The `updated_at` has no default and no NOT NULL implied. Let me make it optional: `DateTime? @map("updated_at")`.

Now for relations:

- `synonyms.ingredient_id` → `ingredients.id`
- `rules.methodology_version_id` → `methodology_versions.id`
- `rules.ingredient_id` → `ingredients.id`
- `profile_modifiers.profile_id` → `profiles.id`
- `profile_modifiers.ingredient_id` → `ingredients.id`
- `product_ingredients.product_id` → `products.id`
- `classification_results.product_id` → `products.id`
- `classification_results.methodology_version_id` → `methodology_versions.id`
- `classification_findings.classification_result_id` → `classification_results.id`
- `classification_findings.ingredient_id` → NO FK constraint (plan explicitly says "no FK constraint; null when unknown")

For the relations in Prisma, I need to define both sides:
- `Ingredient` has `synonyms: Synonym[]`, `rules: Rule[]`, `profileModifiers: ProfileModifier[]`
- `MethodologyVersion` has `rules: Rule[]`, `classificationResults: ClassificationResult[]`
- `Profile` has `modifiers: ProfileModifier[]`
- `Product` has `ingredients: ProductIngredient[]`, `classificationResults: ClassificationResult[]`
- `ClassificationResult` has `findings: ClassificationFinding[]`

For `classification_findings.ingredient_id`, since there's no FK constraint, I won't add a relation field. I'll just have it as a plain `Int?` field.

Let me also think about the enum. In Prisma, I'll define:
```prisma
enum SEV_ENUM {
  BANNED
  RESTRICTED
  WATCH
}
```

And use `SEV_ENUM` as the type in fields. But wait, the TS type is lowercase `'banned' | 'restricted' | 'watch'`. This means there's a mapping layer. But for the Prisma schema, I'll just use the enum values as defined in the plan.

Actually, I realize I should double-check: does Prisma allow `SEV_ENUM` as an enum name? Yes, it's a valid identifier (uppercase with underscore).

Let me now write the complete schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum SEV_ENUM {
  BANNED
  RESTRICTED
  WATCH
}

model MethodologyVersion {
  id        Int      @id @default(autoincrement())
  version   Int      @unique
  name      String
  isActive  Boolean  @default(false) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")

  rules                Rule[]
  classificationResults ClassificationResult[]

  @@map("methodology_versions")
}

model Ingredient {
  id           Int    @id @default(autoincrement())
  canonicalName String @unique @map("canonical_name")
  displayName  String @map("display_name")

  synonyms         Synonym[]
  rules            Rule[]
  profileModifiers ProfileModifier[]

  @@map("ingredients")
}

model Synonym {
  id          Int    @id @default(autoincrement())
  ingredientId Int   @map("ingredient_id")
  synonymText String @unique @map("synonym_text")

  ingredient Ingredient @relation(fields: [ingredientId], references: [id])

  @@map("synonyms")
}

model Rule {
  id                    Int     @id @default(autoincrement())
  methodologyVersionId  Int     @map("methodology_version_id")
  ingredientId          Int     @map("ingredient_id")
  severity              SEV_ENUM
  flag                  String
  sourceCitation        String  @map("source_citation")

  methodologyVersion MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])
  ingredient         Ingredient         @relation(fields: [ingredientId], references: [id])

  @@unique([methodologyVersionId, ingredientId])
  @@map("rules")
}

model Profile {
  id          Int     @id @default(autoincrement())
  name        String
  description String?
  createdAt   DateTime @default(now()) @map("created_at")

  modifiers ProfileModifier[]

  @@map("profiles")
}

model ProfileModifier {
  id             Int      @id @default(autoincrement())
  profileId      Int      @map("profile_id")
  ingredientId   Int      @map("ingredient_id")
  severity       SEV_ENUM
  flag           String
  sourceCitation String   @map("source_citation")

  profile    Profile    @relation(fields: [profileId], references: [id])
  ingredient Ingredient @relation(fields: [ingredientId], references: [id])

  @@unique([profileId, ingredientId])
  @@map("profile_modifiers")
}

model Product {
  id        Int      @id @default(autoincrement())
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  ingredients          ProductIngredient[]
  classificationResults ClassificationResult[]

  @@map("products")
}

model ProductIngredient {
  id        Int    @id @default(autoincrement())
  productId Int    @map("product_id")
  rawText   String @map("raw_text")
  position  Int

  product Product @relation(fields: [productId], references: [id])

  @@unique([productId, position])
  @@map("product_ingredients")
}

model ClassificationResult {
  id                     Int      @id @default(autoincrement())
  productId              Int      @map("product_id")
  methodologyVersionId   Int      @map("methodology_version_id")
  overallConfidence      Float    @map("overall_confidence")
  disclaimer             String
  createdAt              DateTime @default(now()) @map("created_at")
  updatedAt              DateTime? @map("updated_at")

  product            Product               @relation(fields: [productId], references: [id])
  methodologyVersion MethodologyVersion    @relation(fields: [methodologyVersionId], references: [id])
  findings           ClassificationFinding[]

  @@unique([productId, methodologyVersionId])
  @@map("classification_results")
}

model ClassificationFinding {
  id                     Int      @id @default(autoincrement())
  classificationResultId Int      @map("classification_result_id")
  rawText                String   @map("raw_text")
  resolvedName           String?  @map("resolved_name")
  ingredientId           Int?     @map("ingredient_id")
  isUnknown              Boolean  @default(false) @map("is_unknown")
  flag                   String?
  severity               SEV_ENUM?
  sourceCitation         String?  @map("source_citation")

  classificationResult ClassificationResult @relation(fields: [classificationResultId], references: [id])

  @@map("classification_findings")
}
```

Wait, I need to double-check the `id` fields. The plan says columns are snake_case via `@map`. But `id` is a single word, so it's the same in snake_case. I don't need to map it. Same for `name`, `flag`, `version`. These are all single words that don't change between camelCase and snake_case.

For multi-word fields, I need `@map`:
- `canonicalName` → `canonical_name` ✓
- `displayName` → `display_name` ✓
- `isActive` → `is_active` ✓
- `createdAt` → `created_at` ✓
- `updatedAt` → `updated_at` ✓
- `ingredientId` → `ingredient_id` ✓
- `synonymText` → `synonym_text` ✓
- `methodologyVersionId` → `methodology_version_id` ✓
- `sourceCitation` → `source_citation` ✓
- `profileId` → `profile_id` ✓
- `productId` → `product_id` ✓
- `rawText` → `raw_text` ✓
- `overallConfidence` → `overall_confidence` ✓
- `classificationResultId` → `classification_result_id` ✓
- `resolvedName` → `resolved_name` ✓
- `isUnknown` → `is_unknown` ✓

Looks good. Let me also verify I haven't missed any `@map` on single-word columns that would differ... no, single words are the same.

One more thing: the `id` column in Prisma is `Int @id @default(autoincrement())`. The plan says `id INT PK AI` which matches.

I think the schema is complete. Let me finalize it.
```

## reply

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum SEV_ENUM {
  BANNED
  RESTRICTED
  WATCH
}

model MethodologyVersion {
  id        Int      @id @default(autoincrement())
  version   Int      @unique
  name      String
  isActive  Boolean  @default(false) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")

  rules                 Rule[]
  classificationResults ClassificationResult[]

  @@map("methodology_versions")
}

model Ingredient {
  id            Int    @id @default(autoincrement())
  canonicalName String @unique @map("canonical_name")
  displayName   String @map("display_name")

  synonyms         Synonym[]
  rules            Rule[]
  profileModifiers ProfileModifier[]

  @@map("ingredients")
}

model Synonym {
  id           Int    @id @default(autoincrement())
  ingredientId Int    @map("ingredient_id")
  synonymText  String @unique @map("synonym_text")

  ingredient Ingredient @relation(fields: [ingredientId], references: [id])

  @@map("synonyms")
}

model Rule {
  id                   Int      @id @default(autoincrement())
  methodologyVersionId Int      @map("methodology_version_id")
  ingredientId         Int      @map("ingredient_id")
  severity             SEV_ENUM
  flag                 String
  sourceCitation       String   @map("source_citation")

  methodologyVersion MethodologyVersion @relation(fields: [methodologyVersionId], references: [id])
  ingredient         Ingredient         @relation(fields: [ingredientId], references: [id])

  @@unique([methodologyVersionId, ingredientId])
  @@map("rules")
}

model Profile {
  id          Int       @id @default(autoincrement())
  name        String
  description String?
  createdAt   DateTime  @default(now()) @map("created_at")

  modifiers ProfileModifier[]

  @@map("profiles")
}

model ProfileModifier {
  id             Int      @id @default(autoincrement())
  profileId      Int      @map("profile_id")
  ingredientId   Int      @map("ingredient_id")
  severity       SEV_ENUM
  flag           String
  sourceCitation String   @map("source_citation")

  profile    Profile    @relation(fields: [profileId], references: [id])
  ingredient Ingredient @relation(fields: [ingredientId], references: [id])

  @@unique([profileId, ingredientId])
  @@map("profile_modifiers")
}

model Product {
  id        Int      @id @default(autoincrement())
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  ingredients           ProductIngredient[]
  classificationResults ClassificationResult[]

  @@map("products")
}

model ProductIngredient {
  id        Int    @id @default(autoincrement())
  productId Int    @map("product_id")
  rawText   String @map("raw_text")
  position  Int

  product Product @relation(fields: [productId], references: [id])

  @@unique([productId, position])
  @@map("product_ingredients")
}

model ClassificationResult {
  id                   Int       @id @default(autoincrement())
  productId            Int       @map("product_id")
  methodologyVersionId Int       @map("methodology_version_id")
  overallConfidence    Float     @map("overall_confidence")
  disclaimer           String
  createdAt            DateTime  @default(now()) @map("created_at")
  updatedAt            DateTime? @map("updated_at")

  product            Product                 @relation(fields: [productId], references: [id])
  methodologyVersion MethodologyVersion      @relation(fields: [methodologyVersionId], references: [id])
  findings           ClassificationFinding[]

  @@unique([productId, methodologyVersionId])
  @@map("classification_results")
}

model ClassificationFinding {
  id                     Int       @id @default(autoincrement())
  classificationResultId Int       @map("classification_result_id")
  rawText                String    @map("raw_text")
  resolvedName           String?   @map("resolved_name")
  ingredientId           Int?      @map("ingredient_id")
  isUnknown              Boolean   @default(false) @map("is_unknown")
  flag                   String?
  severity               SEV_ENUM?
  sourceCitation         String?   @map("source_citation")

  classificationResult ClassificationResult @relation(fields: [classificationResultId], references: [id])

  @@map("classification_findings")
}
```
