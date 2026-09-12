import { Test } from '@nestjs/testing';
import { ClassificationModule } from '../src/classification/classification.module';
import { ClassificationService } from '../src/classification/classification.service';
import { ClassificationRepository } from '../src/classification/classification.repository';
import { PrismaService } from '../src/prisma.service';
import {
  Ingredient,
  Synonym,
  Profile,
  ProfileModifier,
  Product,
  MethodologyVersion,
} from '@prisma/client';
import { expect, describe, it, beforeAll, afterAll, beforeEach } from 'vitest';

let prisma: PrismaService;
let service: ClassificationService;
let repository: ClassificationRepository;

async function clearDatabase() {
  // Order matters due to foreign‑key constraints.
  await prisma.classificationResult.deleteMany();
  await prisma.rule.deleteMany();
  await prisma.methodologyVersion.deleteMany();
  await prisma.profileModifier.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.synonym.deleteMany();
  await prisma.ingredient.deleteMany();
  await prisma.product.deleteMany();
}

/** Helper to create an ingredient (and its normalized name). */
async function createIngredient(name: string): Promise<Ingredient> {
  return repository.createIngredient(name);
}

/** Helper to create a synonym for an ingredient. */
async function createSynonym(ingredientId: string, synonym: string): Promise<Synonym> {
  const normalized = synonym.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return prisma.synonym.create({
    data: {
      ingredientId,
      synonym,
      synonymNormalized: normalized,
    },
  });
}

/** Helper to create a product with a raw ingredient list. */
async function createProduct(name: string, ingredients: string[]): Promise<Product> {
  return prisma.product.create({
    data: {
      name,
      ingredientList: ingredients,
    },
  });
}

/** Helper to create a profile and its modifier. */
async function createProfile(name: string): Promise<Profile> {
  return prisma.profile.create({
    data: { name },
  });
}

async function addProfileModifier(
  profileId: string,
  ingredientId: string,
  severity: 'banned' | 'restricted' | 'watch',
  sourceCitation: string,
) {
  const prismaSeverity = severity.toUpperCase() as any;
  await prisma.profileModifier.create({
    data: {
      profileId,
      ingredientId,
      severity: prismaSeverity,
      sourceCitation,
    },
  });
}

/** Helper to publish a methodology version with arbitrary rules. */
async function publishVersion(
  name: string,
  rules: { ingredientName: string; severity: 'banned' | 'restricted' | 'watch'; sourceCitation: string }[],
) {
  await service.publishMethodologyVersion(name, rules);
}

