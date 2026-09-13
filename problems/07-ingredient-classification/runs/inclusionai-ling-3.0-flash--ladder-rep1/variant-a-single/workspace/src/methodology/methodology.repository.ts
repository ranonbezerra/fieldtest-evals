import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { RuleSource } from "../generated/prisma-client/index.js";

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createVersion(version: string): Promise<any> {
    return this.prisma.methodologyVersion.create({ data: { version } });
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.methodologyVersion.findUnique({ where: { id } });
  }

  async getActiveVersion(): Promise<any | null> {
    return this.prisma.methodologyVersion.findFirst({
      where: { active: true },
    });
  }

  async getRulesForVersion(versionId: string): Promise<any[]> {
    return this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
    });
  }

  async addRule(versionId: string, rule: {
    name: string;
    ingredientName: string;
    severity: string;
    sourceCitation: string;
    source: RuleSource;
  }): Promise<any> {
    return this.prisma.rule.create({
      data: {
        ...rule,
        methodologyVersion: { connect: { id: versionId } },
      },
    });
  }

  async publishVersion(versionId: string): Promise<any> {
    return this.prisma.$transaction(async (tx: any) => {
      await tx.methodologyVersion.updateMany({
        data: { active: false },
        where: { id: { not: versionId } },
      });
      return tx.methodologyVersion.update({
        where: { id: versionId },
        data: { isPublished: true, active: true },
      });
    });
  }

  async deactivateOthers(versionId: string): Promise<void> {
    await this.prisma.methodologyVersion.updateMany({
      data: { active: false },
      where: { id: { not: versionId } },
    });
  }
}
