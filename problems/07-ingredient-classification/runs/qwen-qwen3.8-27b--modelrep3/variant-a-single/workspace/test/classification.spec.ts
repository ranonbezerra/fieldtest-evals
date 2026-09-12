import { describe, expect, it } from 'vitest';
import { ClassificationService } from '../src/classification/classification.service.js';
import { ClassificationRepository } from '../src/classification/classification.repository.js';
import { IngredientRepository } from '../src/ingredient/ingredient.repository.js';
import { MethodologyRepository } from '../src/methodology/methodology.repository.js';
import { ProductRepository } from '../src/product/product.repository.js';
import { ProfileRepository } from '../src/profile/profile.repository.js';
import { AppException } from '../src/common/app.exception.js';

interface Ingredient {
  id: string;
  name: string;
  normalized: string;
}

interface Synonym {
  normalizedSynonym: string;
  ingredientId: string;
}

interface ProductIngredient {
  rawIngredient: string;
  position: number;
}

interface Product {
  id: string;
  name: string;
  ingredients: ProductIngredient[];
}

interface Rule {
  id: string;
  methodologyVersionId: string;
  ingredientId: string;
  ingredient: Ingredient;
  severity: 'BANNED' | 'RESTRICTED' | 'WATCH';
  sourceCitation: string;
}

interface Version {
  id: string;
  version: number;
  active: boolean;
  rules: Rule[];
}

interface Profile {
  id: string;
  name: string;
  context: string;
}

interface Modifier {
  id: string;
  profileId: string;
  ingredientId: string;
  ingredient: Ingredient;
  severity: 'BANNED' | 'RESTRICTED' | 'WATCH';
  sourceCitation: string;
}

function createIngredientRepository(ingredients: Ingredient[], synonyms: Synonym[] = []) {
  const byName = new Map(ingredients.map((item) => [item.normalized, item]));
  const bySynonym = new Map(
    synonyms.map((item) => [item.normalizedSynonym, byName.get(item.ingredientId) ?? null]),
  );

  return {
    findByNormalizedName: async (normalized: string) => byName.get(normalized) ?? null,
    findByNormalizedSynonym: async (normalized: string) => bySynonym.get(normalized) ?? null,
  };
}

function createProductRepository(product: Product, options: { reverseAfterFirstCall?: boolean } = {}) {
  let calls = 0;

  return {
    findById: async (id: string) => {
      calls += 1;
      if (id !== product.id) {
        return null;
      }

      const shouldReverse = options.reverseAfterFirstCall === true && calls === 2;
      return {
        ...product,
        ingredients: shouldReverse ? [...product.ingredients].reverse() : product.ingredients,
      };
    },
    findAllWithIngredients: async () => (product.ingredients.length > 0 ? [product] : []),
  };
}

function createMethodologyRepository(versions: Version[]) {
  let activeId = versions.find((version) => version.active)?.id ?? null;

  return {
    findActive: async () => versions.find((version) => version.id === activeId) ?? null,
    findById: async (id: string) => versions.find((version) => version.id === id) ?? null,
    activate: async (id: string) => {
      activeId = id;
    },
  };
}

function createProfileRepository(profiles: Profile[], modifiers: Modifier[]) {
  return {
    findById: async (id: string) => profiles.find((profile) => profile.id === id) ?? null,
    findAll: async () => profiles,
    findModifiers: async (profileId: string) =>
      modifiers.filter((modifier) => modifier.profileId === profileId),
  };
}

function createClassificationRepository() {
  const store = new Map<string, { payload: unknown }>();

  const key = (
    productId: string,
    methodologyVersionId: string,
    profileId: string | null | undefined,
  ) => `${productId}:${methodologyVersionId}:${profileId ?? ''}`;

  return {
    upsert: async (input: {
      productId: string;
      methodologyVersionId: string;
      profileId: string | null;
      payload: unknown;
    }) => {
      store.set(key(input.productId, input.methodologyVersionId, input.profileId), {
        payload: input.payload,
      });
    },
    findByProductAndVersion: async (
      productId: string,
      methodologyVersionId: string,
      profileId: string | null | undefined,
    ) => store.get(key(productId, methodologyVersionId, profileId)) ?? null,
  };
}

