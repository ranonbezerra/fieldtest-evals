import type { PrismaClient } from '@prisma/client';

// ASSUMPTION: the spec refers to "provided synonym fixtures", but no fixture
// file was included with the task. These are assumed stand-ins covering
// canonical names, synonyms, spacing variants, and common OCR typos.

export interface IngredientFixture {
  name: string;
  variants: string[];
}

export interface RuleSeed {
  ingredient: string;
  severity: 'banned' | 'restricted' | 'watch';
  citation: string;
}

export interface ModifierSeed {
  context: string;
  ingredient: string;
  severity: 'banned' | 'restricted' | 'watch';
  citation: string;
}

export const INGREDIENTS: IngredientFixture[] = [
  { name: 'methylparaben', variants: ['methyl paraben', 'parabenmethyl', 'e218'] },
  { name: 'butylparaben', variants: ['butyl paraben'] },
  { name: 'linalool', variants: ['linalol'] },
  { name: 'fragrance', variants: ['parfum', 'perfume'] },
  { name: 'tocopherol', variants: ['vitamin e'] },
  { name: 'niacinamide', variants: [] },
  { name: 'aqua', variants: ['water'] },
];

export const V1_RULES: RuleSeed[] = [
  { ingredient: 'methylparaben', severity: 'restricted', citation: 'EU Reg 1223/2009, Annex V, 17.c' },
  { ingredient: 'butylparaben', severity: 'restricted', citation: 'EU Reg 1223/2009, Annex V, 17.c' },
  { ingredient: 'linalool', severity: 'watch', citation: 'EU Reg 1223/2009, Annex III, 663' },
];

export const V2_RULES: RuleSeed[] = [
  { ingredient: 'methylparaben', severity: 'restricted', citation: 'EU Reg 1223/2009, Annex V, 17.c' },
  { ingredient: 'butylparaben', severity: 'restricted', citation: 'EU Reg 1223/2009, Annex V, 17.c' },
  { ingredient: 'linalool', severity: 'restricted', citation: 'EU Reg 1223/2009, Annex III, 663 (2024 amendment)' },
  { ingredient: 'fragrance', severity: 'watch', citation: 'Internal watch list, rev. 2' },
];

export const MODIFIERS: ModifierSeed[] = [
  { context: 'child_under_3', ingredient: 'linalool', severity: 'restricted', citation: 'Internal pediatric precaution list, entry 3' },
  { context: 'child_under_3', ingredient: 'fragrance', severity: 'restricted', citation: 'Internal pediatric precaution list, entry 1' },
  { context: 'pregnancy', ingredient: 'linalool', severity: 'restricted', citation: 'Internal pregnancy precaution list, entry 2' },
];

export const SHAMPOO_LIST = ['Aqua', 'Methyl Paraben', 'Linalool', 'Fragrance'];
export const SERUM_LIST = ['Niacinamide', 'Linalol', 'Tocophérol', 'Zinc-9 Xyz'];
export const CREAM_LIST = ['Fragrance', 'Tocopherol', 'Aqua', 'Butyl Paraben'];

export interface Seeded {
  ingredients: Record<string, string>;
  v1Id: string;
  shampooId: string;
  serumId: string;
  creamId: string;
  youngChildId: string;
  expectingId: string;
  bothId: string;
}

export async function seedBase(prisma: PrismaClient): Promise<Seeded> {
  const ingredients: Record<string, string> = {};
  for (const fixture of INGREDIENTS) {
    const row = await prisma.ingredient.create({
      data: {
        name: fixture.name,
        synonyms: { create: fixture.variants.map((variant) => ({ variant })) },
      },
    });
    ingredients[fixture.name] = row.id;
  }

  await prisma.contextualModifier.createMany({
    data: MODIFIERS.map((modifier) => ({
      context: modifier.context,
      ingredientId: ingredients[modifier.ingredient],
      severity: modifier.severity,
      sourceCitation: modifier.citation,
    })),
  });

  const v1 = await prisma.methodologyVersion.create({
    data: {
      version: 1,
      name: '2024 baseline',
      status: 'published',
      publishedAt: new Date('2024-02-01T00:00:00Z'),
      rules: {
        create: V1_RULES.map((rule) => ({
          ingredientId: ingredients[rule.ingredient],
          severity: rule.severity,
          sourceCitation: rule.citation,
        })),
      },
    },
  });

  const [shampoo, serum, cream] = await Promise.all([
    prisma.product.create({
      data: { name: 'Shampoo', ingredients: { create: SHAMPOO_LIST.map((inci) => ({ inci })) } },
    }),
    prisma.product.create({
      data: { name: 'Serum', ingredients: { create: SERUM_LIST.map((inci) => ({ inci })) } },
    }),
    prisma.product.create({
      data: { name: 'Night Cream', ingredients: { create: CREAM_LIST.map((inci) => ({ inci })) } },
    }),
  ]);

  const [youngChild, expecting, both] = await Promise.all([
    prisma.familyProfile.create({
      data: { name: 'young-child', contexts: { create: [{ context: 'child_under_3' }] } },
    }),
    prisma.familyProfile.create({
      data: { name: 'expecting', contexts: { create: [{ context: 'pregnancy' }] } },
    }),
    prisma.familyProfile.create({
      data: {
        name: 'combined',
        contexts: { create: [{ context: 'child_under_3' }, { context: 'pregnancy' }] },
      },
    }),
  ]);

  return {
    ingredients,
    v1Id: v1.id,
    shampooId: shampoo.id,
    serumId: serum.id,
    creamId: cream.id,
    youngChildId: youngChild.id,
    expectingId: expecting.id,
    bothId: both.id,
  };
}

export async function wipeAll(prisma: PrismaClient): Promise<void> {
  await prisma.classificationResult.deleteMany();
  await prisma.productIngredient.deleteMany();
  await prisma.rule.deleteMany();
  await prisma.contextualModifier.deleteMany();
  await prisma.profileContext.deleteMany();
  await prisma.ingredientSynonym.deleteMany();
  await prisma.methodologyVersion.deleteMany();
  await prisma.familyProfile.deleteMany();
  await prisma.ingredient.deleteMany();
  await prisma.product.deleteMany();
}
