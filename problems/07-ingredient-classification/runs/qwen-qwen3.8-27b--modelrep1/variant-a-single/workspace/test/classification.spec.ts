import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { ClassificationModule } from '../src/classification/classification.module.js';
import { ClassificationRepository } from '../src/classification/classification.repository.js';
import type { ClassificationOutput, Finding } from '../src/classification/classification.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createWorld, type World } from './helpers/world.js';

function findingFor(output: ClassificationOutput, listedName: string): Finding {
  const finding = output.findings.find((entry) => entry.listedName === listedName);
  if (!finding) throw new Error(`expected a finding for listed ingredient "${listedName}"`);
  return finding;
}

describe('classification', () => {
  it('resolves synonyms, case, accents and OCR typos to canonical ingredients', async () => {
    const world = await createWorld();
    const product = await world.products.create({
      name: 'Resolution Sample',
      ingredients: ['Glycerine', 'VITAMIN E', 'MethyParaben', 'Rétinol', 'Hydroquionone'],
    });
    const output = await world.classification.classify(product.id);

    expect(findingFor(output, 'Glycerine').canonicalName).toBe('glycerin');
    expect(findingFor(output, 'Glycerine').status).toBe('clear');
    expect(findingFor(output, 'VITAMIN E').canonicalName).toBe('tocopherol');
    expect(findingFor(output, 'VITAMIN E').status).toBe('clear');
    expect(findingFor(output, 'MethyParaben').canonicalName).toBe('methylparaben');
    expect(findingFor(output, 'MethyParaben').severity).toBe('restricted');
    expect(findingFor(output, 'MethyParaben').source).toContain('1223/2009');
    expect(findingFor(output, 'Rétinol').canonicalName).toBe('retinol');
    expect(findingFor(output, 'Rétinol').severity).toBe('watch');
    expect(findingFor(output, 'Hydroquionone').canonicalName).toBe('hydroquinone');
    expect(findingFor(output, 'Hydroquionone').severity).toBe('banned');
    expect(output.unknowns).toEqual([]);
    expect(output.confidence).toBe(100);
    expect(output.disclaimer).toMatch(/advisory/i);
  });

  it('lists unknown ingredients as unknown and lowers confidence', async () => {
    const world = await createWorld();
    const product = await world.products.create({ name: 'Unknown Sample', ingredients: ['Glycerin', 'Borax-9'] });
    const output = await world.classification.classify(product.id);

    expect(output.unknowns).toEqual(['Borax-9']);
    expect(findingFor(output, 'Borax-9').status).toBe('unknown');
    expect(findingFor(output, 'Borax-9').canonicalName).toBeNull();
    expect(findingFor(output, 'Borax-9').flag).toBe(true);
    expect(output.confidence).toBe(50);

    const clean = await world.products.create({ name: 'Clean Sample', ingredients: ['Glycerin', 'Tocopherol'] });
    const cleanOutput = await world.classification.classify(clean.id);
    expect(cleanOutput.confidence).toBe(100);
    expect(cleanOutput.confidence).toBeGreaterThan(output.confidence);
  });

  it('flips findings when a family profile is applied', async () => {
    const world = await createWorld();
    const product = await world.products.create({
      name: 'Profile Sample',
      ingredients: ['Retinol', 'Salicylic Acid', 'Limonene'],
    });

    const base = await world.classification.classify(product.id);
    expect(findingFor(base, 'Retinol').severity).toBe('watch');
    expect(findingFor(base, 'Salicylic Acid').status).toBe('clear');
    expect(findingFor(base, 'Salicylic Acid').flag).toBe(false);

    const pregnant = await world.classification.classify(product.id, world.profileIds['pregnancy']);
    expect(pregnant.profileName).toBe('pregnancy');
    expect(findingFor(pregnant, 'Retinol').severity).toBe('restricted');
    expect(findingFor(pregnant, 'Retinol').source).toMatch(/pregnancy/i);
    // Ingredients the profile does not target keep their base finding.
    expect(findingFor(pregnant, 'Salicylic Acid').status).toBe('clear');

    const child = await world.classification.classify(product.id, world.profileIds['child-under-3']);
    const salicylic = findingFor(child, 'Salicylic Acid');
    expect(salicylic.status).toBe('flagged');
    expect(salicylic.flag).toBe(true);
    expect(salicylic.severity).toBe('restricted');
    expect(salicylic.source).toMatch(/paediatric/i);
    // The profile changes findings, not the base confidence.
    expect(child.confidence).toBe(base.confidence);
  });

  it('is identical across reruns and shuffled ingredient order', async () => {
    const world = await createWorld();
    const set = ['Glycerin', 'Methyl Paraben', 'Aqua', 'Tocopherol', 'Retinol'];
    const ordered = await world.products.create({ name: 'Order A', ingredients: set });
    const shuffled = await world.products.create({ name: 'Order B', ingredients: [...set].reverse() });

    const first = await world.classification.classify(ordered.id);
    const rerun = await world.classification.classify(ordered.id);
    const other = await world.classification.classify(shuffled.id);

    expect(rerun.findings).toEqual(first.findings);
    expect(rerun.confidence).toBe(first.confidence);
    expect(other.findings).toEqual(first.findings);
    expect(other.unknowns).toEqual(first.unknowns);
    expect(other.confidence).toBe(first.confidence);
    expect(other.disclaimer).toEqual(first.disclaimer);
  });

  describe('HTTP layer', () => {
    let world: World;
    let app: INestApplication | undefined;

    beforeAll(async () => {
      world = await createWorld();
      const moduleRef = await Test.createTestingModule({ imports: [ClassificationModule] })
        .overrideProvider(PrismaService)
        .useValue({})
        .overrideProvider(ClassificationRepository)
        .useValue(world.classificationRepo)
        .compile();
      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
    });

    afterAll(async () => {
      await app?.close();
    });

    it('classifies a product with the active methodology', async () => {
      const res = await request(app!.getHttpServer())
        .post('/classifications')
        .send({ productId: world.productIds['Moisturizing Cream'] });
      expect(res.status).toBe(200);
      expect(res.body.methodologyVersion).toBe(1);
      expect(res.body.profileId).toBeNull();
      expect(res.body.findings).toBeInstanceOf(Array);
      expect(res.body.disclaimer).toBeTypeOf('string');
    });

    it('answers invalid payloads with the standard error envelope', async () => {
      const res = await request(app!.getHttpServer())
        .post('/classifications')
        .send({ profileId: 'not-a-uuid' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
      expect(res.body.error.details).toHaveProperty('issues');
    });

    it('answers unknown products with resource_not_found', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';
      const res = await request(app!.getHttpServer())
        .post('/classifications')
        .send({ productId: missing });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('resource_not_found');
      expect(res.body.error.details).toEqual({ productId: missing });
    });

    it('serves a stored result for an explicit product and version pair', async () => {
      const res = await request(app!.getHttpServer()).get(
        `/classifications?productId=${world.productIds['Anti-Aging Serum']}&methodologyVersionId=${world.versionIds[1]}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.methodologyVersion).toBe(1);
      expect(res.body.findings).toHaveLength(4);
    });
  });
});
