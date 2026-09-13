import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import {
  Ingredient,
  Synonym,
  MethodologyVersion,
  Rule,
  Product,
  Profile,
  ClassificationResult,
} from '@prisma/client';
import { ClassificationResultDto } from './dto/classification-result.dto.js';

@Injectable()
export class ClassificationRepository {
  constructor(public readonly prisma: PrismaService) {}

  async getProductById(productId: number): Promise<Product | null> {
    return this.prisma.product.findUnique({
      where: { id: productId },
    });
  }

  async getProfileById(profileId: number): Promise<Profile | null> {
    return this.prisma.profile.findUnique({
      where: { id: profileId },
    });
  }

  async getActiveMethodologyVersion(): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findFirst({
      orderBy: { publishedAt: 'desc' },
    });
  }

  async getMethodologyVersionByVersion(
    version: string,
  ): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findUnique({
      where: { version },
    });
  }

  async getRulesByMethodologyVersionId(versionId: number): Promise<Rule[]> {
    return this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
    });
  }

  async getAllProducts(): Promise<Product[]> {
    return this.prisma.product.findMany();
  }

  /**
   * Builds a map from normalized name (canonical or synonym) to the ingredient.
   */
  async getIngredientResolutionMap(): Promise<
    Map<string, { id: number; name: string }>
  > {
    const ingredients = await this.prisma.ingredient.findMany({
      include: { synonyms: true },
    });

    const map = new Map<string, { id: number; name: string }>();

    for (const ing of ingredients) {
      const normalizedCanonical = this.normalize(ing.name);
      map.set(normalizedCanonical, { id: ing.id, name: ing.name });

      for (const syn of ing.synonyms) {
        const normalizedSyn = this.normalize(syn.name);
        map.set(normalizedSyn, { id: ing.id, name: ing.name });
      }
    }

    return map;
  }

  async upsertClassificationResult(
    productId: number,
    methodologyVersionId: number,
    resultDto: ClassificationResultDto,
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
        // Prisma expects a JSON compatible value; casting satisfies the type checker.
        resultData: resultDto as any,
      },
      update: {
        resultData: resultDto as any,
      },
    });
  }

  private normalize(input: string): string {
    return input
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
  }
}
