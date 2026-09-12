-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('watch', 'restricted', 'banned');

CREATE TYPE "VersionStatus" AS ENUM ('draft', 'published');

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "synonyms" (
    "id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "synonyms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_versions" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'draft',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "methodology_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "severity" "Severity" NOT NULL,
    "source_citation" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_ingredients" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_modifiers" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "severity" "Severity" NOT NULL,
    "citation" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classification_results" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "methodology_version_id" UUID NOT NULL,
    "findings" TEXT NOT NULL,
    "unknowns" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "classified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classification_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_name_key" ON "ingredients"("name");
CREATE UNIQUE INDEX "ingredients_normalized_key" ON "ingredients"("normalized");
CREATE UNIQUE INDEX "synonyms_normalized_key" ON "synonyms"("normalized");
CREATE INDEX "synonyms_ingredient_id_idx" ON "synonyms"("ingredient_id");
CREATE UNIQUE INDEX "rules_version_id_ingredient_id_key" ON "rules"("version_id", "ingredient_id");
CREATE UNIQUE INDEX "product_ingredients_product_id_position_key" ON "product_ingredients"("product_id", "position");
CREATE UNIQUE INDEX "profile_modifiers_profile_id_ingredient_id_key" ON "profile_modifiers"("profile_id", "ingredient_id");
CREATE UNIQUE INDEX "classification_results_product_id_methodology_version_id_key" ON "classification_results"("product_id", "methodology_version_id");

-- AddForeignKey
ALTER TABLE "synonyms" ADD CONSTRAINT "synonyms_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rules" ADD CONSTRAINT "rules_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rules" ADD CONSTRAINT "rules_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_modifiers" ADD CONSTRAINT "profile_modifiers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "profile_modifiers" ADD CONSTRAINT "profile_modifiers_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "classification_results" ADD CONSTRAINT "classification_results_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
