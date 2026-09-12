import type { PrismaService } from '../src/prisma/prisma.service.js';
import { BadRequestError, MethodologyVersionExistsError } from '../src/common/api-error.filter.js';
import type {
  IngredientInfo,
  MethodologyStatus,
  MethodologyVersionInput,
  MethodologyVersionView,
  ProfileView,
  ProductRow,
  RuleView,
  Severity,
  StoredResultView,
} from '../src/classification/classification.repository.js';

export interface SeededIngredient {
  id: string;
  name: string;
  synonyms: string[];
}

export interface SeededRule {
  ingredientId: string;
  severity: Severity;
  source: string;
}

export interface SeededVersion {
  id: string;
  code: string;
  status: MethodologyStatus;
  rules: SeededRule[];
}

export interface SeededModifier {
  profileId: string;
  ingredientId: string;
  severity: Severity;
  source: string;
  reason?: string;
}

export interface SeededProfile {
  id: string;
  name: string;
  modifiers: SeededModifier[];
}

export interface SeededProduct {
  id: string;
  name: string;
  ingredients: string[];
}

export interface SeedData {
  ingredients: SeededIngredient[];
  versions: SeededVersion[];
  profiles: SeededProfile[];
  products: SeededProduct[];
}

interface StoredResult {
  id: string;
  productId: string;
  methodologyVersionId: string;
  payload: unknown;
  confidence: number;
  worstSeverity: Severity | null;
  computedAt: string;
}

/**
 * In-memory stand-in for ClassificationRepository. Same public contract, no
 * database: keeps the tests deterministic and offline.
 */
export class FakeClassificationRepository {
  // Part of the structural contract; never dereferenced.
  readonly prisma = undefined as unknown as PrismaService;

  private readonly ingredients: SeededIngredient[];
  private readonly versions: SeededVersion[];
  private readonly profiles: SeededProfile[];
  private readonly products: Map<string, ProductRow>;
  private readonly results: Map<string, StoredResult> = new Map();
  private sequence = 0;

