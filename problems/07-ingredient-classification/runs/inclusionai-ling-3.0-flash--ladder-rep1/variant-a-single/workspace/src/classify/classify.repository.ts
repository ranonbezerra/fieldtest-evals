import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  Ingredient,
  Synonym,
  MethodologyVersion,
  Rule,
  ProfileModifier,
  Product,
  ClassificationResult,
  Finding,
  UnknownIngredient,
} from '@prisma/client';

@Injectable()
export class ClassifyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getProduct(productId: string): Promise<Product> {
    return this.prisma.product.findUniqueOrThrow({ where: { id: productId } });
  }

  async getAllSynonyms(): Promise<(Synonym & { ingredient: Ingredient })[]> {
    return this.prisma.synonym.findMany({ include: { ingredient: true } });
  }

  async getRulesForVersion(versionId: string): Promise<Rule[]> {
    return this.prisma.rule.findMany({ where: { methodologyId: versionId } });
  }

  async getProfileModifiers(profileId: string): Promise<ProfileModifier[]> {
    return this.prisma.profileModifier.findMany({ where: { profileId } });
  }

  async getActiveVersion(): Promise<MethodologyVersion> {
    return this.prisma.methodologyVersion.findFirstOrThrow({
      where: { status: 'published' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getVersion(versionId: string): Promise<MethodologyVersion> {
    return this.prisma.methodologyVersion.findUniqueOrThrow({ where: { id: versionId } });
  }

  async getResult(
    productId: string,
    versionId: string,
  ): Promise<(ClassificationResult & { findings: Finding[]; unknownIngredients: UnknownIngredient[] }) | null> {
    return this.prisma.classificationResult.findFirst({
      where: { productId, methodologyVersionId: versionId },
      include: { findings: true, unknownIngredients: true },
    });
  }

  async getAllProducts(): Promise<Product[]> {
    return this.prisma.product.findMany();
  }

  async storeResult(data: {
    productId: string;
    methodologyVersionId: string;
    confidence: number;
    disclaimer: string;
    findings: Array<{
      ingredientName: string;
      listedAs: string;
      isFlagged: boolean;
      severity?: string;
      source?: string;
    }>;
    unknownIngredients: string[];
  }): Promise<ClassificationResultDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.classificationResult.create({
        data: {
          productId: data.productId,
          methodologyVersionId: data.methodologyVersionId,
          confidence: data.confidence,
          disclaimer: data.disclaimer,
        },
      });

      for (const f of data.findings) {
        await tx.finding.create({
          data: {
            classificationId: created.id,
            ingredientName: f.ingredientName,
            listedAs: f.listedAs,
            isFlagged: f.isFlagged,
            severity: f.severity ?? null,
            source: f.source ?? null,
          },
        });
      }

      for (const u of data.unknownIngredients) {
        await tx.unknownIngredient.create({
          data: {
            classificationId: created.id,
            ingredientText: u,
          },
        });
      }

      return created;
    });

    return this.buildDto(result.id);
  }

  async buildDto(resultId: string): Promise<ClassificationResultDto> {
    const result = await this.prisma.classificationResult.findUniqueOrThrow({
      where: { id: resultId },
      include: { findings: true, unknownIngredients: true },
    });

    return {
      confidence: result.confidence,
      disclaimer: result.disclaimer,
      findings: result.findings.map((f) => ({
        ingredient: f.ingredientName,
        listedAs: f.listedAs,
        isFlagged: f.isFlagged,
        severity: f.severity ?? undefined,
        source: f.source ?? undefined,
      })),
      unknownIngredients: result.unknownIngredients.map((u) => u.ingredientText),
    };
  }
}

export interface ClassificationResultDto {
  confidence: number;
  disclaimer: string;
  findings: Array<{
    ingredient: string;
    listedAs: string;
    isFlagged: boolean;
    severity?: string;
    source?: string;
  }>;
  unknownIngredients: string[];
}
