-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('banned', 'restricted', 'watch');

-- CreateEnum
CREATE TYPE "RuleContext" AS ENUM ('base', 'pregnancy', 'child_under_3');

-- CreateEnum
CREATE TYPE "SynonymKind" AS ENUM ('synonym', 'typo');

-- CreateEnum
CREATE TYPE "MethodologyVersionStatus" AS ENUM ('draft', 'published');

-- CreateTable
CREATE TABLE "ingredients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_synonyms" (
    "id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "kind" "SynonymKind" NOT NULL DEFAULT 'synonym',
    "ingredient_id" TEXT NOT NULL,

    CONSTRAINT "ingredient_synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_versions" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "status" "MethodologyVersionStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),

    CONSTRAINT "methodology_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "methodology_version_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "context" "RuleContext" NOT NULL,
    "severity" "Severity" NOT NULL,
    "source_citation" TEXT NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contexts" TEXT[] NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_ingredients" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "raw_inci_string" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classification_results" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "methodology_version_id" TEXT NOT NULL,
    "profile_id" TEXT,
    "payload" JSONB NOT NULL,

    CONSTRAINT "classification_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_name_key" ON "ingredients"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_synonyms_alias_key" ON "ingredient_synonyms"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "methodology_versions_version_key" ON "methodology_versions"("version");

-- CreateIndex
CREATE UNIQUE INDEX "rules_methodology_version_id_ingredient_id_context_key" ON "rules"("methodology_version_id", "ingredient_id", "context");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_name_key" ON "profiles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_ingredients_product_id_position_key" ON "product_ingredients"("product_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "classification_results_product_id_methodology_version_id_profile_id_key" ON "classification_results"("product_id", "methodology_version_id", "profile_id");

-- CreateIndex
CREATE INDEX "rules_methodology_version_id_idx" ON "rules"("methodology_version_id");

-- CreateIndex
CREATE INDEX "product_ingredients_product_id_idx" ON "product_ingredients"("product_id");

-- CreateIndex
CREATE INDEX "classification_results_product_id_idx" ON "classification_results"("product_id");

-- AddForeignKey
ALTER TABLE "ingredient_synonyms" ADD CONSTRAINT "ingredient_synonyms_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
