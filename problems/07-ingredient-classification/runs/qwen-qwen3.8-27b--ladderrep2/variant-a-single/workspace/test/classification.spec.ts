/**
 * Behaviour tests for the scanner. They run against a real PostgreSQL instance
 * reachable via DATABASE_URL; every test starts from a truncated database so
 * the assertions are fully deterministic.
 */
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ClassificationService } from '../src/classification/classification.service.js';
import { MethodologyService } from '../src/methodology/methodology.service.js';
import { ProfileService } from '../src/profile/profile.service.js';
import { ProductService } from '../src/product/product.service.js';
import { createTestContext, resetDb, seedIngredients } from './helpers.js';

let app: INestApplication;
let prisma: PrismaClient;
let classifications: ClassificationService;
let methodologies: MethodologyService;
let profiles: ProfileService;
let products: ProductService;
let ids: Map<string, string>;

beforeAll(async () => {
  const context = await createTestContext();
  app = context.app;
  prisma = context.prisma;
  classifications = app.get(ClassificationService);
  methodologies = app.get(MethodologyService);
  profiles = app.get(ProfileService);
  products = app.get(ProductService);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb(prisma);
  ids = await seedIngredients(prisma);
});

const ingredientId = (canonicalName: string): string => {
  const id = ids.get(canonicalName);
  if (!id) throw new Error(`Test fixture has no canonical ingredient "${canonicalName}"`);
  return id;
};

async function createProduct(name: string, ingredients: string[]): Promise<string> {
  const created = await products.create(name, ingredients);
  return created.id;
}

async function publishVersion(
  label: string,
  rules: Array<{ ingredient: string; severity: 'banned' | 'restricted' | 'watch'; source: string }>,
): Promise<string> {
  const created = await methodologies.create(
    label,
    rules.map((rule) => ({ ingredientId: ingredientId(rule.ingredient), severity: rule.severity, source: rule.source })),
  );
  await methodologies.publish(created.id);
  return created.id;
}

describe('resolution (synonyms, case, accents, OCR typos)', () => {
  it('resolves an OCR typo and synonyms to their canonical ingredients', async () => {
    await publishVersion('2024-01', []);
    const productId = await createProduct('Serum', ['Tocopherol', 'Glycerine', 'Vitamin C']);

    const result = await classifications.classify(productId);

    const byRaw = new Map(result.ingredients.map((finding) => [finding.raw, finding] as const));
    expect(byRaw.get('Tocopherol')).toMatchObject({
      status: 'resolved',
      canonicalName: 'Tocopherol',
      ingredientId: ingredientId('Tocopherol'),
      matchedAs: 'synonym',
    });
    expect(byRaw.get('Glycerine')).toMatchObject({
      status: 'resolved',
      canonicalName: 'Glycerin',
      ingredientId: ingredientId('Glycerin'),
      matchedAs: 'synonym',
    });
    expect(byRaw.get('Vitamin C')).toMatchObject({
      status: 'resolved',
      canonicalName: 'Ascorbic Acid',
      ingredientId: ingredientId('Ascorbic Acid'),
      matchedAs: 'synonym',
    });
    expect(result.unknownIngredients).toEqual([]);
    expect(result.confidence).toBe(1);
  });

  it('normalizes case and accents before matching', async () => {
    await publishVersion('2024-01', []);
    const productId = await createProduct('Cream', ['pArfüM', 'ALOE VERA LEAF JUICE']);

    const result = await classifications.classify(productId);

    const byRaw = new Map(result.ingredients.map((finding) => [finding.raw, finding] as const));
    expect(byRaw.get('pArfüM')).toMatchObject({ status: 'resolved', canonicalName: 'Fragrance', ingredientId: ingredientId('Fragrance') });
    expect(byRaw.get('ALOE VERA LEAF JUICE')).toMatchObject({
      status: 'resolved',
      canonicalName: 'Aloe Barbadensis Leaf Juice',
      ingredientId: ingredientId('Aloe Barbadensis Leaf Juice'),
    });
  });

  it('rejects unknown products with the error envelope code', async () => {
    await publishVersion('2024-01', []);
    await expect(classifications.classify('does-not-exist')).rejects.toMatchObject({ code: 'resource_not_found', status: 404 });
  });
});