/** Normalizes a string the same way the service does (used for deterministic assertions). */
function normalize(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

describe('Classification Service (L2 Acceptance)', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ClassificationModule],
      providers: [PrismaService],
    }).compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    service = moduleRef.get<ClassificationService>(ClassificationService);
    repository = moduleRef.get<ClassificationRepository>(ClassificationRepository);

    // Ensure DB is clean before the suite runs.
    await clearDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await clearDatabase();

    // Set up a base methodology version (v1) with no rules initially.
    await prisma.methodologyVersion.create({
      data: {
        name: 'v1',
        isActive: true,
      },
    });
  });

  it('profile flips a finding that the base rules alone would not have flagged', async () => {
    // Ingredient without any base rule.
    const retinol = await createIngredient('Retinol');

    // Profile that flags Retinol as banned.
    const pregnancy = await createProfile('Pregnancy');
    await addProfileModifier(pregnancy.id, retinol.id, 'banned', 'Pregnancy profile');

    // Product containing Retinol.
    const product = await createProduct('Serum', ['Retinol']);

    // Classification without profile → should NOT flag.
    const resultNoProfile = await service.classify(product.id);
    const findingNoProfile = resultNoProfile.findings.find((f) => f.ingredient === 'Retinol')!;
    expect(findingNoProfile.flag).toBe(false);
    expect(findingNoProfile.unknown).toBe(false);

    // Classification WITH profile → should flag as banned.
    const resultWithProfile = await service.classify(product.id, pregnancy.id);
    const findingWithProfile = resultWithProfile.findings.find((f) => f.ingredient === 'Retinol')!;
    expect(findingWithProfile.flag).toBe(true);
    expect(findingWithProfile.severity).toBe('banned');
    expect(findingWithProfile.sourceCitation).toBe('Pregnancy profile');
  });

  it('unrecognized ingredient appears as unknown and confidence drops', async () => {
    const known = await createIngredient('KnownIngredient');

    const product = await createProduct('Cream', ['KnownIngredient', 'MysteryXyz']);

    const result = await service.classify(product.id);
    const unknownFinding = result.findings.find((f) => f.ingredient === 'MysteryXyz')!;
    expect(unknownFinding.unknown).toBe(true);
    expect(unknownFinding.flag).toBe(false);

    const knownFinding = result.findings.find((f) => f.ingredient === 'KnownIngredient')!;
    expect(knownFinding.unknown).toBe(false);

    // Confidence should be 0.5 (1 known / 2 total).
    expect(result.confidence).toBeCloseTo(0.5);
  });

  it('synonym and OCR typo both resolve to the canonical ingredient', async () => {
    const water = await createIngredient('Water');
    await createSynonym(water.id, 'Aqua');   // common synonym
    await createSynonym(water.id, 'Watre'); // typo fixture

    const product = await createProduct('Lotion', ['Aqua', 'Watre']);

    const result = await service.classify(product.id);
    // Both ingredients should be recognized (no unknowns).
    const unknowns = result.findings.filter((f) => f.unknown);
    expect(unknowns.length).toBe(0);
    expect(result.confidence).toBe(1);
  });

  it('same product, two runs → identical output', async () => {
    const water = await createIngredient('Water');
    const oil = await createIngredient('Oil');

    const product = await createProduct('Cleanser', ['Water', 'Oil']);

    const first = await service.classify(product.id);
    const second = await service.classify(product.id);

    expect(first).toEqual(second);
  });

  it('same product, shuffled ingredient order → identical output', async () => {
    const water = await createIngredient('Water');
    const oil = await createIngredient('Oil');

    const prodA = await createProduct('Gel A', ['Water', 'Oil']);
    const prodB = await createProduct('Gel B', ['Oil', 'Water']);

    const resultA = await service.classify(prodA.id);
    const resultB = await service.classify(prodB.id);

    expect(resultA).toEqual(resultB);
  });

  it('after publishing v2, both v1 and v2 results are retrievable for the same product', async () => {
    // Base version v1 (already active) with no rules.
    const water = await createIngredient('Water');
    const oil = await createIngredient('Oil');

    const product = await createProduct('Moisturizer', ['Water', 'Oil']);

    // Classify under v1.
    const resultV1 = await service.classify(product.id);
    const activeV1 = await repository.getActiveMethodologyVersion();
    expect(activeV1).toBeTruthy();

    // Publish v2 with a new rule that bans Oil.
    await publishVersion('v2', [
      { ingredientName: 'Oil', severity: 'banned', sourceCitation: 'Regulator' },
    ]);

    // The newly created version becomes active; old version remains.
    const activeV2 = await repository.getActiveMethodologyVersion();
    expect(activeV2?.name).toBe('v2');

    // Retrieve stored results for both versions.
    const storedV1 = await service.getResult(product.id, activeV1!.id);
    const storedV2 = await service.getResult(product.id, activeV2!.id);

    expect(storedV1).toBeTruthy();
    expect(storedV2).toBeTruthy();

    // V2 should flag Oil as banned, V1 should not.
    const oilFindingV2 = storedV2!.findings.find((f) => f.ingredient === 'Oil')!;
    expect(oilFindingV2.flag).toBe(true);
    expect(oilFindingV2.severity).toBe('banned');

    const oilFindingV1 = storedV1!.findings.find((f) => f.ingredient === 'Oil')!;
    expect(oilFindingV1.flag).toBe(false);
  });
});
