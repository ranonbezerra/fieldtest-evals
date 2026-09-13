import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MethodologyVersion, Rule } from '@prisma/client';

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createVersion(version: string): Promise<MethodologyVersion> {
    return this.prisma.methodologyVersion.create({
      data: { version, status: 'draft' },
    });
  }

  async addRule(versionId: string, rule: { name: string; severity: string; source: string }): Promise<Rule> {
    return this.prisma.rule.create({
      data: { ...rule, methodologyId: versionId },
    });
  }

  async publish(versionId: string): Promise<MethodologyVersion> {
    return this.prisma.methodologyVersion.update({
      where: { id: versionId },
      data: { status: 'published', publishedAt: new Date() },
    });
  }

  async getById(versionId: string): Promise<(MethodologyVersion & { rules: Rule[] }) | null> {
    return this.prisma.methodologyVersion.findFirst({
      where: { id: versionId },
      include: { rules: true },
    });
  }

  async getPublished(): Promise<MethodologyVersion[]> {
    return this.prisma.methodologyVersion.findMany({ where: { status: 'published' } });
  }
}
