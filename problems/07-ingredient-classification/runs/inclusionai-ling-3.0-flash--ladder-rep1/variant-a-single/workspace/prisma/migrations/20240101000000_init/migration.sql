-- ASSUMPTION: Run `prisma migrate dev --name init` to generate this migration from the schema.
-- This is the DDL that Prisma would produce from prisma/schema.prisma.
CREATE TABLE "ingredients" (
  id    VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  name  VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE "synonyms" (
  id           VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  text         VARCHAR(255) NOT NULL UNIQUE,
  normalized   VARCHAR(255) NOT NULL,
  type         VARCHAR(255) NOT NULL,
  "ingredientId" VARCHAR(255) NOT NULL REFERENCES "ingredients"(id)
);

CREATE TABLE "methodology_versions" (
  id          VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  version     VARCHAR(255) NOT NULL UNIQUE,
  status      VARCHAR(255) NOT NULL DEFAULT 'draft',
  "publishedAt" TIMESTAMP,
);

CREATE TABLE "rules" (
  id             VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(255) NOT NULL,
  severity       VARCHAR(255) NOT NULL,
  source         VARCHAR(255) NOT NULL,
  "methodologyId" VARCHAR(255) NOT NULL REFERENCES "methodology_versions"(id)
);

CREATE TABLE "profiles" (
  id   VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL
);

CREATE TABLE "profile_modifiers" (
  id             VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  field          VARCHAR(255) NOT NULL,
  severity       VARCHAR(255) NOT NULL,
  description    VARCHAR(255) NOT NULL,
  "profileId"    VARCHAR(255) NOT NULL REFERENCES "profiles"(id)
);

CREATE TABLE "products" (
  id             VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(255) NOT NULL,
  "ingredientList" TEXT NOT NULL
);

CREATE TABLE "classification_results" (
  id                    VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  "productId"           VARCHAR(255) NOT NULL REFERENCES "products"(id),
  "methodologyVersionId" VARCHAR(255) NOT NULL REFERENCES "methodology_versions"(id),
  confidence            FLOAT NOT NULL,
  disclaimer            VARCHAR(255) NOT NULL,
  "createdAt"           TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE("productId", "methodologyVersionId")
);

CREATE TABLE "findings" (
  id               VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  "classificationId" VARCHAR(255) NOT NULL REFERENCES "classification_results"(id),
  "ingredientName"  VARCHAR(255) NOT NULL,
  "listedAs"        VARCHAR(255) NOT NULL,
  "isFlagged"       BOOLEAN NOT NULL,
  severity           VARCHAR(255),
  source             VARCHAR(255)
);

CREATE TABLE "unknown_ingredients" (
  id               VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  "classificationId" VARCHAR(255) NOT NULL REFERENCES "classification_results"(id),
  "ingredientText"   VARCHAR(255) NOT NULL
);
