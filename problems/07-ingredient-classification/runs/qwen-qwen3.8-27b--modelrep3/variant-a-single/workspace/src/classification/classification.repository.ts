import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(input: {
    productId: string;
    methodologyVersionId: string;
    profileId: string | null;
    payload: Record<string, unknown>;
  }) {
    const profileId = input.profileId ?? null;
    const payload = input.payload as unknown as Prisma.InputJsonValue;

    const existing = await this.prisma.classificationResult.findFirst({
      where: {
        productId: input.productId,
        methodologyVersionId: input.methodologyVersionId,
        profileId,
      },
    });

    if (existing) {
      return this.prisma.classificationResult.update({
        where: { id: existing.id },
        data: { payload },
      });
    }

    return this.prisma.classificationResult.create({
      data: {
        productId: input.productId,
        methodologyVersionId: input.methodologyVersionId,
        profileId,
        payload,
      },
    });
  }

  async findByProductAndVersion(productId: string, methodologyVersionId: string, profileId?: string | null) {
    return this.prisma.classificationResult.findFirst({
      where: {
        productId,
        methodologyVersionId,
        profileId: profileId ?? null,
      },
    });
  }
}
