import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type Severity = 'watch' | 'restricted' | 'banned';
export type MethodologyStatus = 'draft' | 'active' | 'retired';

export interface ProductRow {
  id: string;
  name: string;
  ingredients: Array<{ position: number; raw: string }>;
}

export interface MethodologyVersionView {
  id: string;
  code: string;
  status: MethodologyStatus;
}

export interface RuleView {
  ingredientId: string;
  ingredientName: string;
  severity: Severity;
  source: string;
}

export interface ResolvedRuleInput {
  ingredientId: string;
  severity: Severity;
  source: string;
}

export interface MethodologyVersionInput {
  code: string;
  rules: ResolvedRuleInput[];
}

export interface IngredientInfo {
  id: string;
  name: string;
  synonyms: string[];
}

export interface ProfileModifierView {
  ingredientId: string;
  severity: Severity;
  source: string;
  reason?: string | null;
}

export interface ProfileView {
  id: string;
  name: string;
  modifiers: ProfileModifierView[];
}

export interface UpsertResultInput {
  productId: string;
  methodologyVersionId: string;
  payload: object;
  confidence: number;
  worstSeverity: Severity | null;
}

export interface StoredResultView {
  id: string;
  productId: string;
  methodologyVersionId: string;
  methodologyVersionCode: string;
  payload: unknown;
  confidence: number;
  worstSeverity: Severity | null;
  computedAt: string;
}

@Injectable()
export class ClassificationRepository {
  constructor(readonly prisma: PrismaService) {}

  async createProduct(name: string, rawIngredients: string[]): Promise<{ id: string; name: string }> {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({ data: { name } });
      if (rawIngredients.length > 0) {
        await tx.productIngredient.createMany({
          data: rawIngredients.map((rawName, index) => ({
            productId: product.id,
            position: index + 1,
            rawName,
          })),
        });
      }
      return { id: product.id, name: product.name };
    });
  }

  async findProductWithIngredients(id: string): Promise<ProductRow | null> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { ingredients: { orderBy: { position: 'asc' } } },
    });
    if (!product) return null;
    return {
      id: product.id,
      name: product.name,
      ingredients: product.ingredients.map((line) => ({ position: line.position, raw: line.rawName })),
    };
  }

  async listProducts(): Promise<ProductRow[]> {
    const products = await this.prisma.product.findMany({
      orderBy: { id: 'asc' },
      include: { ingredients: { orderBy: { position: 'asc' } } },
    });
    return products.map((product) => ({
      id: product.id,
      name: product.name,
      ingredients: product.ingredients.map((line) => ({ position: line.position, raw: line.rawName })),
    }));
  }

  async findActiveMethodology(): Promise<MethodologyVersionView | null> {
    const version = await this.prisma.methodologyVersion.findUnique({ where: { status: 'active' } });
    return version ? { id: version.id, code: version.code, status: version.status } : null;
  }

  async findMethodologyById(id: string): Promise<MethodologyVersionView | null> {
    const version = await this.prisma.methodologyVersion.findUnique({ where: { id } });
    return version ? { id: version.id, code: version.code, status: version.status } : null;
  }

  async findMethodologyByCode(code: string): Promise<MethodologyVersionView | null> {
    const version = await this.prisma.methodologyVersion.findUnique({ where: { code } });
    return version ? { id: version.id, code: version.code, status: version.status } : null;
  }

  /**
   * Publishes a new active version: the previous active version is retired in
   * the same transaction, and the new version's rules are created. Version
   * content is never modified afterwards (immutability by construction).
   */
  async publishVersion(input: MethodologyVersionInput): Promise<MethodologyVersionView> {
    const version = await this.prisma.$transaction(async (tx) => {
      const active = await tx.methodologyVersion.findUnique({ where: { status: 'active' } });
      if (active) {
        await tx.methodologyVersion.update({ where: { id: active.id }, data: { status: 'retired' } });
      }
      return tx.methodologyVersion.create({
        data: {
          code: input.code,
          status: 'active',
          publishedAt: new Date(),
          rules: {
            create: input.rules.map((rule) => ({
              ingredientId: rule.ingredientId,
              severity: rule.severity,
              source: rule.source,
            })),
          },
        },
      });
    });
    return { id: version.id, code: version.code, status: version.status };
  }

  async findRulesByVersion(methodologyVersionId: string): Promise<RuleView[]> {
    const rules = await this.prisma.rule.findMany({
      where: { methodologyVersionId },
      include: { ingredient: { select: { name: true } } },
    });
    return rules.map((rule) => ({
      ingredientId: rule.ingredientId,
      ingredientName: rule.ingredient.name,
      severity: rule.severity,
      source: rule.source,
    }));
  }

  async findIngredients(): Promise<IngredientInfo[]> {
    const ingredients = await this.prisma.ingredient.findMany({
      orderBy: { name: 'asc' },
      include: { synonyms: { orderBy: { term: 'asc' }, select: { term: true } } },
    });
    return ingredients.map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      synonyms: ingredient.synonyms.map((synonym) => synonym.term),
    }));
  }

  async findProfileWithModifiers(id: string): Promise<ProfileView | null> {
    const profile = await this.prisma.familyProfile.findUnique({
      where: { id },
      include: { modifiers: true },
    });
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

  /** Idempotent upsert keyed by (product, methodologyVersion). */
  async upsertResult(input: UpsertResultInput): Promise<{ id: string }> {
    const result = await this.prisma.classificationResult.upsert({
      where: {
        productId_methodologyVersionId: {
          productId: input.productId,
          methodologyVersionId: input.methodologyVersionId,
        },
      },
      update: {
        payload: input.payload as Prisma.InputJsonValue,
        confidence: input.confidence,
        worstSeverity: input.worstSeverity,
        computedAt: new Date(),
      },
      create: {
        productId: input.productId,
        methodologyVersionId: input.methodologyVersionId,
        payload: input.payload as Prisma.InputJsonValue,
        confidence: input.confidence,
        worstSeverity: input.worstSeverity,
      },
    });
    return { id: result.id };
  }

  async findResultsByProduct(productId: string, methodologyVersionId?: string): Promise<StoredResultView[]> {
    const results = await this.prisma.classificationResult.findMany({
      where: { productId, ...(methodologyVersionId ? { methodologyVersionId } : {}) },
      orderBy: { computedAt: 'asc' },
      include: { methodologyVersion: { select: { code: true } } },
    });
    return results.map((result) => ({
      id: result.id,
      productId: result.productId,
      methodologyVersionId: result.methodologyVersionId,
      methodologyVersionCode: result.methodologyVersion.code,
      payload: result.payload,
      confidence: result.confidence,
      worstSeverity: result.worstSeverity,
      computedAt: result.computedAt.toISOString(),
    }));
  }
}
