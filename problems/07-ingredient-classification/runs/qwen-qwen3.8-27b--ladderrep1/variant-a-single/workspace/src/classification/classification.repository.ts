import { Injectable } from '@nestjs/common';
import { Prisma, RuleKind, RuleSeverity, VersionStatus } from '@prisma/client';
import type {
  ClassificationResult,
  Ingredient,
  MethodologyVersion,
  Product,
  ProductIngredient,
  Profile,
  Rule,
  Synonym,
} from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { Errors } from '../common/api-error.js';
import { normalizeInci } from './inci-normalizer.js';

export interface ResolutionEntry {
  ingredientId: string;
  canonicalName: string;
  matchedVia: 'canonical' | 'synonym';
}

export type ProductWithIngredients = Product & { ingredients: ProductIngredient[] };
export type RuleWithIngredient = Rule & { ingredient: { name: string } };

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------- methodology versions

  async findActiveVersion(): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findFirst({
      where: { status: VersionStatus.PUBLISHED },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findVersion(idOrSlug: string): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    });
  }

  async listVersions(): Promise<MethodologyVersion[]> {
    return this.prisma.methodologyVersion.findMany({
      orderBy: [{ createdAt: 'asc' }, { slug: 'asc' }],
    });
  }

  async createVersion(slug: string, name: string): Promise<MethodologyVersion> {
    return this.prisma.methodologyVersion.upsert({
      where: { slug },
      update: {},
      create: { slug, name },
    });
  }

  async markVersionPublished(id: string): Promise<MethodologyVersion> {
    return this.prisma.methodologyVersion.update({
      where: { id },
      data: { status: VersionStatus.PUBLISHED, publishedAt: new Date() },
    });
  }

  // ------------------------------------------------- rules

  async findRulesByVersion(versionId: string): Promise<RuleWithIngredient[]> {
    return this.prisma.rule.findMany({
      where: { versionId },
      include: { ingredient: { select: { name: true } } },
      orderBy: [{ ingredientId: 'asc' }, { kind: 'asc' }, { context: 'asc' }],
    });
  }

  async findRuleByKeys(
    versionId: string,
    ingredientName: string,
    kind: RuleKind,
    context: string,
  ): Promise<Rule | null> {
    const ingredient = await this.prisma.ingredient.findUnique({
      where: { name: ingredientName },
      select: { id: true },
    });
    if (!ingredient) {
      return null;
    }
    return this.prisma.rule.findUnique({
      where: {
        versionId_ingredientId_kind_context: {
          versionId,
          ingredientId: ingredient.id,
          kind,
          context,
        },
      },
    });
  }

  async upsertRule(
    versionId: string,
    ingredientName: string,
    severity: string,
    source: string,
    kind: RuleKind,
    context: string,
  ): Promise<Rule> {
    const ingredient = await this.upsertIngredient(ingredientName);
    const prismaSeverity = severity as RuleSeverity;
    return this.prisma.rule.upsert({
      where: {
        versionId_ingredientId_kind_context: {
          versionId,
          ingredientId: ingredient.id,
          kind,
          context,
        },
      },
      update: { severity: prismaSeverity, source },
      create: {
        versionId,
        ingredientId: ingredient.id,
        kind,
        context,
        severity: prismaSeverity,
        source,
      },
    });
  }

  // ------------------------------------------------- ingredients & synonyms

  async upsertIngredient(name: string): Promise<Ingredient> {
    const normalized = normalizeInci(name);
    return this.prisma.ingredient.upsert({
      where: { normalized },
      update: {},
      create: { name, normalized },
    });
  }

  async upsertSynonym(ingredientId: string, text: string): Promise<Synonym> {
    const normalized = normalizeInci(text);
    return this.prisma.synonym.upsert({
      where: { normalized },
      update: {},
      create: { text, normalized, ingredientId },
    });
  }

  /**
   * Lookup table: normalized alias -> canonical ingredient. Canonical names
   * win over synonyms when both would match the same key.
   */
  async findResolutionMap(): Promise<Map<string, ResolutionEntry>> {
    const [ingredients, synonyms] = await Promise.all([
      this.prisma.ingredient.findMany({ select: { id: true, name: true, normalized: true } }),
      this.prisma.synonym.findMany({
        select: {
          ingredientId: true,
          normalized: true,
          ingredient: { select: { name: true } },
        },
      }),
    ]);
    const map = new Map<string, ResolutionEntry>();
    for (const ingredient of ingredients) {
      map.set(ingredient.normalized, {
        ingredientId: ingredient.id,
        canonicalName: ingredient.name,
        matchedVia: 'canonical',
      });
    }
    for (const synonym of synonyms) {
      if (!map.has(synonym.normalized)) {
        map.set(synonym.normalized, {
          ingredientId: synonym.ingredientId,
          canonicalName: synonym.ingredient.name,
          matchedVia: 'synonym',
        });
      }
    }
    return map;
  }

  // ------------------------------------------------- products

  async createProduct(name: string, brand: string | null, ingredients: string[]): Promise<Product> {
    return this.prisma.product.create({
      data: {
        name,
        brand,
        ingredients: {
          create: ingredients.map((raw, position) => ({ raw, position })),
        },
      },
    });
  }

  async findProduct(id: string): Promise<ProductWithIngredients | null> {
    return this.prisma.product.findUnique({
      where: { id },
      include: { ingredients: { orderBy: { position: 'asc' } } },
    });
  }

  async listProducts(): Promise<ProductWithIngredients[]> {
    return this.prisma.product.findMany({
      include: { ingredients: { orderBy: { position: 'asc' } } },
    });
  }

  async reorderProductIngredients(productId: string, orderedRaws: string[]): Promise<void> {
    const rows = await this.prisma.productIngredient.findMany({ where: { productId } });
    const idByRaw = new Map<string, string>();
    for (const row of rows) {
      idByRaw.set(row.raw, row.id);
    }
    const updates = orderedRaws.map((raw, position) => {
      const id = idByRaw.get(raw);
      if (!id) {
        throw Errors.invalidInput(`Ingredient '${raw}' is not part of the product.`, { raw });
      }
      return this.prisma.productIngredient.update({ where: { id }, data: { position } });
    });
    await this.prisma.$transaction(updates);
  }

  // ------------------------------------------------- profiles

  async createProfile(name: string, contexts: string[]): Promise<Profile> {
    return this.prisma.profile.create({ data: { name, contexts } });
  }

  async findProfile(id: string): Promise<Profile | null> {
    return this.prisma.profile.findUnique({ where: { id } });
  }

  // ------------------------------------------------- stored results

  async upsertResult(productId: string, versionId: string, payload: object): Promise<ClassificationResult> {
    const json = payload as Prisma.InputJsonValue;
    return this.prisma.classificationResult.upsert({
      where: { productId_versionId: { productId, versionId } },
      update: { payload: json },
      create: { productId, versionId, payload: json },
    });
  }

  async findResult(productId: string, versionId: string): Promise<ClassificationResult | null> {
    return this.prisma.classificationResult.findUnique({
      where: { productId_versionId: { productId, versionId } },
    });
  }

  async countResults(versionId: string): Promise<number> {
    return this.prisma.classificationResult.count({ where: { versionId } });
  }
}
