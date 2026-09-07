import { describe, expect, it } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { toAppError } from '../src/common/errors.js';
import { ClassificationComputer, ClassificationService } from '../src/classifications/classification.js';
import { MethodologyRepository } from '../src/methodologies/methodology.repository.js';
import { MethodologyService } from '../src/methodologies/methodology.service.js';
import { ProductRepository } from '../src/products/product.repository.js';
import { ProfileRepository } from '../src/profiles/profile.repository.js';
import { ProfileService } from '../src/profiles/profile.service.js';
import { IngredientRepository } from '../src/ingredients/ingredient.repository.js';
import { IngredientService } from '../src/ingredients/ingredient.service.js';
import { normalizeIngredientName } from '../src/ingredients/normalize.js';

// Synonym fixtures, including common OCR typos.
const SYNONYM_FIXTURES: Array<[string, string[]]> = [
  ['aqua', []],
  ['butylene glycol', []],
  ['glycerin', ['glycerine']],
  ['limonene', ['lemonene', 'limonenee']],
  ['oxybenzone', ['oxybenzon', '0xybenzone', 'oxy-benzone']],
  ['parabens-mix', []],
];

const SOURCE = (name: string) => `Source: ${name}`;

const productOf = (rows: Array<{ productId: string; rawName: string; position: number }>) =>
  (id: string) => rows.filter((row) => row.productId === id);

const findingOf = (classification: { ingredients: Array<{ ingredient?: string; canonicalName?: string | null; rawName?: string }> }, name: string) =>
  classification.ingredients.find(
    (entry) => (entry.ingredient ?? entry.canonicalName ?? entry.rawName) === name,
  );

function buildHarness() {
  const prisma = new PrismaClient();
  const ingredientRepo = new IngredientRepository(prisma as never);
  const ingredientService = new IngredientService(ingredientRepo);
  const productRepo = new ProductRepository(prisma as never);
  const profileRepo = new ProfileRepository(prisma as never);
  const profileService = new ProfileService(profileRepo);
  const methodologyRepo = new MethodologyRepository(prisma as never);
  const methodologyService = new MethodologyService(methodologyRepo, productRepo, new ClassificationComputer());
  const classificationService = new ClassificationService(
    methodologyService,
    methodologyRepo,
    productRepo,
    profileService,
    new ClassificationComputer(),
  );
  const filter = new AllExceptionsFilter();

  async function api(call: () => Promise<unknown>): Promise<{ status: number; body: unknown }> {
    try {
      return { status: 200, body: await call() };
    } catch (err) {
      const appError = toAppError(err);
      const ctx = {
        switchToHttp: () => ({
          getResponse: () => ({
            status: (code: number) => ({ code, json: (body: unknown) => ({ code, body }) }),
            json: (body: unknown) => body,
          }),
          getRequest: () => ({}),
        }),
      } as never;
      filter.catch(err, ctx);
      const captured = (ctx as { captured?: { code: number; body: unknown } }).captured;
      throw new Error('filter did not capture a response');
    }
  }

  async function setup() {
    await prisma.classificationResult.deleteMany();
    await prisma.productIngredient.deleteMany();
    await prisma.product.deleteMany();
    await prisma.profileModifier.deleteMany();
    await prisma.profile.deleteMany();
    await prisma.rule.deleteMany();
    await prisma.methodologyVersion.deleteMany();
    await prisma.synonym.deleteMany();
    await prisma.ingredient.deleteMany();

    const ingredients = new Map<string, string>();
    for (const [name, synonyms] of SYNONYM_FIXTURES) {
      const record = await ingredientService.create(name, synonyms);
      ingredients.set(normalizeIngredientName(name), record.id);
    }
    const ingredientId = (name: string) => ingredients.get(normalizeIngredientName(name));
    if (!ingredientId) throw new Error('unreachable');

    const productRows: Array<{ productId: string; rawName: string; position: number }> = [];
    const createdProducts: Array<{ id: string; name: string }> = [];
    async function createProduct(name: string, rawNames: string[]) {
      const product = await prisma.product.create({ data: { name } });
      const productEntry: { id: string; name: string } = { id: product.id, name: product.name };
      createdProducts.push(productEntry);
      await prisma.productIngredient.createMany({
        data: rawNames.map((rawName, position) => ({
          productId: product.id,
          rawName,
          position,
        })),
      });
      for (const [rawName, position] of rawNames.entries()) {
        productRows.push({ productId: product.id, rawName, position });
      }
      return productEntry;
    }

    const productRepoSpy = {
      create: productRepo.create.bind(productRepo),
      findById: (id: string) => prisma.product.findUnique({ where: { id } }),
      findAll: () => prisma.product.findMany().then((rows) => rows.map((row) => ({ id: row.id, name: row.name }))),
      findIngredientEntries: (productId: string) =>
        productOf(productRows)(productId)
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((row) => ({ rawName: row.rawName, position: row.position, canonicalName: null as string | null })),
      setIngredientEntries: (productId: string, rawNames: string[]) =>
        prisma.$transaction(async (tx) => {
          await tx.productIngredient.deleteMany({ where: { productId } });
          await tx.productIngredient.createMany({
            data: rawNames.map((rawName, position) => ({ productId, rawName, position })),
          });
        }),
    };

    return {
      prisma,
      ingredients,
      createProduct,
      createdProducts,
      services: {
        ingredientService,
        profileService,
        methodologyService: new MethodologyService(methodologyRepo, productRepoSpy as never, new ClassificationComputer()),
        classificationService: new ClassificationService(
          new MethodologyService(methodologyRepo, productRepoSpy as never, new ClassificationComputer()),
          methodologyRepo,
          productRepoSpy as never,
          profileService,
          new ClassificationComputer(),
        ),
        filter,
      },
    };
  }

  return { setup, api };
}

