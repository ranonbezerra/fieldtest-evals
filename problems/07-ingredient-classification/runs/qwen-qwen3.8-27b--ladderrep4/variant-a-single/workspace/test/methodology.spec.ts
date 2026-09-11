import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  DuplicateVersionError,
  NoActiveMethodologyError,
  ResourceNotFoundError,
} from '../src/common/errors.js';
import {
  ClassificationService,
  type ClassificationOutput,
} from '../src/classification/classification.service.js';
import { ClassificationRepository } from '../src/classification/classification.repository.js';
import { MethodologyService } from '../src/methodology/methodology.service.js';
import { MethodologyRepository } from '../src/methodology/methodology.repository.js';
import { seedBase, V2_RULES, wipeAll, type Seeded } from './fixtures.js';

const prisma = new PrismaClient();

let classification: ClassificationService;
let methodology: MethodologyService;
let seeded: Seeded;

const v2Input = () => ({
  version: 2,
  name: '2024 amendment',
  rules: V2_RULES.map((rule) => ({
    ingredientId: seeded.ingredients[rule.ingredient],
    severity: rule.severity,
    sourceCitation: rule.citation,
  })),
});

beforeAll(() => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must point at a PostgreSQL database for tests.');
  }
  const repository = new ClassificationRepository(prisma);
  classification = new ClassificationService(repository);
  methodology = new MethodologyService(new MethodologyRepository(prisma), classification);
});

beforeEach(async () => {
  await wipeAll(prisma);
  seeded = await seedBase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('publishing methodology versions', () => {
  it('keeps v1 results exactly as they were while v2 results coexist', async () => {
    const before = await classification.classify(seeded.shampooId);
    expect(before.methodologyVersion).toBe(1);

    const v2 = await methodology.create(v2Input());
    expect(v2.status).toBe('draft');
    const published = await methodology.publish(v2.id);
    expect(published.status).toBe('published');
    expect(published.rescoredProducts).toBe(3);
    expect(published.publishedAt).toBeTruthy();

    const rows = await prisma.classificationResult.findMany({
      where: { productId: seeded.shampooId, profileId: '' },
      orderBy: { version: 'asc' },
    });
    expect(rows.map((row) => row.version)).toEqual([1, 2]);

    const v1Payload = JSON.parse(rows[0].payload) as ClassificationOutput;
    const v2Payload = JSON.parse(rows[1].payload) as ClassificationOutput;
    // v1 is exactly what it was before v2 existed
    expect(v1Payload).toEqual(before);
    // v2 reflects the tightened rules
    expect(v2Payload.findings.find((f) => f.inci === 'Linalool')!.severity).toBe('restricted');
    expect(v2Payload.findings.find((f) => f.inci === 'Fragrance')!.severity).toBe('watch');

    const v1ViaApi = await classification.getResults(seeded.shampooId, 1);
    expect(v1ViaApi).toHaveLength(1);
    expect(v1ViaApi[0].methodologyVersion).toBe(1);
    expect(v1ViaApi[0].findings).toEqual(before.findings);
    const v2ViaApi = await classification.getResults(seeded.shampooId, 2);
    expect(v2ViaApi[0].findings).toEqual(v2Payload.findings);
  });

  it('re-scores idempotently: repeated publishes never duplicate rows', async () => {
    const v2 = await methodology.create(v2Input());
    await methodology.publish(v2.id);
    const afterFirst = await prisma.classificationResult.count({ where: { version: 2 } });
    expect(afterFirst).toBe(3);

    const before = await prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId_profileId: {
          productId: seeded.creamId,
          methodologyVersionId: v2.id,
          profileId: '',
        },
      },
    });
    expect(before).not.toBeNull();

    await methodology.publish(v2.id);
    await methodology.publish(v2.id);

    const afterRepeat = await prisma.classificationResult.count({ where: { version: 2 } });
    expect(afterRepeat).toBe(afterFirst);
    const after = await prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId_profileId: {
          productId: seeded.creamId,
          methodologyVersionId: v2.id,
          profileId: '',
        },
      },
    });
    expect(after!.id).toBe(before!.id);
    expect(after!.payload).toBe(before!.payload);
  });

  it('makes the newly published version active for fresh classifications', async () => {
    const v2 = await methodology.create(v2Input());
    await methodology.publish(v2.id);
    const output = await classification.classify(seeded.shampooId);
    expect(output.methodologyVersion).toBe(2);
  });

  it('rejects a duplicate version number', async () => {
    await methodology.create(v2Input());
    await expect(methodology.create({ version: 2, rules: [] })).rejects.toThrow(DuplicateVersionError);
  });

  it('cannot publish a version that does not exist', async () => {
    await expect(methodology.publish('missing-version')).rejects.toThrow(ResourceNotFoundError);
  });

  it('refuses to classify while no version is published', async () => {
    await prisma.methodologyVersion.update({
      where: { id: seeded.v1Id },
      data: { status: 'draft', publishedAt: null },
    });
    await expect(classification.classify(seeded.shampooId)).rejects.toThrow(NoActiveMethodologyError);
  });
});
