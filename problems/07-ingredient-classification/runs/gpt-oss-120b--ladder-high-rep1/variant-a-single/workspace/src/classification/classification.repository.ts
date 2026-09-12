import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Product,
  MethodologyVersion,
  Rule,
  ClassificationResult,
  Severity,
} from '@prisma/client';
import { FindingDto } from './dto/classification-result.dto';
import { normalizeIngredient } from '../utils/normalizer';

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProductWithIngredients(productId: number): Promise<
    Product & {
      product_ingredients: { ingredient_string: string }[];
    } | null
  > {
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        product_ingredients: true,
      },
    });
  }

  async findActiveMethodologyVersion(): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findFirst({
      where: { active: true },
    });
  }

  async findMethodologyVersionById(id: number): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findUnique({
      where: { id },
    });
  }

  async findMethodologyVersionByName(version: string): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findUnique({
      where: { version },
    });
  }

  /**
   * Returns a map of normalized synonym => ingredientId
   */
  async getSynonymMap(): Promise<Map<string, number>> {
    const synonyms = await this.prisma.ingredientSynonym.findMany({
      include: {
        ingredient: true,
      },
    });
    const map = new Map<string, number>();
    for (const syn of synonyms) {
      const normalized = normalizeIngredient(syn.synonym);
      map.set(normalized, syn.ingredientId);
    }
    return map;
  }

  /**
   * Returns a map of normalized canonical ingredient name => { id, name }
   */
  async getCanonicalIngredientMap(): Promise<Map<string, { id: number; name: string }>> {
    const ingredients = await this.prisma.ingredient.findMany();
    const map = new Map<string, { id: number; name: string }>();
    for (const ing of ingredients) {
      const normalized = normalizeIngredient(ing.name);
      map.set(normalized, { id: ing.id, name: ing.name });
    }
    return map;
  }

  /**
   * Returns a map of ingredientId => Rule with highest severity for the given methodology version
   */
  async getRulesMapByVersion(versionId: number): Promise<Map<number, Rule>> {
    const rules = await this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
    });
    const severityRank: { [key in Severity]: number } = {
      watch: 1,
      restricted: 2,
      banned: 3,
    };
    const map = new Map<number, Rule>();
    for (const rule of rules) {
      const existing = map.get(rule.ingredientId);
      if (!existing || severityRank[rule.severity] > severityRank[existing.severity]) {
        map.set(rule.ingredientId, rule);
      }
    }
    return map;
  }

  async upsertClassificationResult(params: {
    productId: number;
    methodologyVersionId: number;
    confidence: number;
    disclaimer: string;
    findings: FindingDto[];
  }): Promise<ClassificationResult> {
    const { productId, methodologyVersionId, confidence, disclaimer, findings } = params;
    return this.prisma.classificationResult.upsert({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId,
        },
      },
      create: {
        productId,
        methodologyVersionId,
        confidence,
        disclaimer,
        findings: findings as any,
      },
      update: {
        confidence,
        disclaimer,
        findings: findings as any,
      },
    });
  }

  async findResult(productId: number, methodologyVersionId: number): Promise<ClassificationResult | null> {
    return this.prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId,
        },
      },
    });
  }

  async findAllProductIds(): Promise<number[]> {
    const products = await this.prisma.product.findMany({
      select: { id: true },
    });
    return products.map(p => p.id);
  }
}
