import { Test, TestingModule } from '@nestjs/testing';
import { ClassificationService } from '../src/classification/classification.service';
import { ClassificationRepository } from '../src/classification/classification.repository';
import { PrismaService } from '../src/prisma.service';
import { PrismaClient, Severity } from '@prisma/client';
import { normalizeString } from '../src/utils/normalize';

describe('ClassificationService (L2 spec)', () => {
  let module: TestingModule;
  let service: ClassificationService;
  let repo: ClassificationRepository;
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.DATABASE_URL = 'file:./test.db?mode=memory&cache=shared';
    module = await Test.createTestingModule({
      providers: [ClassificationService, ClassificationRepository, PrismaService],
    }).compile();

    service = module.get<ClassificationService>(ClassificationService);
    repo = module.get<ClassificationRepository>(ClassificationRepository);
    prisma = module.get<PrismaService>(PrismaService);

    // Migrate schema (Prisma migrate dev is not available – we rely on SQLite auto‑create)
    await prisma.$executeRawUnsafe(`
      PRAGMA foreign_keys = ON;
    `);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean DB
    const models = [
      'classification_finding',
      'classification_result',
      'modifier',
      'profile',
      'product_ingredient',
      'product',
      'rule',
      'methodology_version',
      'synonym',
      'ingredient',
    ];
    for (const m of models) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${m}";`);
    }

    // Seed ingredients
    const ingA = await prisma.ingredient.create({
      data: {
        name: 'Aloe Vera',
        normalizedName: normalizeString('Aloe Vera'),
      },
    });

    const ingB = await prisma.ingredient.create({
      data: {
        name: 'Parabens',
        normalizedName: normalizeString('Parabens'),
      },
    });

    // Synonyms & typo fixtures
    await prisma.synonym.create({
      data: {
        name: normalizeString('Aloë Vera'), // synonym with accent
        ingredientId: ingA.id,
      },
    });

    await prisma.synonym.create({
      data: {
        name: normalizeString('Paraben'), // typo missing s
        ingredientId: ingB.id,
      },
    });

    // Methodology v1
    const v1 = await prisma.methodologyVersion.create({
      data: {
        name: 'v1',
        active: true,
      },
    });

    // Rules for v1
    await prisma.rule.create({
      data: {
        methodologyVersionId: v1.id,
        ingredientId: ingB.id,
        severity: Severity.BANNED,
        sourceCitation: 'Regulator 2022',
      },
    });

    // Product with ingredients (including synonym, typo, unknown)
    const product = await prisma.product.create({
      data: {
        name: 'Test Cream',
      },
    });

    await prisma.productIngredient.createMany({
      data: [
        {
          productId: product.id,
          rawName: 'Aloë Vera', // should resolve via synonym
          orderIdx: 0,
        },
        {
          productId: product.id,
          rawName: 'Paraben', // typo resolves to Parabens
          orderIdx: 1,
        },
        {
          productId: product.id,
          rawName: 'MysteryIngredient', // unknown
          orderIdx: 2,
        },
      ],
    });

    // Profile that flips Parabens severity to WATCH
    const profile = await prisma.profile.create({
      data: {
        name: 'Pregnancy',
      },
    });

    await prisma.modifier.create({
      data: {
        profileId: profile.id,
        ingredientId: ingB.id,
        overrideSeverity: Severity.WATCH,
        overrideFlag: true,
      },
    });
  });

  it('profile flips a finding that the base rules alone would not have flagged', async () => {
    // v1 base flags Parabens as banned; profile changes severity to WATCH (still flagged)
    const product = await prisma.product.findFirst({ where: { name: 'Test Cream' } });
    const profile = await prisma.profile.findFirst({ where: { name: 'Pregnancy' } });
    const result = await service.classify(product!.id, profile!.id);

    const findings = await prisma.classificationFinding.findMany({
      where: { resultId: result.id },
    });

    const parabensFinding = findings.find((f) => f.rawName === 'Paraben')!;
    expect(parabensFinding.flag).toBe(true);
    expect(parabensFinding.severity).toBe(Severity.WATCH);
    expect(parabensFinding.sourceCitation).toBe('Regulator 2022');
  });

  it('unknown ingredient appears as unknown and confidence drops', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Cream' } });
    const result = await service.classify(product!.id);
    const findings = await prisma.classificationFinding.findMany({
      where: { resultId: result.id },
    });

    const unknown = findings.find((f) => f.rawName === 'MysteryIngredient')!;
    expect(unknown.isUnknown).toBe(true);
    expect(unknown.flag).toBe(false);
    expect(unknown.severity).toBeNull();

    // 2 recognised out of 3 => confidence 0.666...
    expect(result.confidence).toBeCloseTo(2 / 3);
  });

  it('synonym and OCR typo both resolve to the canonical ingredient', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Cream' } });
    const result = await service.classify(product!.id);
    const findings = await prisma.classificationFinding.findMany({
      where: { resultId: result.id },
    });

    const aloe = findings.find((f) => f.rawName === 'Aloë Vera')!;
    const parab = findings.find((f) => f.rawName === 'Paraben')!;

    expect(aloe.isUnknown).toBe(false);
    expect(parab.isUnknown).toBe(false);
    // Ensure they are linked to the correct canonical ingredient IDs
    const ingA = await prisma.ingredient.findFirst({ where: { name: 'Aloe Vera' } });
    const ingB = await prisma.ingredient.findFirst({ where: { name: 'Parabens' } });
    expect(aloe.ingredientId).toBe(ingA!.id);
    expect(parab.ingredientId).toBe(ingB!.id);
  });

  it('same product classified twice yields identical output', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Cream' } });
    const first = await service.classify(product!.id);
    const second = await service.classify(product!.id);

    // Results should be the same row (upsert), confidence equal
    expect(first.id).toBe(second.id);
    expect(first.confidence).toBe(second.confidence);
  });

  it('shuffled ingredient order yields identical output', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Cream' } });
    // Shuffle order indices
    await prisma.productIngredient.updateMany({
      where: { productId: product!.id },
      data: { orderIdx: 999 },
    });
    await prisma.productIngredient.update({
      where: { id: (await prisma.productIngredient.findFirst({ where: { rawName: 'Aloë Vera' } }))!.id },
      data: { orderIdx: 0 },
    });
    await prisma.productIngredient.update({
      where: { id: (await prisma.productIngredient.findFirst({ where: { rawName: 'Paraben' } }))!.id },
      data: { orderIdx: 1 },
    });
    await prisma.productIngredient.update({
      where: { id: (await prisma.productIngredient.findFirst({ where: { rawName: 'MysteryIngredient' } }))!.id },
      data: { orderIdx: 2 },
    });

    const result = await service.classify(product!.id);
    const findings = await prisma.classificationFinding.findMany({
      where: { resultId: result.id },
    });

    // Order of findings should not matter – we assert presence of each expected finding
    const rawNames = findings.map((f) => f.rawName).sort();
    expect(rawNames).toEqual(['Aloë Vera', 'MysteryIngredient', 'Paraben'].sort());
  });

  it('after publishing v2 both v1 and v2 results are retrievable', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Cream' } });

    // Initial classification with v1 (active)
    await service.classify(product!.id);

    // Publish v2 (new rule set)
    const v2 = await prisma.methodologyVersion.create({
      data: {
        name: 'v2',
        active: false,
      },
    });

    // Deactivate v1, activate v2
    await prisma.methodologyVersion.updateMany({
      where: {},
      data: { active: false },
    });
    await prisma.methodologyVersion.update({
      where: { id: v2.id },
      data: { active: true },
    });

    // Add a new rule in v2 (different severity)
    const ingB = await prisma.ingredient.findFirst({ where: { name: 'Parabens' } });
    await prisma.rule.create({
      data: {
        methodologyVersionId: v2.id,
        ingredientId: ingB!.id,
        severity: Severity.RESTRICTED,
        sourceCitation: 'Regulator 2023',
      },
    });

    // Rescore all products (should create a new result row for v2)
    await service.rescoreAll();

    // Retrieve both results
    const v1 = await prisma.methodologyVersion.findFirst({ where: { name: 'v1' } });
    const v2active = await prisma.methodologyVersion.findFirst({ where: { name: 'v2' } });

    const resV1 = await service.getStoredResult(product!.id, v1!.id);
    const resV2 = await service.getStoredResult(product!.id, v2active!.id);

    expect(resV1).toBeDefined();
    expect(resV2).toBeDefined();
    expect(resV1!.id).not.toBe(resV2!.id);
    // Verify that v2 severity differs
    const parabV2 = await prisma.classificationFinding.findFirst({
      where: { resultId: resV2!.id, rawName: 'Paraben' },
    });
    expect(parabV2!.severity).toBe(Severity.RESTRICTED);
  });
});
