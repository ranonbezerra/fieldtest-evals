import { Injectable } from '@nestjs/common';
import { PrismaClient, Severity } from '@prisma/client';

export interface ProductIngredientData {
  rawText: string;
  position: number;
}

export interface ProductWithIngredients {
  id: number;
  name: string;
  productIngredients: ProductIngredientData[];
}

export interface FindingData {
  rawText: string;
  resolvedName: string | null;
  ingredientId: number | null;
  isUnknown: boolean;
  flag: string | null;
  severity: Severity | null;
  sourceCitation: string | null;
}

export interface ResultData {
  productId: number;
  methodologyVersionId: number;
  overallConfidence: number;
  disclaimer: string;
}

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(result: ResultData, findings: FindingData[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.classificationResult.upsert({
        where: {
          productId_methodologyVersionId: {
            productId: result.productId,
            methodologyVersionId: result.methodologyVersionId,
          },
        },
        create: {
          productId: result.productId,
          methodologyVersionId: result.methodologyVersionId,
          overallConfidence: result.overallConfidence,
          disclaimer: result.disclaimer,
        },
        update: {
          overallConfidence: result.overallConfidence,
          disclaimer: result.disclaimer,
          updatedAt: new Date(),
        },
      });

      await tx.classificationFinding.deleteMany({
        where: { classificationResultId: saved.id },
      });

      if (findings.length > 0) {
        await tx.classificationFinding.createMany({
          data: findings.map((f) => ({
            classificationResultId: saved.id,
            rawText: f.rawText,
            resolvedName: f.resolvedName,
            ingredientId: f.ingredientId,
            isUnknown: f.isUnknown,
            flag: f.flag,
            severity: f.severity,
            sourceCitation: f.sourceCitation,
          })),
        });
      }
    });
  }

  async findByProductAndVersion(
    productId: number,
    versionId: number,
  ): Promise<null | {
    id: number;
    productId: number;
    methodologyVersionId: number;
    overallConfidence: number;
    disclaimer: string;
    createdAt: Date;
    updatedAt: Date | null;
    findings: Array<{
      id: number;
      classificationResultId: number;
      rawText: string;
      resolvedName: string | null;
      ingredientId: number | null;
      isUnknown: boolean;
      flag: string | null;
      severity: Severity | null;
      sourceCitation: string | null;
    }>;
  }> {
    return this.prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId: versionId,
        },
      },
      include: { findings: true },
    });
  }

  async findByProductId(
    productId: number,
  ): Promise<Array<{
    id: number;
    productId: number;
    methodologyVersionId: number;
    overallConfidence: number;
    disclaimer: string;
    createdAt: Date;
    updatedAt: Date | null;
    findings: Array<{
      id: number;
      classificationResultId: number;
      rawText: string;
      resolvedName: string | null;
      ingredientId: number | null;
      isUnknown: boolean;
      flag: string | null;
      severity: Severity | null;
      sourceCitation: string | null;
    }>;
  }>> {
    return this.prisma.classificationResult.findMany({
      where: { productId },
      include: { findings: true },
    });
  }
}
