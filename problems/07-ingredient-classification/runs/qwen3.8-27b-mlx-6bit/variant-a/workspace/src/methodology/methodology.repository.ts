import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getActive() {
    return this.prisma.methodologyVersion.findFirst({ where: { isActive: true } });
  }

  async getById(id: number) {
    return this.prisma.methodologyVersion.findUnique({ where: { id } });
  }

  async getRules(versionId: number) {
    return this.prisma.rule.findMany({ where: { methodologyVersionId: versionId } });
  }

  async create(data: { version: number; name: string }) {
    return this.prisma.methodologyVersion.create({ data });
  }

  async publish(versionId: number): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.methodologyVersion.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      await tx.methodologyVersion.update({
        where: { id: versionId },
        data: { isActive: true },
      });
    });
  }
}
