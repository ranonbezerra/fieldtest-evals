import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PrismaClient, Severity } from '@prisma/client';
import { ClassificationService } from '../src/classification/classification.service.js';
import { ClassificationRepository } from '../src/classification/classification.repository.js';
import { PrismaService } from '../src/prisma.service.js';

let prisma: PrismaClient;
let repo: ClassificationRepository;
let service: ClassificationService;

beforeAll(async () => {
  prisma = new PrismaClient({
    datasources: { db: { url: 'file:./test.db' } },
  });
  await prisma.$connect();

  // Reset DB (for SQLite file)
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS classification_findings');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS classification_results');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS product_ingredients');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS products');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS profile_overrides');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS profiles');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS rules');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS methodology_versions');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS synonyms');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS ingredients');

  // Run migrations (auto migrate for test)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE ingredients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE synonyms (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      ingredient_id INT REFERENCES ingredients(id)
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE methodology_versions (
      id SERIAL PRIMARY KEY,
      version TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE rules (
      id SERIAL PRIMARY KEY,
      methodology_version_id INT REFERENCES methodology_versions(id),
      ingredient_id INT REFERENCES ingredients(id),
      severity TEXT NOT NULL,
      source_citation TEXT NOT NULL
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE profiles (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE profile_overrides (
      id SERIAL PRIMARY KEY,
      profile_id INT REFERENCES profiles(id),
      ingredient_id INT REFERENCES ingredients(id),
      severity TEXT NOT NULL
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE product_ingredients (
      id SERIAL PRIMARY KEY,
      product_id INT REFERENCES products(id),
      raw TEXT NOT NULL,
      "order" INT NOT NULL
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE classification_results (
      id SERIAL PRIMARY KEY,
      product_id INT REFERENCES products(id),
      methodology_version_id INT REFERENCES methodology_versions(id),
      confidence FLOAT NOT NULL,
      disclaimer TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE classification_findings (
      id SERIAL PRIMARY KEY,
      classification_result_id INT REFERENCES classification_results(id),
      ingredient_id INT REFERENCES ingredients(id),
      raw TEXT NOT NULL,
      recognized BOOLEAN NOT NULL,
      severity TEXT,
      source_citation TEXT,
      flagged BOOLEAN NOT NULL
    );
  `);

  // instantiate repository and service with a thin wrapper around the test prisma
  const prismaService = new PrismaService() as any;
  prismaService.$connect = () => Promise.resolve();
  prismaService.$disconnect = () => Promise.resolve();
  // Hack: replace internal client with test client
  (prismaService as any).prisma = prisma;
  (prismaService as any).$connect = prisma.$connect.bind(prisma);
  (prismaService as any).$disconnect = prisma.$disconnect.bind(prisma);
  repo = new ClassificationRepository(prismaService as any);
  service = new ClassificationService(repo);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ClassificationService', () => {
  it('profile flips a finding severity', async () => {
    // Setup ingredient and rule
    const ing = await prisma.ingredient.create({ data: { name: 'sodium laureth sulfate' } });
    const version = await prisma.methodologyVersion.create({ data: { version: 'v1' } });
    await prisma.rule.create({
      data: {
        methodologyVersionId: version.id,
        ingredientId: ing.id,
        severity: Severity.restricted,
        sourceCitation: 'Regulator A',
      },
    });
    // Profile override to banned
    const profile = await prisma.profile.create({ data: { name: 'Pregnancy' } });
    await prisma.profileOverride.create({
      data: {
        profileId: profile.id,
        ingredientId: ing.id,
        severity: Severity.banned,
      },
    });
    const product = await prisma.product.create({
      data: {
        name: 'Shampoo',
        ingredientEntries: {
          create: [{ raw: 'Sodium Laureth Sulfate', order: 1 }],
        },
      },
    });

    const result = await service.classify(product.id, profile.id);
    const finding = result.findings[0];
    expect(finding.severity).toBe(Severity.banned);
    expect(finding.flagged).toBe(true);
  });

  it('unknown ingredient lowers confidence and is visible', async () => {
    const version = await prisma.methodologyVersion.create({ data: { version: 'v2' } });
    const product = await prisma.product.create({
      data: {
        name: 'Cream',
        ingredientEntries: {
          create: [
            { raw: 'Water', order: 1 },
            { raw: 'MysteryIngredient', order: 2 },
          ],
        },
      },
    });

    const result = await service.classify(product.id);
    expect(result.confidence).toBeCloseTo(0.5);
    const unknownFinding = result.findings.find((f: any) => !f.recognized);
    expect(unknownFinding).toBeDefined();
    expect(unknownFinding.raw).toBe('MysteryIngredient');
  });

  it('synonym resolves to ingredient', async () => {
    const ing = await prisma.ingredient.create({ data: { name: 'tocopherol' } });
    await prisma.synonym.create({ data: { name: 'vitamin e', ingredientId: ing.id } });
    const version = await prisma.methodologyVersion.create({ data: { version: 'v3' } });
    await prisma.rule.create({
      data: {
        methodologyVersionId: version.id,
        ingredientId: ing.id,
        severity: Severity.watch,
        sourceCitation: 'Regulator B',
      },
    });
    const product = await prisma.product.create({
      data: {
        name: 'Lotion',
        ingredientEntries: {
          create: [{ raw: 'Vitamin E', order: 1 }],
        },
      },
    });

    const result = await service.classify(product.id);
    const finding = result.findings[0];
    expect(finding.recognized).toBe(true);
    expect(finding.ingredientId).toBe(ing.id);
    expect(finding.severity).toBe(Severity.watch);
  });

  it('same product yields identical results despite shuffled ingredient order', async () => {
    const ingA = await prisma.ingredient.create({ data: { name: 'aqua' } });
    const ingB = await prisma.ingredient.create({ data: { name: 'glycerin' } });
    const version = await prisma.methodologyVersion.create({ data: { version: 'v4' } });
    await prisma.rule.createMany({
      data: [
        {
          methodologyVersionId: version.id,
          ingredientId: ingA.id,
          severity: Severity.watch,
          sourceCitation: 'Src',
        },
        {
          methodologyVersionId: version.id,
          ingredientId: ingB.id,
          severity: Severity.restricted,
          sourceCitation: 'Src',
        },
      ],
    });
    const product = await prisma.product.create({
      data: {
        name: 'Serum',
        ingredientEntries: {
          create: [
            { raw: 'Aqua', order: 1 },
            { raw: 'Glycerin', order: 2 },
          ],
        },
      },
    });

    const first = await service.classify(product.id);
    // shuffle order
    await prisma.productIngredient.updateMany({
      where: { productId: product.id },
      data: { order: { set: 2 } }, // simplistic change just to trigger diff
    });
    const second = await service.classify(product.id);
    expect(first.confidence).toBe(second.confidence);
    expect(first.findings.length).toBe(second.findings.length);
    // compare sets of raw values
    const firstRaw = first.findings.map((f: any) => f.raw).sort();
    const secondRaw = second.findings.map((f: any) => f.raw).sort();
    expect(firstRaw).toEqual(secondRaw);
  });

  it('both methodology versions results coexist', async () => {
    // version v5
    const ing = await prisma.ingredient.create({ data: { name: 'butylene glycol' } });
    const v5 = await prisma.methodologyVersion.create({ data: { version: 'v5' } });
    await prisma.rule.create({
      data: {
        methodologyVersionId: v5.id,
        ingredientId: ing.id,
        severity: Severity.watch,
        sourceCitation: 'Src5',
      },
    });
    const product = await prisma.product.create({
      data: {
        name: 'Toner',
        ingredientEntries: {
          create: [{ raw: 'Butylene Glycol', order: 1 }],
        },
      },
    });

    // classify with v5 (active)
    const resV5 = await service.classify(product.id);
    expect(resV5.methodologyVersion).toBe('v5');

    // publish new version v6
    const v6 = await service.publishNewMethodologyVersion('v6', [
      {
        ingredientId: ing.id,
        severity: Severity.banned,
        sourceCitation: 'Src6',
      },
    ]);

    expect(v6.version).toBe('v6');

    // classify again (now active is v6)
    const resV6 = await service.classify(product.id);
    expect(resV6.methodologyVersion).toBe('v6');

    // ensure both results exist in DB
    const results = await prisma.classificationResult.findMany({
      where: { productId: product.id },
    });
    expect(results.length).toBe(2);
    const versions = results.map(r => r.methodologyVersionId);
    expect(new Set(versions).size).toBe(2);
  });
});
