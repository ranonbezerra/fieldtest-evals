import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByProductVersionProfile(
    productId: string,
    versionId: string,
    profileId: string | null,
  ): Promise<any | null> {
    return this.prisma.classificationResult.findFirst({
      where: {
        productId,
        methodologyVersionId: versionId,
        profileId,
      },
    });
  }

  async saveResult(
    productId: string,
    versionId: string,
    profileId: string | null,
    output: {
      findings: Array<{
        ingredientName: string;
        canonicalIngredient: string | null;
        flag: boolean;
        severity: string | null;
        sourceCitation: string | null;
        isUnknown: boolean;
      }>;
      confidence: number;
      disclaimer: string;
    },
  ): Promise<any> {
    return this.prisma.$transaction(async (tx: any) => {
      const result = await tx.classificationResult.create({
        data: {
          productId,
          methodologyVersionId: versionId,
          profileId,
          confidence: output.confidence,
          disclaimer: output.disclaimer,
        },
      });

      if (output.findings.length > 0) {
        await tx.ingredientFinding.createMany({
          data: output.findings.map((f) => ({
            ingredientName: f.ingredientName,
            canonicalIngredient: f.canonicalIngredient,
            severity: f.severity,
            sourceCitation: f.sourceCitation,
            flag: f.flag,
            isUnknown: f.isUnknown,
            classificationResultId: result.id,
          })),
        });
      }

      return result;
    });
  }

  async getResult(
    productId: string,
    versionId: string,
    profileId: string | null,
  ): Promise<any | null> {
    return this.prisma.classificationResult.findFirst({
      where: {
        productId,
        methodologyVersionId: versionId,
        profileId,
      },
      include: { findings: true },
    });
  }
}
