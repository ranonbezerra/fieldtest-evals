import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface VersionRow {
  id: string;
  version: number;
  status: string;
  publishedAt: Date | null;
}

@Injectable()
export class MethodologyRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaClient) {}

  async findByVersion(version: number) {
    return this.prisma.methodologyVersion.findUnique({
      where: { version },
      select: { id: true, version: true, status: true, publishedAt: true },
    });
  }

  async findVersion(id: string): Promise<VersionRow | null> {
    return this.prisma.methodologyVersion.findUnique({
      where: { id },
      select: { id: true, version: true, status: true, publishedAt: true },
    });
  }

  async findIngredient(id: string) {
    return this.prisma.ingredient.findUnique({ where: { id }, select: { id: true, name: true } });
  }

  async createWithRules(input: {
    version: number;
    name?: string;
    rules: Array<{ ingredientId: string; severity: string; sourceCitation: string }>;
  }) {
    return this.prisma.methodologyVersion.create({
      data: {
        version: input.version,
        name: input.name ?? null,
        status: 'draft',
        rules: { create: input.rules },
      },
      select: { id: true, version: true, status: true, publishedAt: true },
    });
  }

  async markPublished(id: string): Promise<VersionRow> {
    return this.prisma.methodologyVersion.update({
      where: { id },
      data: { status: 'published', publishedAt: new Date() },
      select: { id: true, version: true, status: true, publishedAt: true },
    });
  }
}
