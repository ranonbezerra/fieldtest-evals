import { Injectable, Inject } from '@nestjs/common';
import { MethodologyStatus, Severity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface NewRule {
  ingredientId: string;
  severity: Severity;
  source: string;
}

@Injectable()
export class MethodologyRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Creates a draft version with its rules. Drafts may still be edited by re-creation; published versions have no update path at all. */
  create(label: string, rules: NewRule[]) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.methodologyVersion.create({ data: { label, status: MethodologyStatus.DRAFT } });
      if (rules.length > 0) {
        await tx.rule.createMany({
          data: rules.map((rule) => ({ ...rule, methodologyVersionId: version.id })),
        });
      }
      return version;
    });
  }

  findById(id: string) {
    return this.prisma.methodologyVersion.findUnique({ where: { id } });
  }

  list() {
    return this.prisma.methodologyVersion.findMany({
      orderBy: { revision: 'asc' },
      include: { _count: { select: { rules: true } } },
    });
  }

  markPublished(id: string) {
    return this.prisma.methodologyVersion.update({
      where: { id },
      data: { status: MethodologyStatus.PUBLISHED, publishedAt: new Date() },
    });
  }

  /** The version in effect: the most recently published one (by revision). */
  findActiveVersion() {
    return this.prisma.methodologyVersion.findFirst({
      where: { status: MethodologyStatus.PUBLISHED },
      orderBy: { revision: 'desc' },
    });
  }

  findActiveVersionWithRules() {
    return this.prisma.methodologyVersion.findFirst({
      where: { status: MethodologyStatus.PUBLISHED },
      orderBy: { revision: 'desc' },
      include: { rules: true },
    });
  }

  findVersionWithRules(id: string) {
    return this.prisma.methodologyVersion.findUnique({ where: { id }, include: { rules: true } });
  }
}
