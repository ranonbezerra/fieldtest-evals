import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { ClassificationResult } from '@prisma/client';

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(params: {
    productId: number;
    methodologyVersionId: number;
    profileId?: number;
    findings: any;
    confidence: number;
    disclaimer: string;
  }): Promise<ClassificationResult> {
    const {
      productId,
      methodologyVersionId,
      profileId,
      findings,
      confidence,
      disclaimer,
    } = params;

    return this.prisma.classificationResult.upsert({
      where: {
        product_methodology_profile_unique: {
          productId,
          methodologyVersionId,
          profileId: profileId ?? null,
        },
      },
      create: {
        productId,
        methodologyVersionId,
        profileId: profileId ?? null,
        findings,
        confidence,
        disclaimer,
      },
      update: {
        findings,
        confidence,
        disclaimer,
      },
    });
  }

  async find(params: {
    productId: number;
    methodologyVersionId: number;
    profileId?: number;
  }): Promise<ClassificationResult | null> {
    const { productId, methodologyVersionId, profileId } = params;
    return this.prisma.classificationResult.findUnique({
      where: {
        product_methodology_profile_unique: {
          productId,
          methodologyVersionId,
          profileId: profileId ?? null,
        },
      },
    });
  }
}
