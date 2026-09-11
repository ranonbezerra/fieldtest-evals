import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { ClassificationRepository } from '../src/classification/classification.repository.js';
import { ClassificationService } from '../src/classification/classification.service.js';
import { CREAM_LIST, seedBase, wipeAll, type Seeded } from './fixtures.js';

const prisma = new PrismaClient();

let service: ClassificationService;
let app: INestApplication;
let seeded: Seeded;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at a PostgreSQL database for tests.');
  }
  service = new ClassificationService(new ClassificationRepository(prisma));
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
});

beforeEach(async () => {
  await wipeAll(prisma);
  seeded = await seedBase(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('classify — behaviour', () => {
  it('flips a finding with a profile that the base rules alone would not flag', async () => {
    const base = await service.classify(seeded.shampooId);
    const baseFragrance = base.findings.find((f) => f.inci === 'Fragrance');
    expect(baseFragrance).toBeDefined();
    expect(baseFragrance!.status).toBe('unflagged');
    expect(baseFragrance!.flag).toBe(false);
    expect(baseFragrance!.severity).toBeNull();
    expect(baseFragrance!.sourceCitation).toBeNull();

    const child = await service.classify(seeded.shampooId, seeded.youngChildId);
    const childFragrance = child.findings.find((f) => f.inci === 'Fragrance');
    expect(childFragrance!.flag).toBe(true);
    expect(childFragrance!.status).toBe('flagged');
    expect(childFragrance!.severity).toBe('restricted');
    expect(childFragrance!.sourceCitation).toBe('Internal pediatric precaution list, entry 1');

    // the profile also tightens a finding the base rules already had
    expect(base.findings.find((f) => f.inci === 'Linalool')!.severity).toBe('watch');
    expect(child.findings.find((f) => f.inci === 'Linalool')!.severity).toBe('restricted');
  });

  it('applies two modifiers touching one ingredient in the documented fixed order', async () => {
    const first = await service.classify(seeded.shampooId, seeded.bothId);
    const second = await service.classify(seeded.shampooId, seeded.bothId);
    expect(second).toEqual(first);
    const linalool = first.findings.find((f) => f.inci === 'Linalool');
    expect(linalool!.severity).toBe('restricted');
    // child_under_3 applies before pregnancy; equal severities never swap the
    // citation, so the pediatric one is the one on record
    expect(linalool!.sourceCitation).toBe('Internal pediatric precaution list, entry 3');
  });

  it('lists unrecognized ingredients as unknown and lowers confidence', async () => {
    const serum = await service.classify(seeded.serumId);
    const unknown = serum.findings.filter((f) => f.status === 'unknown');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].inci).toBe('Zinc-9 Xyz');
    expect(unknown[0].flag).toBe(false);
    expect(unknown[0].severity).toBeNull();
    expect(unknown[0].canonicalName).toBeNull();
    expect(serum.totalCount).toBe(4);
    expect(serum.recognizedCount).toBe(3);
    expect(serum.confidence).toBe(0.75);

    const shampoo = await service.classify(seeded.shampooId);
    expect(shampoo.confidence).toBe(1);
  });

  it('resolves synonyms, OCR typos, and accent/case variants to canonical ingredients', async () => {
    const shampoo = await service.classify(seeded.shampooId);
    const methyl = shampoo.findings.find((f) => f.inci === 'Methyl Paraben');
    expect(methyl!.canonicalName).toBe('methylparaben');
    expect(methyl!.ingredientId).toBe(seeded.ingredients['methylparaben']);
    expect(methyl!.flag).toBe(true);
    expect(methyl!.severity).toBe('restricted');
    expect(methyl!.sourceCitation).toBe('EU Reg 1223/2009, Annex V, 17.c');

    const serum = await service.classify(seeded.serumId);
    const linalol = serum.findings.find((f) => f.inci === 'Linalol');
    expect(linalol!.canonicalName).toBe('linalool');
    expect(linalol!.ingredientId).toBe(seeded.ingredients['linalool']);
    expect(linalol!.severity).toBe('watch');

    const tocopherol = serum.findings.find((f) => f.inci === 'Tocophérol');
    expect(tocopherol!.canonicalName).toBe('tocopherol');
    expect(tocopherol!.status).toBe('unflagged');
  });

  it('returns an identical result across reruns', async () => {
    const first = await service.classify(seeded.shampooId);
    const second = await service.classify(seeded.shampooId);
    expect(second).toEqual(first);
    const stored = await prisma.classificationResult.count({
      where: { productId: seeded.shampooId, profileId: '' },
    });
    expect(stored).toBe(1);
  });

  it('returns an identical result for a shuffled ingredient list', async () => {
    const first = await service.classify(seeded.creamId);
    await prisma.productIngredient.deleteMany({ where: { productId: seeded.creamId } });
    const shuffled = [...CREAM_LIST].reverse();
    await prisma.productIngredient.createMany({
      data: shuffled.map((inci) => ({ productId: seeded.creamId, inci })),
    });
    const second = await service.classify(seeded.creamId);
    expect(second).toEqual(first);
  });

  it('reports findings, confidence and a disclaimer — never a binary verdict', async () => {
    const output = await service.classify(seeded.shampooId);
    expect(typeof output.disclaimer).toBe('string');
    expect(output.disclaimer.length).toBeGreaterThan(0);
    expect(output.confidence).toBeGreaterThanOrEqual(0);
    expect(output.confidence).toBeLessThanOrEqual(1);
    const keys: string[] = [];
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) collect(item);
        return;
      }
      if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
          keys.push(key);
          collect(item);
        }
      }
    };
    collect(output);
    expect(keys.some((key) => /safe|toxic/i.test(key))).toBe(false);
  });
});

describe('HTTP contract', () => {
  it('POST /classifications stores and returns a result', async () => {
    const res = await request(app.getHttpServer())
      .post('/classifications')
      .send({ productId: seeded.shampooId })
      .expect(201);
    expect(res.body.methodologyVersion).toBe(1);
    expect(res.body.findings).toHaveLength(4);
    const stored = await prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId_profileId: {
          productId: seeded.shampooId,
          methodologyVersionId: seeded.v1Id,
          profileId: '',
        },
      },
    });
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!.payload).findings).toEqual(res.body.findings);
  });

  it('GET /classifications retrieves the stored result', async () => {
    await service.classify(seeded.shampooId);
    const res = await request(app.getHttpServer())
      .get('/classifications')
      .query({ productId: seeded.shampooId, methodologyVersion: 1 })
      .expect(200);
    expect(res.body).toHaveLength(1);
    const fresh = await service.classify(seeded.shampooId);
    expect(res.body[0].findings).toEqual(fresh.findings);
    expect(res.body[0].methodologyVersion).toBe(1);
  });

  it('answers unknown products with the resource_not_found envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/classifications')
      .send({ productId: 'nope' })
      .expect(404);
    expect(res.body).toEqual({
      error: {
        code: 'resource_not_found',
        message: expect.any(String),
        details: expect.objectContaining({ resource: 'product', id: 'nope' }),
      },
    });
  });

  it('rejects malformed bodies with the invalid_request envelope', async () => {
    const res = await request(app.getHttpServer()).post('/classifications').send({}).expect(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.details).toBeTypeOf('object');
    expect(res.body.error.details).not.toBeNull();
  });
});
