import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upsert on the (product, methodologyVersion) key: re-scoring is
   * idempotent by construction, repeated runs rewrite the same row.
   */
  upsert(
    productId: string,
    methodologyVersionId: string,
    data: { findings: string; unknowns: string; confidence: number },
  ) {
    return this.prisma.classificationResult.upsert({
      where: {
        productId_methodologyVersionId: { productId, methodologyVersionId },
      },
      create: {
        productId,
        methodologyVersionId,
        findings: data.findings,
        unknowns: data.unknowns,
        confidence: data.confidence,
      },
      update: {
        findings: data.findings,
        unknowns: data.unknowns,
        confidence: data.confidence,
        classifiedAt: new Date(),
      },
    });
  }

  findByProductAndVersion(productId: string, methodologyVersionId: string) {
    return this.prisma.classificationResult.findUnique({
      where: { productId_methodologyVersionId: { productId, methodologyVersionId } },
    });
  }

  listForProduct(productId: string) {
    return this.prisma.classificationResult.findMany({
      where: { productId },
      orderBy: { classifiedAt: 'asc' },
    });
  }

  countForVersion(methodologyVersionId: string): Promise<number> {
    return this.prisma.classificationResult.count({ where: { methodologyVersionId } });
  }
}
