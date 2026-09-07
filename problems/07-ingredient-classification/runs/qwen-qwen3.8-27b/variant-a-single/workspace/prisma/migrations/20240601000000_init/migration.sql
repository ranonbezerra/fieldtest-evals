-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('banned', 'restricted', 'watch');

-- CreateEnum
CREATE TYPE "MethodologyStatus" AS ENUM ('draft', 'active');

-- CreateTable
CREATE TABLE "ingredients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "synonyms" (
    "id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_versions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "MethodologyStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "methodology_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "flag" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "methodology_version_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_modifiers" (
    "id" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "flag" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,

    CONSTRAINT "profile_modifiers_pkey" PRIMARY KEY ("id")
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
    "raw_name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "product_id" TEXT NOT NULL,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classification_results" (
    "id" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "disclaimer" TEXT NOT NULL,
    "findings_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "product_id" TEXT NOT NULL,
    "methodology_version_id" TEXT NOT NULL,

    CONSTRAINT "classification_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_name_key" ON "ingredients"("name");

-- CreateIndex
CREATE UNIQUE INDEX "synonyms_ingredient_id_value_key" ON "synonyms"("ingredient_id", "value");

-- CreateIndex
CREATE UNIQUE INDEX "methodology_versions_version_key" ON "methodology_versions"("version");

-- CreateIndex
CREATE UNIQUE INDEX "rules_methodology_version_id_ingredient_id_key" ON "rules"("methodology_version_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_name_key" ON "profiles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "profile_modifiers_profile_id_ingredient_id_key" ON "profile_modifiers"("profile_id", "ingredient_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_ingredients_product_id_raw_name_position_key" ON "product_ingredients"("product_id", "raw_name", "position");

-- CreateIndex
CREATE UNIQUE INDEX "classification_results_product_id_methodology_version_id_key" ON "classification_results"("product_id", "methodology_version_id");

-- AddForeignKey
ALTER TABLE "synonyms" ADD CONSTRAINT "synonyms_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_modifiers" ADD CONSTRAINT "profile_modifiers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_modifiers" ADD CONSTRAINT "profile_modifiers_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
