-- CreateTable
CREATE TABLE "ingredients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_synonyms" (
    "id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "variant" TEXT NOT NULL,

    CONSTRAINT "ingredient_synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_versions" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),

    CONSTRAINT "methodology_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "methodology_version_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "source_citation" TEXT NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contextual_modifiers" (
    "id" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "source_citation" TEXT NOT NULL,

    CONSTRAINT "contextual_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "family_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_contexts" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "context" TEXT NOT NULL,

    CONSTRAINT "profile_contexts_pkey" PRIMARY KEY ("id")
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
    "inci" TEXT NOT NULL,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classification_results" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "methodology_version_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "profile_id" TEXT NOT NULL DEFAULT '',
    "confidence" DOUBLE PRECISION NOT NULL,
    "payload" TEXT NOT NULL,
    "classified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classification_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ingredient_synonyms_ingredient_id_idx" ON "ingredient_synonyms"("ingredient_id");
CREATE INDEX "rules_methodology_version_id_idx" ON "rules"("methodology_version_id");
CREATE INDEX "rules_ingredient_id_idx" ON "rules"("ingredient_id");
CREATE INDEX "contextual_modifiers_ingredient_id_idx" ON "contextual_modifiers"("ingredient_id");
CREATE INDEX "profile_contexts_profile_id_idx" ON "profile_contexts"("profile_id");
CREATE INDEX "product_ingredients_product_id_idx" ON "product_ingredients"("product_id");
CREATE INDEX "classification_results_product_id_idx" ON "classification_results"("product_id");
CREATE INDEX "classification_results_methodology_version_id_idx" ON "classification_results"("methodology_version_id");

-- CreateIndex (unique)
CREATE UNIQUE INDEX "ingredients_name_key" ON "ingredients"("name");
CREATE UNIQUE INDEX "ingredient_synonyms_ingredient_id_variant_key" ON "ingredient_synonyms"("ingredient_id", "variant");
CREATE UNIQUE INDEX "methodology_versions_version_key" ON "methodology_versions"("version");
CREATE UNIQUE INDEX "rules_methodology_version_id_ingredient_id_key" ON "rules"("methodology_version_id", "ingredient_id");
CREATE UNIQUE INDEX "contextual_modifiers_context_ingredient_id_key" ON "contextual_modifiers"("context", "ingredient_id");
CREATE UNIQUE INDEX "family_profiles_name_key" ON "family_profiles"("name");
CREATE UNIQUE INDEX "profile_contexts_profile_id_context_key" ON "profile_contexts"("profile_id", "context");
CREATE UNIQUE INDEX "classification_results_product_id_methodology_version_id_profile_id_key" ON "classification_results"("product_id", "methodology_version_id", "profile_id");

-- AddForeignKey
ALTER TABLE "ingredient_synonyms" ADD CONSTRAINT "ingredient_synonyms_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rules" ADD CONSTRAINT "rules_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rules" ADD CONSTRAINT "rules_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contextual_modifiers" ADD CONSTRAINT "contextual_modifiers_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "profile_contexts" ADD CONSTRAINT "profile_contexts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "family_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
