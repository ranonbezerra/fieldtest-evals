import { Injectable, Inject } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { IngredientFinding } from './classification.types.js';

@Injectable()
export class ClassificationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Upsert on (product, methodology version): re-scoring the same version again
   * refreshes the same row with the same content instead of creating duplicates.
   */
  upsert(args: {
    productId: string;
    methodologyVersionId: string;
    findings: IngredientFinding[];
    confidence: number;
    disclaimer: string;
  }) {
    const { productId, methodologyVersionId, findings, confidence, disclaimer } = args;
    const data: Prisma.ClassificationResultUncheckedCreateInput = {
      productId,
      methodologyVersionId,
      // JSON boundary: typed findings cross into a jsonb column.
      findings: findings as unknown as Prisma.InputJsonValue,
      confidence,
      disclaimer,
    };
    return this.prisma.classificationResult.upsert({
      where: { productId_methodologyVersionId: { productId, methodologyVersionId } },
      update: { findings: data.findings, confidence, disclaimer },
      create: data,
    });
  }

  findByProductAndVersion(productId: string, methodologyVersionId: string) {
    return this.prisma.classificationResult.findUnique({
      where: { productId_methodologyVersionId: { productId, methodologyVersionId } },
      include: { methodologyVersion: { select: { id: true, label: true } } },
    });
  }
}
