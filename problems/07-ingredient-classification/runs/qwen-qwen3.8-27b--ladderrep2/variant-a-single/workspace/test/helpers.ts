import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { normalizeInci } from '../src/classification/normalization.js';
import { INGREDIENT_FIXTURES } from '../src/ingredient/ingredient-fixtures.js';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaClient;
}

export async function createTestContext(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, prisma: new PrismaClient() };
}

/** Drops every row so each test starts from an empty, deterministic state. */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "classification_results", "product_ingredients", "rules", "profile_modifiers", "synonyms", "products", "profiles", "methodology_versions", "ingredients" RESTART IDENTITY CASCADE',
  );
}

/** Seeds canonical ingredients and their synonym/typo fixtures; returns canonicalName -> id. */
export async function seedIngredients(prisma: PrismaClient): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const taken = new Set<string>();
  for (const fixture of INGREDIENT_FIXTURES) {
    const normalized = normalizeInci(fixture.canonicalName);
    const ingredient = await prisma.ingredient.create({
      data: { name: fixture.canonicalName, normalized },
    });
    ids.set(fixture.canonicalName, ingredient.id);
    taken.add(normalized);
    for (const variant of fixture.variants) {
      const variantNormalized = normalizeInci(variant);
      if (taken.has(variantNormalized)) continue;
      taken.add(variantNormalized);
      await prisma.synonym.create({
        data: { ingredientId: ingredient.id, raw: variant, normalized: variantNormalized },
      });
    }
  }
  return ids;
}