const harness = buildHarness();

async function withHarness(fn: (ctx: Awaited<ReturnType<typeof harness.setup>>) => Promise<void>) {
  const ctx = await harness.setup();
  try {
    await fn(ctx);
  } finally {
    await ctx.prisma.$disconnect();
  }
}

describe('classification', () => {
  it('classifies a product with the active methodology', async () => {
    await withHarness(async (ctx) => {
      const sunCare = await ctx.createProduct('Sun Care SPF30', ['Aqua', 'Butylene Glycol', 'OXYBENZONE']);
      const v1 = await ctx.services.methodologyService.create({
        version: '2024.06',
        rules: [
          { ingredientId: ctx.ingredients.get('oxybenzone')!, severity: 'restricted', flag: 'uv-filter-restricted', source: SOURCE('EU 1223/2009 Annex VI') },
          { ingredientId: ctx.ingredients.get('limonene')!, severity: 'watch', flag: 'fragrance-allergen', source: SOURCE('EU 1223/2009 Annex III') },
        ],
      });
      await ctx.services.methodologyService.publish(v1.id);

      const res = await ctx.services.classificationService.classify(sunCare.id);
      expect(res.methodologyVersion).toBe('2024.06');
      expect(res.ingredients.map((entry) => entry.canonicalName).sort()).toEqual(['aqua', 'butylene glycol', 'oxybenzone']);
      const oxy = findingOf(res as never, 'oxybenzone');
      expect(oxy?.status).toBe('flagged');
      expect(oxy?.severity).toBe('restricted');
      expect(typeof oxy?.source).toBe('string');
      expect(res.confidence).toBe(1);
      expect(res.disclaimer).toBeTruthy();
    });
  });

  it('lets a profile flip a finding for the same product', async () => {
    await withHarness(async (ctx) => {
      const sunCare = await ctx.createProduct('Sun Care SPF30', ['Aqua', 'OXYBENZONE']);
      const v1 = await ctx.services.methodologyService.create({
        version: '2024.06',
        rules: [
          { ingredientId: ctx.ingredients.get('oxybenzone')!, severity: 'watch', flag: 'uv-filter-watch', source: SOURCE('watch list') },
        ],
      });
      await ctx.services.methodologyService.publish(v1.id);

      await ctx.services.profileService.create('pregnancy', [
        { ingredientId: ctx.ingredients.get('oxybenzone')!, severity: 'banned', flag: 'avoid-during-pregnancy', source: SOURCE('pregnancy guidance') },
      ]);
      // No profile: watch. With the pregnancy profile: banned. The profile
      // modifier takes precedence over the base rule.
      const base = await ctx.services.classificationService.classify(sunCare.id);
      const withProfile = await ctx.services.classificationService.classify(sunCare.id, 'pregnancy');
      expect(findingOf(base as never, 'oxybenzone')?.severity).toBe('watch');
      expect(findingOf(withProfile as never, 'oxybenzone')?.severity).toBe('banned');
      expect(findingOf(withProfile as never, 'oxybenzone')?.source).toContain('pregnancy');
    });
  });

  it('lists unknown ingredients and lowers confidence', async () => {
    await withHarness(async (ctx) => {
      const serum = await ctx.createProduct('Mystery Serum', ['Aqua', 'Unlisted Molecule']);
      const v1 = await ctx.services.methodologyService.create({ version: '2024.06', rules: [] });
      await ctx.services.methodologyService.publish(v1.id);

      const res = await ctx.services.classificationService.classify(serum.id);
      const unknown = findingOf(res as never, 'unlisted molecule');
      expect(unknown?.status).toBe('unknown');
      expect(res.confidence).toBe(0.5);
      expect(res.confidence).toBeLessThan(1);
    });
  });

  it('resolves synonyms, accents, case and OCR typos', async () => {
    await withHarness(async (ctx) => {
      const product = await ctx.createProduct('Shampoo', ['Glycérine', '0xybenzone', 'LEMONENE', 'oxy-benzone']);
      const v1 = await ctx.services.methodologyService.create({
        version: '2024.06',
        rules: [
          { ingredientId: ctx.ingredients.get('oxybenzone')!, severity: 'restricted', flag: 'uv-filter-restricted', source: SOURCE('EU 1223/2009 Annex VI') },
          { ingredientId: ctx.ingredients.get('limonene')!, severity: 'watch', flag: 'fragrance-allergen', source: SOURCE('EU 1223/2009 Annex III') },
        ],
      });
      await ctx.services.methodologyService.publish(v1.id);

      const res = await ctx.services.classificationService.classify(product.id);
      expect(res.confidence).toBe(1);
      const names = res.ingredients.map((entry) => entry.canonicalName).sort();
      expect(names).toEqual(['glycerin', 'limonene', 'oxybenzone', 'oxybenzone']);
      expect(findingOf(res as never, 'glycerin')?.matchedBy).toBe('synonym');
      expect(findingOf(res as never, 'limonene')?.matchedBy).toBe('synonym');
      expect(res.ingredients.filter((entry) => entry.status === 'flagged')).toHaveLength(3);
    });
  });

  it('is identical across reruns and across shuffled ingredient order', async () => {
    await withHarness(async (ctx) => {
      const ordered = await ctx.createProduct('Order A', ['Aqua', 'OXYBENZONE', 'Glycérine']);
      const shuffled = await ctx.createProduct('Order B', ['Glycérine', 'aqua', '0xybenzone']);
      const v1 = await ctx.services.methodologyService.create({
        version: '2024.06',
        rules: [
          { ingredientId: ctx.ingredients.get('oxybenzone')!, severity: 'restricted', flag: 'uv-filter-restricted', source: SOURCE('EU 1223/2009 Annex VI') },
        ],
      });
      await ctx.services.methodologyService.publish(v1.id);

      const first = await ctx.services.classificationService.classify(ordered.id);
      const rerun = await ctx.services.classificationService.classify(ordered.id);
      expect(rerun).toEqual(first);

      const other = await ctx.services.classificationService.classify(shuffled.id);
      expect(other).toEqual(first);
    });
  });

  it('keeps both versions\' results coexisting', async () => {
    await withHarness(async (ctx) => {
      const sunCare = await ctx.createProduct('Sun Care SPF30', ['Aqua', 'OXYBENZONE']);
      const v1 = await ctx.services.methodologyService.create({
        version: '2024.06',
        rules: [
          { ingredientId: ctx.ingredients.get('oxybenzone')!, severity: 'watch', flag: 'uv-filter-watch', source: SOURCE('watch list') },
        ],
      });
      await ctx.services.methodologyService.publish(v1.id);

      const v2 = await ctx.services.methodologyService.create({
        version: '2024.12',
        rules: [
          { ingredientId: ctx.ingredients.get('oxybenzone')!, severity: 'banned', flag: 'uv-filter-banned', source: SOURCE('EU 1223/2009 Annex II') },
        ],
      });
      await ctx.services.methodologyService.publish(v2.id);

      const old = await ctx.services.classificationService.retrieve(sunCare.id, '2024.06');
      const current = await ctx.services.classificationService.retrieve(sunCare.id, '2024.12');
      expect(old.methodologyVersion).toBe('2024.06');
      expect(current.methodologyVersion).toBe('2024.12');
      expect(findingOf(old as never, 'oxybenzone')?.severity).toBe('watch');
      expect(findingOf(current as never, 'oxybenzone')?.severity).toBe('banned');
      expect(findingOf(await ctx.services.classificationService.classify(sunCare.id) as never, 'oxybenzone')?.severity).toBe('banned');
    });
  });

  it('re-scoring on publish is idempotent', async () => {
    await withHarness(async (ctx) => {
      const sunCare = await ctx.createProduct('Sun Care SPF30', ['Aqua', 'OXYBENZONE']);
      const v1 = await ctx.services.methodologyService.create({
        version: '2024.06',
        rules: [
          { ingredientId: ctx.ingredients.get('oxybenzone')!, severity: 'watch', flag: 'uv-filter-watch', source: SOURCE('watch list') },
        ],
      });
      await ctx.services.methodologyService.publish(v1.id);
      const afterFirst = await ctx.services.classificationService.retrieve(sunCare.id, '2024.06');

      // Re-publishing the active version re-runs the same scoring.
      await ctx.services.methodologyService.publish(v1.id);
      const afterSecond = await ctx.services.classificationService.retrieve(sunCare.id, '2024.06');
      expect(afterSecond).toEqual(afterFirst);
      const count = await ctx.prisma.classificationResult.count({ where: { productId: sunCare.id } });
      expect(count).toBe(1);
    });
  });
});
