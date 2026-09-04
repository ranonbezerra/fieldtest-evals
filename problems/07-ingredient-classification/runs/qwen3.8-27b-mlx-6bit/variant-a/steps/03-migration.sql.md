# 03-migration.sql

## reasoning

```
The user wants me to write the Prisma migration SQL file for the initial schema. Let me analyze the schema.prisma file to generate the correct SQL migration.

From the schema, I need:
1. An enum `SEV_ENUM` with values BANNED, RESTRICTED, WATCH
2. Tables:
   - `methodology_versions`
   - `ingredients`
   - `synonyms`
   - `rules`
   - `profiles`
   - `profile_modifiers`
   - `products`
   - `product_ingredients`
   - `classification_results`
   - `classification_findings`

Let me write the migration SQL following Prisma's standard migration format for PostgreSQL.

Prisma migrations typically:
- Create enums
- Create tables with appropriate types
- Add primary keys, foreign keys, unique constraints
- Use the `@@map` table names and `@map` column names

Let me go through each model:

**SEV_ENUM**: BANNED, RESTRICTED, WATCH

**MethodologyVersion** → `methodology_versions`:
- id: SERIAL PK (Int @id @default(autoincrement()))
- version: INTEGER UNIQUE NOT NULL
- name: TEXT NOT NULL (String → TEXT in Prisma PG)
- is_active: BOOLEAN DEFAULT false NOT NULL
- created_at: TIMESTAMPTZ DEFAULT now() NOT NULL

**Ingredient** → `ingredients`:
- id: SERIAL PK
- canonical_name: TEXT UNIQUE NOT NULL
- display_name: TEXT NOT NULL

**Synonym** → `synonyms`:
- id: SERIAL PK
- ingredient_id: INTEGER NOT NULL (FK → ingredients.id)
- synonym_text: TEXT UNIQUE NOT NULL

**Rule** → `rules`:
- id: SERIAL PK
- methodology_version_id: INTEGER NOT NULL (FK → methodology_versions.id)
- ingredient_id: INTEGER NOT NULL (FK → ingredients.id)
- severity: "SEV_ENUM" NOT NULL
- flag: TEXT NOT NULL
- source_citation: TEXT NOT NULL
- UNIQUE(methodology_version_id, ingredient_id)

**Profile** → `profiles`:
- id: SERIAL PK
- name: TEXT NOT NULL
- description: TEXT (nullable)
- created_at: TIMESTAMPTZ DEFAULT now() NOT NULL

**ProfileModifier** → `profile_modifiers`:
- id: SERIAL PK
- profile_id: INTEGER NOT NULL (FK → profiles.id)
- ingredient_id: INTEGER NOT NULL (FK → ingredients.id)
- severity: "SEV_ENUM" NOT NULL
- flag: TEXT NOT NULL
- source_citation: TEXT NOT NULL
- UNIQUE(profile_id, ingredient_id)

**Product** → `products`:
- id: SERIAL PK
- name: TEXT NOT NULL
- created_at: TIMESTAMPTZ DEFAULT now() NOT NULL

**ProductIngredient** → `product_ingredients`:
- id: SERIAL PK
- product_id: INTEGER NOT NULL (FK → products.id)
- raw_text: TEXT NOT NULL
- position: INTEGER NOT NULL
- UNIQUE(product_id, position)

**ClassificationResult** → `classification_results`:
- id: SERIAL PK
- product_id: INTEGER NOT NULL (FK → products.id)
- methodology_version_id: INTEGER NOT NULL (FK → methodology_versions.id)
- overall_confidence: REAL NOT NULL (Float → REAL in Prisma PG)
- disclaimer: TEXT NOT NULL
- created_at: TIMESTAMPTZ DEFAULT now() NOT NULL
- updated_at: TIMESTAMPTZ (nullable)
- UNIQUE(product_id, methodology_version_id)

**ClassificationFinding** → `classification_findings`:
- id: SERIAL PK
- classification_result_id: INTEGER NOT NULL (FK → classification_results.id)
- raw_text: TEXT NOT NULL
- resolved_name: TEXT (nullable)
- ingredient_id: INTEGER (nullable) — no FK constraint per plan
- is_unknown: BOOLEAN DEFAULT false NOT NULL
- flag: TEXT (nullable)
- severity: "SEV_ENUM" (nullable)
- source_citation: TEXT (nullable)

Now let me write the Prisma-style migration SQL. Prisma migrations use specific formatting with `--` comments for steps and standard PostgreSQL DDL.

Let me write it in the standard Prisma migration format:

```sql
-- CreateEnum
CREATE TYPE "SEV_ENUM" AS ENUM ('BANNED', 'RESTRICTED', 'WATCH');

