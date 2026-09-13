import { describe, it, beforeAll, beforeEach, afterAll, expect } from 'vitest';
import { PrismaClient, Severity } from '@prisma/client';
import { ClassificationService } from '../src/classification/classification.service.js';
import { ClassificationRepository } from '../src/classification/classification.repository.js';
import { MethodologyService } from '../src/classification/methodology.service.js';
import { PrismaService } from '../src/prisma.service.js';

describe('Classification', () => {
  let prisma: PrismaClient;
  let repo: ClassificationRepository;
  let classificationService: ClassificationService;
  let methodologyService: MethodologyService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    // Use PrismaService as a thin wrapper; for tests we can pass the client directly
    const prismaService = new PrismaService();
    // @ts-ignore – assign underlying client for simplicity
    prismaService.$connect = async () => {};
    prismaService.$disconnect = async () => {};
    // @ts-ignore
    prismaService.prisma = prisma;

    repo = new ClassificationRepository(prisma as any);
    classificationService = new ClassificationService(repo);
    methodologyService = new MethodologyService(repo, classificationService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const tables = [
      'classification_results',
      'rules',
      'methodology_versions',
      'products',
      'profiles',
      'synonyms',
      'ingredients',
    ];
    for (const table of tables) {
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE;`,
      );
    }
  });

  it('profile flips a finding that base rules alone would not have flagged', async () => {
    // Ingredient
    await prisma.ingredient.create({ data: { name: 'Aloe Vera' } });

    // Publish v1 with watch rule
    await methodologyService.publishVersion('v1', [
      {
        ingredientName: 'Aloe Vera',
        severity: Severity.WATCH,
        sourceCitation: 'Regulator',
      },
    ]);

    // Profile: child under 3
    const profile = await prisma.profile.create({
      data: {
        name: 'Child Under 3',
        childUnder3: true,
        pregnant: false,
      },
    });

    // Product
    const product = await prisma.product.create({
      data: {
        name: 'Test Product',
        ingredients: ['Aloe Vera'],
      },
    });

    // Classification without profile
    const resultNoProfile = await classificationService.classify(product.id);
    const findingNoProfile = resultNoProfile.findings.find(
      (f) => f.ingredient === 'Aloe Vera',
    )!;
    expect(findingNoProfile.flag).toBe(false);
    expect(findingNoProfile.severity).toBe('watch');

    // Classification with profile
    const resultWithProfile = await classificationService.classify(
      product.id,
      profile.id,
    );
    const findingWithProfile = resultWithProfile.findings.find(
      (f) => f.ingredient === 'Aloe Vera',
    )!;
    expect(findingWithProfile.flag).toBe(true);
    expect(findingWithProfile.severity).toBe('restricted');
  });

  it('unrecognized ingredient appears as unknown and confidence drops', async () => {
    // Known ingredient
    await prisma.ingredient.create({ data: { name: 'Water' } });

    // Product with unknown ingredient
    const product = await prisma.product.create({
      data: {
        name: 'Mixed Product',
        ingredients: ['Water', 'MysteryIngredient'],
      },
    });

    // Publish empty methodology
    await methodologyService.publishVersion('v1', []);

    const result = await classificationService.classify(product.id);
    const unknownFinding = result.findings.find((f) => (f as any).unknown);
    expect(unknownFinding).toBeDefined();
    expect(unknownFinding!.ingredient).toBe('MysteryIngredient');
    expect(result.confidence).toBe(0.5);
  });

  it('synonym and OCR typo resolve to canonical ingredient', async () => {
    // Canonical ingredient
    const ingredient = await prisma.ingredient.create({
      data: { name: 'Vitamin C' },
    });

    // Synonym
    await prisma.synonym.create({
      data: {
        name: 'Ascorbic Acid',
        ingredientId: ingredient.id,
      },
    });

    // Publish rule for Vitamin C
    await methodologyService.publishVersion('v1', [
      {
        ingredientName: 'Vitamin C',
        severity: Severity.BANNED,
        sourceCitation: 'Regulator',
      },
    ]);

    // Product with synonym and typo
    const product = await prisma.product.create({
      data: {
        name: 'Vitamin Product',
        ingredients: ['Ascorbic Acid', 'Vitamina C'],
      },
    });

    const result = await classificationService.classify(product.id);
    const findings = result.findings.filter((f) => !(f as any).unknown);
    expect(findings.length).toBe(2);
    for (const f of findings) {
      expect(f.ingredient).toBe('Vitamin C');
      expect(f.flag).toBe(true);
      expect(f.severity).toBe('banned');
    }
  });

  it('same product, two runs produce identical output', async () => {
    await prisma.ingredient.create({ data: { name: 'Water' } });
    await methodologyService.publishVersion('v1', []);

    const product = await prisma.product.create({
      data: {
        name: 'Simple Product',
        ingredients: ['Water'],
      },
    });

    const result1 = await classificationService.classify(product.id);
    const result2 = await classificationService.classify(product.id);
    expect(result1).toEqual(result2);
  });

  it('same product, shuffled ingredient order yields identical output', async () => {
    await prisma.ingredient.create({ data: { name: 'Water' } });
    await prisma.ingredient.create({ data: { name: 'Glycerin' } });
    await methodologyService.publishVersion('v1', []);

    const product = await prisma.product.create({
      data: {
        name: 'Shuffled Product',
        ingredients: ['Glycerin', 'Water'],
      },
    });

    const resultOrdered = await classificationService.classify(product.id);

    // Shuffle ingredient order
    await prisma.product.update({
      where: { id: product.id },
      data: {
        ingredients: ['Water', 'Glycerin'],
      },
    });

    const resultShuffled = await classificationService.classify(product.id);
    expect(resultOrdered).toEqual(resultShuffled);
  });

  it('after publishing v2, both v1 and v2 results coexist', async () => {
    // Ingredient and v1 rule
    await prisma.ingredient.create({ data: { name: 'Water' } });
    await methodologyService.publishVersion('v1', [
      {
        ingredientName: 'Water',
        severity: Severity.BANNED,
        sourceCitation: 'Regulator v1',
      },
    ]);

    const product = await prisma.product.create({
      data: {
        name: 'Versioned Product',
        ingredients: ['Water'],
      },
    });

    // Result for v1
    const resultV1 = await classificationService.classify(
      product.id,
      undefined,
      'v1',
    );
    const findingV1 = resultV1.findings.find((f) => f.ingredient === 'Water')!;
    expect(findingV1.severity).toBe('banned');
    expect(findingV1.sourceCitation).toBe('Regulator v1');

    // Publish v2 with different severity
    await methodologyService.publishVersion('v2', [
      {
        ingredientName: 'Water',
        severity: Severity.RESTRICTED,
        sourceCitation: 'Regulator v2',
      },
    ]);

    // Result for v2
    const resultV2 = await classificationService.classify(
      product.id,
      undefined,
      'v2',
    );
    const findingV2 = resultV2.findings.find((f) => f.ingredient === 'Water')!;
    expect(findingV2.severity).toBe('restricted');
    expect(findingV2.sourceCitation).toBe('Regulator v2');

    // Ensure both rows exist in the DB
    const storedV1 = await prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId: product.id,
          methodologyVersionId: (
            await prisma.methodologyVersion.findUnique({
              where: { version: 'v1' },
            })
          )!.id,
        },
      },
    });
    const storedV2 = await prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId: product.id,
          methodologyVersionId: (
            await prisma.methodologyVersion.findUnique({
              where: { version: 'v2' },
            })
          )!.id,
        },
      },
    });
    expect(storedV1).toBeTruthy();
    expect(storedV2).toBeTruthy();
  });
});