describe('unknown ingredients', () => {
  it('reports unresolved ingredients as unknown (never clean) and lowers confidence', async () => {
    await publishVersion('2024-01', [
      { ingredient: 'Methylisothiazolinone', severity: 'banned', source: 'EU Regulation (EC) No 1223/2009, Annex V' },
    ]);
    const productId = await createProduct('Mystery', ['Aqua', 'Zinc Oxide', 'Unobtainium']);

    const result = await classifications.classify(productId);

    const byRaw = new Map(result.ingredients.map((finding) => [finding.raw, finding] as const));
    expect(byRaw.get('Aqua')).toMatchObject({ status: 'resolved', flag: false });
    expect(byRaw.get('Zinc Oxide')).toMatchObject({
      status: 'unknown',
      flag: false,
      severity: null,
      source: null,
      ingredientId: null,
      canonicalName: null,
    });
    expect(byRaw.get('Unobtainium')).toMatchObject({ status: 'unknown', flag: false });
    expect(result.unknownIngredients).toEqual(['Unobtainium', 'Zinc Oxide']);
    expect(result.confidence).toBeCloseTo(1 / 3);
    expect(result.ingredients).toHaveLength(3); // nothing is dropped

    const cleanId = await createProduct('Clean', ['Aqua', 'Glycerine']);
    const clean = await classifications.classify(cleanId);
    expect(clean.confidence).toBe(1);
    expect(clean.unknownIngredients).toEqual([]);
  });
});

describe('profile modifiers', () => {
  it('flips a finding the base rules alone would not flag', async () => {
    await publishVersion('2024-01', []); // no base rule for Cocamidopropyl Betaine
    const profile = await profiles.create('Child under 3', [
      {
        ingredientId: ingredientId('Cocamidopropyl Betaine'),
        severity: 'watch',
        reason: 'Profile: child under 3 — watch for surfactant irritation',
      },
    ]);
    const productId = await createProduct('Baby Wash', ['Cocamidopropyl Betaine', 'Aqua']);

    const base = await classifications.classify(productId);
    expect(base.ingredients.find((finding) => finding.raw === 'Cocamidopropyl Betaine')).toMatchObject({
      status: 'resolved',
      flag: false,
      severity: null,
      source: null,
    });

    const withProfile = await classifications.classify(productId, profile.id);
    expect(withProfile.profile).toEqual({ id: profile.id, name: 'Child under 3' });
    const finding = withProfile.ingredients.find((f) => f.raw === 'Cocamidopropyl Betaine');
    expect(finding).toMatchObject({
      status: 'resolved',
      flag: true,
      severity: 'watch',
      source: 'Profile: child under 3 — watch for surfactant irritation',
    });
    expect(finding?.profile).toMatchObject({
      severity: 'watch',
      reason: 'Profile: child under 3 — watch for surfactant irritation',
    });
  });

  it('never lets a profile loosen a base rule; ties keep the regulatory citation', async () => {
    await publishVersion('2024-01', [
      { ingredient: 'Methylisothiazolinone', severity: 'banned', source: 'EU Regulation (EC) No 1223/2009, Annex V' },
    ]);
    const profile = await profiles.create('Mild', [
      { ingredientId: ingredientId('Methylisothiazolinone'), severity: 'watch', reason: 'Profile: mild — lower priority' },
    ]);
    const productId = await createProduct('Gel', ['Methylisothiazolinone']);

    const result = await classifications.classify(productId, profile.id);
    expect(result.ingredients).toHaveLength(1);
    expect(result.ingredients[0]).toMatchObject({
      flag: true,
      severity: 'banned',
      source: 'EU Regulation (EC) No 1223/2009, Annex V',
      profile: null,
    });
  });

  it('resolves several modifiers on one ingredient by fixed precedence (highest severity wins)', async () => {
    await publishVersion('2024-01', []);
    const profile = await profiles.create('Child under 3', [
      { ingredientId: ingredientId('Fragrance'), severity: 'watch', reason: 'Profile: child under 3 — limit fragrance' },
      {
        ingredientId: ingredientId('Fragrance'),
        severity: 'restricted',
        reason: 'Profile: child under 3 — restrict fragrance in leave-on products',
      },
    ]);
    const productId = await createProduct('Lotion', ['Parfum']);

    const result = await classifications.classify(productId, profile.id);
    expect(result.ingredients[0]).toMatchObject({
      flag: true,
      severity: 'restricted',
      source: 'Profile: child under 3 — restrict fragrance in leave-on products',
    });
  });
});

