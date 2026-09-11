import { MethodologyStatus, PrismaClient, Severity } from '@prisma/client';
import { normalizeInci } from '../src/classification/normalization.js';
import { INGREDIENT_FIXTURES } from '../src/ingredient/ingredient-fixtures.js';

// Development seed: canonical ingredients with their synonym/typo fixtures,
// one published methodology version, two family profiles and three sample
// products. Stored results are not seeded; run
// POST /methodology-versions/:id/rescore to populate them for a published version.
const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.classificationResult.deleteMany();
  await prisma.productIngredient.deleteMany();
  await prisma.rule.deleteMany();
  await prisma.profileModifier.deleteMany();
  await prisma.synonym.deleteMany();
  await prisma.product.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.methodologyVersion.deleteMany();
  await prisma.ingredient.deleteMany();

  const ingredientIds = new Map<string, string>();
  const takenNormalized = new Set<string>();
  for (const fixture of INGREDIENT_FIXTURES) {
    const normalized = normalizeInci(fixture.canonicalName);
    const ingredient = await prisma.ingredient.create({
      data: { name: fixture.canonicalName, normalized },
    });
    ingredientIds.set(normalized, ingredient.id);
    takenNormalized.add(normalized);
    for (const variant of fixture.variants) {
      const variantNormalized = normalizeInci(variant);
      if (takenNormalized.has(variantNormalized)) continue;
      takenNormalized.add(variantNormalized);
      await prisma.synonym.create({
        data: { ingredientId: ingredient.id, raw: variant, normalized: variantNormalized },
      });
    }
  }

  const ingredientIdOf = (name: string): string => {
    const id = ingredientIds.get(normalizeInci(name));
    if (!id) throw new Error(`Fixture has no canonical ingredient "${name}"`);
    return id;
  };

  const v1 = await prisma.methodologyVersion.create({
    data: {
      label: '2024-01 — regulator restricted list + watch list v3',
      status: MethodologyStatus.PUBLISHED,
      publishedAt: new Date('2024-01-15T09:00:00Z'),
    },
  });
  await prisma.rule.createMany({
    data: [
      {
        methodologyVersionId: v1.id,
        ingredientId: ingredientIdOf('Methylisothiazolinone'),
        severity: Severity.BANNED,
        source: 'EU Regulation (EC) No 1223/2009, Annex V entry 264 (prohibited in leave-on products)',
      },
      {
        methodologyVersionId: v1.id,
        ingredientId: ingredientIdOf('Methylparaben'),
        severity: Severity.RESTRICTED,
        source: 'EU Regulation (EC) No 1223/2009, Annex V (concentration limit)',
      },
      {
        methodologyVersionId: v1.id,
        ingredientId: ingredientIdOf('Limonene'),
        severity: Severity.WATCH,
        source: 'Curated watch list, allergen panel v3',
      },
      {
        methodologyVersionId: v1.id,
        ingredientId: ingredientIdOf('Retinyl Palmitate'),
        severity: Severity.WATCH,
        source: 'Curated watch list, photosensitivity panel v2',
      },
    ],
  });

  await prisma.profile.create({
    data: {
      name: 'Child under 3',
      modifiers: {
        create: [
          {
            ingredientId: ingredientIdOf('Fragrance'),
            severity: Severity.RESTRICTED,
            reason: 'Profile: child under 3 — restrict fragrance in leave-on products',
          },
          {
            ingredientId: ingredientIdOf('Cocamidopropyl Betaine'),
            severity: Severity.WATCH,
            reason: 'Profile: child under 3 — watch for surfactant irritation',
          },
        ],
      },
    },
  });
  await prisma.profile.create({
    data: {
      name: 'Pregnancy',
      modifiers: {
        create: [
          {
            ingredientId: ingredientIdOf('Retinyl Palmitate'),
            severity: Severity.RESTRICTED,
            reason: 'Profile: pregnancy — avoid retinoids',
          },
        ],
      },
    },
  });

  await prisma.product.create({
    data: {
      name: 'Hydra Facial Serum',
      ingredients: {
        create: [
          { position: 0, raw: 'Aqua' },
          { position: 1, raw: 'Butylene Glycol' },
          { position: 2, raw: 'Glycerine' },
          { position: 3, raw: 'Sodium Hyaluronate' },
          { position: 4, raw: 'Parfüm' },
          { position: 5, raw: 'Methylisothiazolinone' },
        ],
      },
    },
  });
  await prisma.product.create({
    data: {
      name: 'Gentle Baby Wash',
      ingredients: {
        create: [
          { position: 0, raw: 'Aqua' },
          { position: 1, raw: 'Cocamidopropyl Betaine' },
          { position: 2, raw: 'Aloe Barbaddensis Leaf Juice' },
          { position: 3, raw: 'Parfum' },
        ],
      },
    },
  });
  await prisma.product.create({
    data: {
      name: 'Retinol Night Cream',
      ingredients: {
        create: [
          { position: 0, raw: 'Aqua' },
          { position: 1, raw: 'Proplyene Glycol' },
          { position: 2, raw: 'Retinyl Pamitate' },
          { position: 3, raw: 'Tocopherol' },
          { position: 4, raw: 'Ascorbic Acid' },
          { position: 5, raw: 'Vitis Vinifera Seed Oil' },
        ],
      },
    },
  });

  console.log('Seed complete.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
