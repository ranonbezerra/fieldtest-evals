-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('BANNED', 'RESTRICTED', 'WATCH');

-- CreateTable
CREATE TABLE "ingredients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_synonyms" (
    "id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "synonym" TEXT NOT NULL,
    "normalized_synonym" TEXT NOT NULL,

    CONSTRAINT "ingredient_synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_versions" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "methodology_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "methodology_version_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "source_citation" TEXT NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "context" TEXT NOT NULL,

    CONSTRAINT "family_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_rule_modifiers" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "source_citation" TEXT NOT NULL,

    CONSTRAINT "profile_rule_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_ingredients" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "raw_ingredient" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classification_results" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "methodology_version_id" TEXT NOT NULL,
    "profile_id" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classification_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_normalized_key" ON "ingredients"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_synonyms_normalized_synonym_key" ON "ingredient_synonyms"("normalized_synonym");

-- CreateIndex
CREATE UNIQUE INDEX "methodology_versions_version_key" ON "methodology_versions"("version");

-- CreateIndex
CREATE UNIQUE INDEX "rules_methodology_version_id_ingredient_id_key" ON "rules"("methodology_version_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_profiles_context_key" ON "family_profiles"("context");

-- CreateIndex
CREATE UNIQUE INDEX "profile_rule_modifiers_profile_id_ingredient_id_key" ON "profile_rule_modifiers"("profile_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "classification_results_product_id_methodology_version_id_profile_id_key" ON "classification_results"("product_id", "methodology_version_id", "profile_id");

-- CreateIndex
CREATE INDEX "rules_methodology_version_id_idx" ON "rules"("methodology_version_id");

-- CreateIndex
CREATE INDEX "rules_ingredient_id_idx" ON "rules"("ingredient_id");

-- CreateIndex
CREATE INDEX "profile_rule_modifiers_profile_id_idx" ON "profile_rule_modifiers"("profile_id");

-- CreateIndex
CREATE INDEX "profile_rule_modifiers_ingredient_id_idx" ON "profile_rule_modifiers"("ingredient_id");

-- CreateIndex
CREATE INDEX "product_ingredients_product_id_idx" ON "product_ingredients"("product_id");

-- CreateIndex
CREATE INDEX "classification_results_product_id_methodology_version_id_idx" ON "classification_results"("product_id", "methodology_version_id");

-- AddForeignKey
ALTER TABLE "ingredient_synonyms" ADD CONSTRAINT "ingredient_synonyms_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_rule_modifiers" ADD CONSTRAINT "profile_rule_modifiers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "family_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_rule_modifiers" ADD CONSTRAINT "profile_rule_modifiers_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "family_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
