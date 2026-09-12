-- CreateTable
CREATE TABLE "ingredients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_synonyms" (
    "id" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredient_synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_versions" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "methodology_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "methodology_version_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_ingredients" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_modifiers" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "profile_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classification_results" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "methodology_version_id" TEXT NOT NULL,
    "findings" JSONB NOT NULL,
    "unknowns" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "disclaimer" TEXT NOT NULL,
    "classified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classification_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_name_key" ON "ingredients"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_synonyms_form_key" ON "ingredient_synonyms"("form");

-- CreateIndex
CREATE UNIQUE INDEX "methodology_versions_version_key" ON "methodology_versions"("version");

-- CreateIndex
CREATE UNIQUE INDEX "rules_methodology_version_id_ingredient_id_key" ON "rules"("methodology_version_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_name_key" ON "products"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_ingredients_product_id_name_key" ON "product_ingredients"("product_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_name_key" ON "profiles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "profile_modifiers_profile_id_ingredient_id_key" ON "profile_modifiers"("profile_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "classification_results_product_id_methodology_version_id_key" ON "classification_results"("product_id", "methodology_version_id");

-- AddForeignKey
ALTER TABLE "ingredient_synonyms" ADD CONSTRAINT "ingredient_synonyms_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_modifiers" ADD CONSTRAINT "profile_modifiers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_modifiers" ADD CONSTRAINT "profile_modifiers_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
