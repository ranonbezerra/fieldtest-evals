import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActive() {
    return this.prisma.methodologyVersion.findFirst({
      where: { active: true },
      include: {
        rules: {
          include: { ingredient: true },
          orderBy: { ingredientId: 'asc' },
        },
      },
    });
  }

  async findById(id: string) {
    return this.prisma.methodologyVersion.findUnique({
      where: { id },
      include: {
        rules: {
          include: { ingredient: true },
        },
      },
    });
  }

  async activate(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.methodologyVersion.updateMany({
        where: { active: true },
        data: { active: false },
      });

      return tx.methodologyVersion.update({
        where: { id },
        data: { active: true },
      });
    });
  }
}
