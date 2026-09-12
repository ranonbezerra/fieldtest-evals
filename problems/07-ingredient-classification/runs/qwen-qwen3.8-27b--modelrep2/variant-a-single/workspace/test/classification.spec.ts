import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/exception-filter.js';
import { ClassificationService } from '../src/classification/classification.service.js';
import { IngredientService } from '../src/ingredient/ingredient.service.js';
import { MethodologyService } from '../src/methodology/methodology.service.js';
import { ProfileService } from '../src/profile/profile.service.js';
import { ProductService } from '../src/product/product.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('ingredient classification', () => {
  let app: INestApplication;
  let ingredientService: IngredientService;
  let methodologyService: MethodologyService;
  let productService: ProductService;
  let profileService: ProfileService;
  let classificationService: ClassificationService;
  let prisma: PrismaService;

  const created = {
    ingredients: [] as string[],
    versions: [] as string[],
    products: [] as string[],
    profiles: [] as string[],
  };

  let waterId: string;
  let caffeineId: string;
  let cafeId: string;
  let lauricAcidId: string;
  let retinolId: string;
  let hydroquinoneId: string;
  let v1Id: string;
  let v2Id: string;
  let serumId: string;
  let shampooId: string;
  let serumShuffledId: string;
  let pregnancyId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    ingredientService = app.get(IngredientService);
    methodologyService = app.get(MethodologyService);
    productService = app.get(ProductService);
    profileService = app.get(ProfileService);
    classificationService = app.get(ClassificationService);
    prisma = app.get(PrismaService);

    // Ingredient dictionary, with curated synonym and OCR typo fixtures.
    // ASSUMPTION: no separate synonym fixture file was provided, so the
    // tests seed their own curated alias/typo entries.
    waterId = (await ingredientService.createIngredient({ name: 'Water' })).id;
    created.ingredients.push(waterId);
    await ingredientService.createSynonym({ ingredientId: waterId, alias: 'Aqua' });

    caffeineId = (await ingredientService.createIngredient({ name: 'Caffeine' })).id;
    created.ingredients.push(caffeineId);

    cafeId = (await ingredientService.createIngredient({ name: 'Café' })).id;
    created.ingredients.push(cafeId);

    lauricAcidId = (await ingredientService.createIngredient({ name: 'Lauric Acid' })).id;
    created.ingredients.push(lauricAcidId);
    await ingredientService.createSynonym({ ingredientId: lauricAcidId, alias: 'Lauric Acd' });

    retinolId = (await ingredientService.createIngredient({ name: 'Retinol' })).id;
    created.ingredients.push(retinolId);

    hydroquinoneId = (await ingredientService.createIngredient({ name: 'Hydroquinone' })).id;
    created.ingredients.push(hydroquinoneId);

    // Version 1 is created as a draft so the products below already exist
    // when its publish triggers the initial re-score.
    const v1 = await methodologyService.create({
      label: 'Baseline 2024',
      rules: [
        { ingredientId: retinolId, severity: 'watch', sourceCitation: 'Curated watch list, 2024' },
        { ingredientId: hydroquinoneId, severity: 'banned', sourceCitation: 'EC 1223/2009, Annex II' },
        { ingredientId: lauricAcidId, severity: 'restricted', sourceCitation: 'EC 1223/2009, Annex III' },
      ],
    });
    v1Id = v1.id;
    created.versions.push(v1Id);

    const serum = await productService.create({
      name: 'Serum',
      ingredients: ['Aqua', 'CAFFEINE', 'Retinol', 'lauric acd', 'cafe'],
    });
    serumId = serum.id;
    created.products.push(serumId);

    const shampoo = await productService.create({
      name: 'Shampoo',
      ingredients: ['Aqua', 'Hydroquinone', 'Mystery-9000'],
    });
    shampooId = shampoo.id;
    created.products.push(shampooId);

    const serumShuffled = await productService.create({
      name: 'Serum (shuffled list)',
      ingredients: ['cafe', 'Retinol', 'Aqua', 'CAFFEINE', 'lauric acd'],
    });
    serumShuffledId = serumShuffled.id;
    created.products.push(serumShuffledId);

    const pregnancy = await profileService.create({
      name: 'Pregnancy',
      description: 'Contextual rules for pregnancy',
      modifiers: [
        { ingredientId: retinolId, severity: 'banned', citation: 'ANSM pregnancy guidance, 2023' },
      ],
    });
    pregnancyId = pregnancy.id;
    created.profiles.push(pregnancyId);

    await methodologyService.publish(v1Id);
  }, 120_000);

  afterAll(async () => {
    try {
      if (prisma) {
        // Delete fixtures in dependency order; relations cascade the rest.
        await prisma.methodologyVersion.deleteMany({ where: { id: { in: created.versions } } });
        await prisma.product.deleteMany({ where: { id: { in: created.products } } });
        await prisma.profile.deleteMany({ where: { id: { in: created.profiles } } });
        await prisma.ingredient.deleteMany({ where: { id: { in: created.ingredients } } });
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  describe('synonym, case, accent and OCR typo resolution', () => {
    it('resolves every listed label to its canonical ingredient', async () => {
      const result = await classificationService.classify(serumId);
      const findingFor = (label: string) => result.findings.find((finding) => finding.label === label);

      expect(result.unknown).toEqual([]);
      expect(result.findings).toHaveLength(5);
      expect(findingFor('Aqua')?.ingredient).toBe('Water');
      expect(findingFor('CAFFEINE')?.ingredient).toBe('Caffeine');
      expect(findingFor('cafe')?.ingredient).toBe('Café');
      expect(findingFor('Retinol')?.ingredient).toBe('Retinol');
      const lauric = findingFor('lauric acd');
      expect(lauric?.ingredient).toBe('Lauric Acid');
      expect(lauric?.flagged).toBe(true);
      expect(lauric?.severity).toBe('restricted');
      expect(lauric?.source).toBe('EC 1223/2009, Annex III');
    });
  });

  describe('profile contextual modifiers', () => {
    it('a profile flips a base finding to a stricter severity and citation', async () => {
      const base = await classificationService.classify(serumId);
      const withProfile = await classificationService.classify(serumId, pregnancyId);

      const retinolBase = base.findings.find((finding) => finding.label === 'Retinol');
      const retinolProfile = withProfile.findings.find((finding) => finding.label === 'Retinol');

      expect(retinolBase).toMatchObject({
        flagged: true,
        severity: 'watch',
        source: 'Curated watch list, 2024',
        profileAdjusted: false,
      });
      expect(retinolProfile).toMatchObject({
        flagged: true,
        severity: 'banned',
        source: 'ANSM pregnancy guidance, 2023',
        profileAdjusted: true,
      });

      // Unrelated findings must stay untouched by the profile.
      expect(withProfile.findings.filter((finding) => finding.label !== 'Retinol')).toEqual(
        base.findings.filter((finding) => finding.label !== 'Retinol'),
      );
      expect(base.profileId).toBeNull();
      expect(withProfile.profileId).toBe(pregnancyId);
    });
  });

  describe('unknown ingredients', () => {
    it('lists unrecognized labels and lowers confidence proportionally', async () => {
      const result = await classificationService.classify(shampooId);

      expect(result.unknown).toEqual(['Mystery-9000']);
      expect(result.confidence).toBeCloseTo(2 / 3, 4);
      expect(result.findings).toHaveLength(2);

      const fullyResolved = await classificationService.classify(serumId);
      expect(fullyResolved.unknown).toEqual([]);
      expect(fullyResolved.confidence).toBe(1);
    });

    it('returns a disclaimer and never a binary safe/toxic verdict', async () => {
      const result = await classificationService.classify(shampooId);

      expect(typeof result.disclaimer).toBe('string');
      expect(result.disclaimer.length).toBeGreaterThan(0);
      expect(result).not.toHaveProperty('safe');
      expect(result).not.toHaveProperty('toxic');
      expect(result).not.toHaveProperty('verdict');
    });
  });

  describe('determinism', () => {
    it('returns the identical result across reruns', async () => {
      const first = await classificationService.classify(serumId);
      const second = await classificationService.classify(serumId);
      expect(second).toEqual(first);
    });

    it('returns the identical result for a shuffled ingredient list', async () => {
      const ordered = await classificationService.classify(serumId);
      const shuffled = await classificationService.classify(serumShuffledId);

      expect({
        findings: shuffled.findings,
        unknown: shuffled.unknown,
        confidence: shuffled.confidence,
      }).toEqual({
        findings: ordered.findings,
        unknown: ordered.unknown,
        confidence: ordered.confidence,
      });
    });
  });

  describe('methodology versions', () => {
    it("keeps the previous version's results retrievable after a new one is published", async () => {
      const v2 = await methodologyService.create({
        label: 'Baseline 2025',
        rules: [
          { ingredientId: retinolId, severity: 'restricted', sourceCitation: 'EC 1223/2009, Annex III' },
          { ingredientId: hydroquinoneId, severity: 'banned', sourceCitation: 'EC 1223/2009, Annex II' },
          { ingredientId: lauricAcidId, severity: 'restricted', sourceCitation: 'EC 1223/2009, Annex III' },
        ],
      });
      v2Id = v2.id;
      created.versions.push(v2Id);

      // Publishing triggers the idempotent re-score of all affected products.
      await methodologyService.publish(v2Id);

      const underV1 = await classificationService.getStored(serumId, v1Id);
      const underV2 = await classificationService.getStored(serumId, v2Id);

      expect(underV1.findings.find((finding) => finding.ingredient === 'Retinol')?.severity).toBe('watch');
      expect(underV2.findings.find((finding) => finding.ingredient === 'Retinol')?.severity).toBe('restricted');
      expect(underV1.unknown).toEqual([]);
      expect(underV2.unknown).toEqual([]);
      expect(underV1.confidence).toBe(1);
      expect(underV2.confidence).toBe(1);
    });

    it('re-scores idempotently: republishing or rerunning does not duplicate rows', async () => {
      const countBefore = await prisma.classificationResult.count({
        where: { methodologyVersionId: v2Id },
      });
      expect(countBefore).toBeGreaterThan(0);

      // Re-publishing an already published version is a no-op.
      await methodologyService.publish(v2Id);
      // Replaying the re-score rewrites the same rows in place.
      const v2WithRules = await methodologyService.get(v2Id);
      await classificationService.rescoreForVersion(
        v2Id,
        v2WithRules.rules.map((rule) => ({
          ingredientId: rule.ingredientId,
          severity: rule.severity,
          sourceCitation: rule.sourceCitation,
        })),
      );

      const countAfter = await prisma.classificationResult.count({
        where: { methodologyVersionId: v2Id },
      });
      expect(countAfter).toBe(countBefore);

      // Stored baselines ignore profile modifiers.
      const stored = await classificationService.getStored(serumId, v2Id);
      expect(stored.findings.find((finding) => finding.ingredient === 'Retinol')).toMatchObject({
        severity: 'restricted',
        profileAdjusted: false,
      });
    });

    it('live classification follows the newest published version', async () => {
      const live = await classificationService.classify(serumId);
      expect(live.methodologyVersionId).toBe(v2Id);
      expect(live.findings.find((finding) => finding.ingredient === 'Retinol')?.severity).toBe(
        'restricted',
      );
    });

    it('serves stored results for both versions over HTTP', async () => {
      const forV1 = await request(app.getHttpServer()).get(
        `/classifications?productId=${serumId}&methodologyVersionId=${v1Id}`,
      );
      expect(forV1.status).toBe(200);
      expect(forV1.body.methodologyVersionId).toBe(v1Id);

      const forV2 = await request(app.getHttpServer()).get(
        `/classifications?productId=${serumId}&methodologyVersionId=${v2Id}`,
      );
      expect(forV2.status).toBe(200);
      expect(forV2.body.methodologyVersionId).toBe(v2Id);
    });
  });

  describe('error envelope', () => {
    it('answers unknown resources with the standard envelope', async () => {
      const response = await request(app.getHttpServer())
        .post('/classifications')
        .send({ productId: randomUUID() });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: {
          code: 'resource_not_found',
          message: expect.any(String),
          details: { productId: expect.any(String) },
        },
      });
    });

    it('answers malformed input with invalid_input', async () => {
      const response = await request(app.getHttpServer())
        .post('/classifications')
        .send({ productId: 'not-a-uuid' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('invalid_input');
      expect(response.body.error.details).toEqual({ field: 'productId' });
    });
  });
});
