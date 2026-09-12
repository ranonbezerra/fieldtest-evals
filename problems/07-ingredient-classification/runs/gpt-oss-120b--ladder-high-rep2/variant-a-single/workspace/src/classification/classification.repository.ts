import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  Ingredient,
  Synonym,
  MethodologyVersion,
  Rule,
  ProfileModifier,
  Product,
  ClassificationResult as ClassificationResultModel,
  Severity,
} from '@prisma/client';

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** --------------------------------------------------------------------- */
  /** PRODUCT */
  async getProductById(productId: string): Promise<Product | null> {
    return this.prisma.product.findUnique({ where: { id: productId } });
  }

  async getAllProductIds(): Promise<string[]> {
    const ids = await this.prisma.product.findMany({ select: { id: true } });
    return ids.map((p) => p.id);
  }

  /** --------------------------------------------------------------------- */
  /** METHODOLOGY VERSION */
  async getActiveMethodologyVersion(): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findFirst({ where: { isActive: true } });
  }

  async deactivateAllMethodologyVersions(): Promise<void> {
    await this.prisma.methodologyVersion.updateMany({ where: {}, data: { isActive: false } });
  }

  async createMethodologyVersion(name: string, isActive: boolean): Promise<MethodologyVersion> {
    return this.prisma.methodologyVersion.create({
      data: { name, isActive },
    });
  }

  /** --------------------------------------------------------------------- */
  /** INGREDIENT */
  async getAllIngredients(): Promise<Ingredient[]> {
    return this.prisma.ingredient.findMany();
  }

  async findIngredientByNormalizedName(normalized: string): Promise<Ingredient | null> {
    return this.prisma.ingredient.findUnique({ where: { nameNormalized: normalized } });
  }

  async createIngredient(name: string): Promise<Ingredient> {
    const normalized = this.normalizeIngredientName(name);
    return this.prisma.ingredient.create({
      data: {
        name,
        nameNormalized: normalized,
      },
    });
  }

  /** --------------------------------------------------------------------- */
  /** SYNONYM */
  async getAllSynonyms(): Promise<Synonym[]> {
    return this.prisma.synonym.findMany();
  }

  /** --------------------------------------------------------------------- */
  /** RULE */
  async getRulesByMethodologyVersion(versionId: string): Promise<Rule[]> {
    return this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
    });
  }

  async createRule(
    versionId: string,
    ingredientId: string,
    severity: Severity,
    sourceCitation: string,
  ): Promise<Rule> {
    return this.prisma.rule.create({
      data: {
        methodologyVersionId: versionId,
        ingredientId,
        severity,
        sourceCitation,
      },
    });
  }

  /** --------------------------------------------------------------------- */
  /** PROFILE MODIFIER */
  async getProfileModifiers(profileId: string): Promise<ProfileModifier[]> {
    return this.prisma.profileModifier.findMany({
      where: { profileId },
    });
  }

  /** --------------------------------------------------------------------- */
  /** CLASSIFICATION RESULT */
  async upsertClassificationResult(
    productId: string,
    methodologyVersionId: string,
    result: any,
  ): Promise<void> {
    await this.prisma.classificationResult.upsert({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId,
        },
      },
      create: {
        productId,
        methodologyVersionId,
        result,
      },
      update: {
        result,
      },
    });
  }

  async getClassificationResult(
    productId: string,
    methodologyVersionId: string,
  ): Promise<ClassificationResultModel | null> {
    return this.prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId,
        },
      },
    });
  }

  /** --------------------------------------------------------------------- */
  /** Utility */
  private normalizeIngredientName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }
}
