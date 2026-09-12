import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MethodologyVersion, Rule } from '@prisma/client';

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async deactivateAllVersions(): Promise<void> {
    await this.prisma.methodologyVersion.updateMany({
      where: { active: true },
      data: { active: false },
    });
  }

  async createVersion(version: string): Promise<MethodologyVersion> {
    return this.prisma.methodologyVersion.create({
      data: {
        version,
        active: true,
      },
    });
  }

  async findVersionByName(version: string): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findUnique({
      where: { version },
    });
  }

  async addRule(
    methodologyVersionId: number,
    ingredientId: number,
    severity: string,
    sourceCitation: string,
  ): Promise<Rule> {
    return this.prisma.rule.create({
      data: {
        ingredientId,
        severity: severity as any,
        sourceCitation,
        methodologyVersionId,
      },
    });
  }

  async findAllProducts(): Promise<{ id: number }[]> {
    return this.prisma.product.findMany({
      select: { id: true },
    });
  }
}
