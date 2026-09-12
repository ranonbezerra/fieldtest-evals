import { Test, TestingModule } from '@nestjs/testing';
import { ClassificationService } from '../src/classification/classification.service';
import { ClassificationModule } from '../src/classification/classification.module';
import { MethodologyModule } from '../src/methodology/methodology.module';
import { ProductModule } from '../src/products/product.module';
import { ProfileModule } from '../src/profiles/profile.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MethodologyService } from '../src/methodology/methodology.service';
import { ProductService } from '../src/products/product.service';
import { ProfileService } from '../src/profiles/profile.service';
import { expect } from 'vitest';
import { Severity } from '@prisma/client';

describe('ClassificationService (e2e)', () => {
  let moduleRef: TestingModule;
  let classificationService: ClassificationService;
  let methodologyService: MethodologyService;
  let productService: ProductService;
  let profileService: ProfileService;
  let prisma: PrismaService;

  const ingredientAName = 'Sodium Laureth Sulfate';
  const ingredientBName = 'Parabens';
  const synonymA = 'SLS';
  const typoA = 'sodum laureth sulfete';
  const unknownIngredient = 'MysteryIngredient';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ClassificationModule, MethodologyModule, ProductModule, ProfileModule],
    }).compile();

    classificationService = moduleRef.get(ClassificationService);
    methodologyService = moduleRef.get(MethodologyService);
    productService = moduleRef.get(ProductService);
    profileService = moduleRef.get(ProfileService);
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    // Clean up all tables
    await prisma.classificationResult.deleteMany();
    await prisma.rule.deleteMany();
    await prisma.methodologyVersion.deleteMany();
    await prisma.productIngredient.deleteMany();
    await prisma.product.deleteMany();
    await prisma.ingredientSynonym.deleteMany();
    await prisma.ingredient.deleteMany();
    await prisma.profile.deleteMany();

    // Seed ingredients
    const ingredientA = await prisma.ingredient.create({ data: { name: ingredientAName } });
    const ingredientB = await prisma.ingredient.create({ data: { name: ingredientBName } });

    // Synonyms and OCR typo fixtures
    await prisma.ingredientSynonym.createMany({
      data: [
        { synonym: synonymA, ingredientId: ingredientA.id },
        { synonym: typoA, ingredientId: ingredientA.id },
      ],
    });

    // Create product with ingredients (including synonym, typo, unknown)
    await productService.create('Test Product', [
      synonymA, // resolves to ingredientA
      ingredientBName, // canonical name for ingredientB
      unknownIngredient, // unknown
      typoA, // typo resolves to ingredientA
    ]);

    // Create profile for child under 3
    await profileService.create('Child Under 3', 'child_under_3');

    // Publish methodology version v1
    await methodologyService.publishVersion('v1', [
      {
        ingredientName: ingredientAName,
        severity: Severity.watch,
        sourceCitation: 'regulator-2023',
      },
      {
        ingredientName: ingredientBName,
        severity: Severity.banned,
        sourceCitation: 'regulator-2023',
      },
    ]);
  });

  it('should classify product with unknown ingredient lowering confidence', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Product' } });
    expect(product).toBeDefined();

    const result = await classificationService.classify(product!.id);
    expect(result).toBeDefined();
    // Expect 3 recognized out of 4
    expect(result.confidence).toBeCloseTo(0.75);
    // Find unknown ingredient in findings
    const unknownFinding = result.findings.find((f) => f.unknown);
    expect(unknownFinding).toBeDefined();
    expect(unknownFinding?.original).toBe(unknownIngredient);
  });

  it('profile flips a finding severity', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Product' } });
    const profile = await prisma.profile.findFirst({ where: { name: 'Child Under 3' } });
    expect(product).toBeDefined();
    expect(profile).toBeDefined();

    const result = await classificationService.classify(product!.id, profile!.id);
    expect(result).toBeDefined();

    // Find ingredient A (Sodium Laureth Sulfate) finding
    const findingA = result.findings.find(
      (f) => f.canonical?.toLowerCase() === ingredientAName.toLowerCase(),
    );
    expect(findingA).toBeDefined();
    // Base severity was watch, profile should elevate to restricted
    expect(findingA?.severity).toBe(Severity.restricted);
  });

  it('synonym and OCR typo resolve to canonical ingredient', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Product' } });
    const result = await classificationService.classify(product!.id);
    const findingSynonym = result.findings.find(
      (f) => f.original.toLowerCase() === synonymA.toLowerCase(),
    );
    const findingTypo = result.findings.find(
      (f) => f.original.toLowerCase() === typoA.toLowerCase(),
    );
    expect(findingSynonym).toBeDefined();
    expect(findingTypo).toBeDefined();
    expect(findingSynonym?.canonical).toBe(ingredientAName);
    expect(findingTypo?.canonical).toBe(ingredientAName);
  });

  it('deterministic output across runs and shuffled ingredient order', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Product' } });
    const firstRun = await classificationService.classify(product!.id);
    const secondRun = await classificationService.classify(product!.id);
    expect(firstRun).toEqual(secondRun);

    // Create shuffled product
    const shuffledProduct = await productService.create('Shuffled Product', [
      typoA,
      unknownIngredient,
      ingredientBName,
      synonymA,
    ]);
    const shuffledResult = await classificationService.classify(shuffledProduct.id);
    // Findings are sorted deterministically, so they should match
    expect(shuffledResult.findings).toEqual(firstRun.findings);
    expect(shuffledResult.confidence).toBeCloseTo(firstRun.confidence);
  });

  it('publishing new version retains old results and creates new ones', async () => {
    const product = await prisma.product.findFirst({ where: { name: 'Test Product' } });
    // Ensure v1 result exists
    const v1Result = await classificationService.getResult(product!.id, 'v1');
    expect(v1Result).toBeDefined();
    expect(v1Result.methodologyVersion).toBe('v1');
    // Publish v2 with ingredientA severity upgraded to restricted
    await methodologyService.publishVersion('v2', [
      {
        ingredientName: ingredientAName,
        severity: Severity.restricted,
        sourceCitation: 'regulator-2023',
      },
      {
        ingredientName: ingredientBName,
        severity: Severity.banned,
        sourceCitation: 'regulator-2023',
      },
    ]);

    // Retrieve v2 result
    const v2Result = await classificationService.getResult(product!.id, 'v2');
    expect(v2Result).toBeDefined();
    expect(v2Result.methodologyVersion).toBe('v2');

    // Verify that v1 result unchanged (severity still watch)
    const findingV1 = v1Result.findings.find(
      (f) => f.canonical?.toLowerCase() === ingredientAName.toLowerCase(),
    );
    expect(findingV1?.severity).toBe(Severity.watch);

    // Verify v2 result severity upgraded
    const findingV2 = v2Result.findings.find(
      (f) => f.canonical?.toLowerCase() === ingredientAName.toLowerCase(),
    );
    expect(findingV2?.severity).toBe(Severity.restricted);
  });
});
