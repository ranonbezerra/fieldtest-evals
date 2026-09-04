import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';

// ASSUMPTION: Prisma model names are `classificationResult` and `classificationFinding`
// (camelCase accessors on the Prisma client, corresponding to PascalCase model names
// mapped to snake_case tables via @@map).
// ASSUMPTION: The composite unique key uses Prisma's default naming convention:
// `productId_methodologyVersionId`.

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(
    result: {
      productId: number;
      methodologyVersionId: number;
      overallConfidence: number;
      disclaimer: string;
    },
    findings: {
      rawText: string;
      resolvedName: string | null;
      ingredientId: number | null;
      isUnknown: boolean;
      flag: string | null;
      severity: string | null;
      sourceCitation: string | null;
    }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const resultRow = await tx.classificationResult.upsert({
        where: {
          productId_methodologyVersionId: {
            productId: result.productId,
            methodologyVersionId: result.methodologyVersionId,
          },
        },
        update: {
          overallConfidence: result.overallConfidence,
          disclaimer: result.disclaimer,
        },
        create: {
          productId: result.productId,
          methodologyVersionId: result.methodologyVersionId,
          overallConfidence: result.overallConfidence,
          disclaimer: result.disclaimer,
        },
      });

      await tx.classificationFinding.deleteMany({
        where: { classificationResultId: resultRow.id },
      });

      if (findings.length > 0) {
        await tx.classificationFinding.createMany({
          data: findings.map((f) => ({
            classificationResultId: resultRow.id,
            rawText: f.rawText,
            resolvedName: f.resolvedName,
            ingredientId: f.ingredientId,
            isUnknown: f.isUnknown,
            flag: f.flag,
            severity: f.severity as any,
            sourceCitation: f.sourceCitation,
          })),
        });
      }

      return tx.classificationResult.findUniqueOrThrow({
        where: { id: resultRow.id },
        include: {
          findings: { orderBy: { id: 'asc' } },
        },
      });
    });
  }

  async findByProductAndVersion(
    productId: number,
    versionId: number,
  ) {
    return this.prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId: versionId,
        },
      },
      include: {
        findings: { orderBy: { id: 'asc' } },
      },
    });
  }

  async findByProductId(productId: number) {
    return this.prisma.classificationResult.findMany({
      where: { productId },
      include: {
        findings: { orderBy: { id: 'asc' } },
      },
    });
  }
}
