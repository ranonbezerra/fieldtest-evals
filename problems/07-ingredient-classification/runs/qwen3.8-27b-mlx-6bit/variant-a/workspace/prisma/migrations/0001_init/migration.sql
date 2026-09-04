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
