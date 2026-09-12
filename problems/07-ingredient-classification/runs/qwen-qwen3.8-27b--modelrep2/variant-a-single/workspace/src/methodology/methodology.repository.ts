import { Injectable } from '@nestjs/common';
import type { MethodologyVersion, Severity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface RuleInput {
  ingredientId: string;
  severity: Severity;
  sourceCitation: string;
}

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(): Promise<MethodologyVersion[]> {
    return this.prisma.methodologyVersion.findMany({ orderBy: { createdAt: 'asc' } });
  }

  findById(id: string) {
    return this.prisma.methodologyVersion.findUnique({ where: { id } });
  }

  findByIdWithRules(id: string) {
    return this.prisma.methodologyVersion.findUnique({
      where: { id },
      include: {
        rules: {
          orderBy: { id: 'asc' },
          include: { ingredient: { select: { id: true, name: true } } },
        },
      },
    });
  }

  findActiveWithRules() {
    return this.prisma.methodologyVersion.findFirst({
      where: { status: 'published', active: true },
      include: {
        rules: {
          include: { ingredient: { select: { id: true, name: true } } },
        },
      },
    });
  }

  createWithRules(input: { label: string; rules: RuleInput[] }) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.methodologyVersion.create({ data: { label: input.label } });
      if (input.rules.length > 0) {
        await tx.rule.createMany({
          data: input.rules.map((rule) => ({
            versionId: version.id,
            ingredientId: rule.ingredientId,
            severity: rule.severity,
            sourceCitation: rule.sourceCitation,
          })),
        });
      }
      return tx.methodologyVersion.findUniqueOrThrow({
        where: { id: version.id },
        include: { rules: { orderBy: { id: 'asc' } } },
      });
    });
  }

  /**
   * Publish is idempotent: an already published version is returned as-is
   * without side effects; otherwise it becomes the single active version.
   */
  async publish(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.methodologyVersion.findUnique({ where: { id } });
      if (!existing) {
        return null;
      }
      if (existing.status === 'published') {
        const version = await tx.methodologyVersion.findUnique({
          where: { id },
          include: { rules: true },
        });
        if (!version) {
          return null;
        }
        return { version, justPublished: false };
      }
      await tx.methodologyVersion.updateMany({
        where: { id: { not: id } },
        data: { active: false },
      });
      const version = await tx.methodologyVersion.update({
        where: { id },
        data: { status: 'published', active: true, publishedAt: new Date() },
        include: { rules: true },
      });
      return { version, justPublished: true };
    });
  }
}
