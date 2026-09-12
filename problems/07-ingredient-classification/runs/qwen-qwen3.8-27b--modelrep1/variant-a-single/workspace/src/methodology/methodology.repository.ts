import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Severity, VersionSummary } from '../classification/classification.types.js';

export interface CreateVersionInput {
  version: number;
  name: string;
  rules: { ingredientId: string; severity: Severity; source: string; note: string | null }[];
}

export interface IMethodologyRepository {
  findVersion(id: string): Promise<VersionSummary | null>;
  findVersionByNumber(version: number): Promise<VersionSummary | null>;
  findIngredientByName(name: string): Promise<{ id: string; name: string } | null>;
  createVersion(input: CreateVersionInput): Promise<VersionSummary>;
  setActive(versionId: string): Promise<void>;
}

@Injectable()
export class MethodologyRepository implements IMethodologyRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findVersion(id: string): Promise<VersionSummary | null> {
    const version = await this.prisma.methodologyVersion.findUnique({ where: { id } });
    return version ? toSummary(version) : null;
  }

  async findVersionByNumber(version: number): Promise<VersionSummary | null> {
    const row = await this.prisma.methodologyVersion.findUnique({ where: { version } });
    return row ? toSummary(row) : null;
  }

  async findIngredientByName(name: string): Promise<{ id: string; name: string } | null> {
    const row = await this.prisma.ingredient.findUnique({ where: { name } });
    return row ? { id: row.id, name: row.name } : null;
  }

  /** Versions are immutable: rules are attached here at creation and never updated. */
  async createVersion(input: CreateVersionInput): Promise<VersionSummary> {
    const row = await this.prisma.methodologyVersion.create({
      data: {
        version: input.version,
        name: input.name,
        rules: {
          create: input.rules.map((rule) => ({
            ingredientId: rule.ingredientId,
            severity: rule.severity,
            source: rule.source,
            note: rule.note,
          })),
        },
      },
    });
    return toSummary(row);
  }

  /**
   * Activate a version and supersede the currently active one. Safe to run
   * repeatedly against an already-active version.
   */
  async setActive(versionId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.methodologyVersion.updateMany({
        where: { isActive: true, NOT: { id: versionId } },
        data: { isActive: false, status: 'superseded' },
      }),
      this.prisma.methodologyVersion.update({
        where: { id: versionId },
        data: { isActive: true, status: 'active' },
      }),
    ]);
  }
}

function toSummary(row: {
  id: string;
  version: number;
  name: string;
  status: string;
  isActive: boolean;
}): VersionSummary {
  return { id: row.id, version: row.version, name: row.name, status: row.status, isActive: row.isActive };
}
