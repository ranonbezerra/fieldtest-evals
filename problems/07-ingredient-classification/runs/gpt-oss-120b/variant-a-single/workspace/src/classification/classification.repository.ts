import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import {
  Product,
  Ingredient,
  Synonym,
  MethodologyVersion,
  Rule,
  ProfileOverride,
  ClassificationResult,
  ClassificationFinding,
  Severity,
} from '@prisma/client';

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getProductWithIngredients(productId: number) {
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: { ingredientEntries: { orderBy: { order: 'asc' } } },
    });
  }

  async getActiveMethodologyVersion() {
    return this.prisma.methodologyVersion.findFirst({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRulesByMethodologyVersion(versionId: number) {
    return this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
    });
  }

  async getProfileOverrides(profileId: number) {
    return this.prisma.profileOverride.findMany({
      where: { profileId },
    });
  }

  async findIngredientByNormalizedName(normalized: string) {
    return this.prisma.ingredient.findFirst({
      where: {
        name: { equals: normalized, mode: 'insensitive' },
      },
    });
  }

  async findSynonymByNormalizedName(normalized: string) {
    return this.prisma.synonym.findFirst({
      where: {
        name: { equals: normalized, mode: 'insensitive' },
      },
    });
  }

  async createClassificationResult(params: {
    productId: number;
    methodologyVersionId: number;
    confidence: number;
    disclaimer: string;
    findings: ClassificationFinding[];
  }) {
    const { productId, methodologyVersionId, confidence, disclaimer, findings } = params;
    const result = await this.prisma.classificationResult.create({
      data: {
        productId,
        methodologyVersionId,
        confidence,
        disclaimer,
        findings: {
          create: findings.map(f => ({
            ingredientId: f.ingredientId,
            raw: f.raw,
            recognized: f.recognized,
            severity: f.severity,
            sourceCitation: f.sourceCitation,
            flagged: f.flagged,
          })),
        },
      },
      include: { findings: true },
    });
    return result;
  }

  async findMethodologyByVersion(version: string) {
    return this.prisma.methodologyVersion.findUnique({
      where: { version },
    });
  }

  async createMethodologyVersion(version: string) {
    return this.prisma.methodologyVersion.create({
      data: { version },
    });
  }

  async createRules(
    methodologyVersionId: number,
    rules: {
      ingredientId: number;
      severity: Severity;
      sourceCitation: string;
    }[],
  ) {
    await this.prisma.rule.createMany({
      data: rules.map(r => ({
        methodologyVersionId,
        ingredientId: r.ingredientId,
        severity: r.severity,
        sourceCitation: r.sourceCitation,
      })),
    });
  }

  async getAllProducts() {
    return this.prisma.product.findMany();
  }

  async findClassificationResult(productId: number, methodologyVersionId: number) {
    return this.prisma.classificationResult.findFirst({
      where: { productId, methodologyVersionId },
    });
  }
}
