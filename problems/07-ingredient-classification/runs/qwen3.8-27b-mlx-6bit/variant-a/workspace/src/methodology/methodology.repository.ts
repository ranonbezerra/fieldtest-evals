import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  getActive() {
    return this.prisma.methodologyVersion.findFirst({
      where: { isActive: true },
    });
  }

  getById(id: number) {
    return this.prisma.methodologyVersion.findUnique({
      where: { id },
    });
  }

  getRules(versionId: number) {
    return this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
    });
  }

  create(data: { version: number; name: string }) {
    return this.prisma.methodologyVersion.create({ data });
  }

  async publish(versionId: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
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
