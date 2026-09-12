import { PrismaClient } from '@prisma/client';

/**
 * Baseline dataset for local development. Idempotent: safe to run repeatedly.
 * This file is the source of the synonym / OCR-typo fixtures the classifier
 * resolves raw INCI entries against (e.g. "t0copherol" -> "Tocopherol",
 * "salixylic acid" -> "Salicylic acid", "caféine" -> "Caffeine").
 */
const prisma = new PrismaClient();

async function upsertIngredient(name: string, synonyms: string[]) {
  const ingredient = await prisma.ingredient.upsert({
    where: { name },
    update: {},
    create: { name },
  });
  for (const term of synonyms) {
    await prisma.ingredientSynonym.upsert({
      where: { term },
      update: { ingredientId: ingredient.id },
      create: { ingredientId: ingredient.id, term },
    });
  }
  return ingredient;
}

async function main() {
  const [aqua, caffeine, limonene, salicylic, tocopherol, retinyl, benzoyl] = await Promise.all([
    upsertIngredient('Aqua', ['water']),
    upsertIngredient('Caffeine', ['cafeine']),
    upsertIngredient('Limonene', []),
    upsertIngredient('Salicylic acid', ['salixylic acid', 'bha', 'beta-hydroxy acid']),
    upsertIngredient('Tocopherol', ['t0copherol', 'vitamin e']),
    upsertIngredient('Retinyl palmitate', ['retinyl-palmitate']),
    upsertIngredient('Benzoyl peroxide', []),
  ]);

  const existingVersion = await prisma.methodologyVersion.findUnique({ where: { code: '2024.1' } });
  if (!existingVersion) {
    const active = await prisma.methodologyVersion.findUnique({ where: { status: 'active' } });
    if (active) {
      await prisma.methodologyVersion.update({ where: { id: active.id }, data: { status: 'retired' } });
    }
    await prisma.methodologyVersion.create({
      data: {
        code: '2024.1',
        status: 'active',
        publishedAt: new Date(),
        rules: {
          create: [
            { ingredientId: benzoyl.id, severity: 'restricted', source: 'EU Reg 1223/2009, Annex III, 315-1' },
            { ingredientId: retinyl.id, severity: 'watch', source: 'Curated watch list, 2024-01' },
            { ingredientId: salicylic.id, severity: 'watch', source: 'Curated watch list, 2024-01' },
          ],
        },
      },
    });
  }

  const child = await prisma.familyProfile.upsert({
    where: { name: 'child_under_3' },
    update: {},
    create: { name: 'child_under_3', description: 'Child under 3 years old.' },
  });
  const childModifiers = [
    {
      ingredientId: limonene.id,
      severity: 'restricted' as const,
      source: 'AAP position paper, 2023',
      reason: 'Strong fragrance; skin sensitivity in young children.',
    },
    {
      ingredientId: retinyl.id,
      severity: 'banned' as const,
      source: 'FDA 2023 advisory on retinoids',
      reason: 'Retinoids are avoided for children.',
    },
  ];
  for (const modifier of childModifiers) {
    await prisma.profileModifier.upsert({
      where: { profileId_ingredientId: { profileId: child.id, ingredientId: modifier.ingredientId } },
      update: modifier,
      create: { profileId: child.id, ...modifier },
    });
  }

  const pregnancy = await prisma.familyProfile.upsert({
    where: { name: 'pregnancy' },
    update: {},
    create: { name: 'pregnancy', description: 'Pregnancy or breastfeeding.' },
  });
  await prisma.profileModifier.upsert({
    where: { profileId_ingredientId: { profileId: pregnancy.id, ingredientId: retinyl.id } },
    update: {
      severity: 'banned' as const,
      source: 'FDA 2023 advisory on retinoids',
      reason: 'Retinoids are contraindicated in pregnancy.',
    },
    create: {
      profileId: pregnancy.id,
      ingredientId: retinyl.id,
      severity: 'banned',
      source: 'FDA 2023 advisory on retinoids',
      reason: 'Retinoids are contraindicated in pregnancy.',
    },
  });

  const products: Array<{ name: string; inci: string[] }> = [
    {
      name: 'Night cream',
      inci: ['Aqua', 'Retinyl  Palmitate', 'T0COPHEROL', 'Limonene', 'Caféine', 'Mystery Butter X'],
    },
    { name: 'Peeling gel', inci: ['Salixylic Acid', 'Aqua', 'T0COPHEROL'] },
  ];
  for (const product of products) {
    const existing = await prisma.product.findFirst({ where: { name: product.name } });
    if (!existing) {
      await prisma.product.create({
        data: {
          name: product.name,
          ingredients: {
            create: product.inci.map((rawName, index) => ({ position: index + 1, rawName })),
          },
        },
      });
    }
  }

  const counts = await Promise.all([
    prisma.ingredient.count(),
    prisma.ingredientSynonym.count(),
    prisma.methodologyVersion.count(),
    prisma.familyProfile.count(),
    prisma.product.count(),
  ]);
  // eslint-disable-next-line no-console
  console.log(
    `Seeded: ${counts[0]} ingredients, ${counts[1]} synonyms, ` +
      `${counts[2]} methodology versions, ${counts[3]} profiles, ${counts[4]} products.`,
  );
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