  constructor(seed: SeedData) {
    this.ingredients = seed.ingredients.map((ingredient) => ({ ...ingredient, synonyms: [...ingredient.synonyms] }));
    this.versions = seed.versions.map((version) => ({ ...version, rules: version.rules.map((rule) => ({ ...rule })) }));
    this.profiles = seed.profiles.map((profile) => ({
      ...profile,
      modifiers: profile.modifiers.map((modifier) => ({ ...modifier })),
    }));
    this.products = new Map<string, ProductRow>(
      seed.products.map((product) => [
        product.id,
        {
          id: product.id,
          name: product.name,
          ingredients: product.ingredients.map((raw, index) => ({ position: index + 1, raw })),
        },
      ]),
    );
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async createProduct(name: string, rawIngredients: string[]): Promise<{ id: string; name: string }> {
    const id = this.nextId('product');
    this.products.set(id, {
      id,
      name,
      ingredients: rawIngredients.map((raw, index) => ({ position: index + 1, raw })),
    });
    return { id, name };
  }

  async findProductWithIngredients(id: string): Promise<ProductRow | null> {
    const product = this.products.get(id);
    return product ? cloneRow(product) : null;
  }

  async listProducts(): Promise<ProductRow[]> {
    return [...this.products.values()].map(cloneRow);
  }

  async findActiveMethodology(): Promise<MethodologyVersionView | null> {
    const version = this.versions.find((candidate) => candidate.status === 'active');
    return version ? toView(version) : null;
  }

  async findMethodologyById(id: string): Promise<MethodologyVersionView | null> {
    const version = this.versions.find((candidate) => candidate.id === id);
    return version ? toView(version) : null;
  }

  async findMethodologyByCode(code: string): Promise<MethodologyVersionView | null> {
    const version = this.versions.find((candidate) => candidate.code === code);
    return version ? toView(version) : null;
  }

  async publishVersion(input: MethodologyVersionInput): Promise<MethodologyVersionView> {
    if (this.versions.some((version) => version.code === input.code)) {
      throw new MethodologyVersionExistsError(input.code);
    }
    const unknown = input.rules.filter((rule) => !this.ingredients.some((ingredient) => ingredient.id === rule.ingredientId));
    if (unknown.length > 0) {
      throw new BadRequestError('unknown_ingredient_in_rule', 'Rule references an unknown ingredient.', {
        ingredient_ids: unknown.map((rule) => rule.ingredientId),
      });
    }
    for (const version of this.versions) {
      if (version.status === 'active') version.status = 'retired';
    }
    const version: SeededVersion = {
      id: this.nextId('version'),
      code: input.code,
      status: 'active',
      rules: input.rules.map((rule) => ({ ...rule })),
    };
    this.versions.push(version);
    return toView(version);
  }

  async findRulesByVersion(methodologyVersionId: string): Promise<RuleView[]> {
    const version = this.versions.find((candidate) => candidate.id === methodologyVersionId);
    if (!version) return [];
    return version.rules.map((rule) => ({
      ingredientId: rule.ingredientId,
      ingredientName: this.ingredients.find((ingredient) => ingredient.id === rule.ingredientId)?.name ?? '',
      severity: rule.severity,
      source: rule.source,
    }));
  }

  async findIngredients(): Promise<IngredientInfo[]> {
    return this.ingredients.map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      synonyms: [...ingredient.synonyms],
    }));
  }

  async findProfileWithModifiers(id: string): Promise<ProfileView | null> {
    const profile = this.profiles.find((candidate) => candidate.id === id);
    if (!profile) return null;
    return {
      id: profile.id,
      name: profile.name,
      modifiers: profile.modifiers.map((modifier) => ({
        ingredientId: modifier.ingredientId,
        severity: modifier.severity,
        source: modifier.source,
        reason: modifier.reason,
      })),
    };
  }

  async upsertResult(input: {
    productId: string;
    methodologyVersionId: string;
    payload: object;
    confidence: number;
    worstSeverity: Severity | null;
  }): Promise<{ id: string }> {
    const key = `${input.productId}:${input.methodologyVersionId}`;
    const existing = this.results.get(key);
    const now = new Date().toISOString();
    if (existing) {
      existing.payload = input.payload;
      existing.confidence = input.confidence;
      existing.worstSeverity = input.worstSeverity;
      existing.computedAt = now;
      return { id: existing.id };
    }
    const row: StoredResult = {
      id: this.nextId('result'),
      productId: input.productId,
      methodologyVersionId: input.methodologyVersionId,
      payload: input.payload,
      confidence: input.confidence,
      worstSeverity: input.worstSeverity,
      computedAt: now,
    };
    this.results.set(key, row);
    return { id: row.id };
  }

  async findResultsByProduct(productId: string, methodologyVersionId?: string): Promise<StoredResultView[]> {
    return [...this.results.values()]
      .filter(
        (result) =>
          result.productId === productId &&
          (!methodologyVersionId || result.methodologyVersionId === methodologyVersionId),
      )
      .map((result) => ({
        id: result.id,
        productId: result.productId,
        methodologyVersionId: result.methodologyVersionId,
        methodologyVersionCode: this.versions.find((version) => version.id === result.methodologyVersionId)?.code ?? '',
        payload: result.payload,
        confidence: result.confidence,
        worstSeverity: result.worstSeverity,
        computedAt: result.computedAt,
      }));
  }
}

function toView(version: SeededVersion): MethodologyVersionView {
  return { id: version.id, code: version.code, status: version.status };
}

function cloneRow(product: ProductRow): ProductRow {
  return {
    ...product,
    ingredients: [...product.ingredients].sort((a, b) => a.position - b.position).map((line) => ({ ...line })),
  };
}