function buildService(params: {
  ingredients: Ingredient[];
  synonyms?: Synonym[];
  product: Product;
  versions: Version[];
  profiles?: Profile[];
  modifiers?: Modifier[];
  reverseAfterFirstCall?: boolean;
}) {
  const ingredientRepository = createIngredientRepository(
    params.ingredients,
    params.synonyms ?? [],
  ) as unknown as IngredientRepository;

  const productRepository = createProductRepository(params.product, {
    reverseAfterFirstCall: params.reverseAfterFirstCall,
  }) as unknown as ProductRepository;

  const methodologyRepository = createMethodologyRepository(
    params.versions,
  ) as unknown as MethodologyRepository;

  const profileRepository = createProfileRepository(
    params.profiles ?? [],
    params.modifiers ?? [],
  ) as unknown as ProfileRepository;

  const classificationRepository =
    createClassificationRepository() as unknown as ClassificationRepository;

  return new ClassificationService(
    ingredientRepository,
    productRepository,
    methodologyRepository,
    profileRepository,
    classificationRepository,
  );
}

describe('classification', () => {
  it('flips a finding when a family profile modifier is applied', async () => {
    const limonene: Ingredient = { id: 'i-limonene', name: 'Limonene', normalized: 'limonene' };

    const service = buildService({
      ingredients: [limonene],
      product: {
        id: 'product-1',
        name: 'Shampoo',
        ingredients: [{ rawIngredient: 'Limonene', position: 0 }],
      },
      versions: [
        {
          id: 'v1',
          version: 1,
          active: true,
          rules: [
            {
              id: 'r1',
              methodologyVersionId: 'v1',
              ingredientId: 'i-limonene',
              ingredient: limonene,
              severity: 'WATCH',
              sourceCitation: 'base-citation',
            },
          ],
        },
      ],
      profiles: [{ id: 'child', name: 'Child under 3', context: 'child_under_3' }],
      modifiers: [
        {
          id: 'm1',
          profileId: 'child',
          ingredientId: 'i-limonene',
          ingredient: limonene,
          severity: 'BANNED',
          sourceCitation: 'child-citation',
        },
      ],
    });

    const withoutProfile = await service.classify('product-1');
    expect(withoutProfile.findings[0]).toMatchObject({
      ingredient: 'Limonene',
      flagged: true,
      severity: 'watch',
      appliedBy: 'base',
      sourceCitation: 'base-citation',
    });

    const withProfile = await service.classify('product-1', 'child');
    expect(withProfile.findings[0]).toMatchObject({
      ingredient: 'Limonene',
      flagged: true,
      severity: 'banned',
      appliedBy: 'profile',
      sourceCitation: 'child-citation',
    });
  });

  it('keeps the base rule when a profile modifier would loosen it', async () => {
    const limonene: Ingredient = { id: 'i-limonene', name: 'Limonene', normalized: 'limonene' };

    const service = buildService({
      ingredients: [limonene],
      product: {
        id: 'product-1',
        name: 'Shampoo',
        ingredients: [{ rawIngredient: 'Limonene', position: 0 }],
      },
      versions: [
        {
          id: 'v1',
          version: 1,
          active: true,
          rules: [
            {
              id: 'r1',
              methodologyVersionId: 'v1',
              ingredientId: 'i-limonene',
              ingredient: limonene,
              severity: 'BANNED',
              sourceCitation: 'base-citation',
            },
          ],
        },
      ],
      profiles: [{ id: 'child', name: 'Child under 3', context: 'child_under_3' }],
      modifiers: [
        {
          id: 'm1',
          profileId: 'child',
          ingredientId: 'i-limonene',
          ingredient: limonene,
          severity: 'WATCH',
          sourceCitation: 'child-citation',
        },
      ],
    });

    const result = await service.classify('product-1', 'child');
    expect(result.findings[0]).toMatchObject({
      ingredient: 'Limonene',
      flagged: true,
      severity: 'banned',
      appliedBy: 'base',
      sourceCitation: 'base-citation',
    });
  });

  it('marks unknown ingredients and lowers confidence', async () => {
    const limonene: Ingredient = { id: 'i-limonene', name: 'Limonene', normalized: 'limonene' };

    const service = buildService({
      ingredients: [limonene],
      product: {
        id: 'product-1',
        name: 'Lotion',
        ingredients: [
          { rawIngredient: 'Limonene', position: 0 },
          { rawIngredient: 'Mystery Oil', position: 1 },
        ],
      },
      versions: [
        {
          id: 'v1',
          version: 1,
          active: true,
          rules: [],
        },
      ],
    });

    const result = await service.classify('product-1');

    expect(result.unknownIngredients).toEqual(['mystery oil']);
    expect(result.confidence).toBe(0.5);
    expect(result.findings).toHaveLength(1);
    expect(result.disclaimer).toContain('not a binary');
  });

  it('resolves synonyms and OCR typos', async () => {
    const fragrance: Ingredient = { id: 'i-fragrance', name: 'Fragrance', normalized: 'fragrance' };

    const service = buildService({
      ingredients: [fragrance],
      synonyms: [{ normalizedSynonym: 'parfum', ingredientId: 'i-fragrance' }],
      product: {
        id: 'product-1',
        name: 'Perfume',
        ingredients: [{ rawIngredient: 'Parfume', position: 0 }],
      },
      versions: [
        {
          id: 'v1',
          version: 1,
          active: true,
          rules: [
            {
              id: 'r1',
              methodologyVersionId: 'v1',
              ingredientId: 'i-fragrance',
              ingredient: fragrance,
              severity: 'WATCH',
              sourceCitation: 'fragrance-base',
            },
          ],
        },
      ],
    });

    const result = await service.classify('product-1');

    expect(result.findings[0]).toMatchObject({
      ingredient: 'Fragrance',
      resolved: true,
      flagged: true,
      severity: 'watch',
      sourceCitation: 'fragrance-base',
    });
    expect(result.unknownIngredients).toEqual([]);
  });

  it('returns identical results for reruns and shuffled ingredient order', async () => {
    const aqua: Ingredient = { id: 'i-aqua', name: 'Aqua', normalized: 'aqua' };
    const glycerin: Ingredient = { id: 'i-glycerin', name: 'Glycerin', normalized: 'glycerin' };
    const limonene: Ingredient = { id: 'i-limonene', name: 'Limonene', normalized: 'limonene' };

    const service = buildService({
      ingredients: [aqua, glycerin, limonene],
      product: {
        id: 'product-1',
        name: 'Lotion',
        ingredients: [
          { rawIngredient: 'Aqua', position: 0 },
          { rawIngredient: 'Glycerin', position: 1 },
          { rawIngredient: 'Limonene', position: 2 },
        ],
      },
      versions: [
        {
          id: 'v1',
          version: 1,
          active: true,
          rules: [],
        },
      ],
      reverseAfterFirstCall: true,
    });

    const first = await service.classify('product-1');
    const second = await service.classify('product-1');

    expect(second).toEqual(first);
  });

  it('keeps previous methodology results after publishing a new version', async () => {
    const limonene: Ingredient = { id: 'i-limonene', name: 'Limonene', normalized: 'limonene' };

    const service = buildService({
      ingredients: [limonene],
      product: {
        id: 'product-1',
        name: 'Shampoo',
        ingredients: [{ rawIngredient: 'Limonene', position: 0 }],
      },
      versions: [
        {
          id: 'v1',
          version: 1,
          active: true,
          rules: [
            {
              id: 'r1',
              methodologyVersionId: 'v1',
              ingredientId: 'i-limonene',
              ingredient: limonene,
              severity: 'WATCH',
              sourceCitation: 'base-citation-v1',
            },
          ],
        },
        {
          id: 'v2',
          version: 2,
          active: false,
          rules: [
            {
              id: 'r2',
              methodologyVersionId: 'v2',
              ingredientId: 'i-limonene',
              ingredient: limonene,
              severity: 'RESTRICTED',
              sourceCitation: 'base-citation-v2',
            },
          ],
        },
      ],
    });

    await service.classify('product-1');

    const firstPublish = await service.publishMethodologyVersion('v2');
    const secondPublish = await service.publishMethodologyVersion('v2');

    expect(secondPublish).toEqual(firstPublish);

    const v1Stored = await service.getClassification('product-1', 'v1');
    const v2Stored = await service.getClassification('product-1', 'v2');

    expect(v1Stored.methodologyVersion).toBe(1);
    expect(v1Stored.findings[0]).toMatchObject({ severity: 'watch' });

    expect(v2Stored.methodologyVersion).toBe(2);
    expect(v2Stored.findings[0]).toMatchObject({ severity: 'restricted' });
  });

  it('returns resource_not_found for missing products', async () => {
    const service = buildService({
      ingredients: [],
      product: {
        id: 'product-1',
        name: 'Product',
        ingredients: [],
      },
      versions: [
        {
          id: 'v1',
          version: 1,
          active: true,
          rules: [],
        },
      ],
    });

    const error = await service.classify('missing').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe('resource_not_found');
  });

  it('returns no_active_methodology when no version is active', async () => {
    const service = buildService({
      ingredients: [],
      product: {
        id: 'product-1',
        name: 'Product',
        ingredients: [],
      },
      versions: [],
    });

    const error = await service.classify('product-1').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe('no_active_methodology');
  });
});
