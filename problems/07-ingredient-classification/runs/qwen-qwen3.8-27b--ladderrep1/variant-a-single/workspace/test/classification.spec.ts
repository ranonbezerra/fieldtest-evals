import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma.service.js';
import { ClassificationRepository } from '../src/classification/classification.repository.js';
import { ClassificationService } from '../src/classification/classification.service.js';
import { INGREDIENT_FIXTURES, METHODOLOGY_V1, METHODOLOGY_V2 } from '../src/classification/fixtures.js';

// ASSUMPTION: no database provisioning is available in this environment, so the
// tests target a real PostgreSQL instance via DATABASE_URL with the schema
// already applied (pnpm prisma migrate deploy).

const prisma = new PrismaClient();

function buildService(): ClassificationService {
  const repository = new ClassificationRepository(prisma as unknown as PrismaService);
  return new ClassificationService(repository);
}

let service!: ClassificationService;

async function wipeDatabase(): Promise<void> {
  await prisma.$transaction([
    prisma.classificationResult.deleteMany({}),
    prisma.rule.deleteMany({}),
    prisma.synonym.deleteMany({}),
    prisma.productIngredient.deleteMany({}),
    prisma.methodologyVersion.deleteMany({}),
    prisma.profile.deleteMany({}),
    prisma.product.deleteMany({}),
    prisma.ingredient.deleteMany({}),
  ]);
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL must point at a PostgreSQL database with the schema applied (pnpm prisma migrate deploy).',
    );
  }
  await wipeDatabase();
  service = buildService();
  await service.ingestIngredients(INGREDIENT_FIXTURES);
  await service.ingestMethodology(METHODOLOGY_V1);
  await service.publish('v1');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ingredient classification (issue #319)', () => {
  it('a profile flips a finding the base rules alone would not flag', async () => {
    const product = await service.createProduct('Citral Lotion', null, ['Water', 'Citral']);

    const base = await service.classify(product.id);
    const citral = base.findings.find((f) => f.canonical === 'Citral');
    expect(citral).toBeDefined();
    expect(citral!.severity).toBeNull();
    expect(citral!.flag).toBe('none');

    const profile = await service.createProfile('Pregnancy', ['pregnancy']);
    const withProfile = await service.classify(product.id, profile.id);
    const flagged = withProfile.findings.find((f) => f.canonical === 'Citral');
    expect(flagged!.severity).toBe('restricted');
    expect(flagged!.flag).toBe('restricted');
    expect(flagged!.source).toContain('pregnancy');
    expect(flagged!.modifierContext).toBe('pregnancy');
  });

  it('an unrecognized ingredient is listed as unknown and lowers confidence', async () => {
    const known = await service.createProduct('Known Ingredients Only', null, ['Water', 'Tocopherol']);
    const withUnknown = await service.createProduct('Has Unknown Ingredient', null, [
      'Water',
      'Tocopherol',
      'Zinc Gluconate',
    ]);

    const clean = await service.classify(known.id);
    const dirty = await service.classify(withUnknown.id);

    expect(clean.confidence).toBe(1);
    const unknown = dirty.findings.find((f) => f.raw === 'Zinc Gluconate');
    expect(unknown).toBeDefined();
    expect(unknown!.recognized).toBe(false);
    expect(unknown!.flag).toBe('unknown');
    expect(unknown!.canonical).toBeNull();
    expect(unknown!.severity).toBeNull();
    expect(dirty.summary).toEqual({ total: 3, recognized: 2, unknown: 1 });
    expect(dirty.confidence).toBeLessThan(clean.confidence);
    expect(dirty.confidence).toBe(0.6667);
  });

  it('resolves synonyms and OCR typos to the canonical ingredient', async () => {
    const product = await service.createProduct('Synonym Sample', null, [
      'WATER',
      'Parfume',
      'Metylparaben',
      'Vitamin E',
      'linarool',
    ]);
    const out = await service.classify(product.id);
    const byRaw = new Map(out.findings.map((f) => [f.raw, f]));

    expect(byRaw.get('WATER')!.canonical).toBe('Aqua');
    expect(byRaw.get('WATER')!.matchedVia).toBe('synonym');
    expect(byRaw.get('Parfume')!.canonical).toBe('Fragrance');
    expect(byRaw.get('Metylparaben')!.canonical).toBe('Methylparaben');
    expect(byRaw.get('Vitamin E')!.canonical).toBe('Tocopherol');
    expect(byRaw.get('linarool')!.canonical).toBe('Linalool');
    expect(out.summary.unknown).toBe(0);
    expect(out.confidence).toBe(1);

    // resolved ingredients carry the canonical ingredient's rule, not the alias's
    expect(byRaw.get('Metylparaben')!.severity).toBe('watch');
    expect(byRaw.get('linarool')!.source).toBe('EC 1223/2009, Annex III, 683');
  });

  it('returns identical output across reruns', async () => {
    const product = await service.createProduct('Rerun Sample', 'Acme', [
      'Fragrance',
      'Water',
      'Methylparaben',
      'Citral',
    ]);
    const first = await service.classify(product.id);
    const second = await service.classify(product.id);
    expect(second).toEqual(first);
  });

  it('returns identical output when the stored ingredient order is shuffled', async () => {
    const ordered = ['Fragrance', 'Water', 'Methylparaben', 'Citral', 'Tocopherol'];
    const shuffled = ['Citral', 'Tocopherol', 'Methylparaben', 'Fragrance', 'Water'];
    const product = await service.createProduct('Shuffle Sample', null, ordered);
    const before = await service.classify(product.id);
    await service.reorderProductIngredients(product.id, shuffled);
    const after = await service.classify(product.id);
    expect(after).toEqual(before);
  });

  it('two modifiers on one ingredient resolve by the written precedence', async () => {
    const family = await service.createProfile('Family', ['child_under_3', 'pregnancy']);
    const fragrance = await service.createProduct('Fragrance Sample', null, ['Fragrance', 'Water']);
    const retinoid = await service.createProduct('Retinoid Sample', null, ['Retinyl Palmitate', 'Water']);

    const fragranceOut = await service.classify(fragrance.id, family.id);
    const frag = fragranceOut.findings.find((f) => f.canonical === 'Fragrance');
    // child_under_3 is RESTRICTED, pregnancy is WATCH: the maximum severity wins
    expect(frag!.severity).toBe('restricted');
    expect(frag!.source).toContain('under 3');
    expect(frag!.modifierContext).toBe('child_under_3');

    const retinoidOut = await service.classify(retinoid.id, family.id);
    const retinyl = retinoidOut.findings.find((f) => f.canonical === 'Retinyl Palmitate');
    // both modifiers are RESTRICTED: the fixed precedence (child_under_3 first)
    // picks the citation, regardless of rule-table order
    expect(retinyl!.severity).toBe('restricted');
    expect(retinyl!.source).toContain('under 3');
    expect(retinyl!.modifierContext).toBe('child_under_3');
  });

  // Runs last: it publishes v2, which changes the active version.
  it('keeps v1 and v2 results retrievable for the same product after publishing v2', async () => {
    const product = await service.createProduct('Dual Version Sample', null, [
      'Methylparaben',
      'Citral',
      'Water',
    ]);
    // lazy-scores under the active version (v1) so a v1 row exists
    await service.classify(product.id);
    const v1Before = await service.getStoredResult(product.id, 'v1');

    await service.ingestMethodology(METHODOLOGY_V2);
    await service.publish('v2');

    const v1 = await service.getStoredResult(product.id, 'v1');
    const v2 = await service.getStoredResult(product.id, 'v2');

    // the previous version's result is retrievable exactly as it was
    expect(v1).toEqual(v1Before);

    // the new version scores the same product differently where rules changed
    expect(v1.findings.find((f) => f.canonical === 'Methylparaben')!.severity).toBe('watch');
    expect(v2.findings.find((f) => f.canonical === 'Methylparaben')!.severity).toBe('restricted');
    expect(v1.findings.find((f) => f.canonical === 'Citral')!.severity).toBeNull();
    expect(v2.findings.find((f) => f.canonical === 'Citral')!.severity).toBe('watch');

    // re-scoring is idempotent: re-publishing v2 produces the same rows, not duplicates
    const rowsBefore = await prisma.classificationResult.count({ where: { version: { slug: 'v2' } } });
    const rowBefore = await prisma.classificationResult.findFirst({
      where: { productId: product.id, version: { slug: 'v2' } },
    });
    await service.publish('v2');
    const rowsAfter = await prisma.classificationResult.count({ where: { version: { slug: 'v2' } } });
    const rowAfter = await prisma.classificationResult.findFirst({
      where: { productId: product.id, version: { slug: 'v2' } },
    });
    expect(rowsAfter).toBe(rowsBefore);
    expect(rowAfter!.payload).toEqual(rowBefore!.payload);

    // classify now uses the new active version
    const active = await service.classify(product.id);
    expect(active.methodologyVersion).toBe('v2');
  });
});
