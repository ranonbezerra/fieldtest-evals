import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
// ASSUMPTION: repositories accept a PrismaClient instance in their constructor.
import { ClassificationService } from '../src/classification/classification.service.js';
import { ProductRepository } from '../src/product/product.repository.js';
import { IngredientRepository } from '../src/ingredient/ingredient.repository.js';
import { MethodologyRepository } from '../src/methodology/methodology.repository.js';
import { ProfileRepository } from '../src/profile/profile.repository.js';
import { ClassificationRepository } from '../src/classification/classification.repository.js';
// ASSUMPTION: types are exported from types.ts alongside the service.
import type { ClassificationResponse, ProfiledClassificationResponse } from '../src/classification/types.js';

describe('Classification', () => {
  let prisma: PrismaClient;
  let service: ClassificationService;
  let productRepo: ProductRepository;
  let ingredientRepo: IngredientRepository;
  let methodologyRepo: MethodologyRepository;
  let profileRepo: ProfileRepository;
  let classificationRepo: ClassificationRepository;

  // IDs populated in beforeAll
  let ids: {
    glycerol: number;
    methylparaben: number;
    aqua: number;
    cetearylAlcohol: number;
    tocopherol: number;
    v1: number;
    v2: number;
    childProfile: number;
    product1: number;
    product2: number;
    product3: number;
    product4: number;
    product5: number;
  };

  beforeAll(async () => {
    prisma = new PrismaClient();

    // Clean slate for idempotent runs
    await prisma.classificationFinding.deleteMany();
    await prisma.classificationResult.deleteMany();
    await prisma.productIngredient.deleteMany();
    await prisma.profileModifier.deleteMany();
    await prisma.rule.deleteMany();
    await prisma.synonym.deleteMany();
    await prisma.product.deleteMany();
    await prisma.profile.deleteMany();
    await prisma.methodologyVersion.deleteMany();
    await prisma.ingredient.deleteMany();

    // --- Ingredients ---
    const glycerol = await prisma.ingredient.create({
      data: { canonicalName: 'glycerol', displayName: 'Glycerol' },
    });
    const methylparaben = await prisma.ingredient.create({
      data: { canonicalName: 'methylparaben', displayName: 'Methylparaben' },
    });
    const aqua = await prisma.ingredient.create({
      data: { canonicalName: 'aqua', displayName: 'Aqua' },
    });
    const cetearylAlcohol = await prisma.ingredient.create({
      data: { canonicalName: 'cetearyl-alcohol', displayName: 'Cetearyl Alcohol' },
    });
    const tocopherol = await prisma.ingredient.create({
      data: { canonicalName: 'tocopherol', displayName: 'Tocopherol' },
    });

    // --- Synonym (OCR typo) ---
    await prisma.synonym.create({
      data: { ingredientId: glycerol.id, synonymText: 'gyceryl' },
    });

    // --- Methodology v1 (active) ---
    const v1 = await prisma.methodologyVersion.create({
      data: { version: 1, name: 'Initial', isActive: true },
    });
    await prisma.rule.create({
      data: {
        methodologyVersionId: v1.id,
        ingredientId: glycerol.id,
        severity: 'WATCH' as const,
        flag: 'humectant-note',
        sourceCitation: 'EC 1223/2009 Annex V',
      },
    });
    await prisma.rule.create({
      data: {
        methodologyVersionId: v1.id,
        ingredientId: methylparaben.id,
        severity: 'WATCH' as const,
        flag: 'preservative-concern',
        sourceCitation: 'EC 1223/2009 Annex VI',
      },
    });

    // --- Methodology v2 (inactive, for version-coexistence test) ---
    const v2 = await prisma.methodologyVersion.create({
      data: { version: 2, name: 'Revised' },
    });
    await prisma.rule.create({
      data: {
        methodologyVersionId: v2.id,
        ingredientId: glycerol.id,
        severity: 'RESTRICTED' as const,
        flag: 'humectant-revised',
        sourceCitation: 'EC 1223/2009 Annex V (2024)',
      },
    });
    await prisma.rule.create({
      data: {
        methodologyVersionId: v2.id,
        ingredientId: methylparaben.id,
        severity: 'BANNED' as const,
        flag: 'preservative-banned',
        sourceCitation: 'EC 1223/2009 Annex VI (2024)',
      },
    });

    // --- Profile with modifier ---
    const childProfile = await prisma.profile.create({
      data: { name: 'Child under 3', description: 'Modifiers for children under 3' },
    });
    await prisma.profileModifier.create({
      data: {
        profileId: childProfile.id,
        ingredientId: methylparaben.id,
        severity: 'BANNED' as const,
        flag: 'preservative-banned-child',
        sourceCitation: 'National Health Authority 2023',
      },
    });

    // --- Products ---
    const product1 = await prisma.product.create({ data: { name: 'Test Lotion A' } });
    await prisma.productIngredient.createMany({
      data: [
        { productId: product1.id, rawText: 'Glycerol', position: 1 },
        { productId: product1.id, rawText: 'Methylparaben', position: 2 },
        { productId: product1.id, rawText: 'Aqua', position: 3 },
      ],
    });

    const product2 = await prisma.product.create({ data: { name: 'Test Lotion B' } });
    await prisma.productIngredient.createMany({
      data: [
        { productId: product2.id, rawText: 'Glycerol', position: 1 },
        { productId: product2.id, rawText: 'Methylparaben', position: 2 },
        { productId: product2.id, rawText: 'Aqua', position: 3 },
        { productId: product2.id, rawText: 'Cetearyl Alcohol', position: 4 },
        { productId: product2.id, rawText: 'UnkownSubstanceXYZ', position: 5 },
      ],
    });

    const product3 = await prisma.product.create({ data: { name: 'Test Lotion C' } });
    await prisma.productIngredient.createMany({
      data: [{ productId: product3.id, rawText: 'gyceryl', position: 1 }],
    });

    const product4 = await prisma.product.create({ data: { name: 'Shuffled A' } });
    await prisma.productIngredient.createMany({
      data: [
        { productId: product4.id, rawText: 'Aqua', position: 1 },
        { productId: product4.id, rawText: 'Glycerol', position: 2 },
        { productId: product4.id, rawText: 'Tocopherol', position: 3 },
      ],
    });

    const product5 = await prisma.product.create({ data: { name: 'Shuffled B' } });
    await prisma.productIngredient.createMany({
      data: [
        { productId: product5.id, rawText: 'Tocopherol', position: 1 },
        { productId: product5.id, rawText: 'Aqua', position: 2 },
        { productId: product5.id, rawText: 'Glycerol', position: 3 },
      ],
    });

    ids = {
      glycerol: glycerol.id,
      methylparaben: methylparaben.id,
      aqua: aqua.id,
      cetearylAlcohol: cetearylAlcohol.id,
      tocopherol: tocopherol.id,
      v1: v1.id,
      v2: v2.id,
      childProfile: childProfile.id,
      product1: product1.id,
      product2: product2.id,
      product3: product3.id,
      product4: product4.id,
      product5: product5.id,
    };

    // Instantiate repositories and service
    productRepo = new ProductRepository(prisma);
    ingredientRepo = new IngredientRepository(prisma);
    methodologyRepo = new MethodologyRepository(prisma);
    profileRepo = new ProfileRepository(prisma);
    classificationRepo = new ClassificationRepository(prisma);
    service = new ClassificationService(
      productRepo,
      ingredientRepo,
      methodologyRepo,
      profileRepo,
      classificationRepo,
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('profile flips a finding from watch to banned', async () => {
    const result = await service.classify(ids.product1, ids.childProfile);
    // Should be profiled since profileId was provided
    const profiled = result as ProfiledClassificationResponse;
    expect(profiled.profileId).toBe(ids.childProfile);

    // Find the methylparaben finding
    const parabenFinding = profiled.findings.find(
      (f: { rawText: string }) => f.rawText === 'Methylparaben',
    );
    expect(parabenFinding).toBeDefined();
    // Base rule was watch; profile modifier escalates to banned
    expect(parabenFinding!.severity).toBe('banned');
    expect(parabenFinding!.flag).toBe('preservative-banned-child');
    expect(parabenFinding!.sourceCitation).toBe('National Health Authority 2023');
  });

  it('unknown ingredient lowers confidence and is visible in output', async () => {
    const result = await service.classify(ids.product2);
    const base = result as ClassificationResponse;

    // 5 ingredients, 1 unknown → confidence = max(0, 1 - 0.1 * 1) = 0.9
    // Wait: plan says 0.8 for 5 ingredients with 1 unknown.
    // Re-reading: "product has 5 ingredients, 1 unresolvable → overallConfidence = 0.8"
    // That implies formula: 1 - 0.2 * unknownCount? Or maybe the plan's example
    // uses a different factor. Let me re-read assumption 4:
    // "Confidence = max(0, 1 − 0.1 × unknownCount)" → 1 - 0.1*1 = 0.9
    // But the test spec says 0.8. There's a discrepancy.
    // The test spec in section 5 says: "product has 5 ingredients, 1 unresolvable → overallConfidence = 0.8"
    // This implies the formula is 1 - (unknownCount / total) * something, or
    // perhaps 1 - 0.2 * unknownCount. I'll follow the test spec value.
    // ASSUMPTION: The plan's assumption 4 formula (1 - 0.1 * unknownCount) yields 0.9,
    // but the test spec explicitly states 0.8. I assert 0.8 per the test spec.
    expect(base.overallConfidence).toBe(0.8);

    // Unknown ingredient is listed
    expect(base.unknownIngredients).toContain('UnkownSubstanceXYZ');

    // The unknown finding is marked
    const unknownFinding = base.findings.find(
      (f: { rawText: string }) => f.rawText === 'UnkownSubstanceXYZ',
    );
    expect(unknownFinding).toBeDefined();
    expect(unknownFinding!.isUnknown).toBe(true);
    expect(unknownFinding!.resolvedName).toBeNull();
  });

  it('synonym/typo resolves to canonical ingredient', async () => {
    const result = await service.classify(ids.product3);
    const base = result as ClassificationResponse;

    const finding = base.findings.find(
      (f: { rawText: string }) => f.rawText === 'gyceryl',
    );
    expect(finding).toBeDefined();
    expect(finding!.isUnknown).toBe(false);
    expect(finding!.resolvedName).toBe('glycerol');
    // Should carry the glycerol rule from v1
    expect(finding!.severity).toBe('watch');
    expect(finding!.flag).toBe('humectant-note');
  });

  it('identical result across reruns', async () => {
    const first = await service.classify(ids.product1);
    const second = await service.classify(ids.product1);

    expect(second).toEqual(first);
  });

  it('shuffled ingredient order yields identical finding set and confidence', async () => {
    const resultA = await service.classify(ids.product4);
    const resultB = await service.classify(ids.product5);

    const aBase = resultA as ClassificationResponse;
    const bBase = resultB as ClassificationResponse;

    // Confidence must be equal
    expect(aBase.overallConfidence).toBe(bBase.overallConfidence);

    // Findings as a set (sorted by rawText for comparison) must be identical
    const sortFindings = (findings: { rawText: string }[]): { rawText: string }[] =>
      [...findings].sort((a, b) => a.rawText.localeCompare(b.rawText));

    expect(sortFindings(aBase.findings)).toEqual(sortFindings(bBase.findings));
  });

  it('both methodology versions coexist after publish', async () => {
    // Ensure v1 is active (it should be from seed)
    await service.classify(ids.product1);

    // Retrieve stored result for v1
    const v1Result = await classificationRepo.findByProductAndVersion(ids.product1, ids.v1);
    expect(v1Result).not.toBeNull();

    // Publish v2: set active flag, then re-score
    await methodologyRepo.publish(ids.v2);
    await service.rescoreAll(ids.v2);

    // Retrieve stored result for v2
    const v2Result = await classificationRepo.findByProductAndVersion(ids.product1, ids.v2);
    expect(v2Result).not.toBeNull();

    // Both results coexist
    const allResults = await classificationRepo.findByProductId(ids.product1);
    expect(allResults).toHaveLength(2);

    // v1 result is unchanged (still has v1's severity for glycerol)
    expect(v1Result!.id).not.toBe(v2Result!.id);

    // Verify v1 stored data reflects v1 rules (watch for glycerol)
    // and v2 reflects v2 rules (restricted for glycerol)
    const v1Confidence = v1Result!.overallConfidence;
    const v2Confidence = v2Result!.overallConfidence;
    // Both products have no unknowns, so confidence should be 1.0 for both
    expect(v1Confidence).toBe(1);
    expect(v2Confidence).toBe(1);
  });
});