-- CreateTable
CREATE TABLE "methodology_versions" (
    "id" SERIAL NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "methodology_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" SERIAL NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

...
```

Wait, Prisma uses `TIMESTAMP(3)` for DateTime by default in PostgreSQL migrations. Let me verify - yes, Prisma generates `TIMESTAMP(3)` for DateTime fields.

Also, the DEFAULT for timestamps in Prisma migrations is `CURRENT_TIMESTAMP` not `now()`.

Let me also note that Prisma uses `SERIAL` for autoincrement Int fields.

For the unique constraints, Prisma creates them as inline `CREATE UNIQUE INDEX` or as part of the table definition. Actually, looking at real Prisma migrations, unique constraints from `@unique` on a single column are added as `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE(...)`, and composite `@@unique` are also added similarly. Let me use the standard Prisma format.

Actually, in Prisma migrations, single-column `@unique` constraints are typically added with:
```sql
CREATE UNIQUE INDEX "table_column_key" ON "table"("column");
```

And composite `@@unique` constraints are:
```sql
CREATE UNIQUE INDEX "table_col1_col2_key" ON "table"("col1", "col2");
```

Foreign keys are added with:
```sql
ALTER TABLE "table" ADD CONSTRAINT "table_column_fkey" FOREIGN KEY ("column") REFERENCES "ref_table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Let me write the full migration now. I'll follow the standard Prisma migration ordering:
1. Create enum
2. Create all tables
3. Create indexes (unique constraints)
4. Add foreign keys

Let me be careful about the naming conventions Prisma uses:
- PK constraint: `"<table>_pkey"`
- Unique index: `"<table>_<column>_key"` (single) or `"<table>_<col1>_<col2>_key"` (composite)
- FK constraint: `"<table>_<column>_fkey"`

For `synonyms.synonym_text` which is `@unique`:
- Index name: `"synonyms_synonym_text_key"`

For `ingredients.canonical_name` which is `@unique`:
- Index name: `"ingredients_canonical_name_key"`

For `methodology_versions.version` which is `@unique`:
- Index name: `"methodology_versions_version_key"`

For composite uniques:
- `rules`: `"rules_methodology_version_id_ingredient_id_key"`
- `profile_modifiers`: `"profile_modifiers_profile_id_ingredient_id_key"`
- `product_ingredients`: `"product_ingredients_product_id_position_key"`
- `classification_results`: `"classification_results_product_id_methodology_version_id_key"`

FKs:
- `synonyms.ingredient_id` → `ingredients.id`: `"synonyms_ingredient_id_fkey"`
- `rules.methodology_version_id` → `methodology_versions.id`: `"rules_methodology_version_id_fkey"`
- `rules.ingredient_id` → `ingredients.id`: `"rules_ingredient_id_fkey"`
- `profile_modifiers.profile_id` → `profiles.id`: `"profile_modifiers_profile_id_fkey"`
- `profile_modifiers.ingredient_id` → `ingredients.id`: `"profile_modifiers_ingredient_id_fkey"`
- `product_ingredients.product_id` → `products.id`: `"product_ingredients_product_id_fkey"`
- `classification_results.product_id` → `products.id`: `"classification_results_product_id_fkey"`
- `classification_results.methodology_version_id` → `methodology_versions.id`: `"classification_results_methodology_version_id_fkey"`
- `classification_findings.classification_result_id` → `classification_results.id`: `"classification_findings_classification_result_id_fkey"`

Now let me write the complete file.
```

## reply

```sql
-- CreateEnum
CREATE TYPE "SEV_ENUM" AS ENUM ('BANNED', 'RESTRICTED', 'WATCH');

-- CreateTable
CREATE TABLE "methodology_versions" (
    "id" SERIAL NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "methodology_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" SERIAL NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "synonyms" (
    "id" SERIAL NOT NULL,
    "ingredient_id" INTEGER NOT NULL,
    "synonym_text" TEXT NOT NULL,

    CONSTRAINT "synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" SERIAL NOT NULL,
    "methodology_version_id" INTEGER NOT NULL,
    "ingredient_id" INTEGER NOT NULL,
    "severity" "SEV_ENUM" NOT NULL,
    "flag" TEXT NOT NULL,
    "source_citation" TEXT NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_modifiers" (
    "id" SERIAL NOT NULL,
    "profile_id" INTEGER NOT NULL,
    "ingredient_id" INTEGER NOT NULL,
    "severity" "SEV_ENUM" NOT NULL,
    "flag" TEXT NOT NULL,
    "source_citation" TEXT NOT NULL,

    CONSTRAINT "profile_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_ingredients" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "raw_text" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classification_results" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "methodology_version_id" INTEGER NOT NULL,
    "overall_confidence" REAL NOT NULL,
    "disclaimer" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "classification_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classification_findings" (
    "id" SERIAL NOT NULL,
    "classification_result_id" INTEGER NOT NULL,
    "raw_text" TEXT NOT NULL,
    "resolved_name" TEXT,
    "ingredient_id" INTEGER,
    "is_unknown" BOOLEAN NOT NULL DEFAULT false,
    "flag" TEXT,
    "severity" "SEV_ENUM",
    "source_citation" TEXT,

    CONSTRAINT "classification_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "methodology_versions_version_key" ON "methodology_versions"("version");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_canonical_name_key" ON "ingredients"("canonical_name");

-- CreateIndex
CREATE UNIQUE INDEX "synonyms_synonym_text_key" ON "synonyms"("synonym_text");

-- CreateIndex
CREATE UNIQUE INDEX "rules_methodology_version_id_ingredient_id_key" ON "rules"("methodology_version_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_modifiers_profile_id_ingredient_id_key" ON "profile_modifiers"("profile_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_ingredients_product_id_position_key" ON "product_ingredients"("product_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "classification_results_product_id_methodology_version_id_key" ON "classification_results"("product_id", "methodology_version_id");

-- AddForeignKey
ALTER TABLE "synonyms" ADD CONSTRAINT "synonyms_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_modifiers" ADD CONSTRAINT "profile_modifiers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_modifiers" ADD CONSTRAINT "profile_modifiers_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_findings" ADD CONSTRAINT "classification_findings_classification_result_id_fkey" FOREIGN KEY ("classification_result_id") REFERENCES "classification_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```
