import { PrismaClient } from '@prisma/client';
import { INGREDIENTS, METHODOLOGY_VERSIONS, PRODUCTS, PROFILES } from './seed-data.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  for (const entry of INGREDIENTS) {
    const ingredient = await prisma.ingredient.upsert({
      where: { name: entry.name },
      update: {},
      create: { name: entry.name },
    });
    // The canonical name itself is a resolvable form, so every ingredient is
    // reachable through the single synonym table.
    for (const form of [entry.name, ...entry.synonyms]) {
      await prisma.ingredientSynonym.upsert({
        where: { form },
        update: {},
        create: { form, ingredientId: ingredient.id },
      });
    }
  }

  for (const seed of METHODOLOGY_VERSIONS) {
    const version = await prisma.methodologyVersion.upsert({
      where: { version: seed.version },
      update: {},
      create: {
        version: seed.version,
        name: seed.name,
        status: seed.version === 1 ? 'active' : 'draft',
        isActive: seed.version === 1,
      },
    });
    for (const rule of seed.rules) {
      const ingredient = await prisma.ingredient.findUniqueOrThrow({ where: { name: rule.ingredient } });
      await prisma.rule.upsert({
        where: {
          methodologyVersionId_ingredientId: {
            methodologyVersionId: version.id,
            ingredientId: ingredient.id,
          },
        },
        update: {},
        create: {
          methodologyVersionId: version.id,
          ingredientId: ingredient.id,
          severity: rule.severity,
          source: rule.source,
          note: rule.note,
        },
      });
    }
  }

  for (const seed of PROFILES) {
    const profile = await prisma.profile.upsert({
      where: { name: seed.name },
      update: {},
      create: { name: seed.name, description: seed.description },
    });
    for (const modifier of seed.modifiers) {
      const ingredient = await prisma.ingredient.findUniqueOrThrow({ where: { name: modifier.ingredient } });
      await prisma.profileModifier.upsert({
        where: {
          profileId_ingredientId: {
            profileId: profile.id,
            ingredientId: ingredient.id,
          },
        },
        update: {},
        create: {
          profileId: profile.id,
          ingredientId: ingredient.id,
          severity: modifier.severity,
          source: modifier.source,
          note: modifier.note,
        },
      });
    }
  }

  for (const seed of PRODUCTS) {
    const product = await prisma.product.upsert({
      where: { name: seed.name },
      update: {},
      create: { name: seed.name },
    });
    for (const name of seed.ingredients) {
      await prisma.productIngredient.upsert({
        where: { productId_name: { productId: product.id, name } },
        update: {},
        create: { productId: product.id, name },
      });
    }
  }

  console.log('Seed complete: ingredients, synonyms, methodology versions, profiles and products are in place.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