describe('determinism', () => {
  it('gives identical output across two runs of the same product', async () => {
    await publishVersion('2024-01', [{ ingredient: 'Retinyl Palmitate', severity: 'watch', source: 'Watch list v2' }]);
    const productId = await createProduct('Night Cream', ['Retinyl Pamitate', 'Tocopherol', 'Zinc Oxide']);

    const first = await classifications.classify(productId);
    const second = await classifications.classify(productId);

    expect(second).toEqual(first);
  });

  it('gives identical output when the ingredient list is shuffled', async () => {
    await publishVersion('2024-01', [{ ingredient: 'Retinyl Palmitate', severity: 'watch', source: 'Watch list v2' }]);
    const order = ['Retinyl Pamitate', 'Tocopherol', 'Zinc Oxide', 'Glycerine'];
    const productId = await createProduct('Night Cream', order);
    const first = await classifications.classify(productId);

    // Re-store the same list, reversed.
    await prisma.productIngredient.deleteMany({ where: { productId } });
    await prisma.productIngredient.createMany({
      data: [...order].reverse().map((raw, position) => ({ productId, position, raw })),
    });

    const second = await classifications.classify(productId);
    expect(second).toEqual(first);
  });
});

describe('methodology versions and stored results', () => {
  it('keeps the previous version result retrievable after publishing a new version', async () => {
    const productId = await createProduct('Night Cream', ['Retinyl Pamitate', 'Aqua']);
    const v1 = await publishVersion('2024-01', [
      { ingredient: 'Retinyl Palmitate', severity: 'watch', source: 'Watch list v2' },
    ]);

    const v1Result = await classifications.savedResult(productId, v1);
    expect(v1Result).toMatchObject({ methodologyVersionId: v1, confidence: 1, profile: null });
    expect(v1Result.ingredients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonicalName: 'Retinyl Palmitate', flag: true, severity: 'watch', source: 'Watch list v2' }),
      ]),
    );
    const snapshot = v1Result;

    const v2 = await publishVersion('2024-02', [
      { ingredient: 'Retinyl Palmitate', severity: 'restricted', source: 'Watch list v3' },
      { ingredient: 'Methylisothiazolinone', severity: 'banned', source: 'EU Regulation (EC) No 1223/2009, Annex V' },
    ]);

    const v1After = await classifications.savedResult(productId, v1);
    const v2After = await classifications.savedResult(productId, v2);

    // The previous version's result is unchanged, exactly as stored.
    expect(v1After.ingredients).toEqual(snapshot.ingredients);
    expect(v1After.confidence).toBe(snapshot.confidence);
    expect(v1After.disclaimer).toBe(snapshot.disclaimer);
    expect(v1After.savedAt).toBe(snapshot.savedAt);
    expect(v1After.ingredients).toEqual(
      expect.arrayContaining([expect.objectContaining({ canonicalName: 'Retinyl Palmitate', severity: 'watch' })]),
    );

    expect(v2After.methodologyVersionId).toBe(v2);
    expect(v2After.ingredients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ canonicalName: 'Retinyl Palmitate', flag: true, severity: 'restricted', source: 'Watch list v3' }),
      ]),
    );

    // classify() follows the active (newest) version.
    const live = await classifications.classify(productId);
    expect(live.methodologyVersionId).toBe(v2);
  });

  it('re-scores idempotently: a rerun produces the same rows, not duplicates', async () => {
    await createProduct('Balm A', ['Limonene', 'Aqua']);
    await createProduct('Balm B', ['Tocopherol', 'Limonene']);
    const v1 = await publishVersion('2024-01', [{ ingredient: 'Limonene', severity: 'watch', source: 'Allergen panel v3' }]);

    const rowsBefore = await prisma.classificationResult.findMany({
      where: { methodologyVersionId: v1 },
      orderBy: { productId: 'asc' },
    });
    expect(rowsBefore).toHaveLength(2);

    const rescored = await methodologies.rescore(v1);
    expect(rescored).toEqual({ rescoredProducts: 2 });

    const rowsAfter = await prisma.classificationResult.findMany({
      where: { methodologyVersionId: v1 },
      orderBy: { productId: 'asc' },
    });
    expect(rowsAfter).toHaveLength(2);
    expect(rowsAfter).toEqual(rowsBefore);
  });

  it('refuses to publish an already published (immutable) version', async () => {
    const v1 = await publishVersion('2024-01', []);
    await expect(methodologies.publish(v1)).rejects.toMatchObject({ code: 'methodology_already_published', status: 409 });
  });
});
