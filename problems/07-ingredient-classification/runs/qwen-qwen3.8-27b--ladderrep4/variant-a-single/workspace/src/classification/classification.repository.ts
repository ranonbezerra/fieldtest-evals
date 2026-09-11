import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export interface IngredientRow {
  id: string;
  name: string;
  variants: string[];
}

export interface RuleRow {
  ingredientId: string;
  severity: string;
  sourceCitation: string;
}

export interface ModifierRow {
  context: string;
  ingredientId: string;
  severity: string;
  sourceCitation: string;
}

export interface VersionRow {
  id: string;
  version: number;
  status: string;
  publishedAt: Date | null;
}

export interface StoredResultRow {
  id: string;
  productId: string;
  methodologyVersionId: string;
  version: number;
  profileId: string;
  confidence: number;
  payload: string;
  classifiedAt: Date;
}

export interface UpsertResultInput {
  productId: string;
  methodologyVersionId: string;
  version: number;
  profileId: string;
  confidence: number;
  payload: string;
}

@Injectable()
export class ClassificationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaClient) {}

  async findProduct(id: string) {
    return this.prisma.product.findUnique({ where: { id }, select: { id: true, name: true } });
  }

  async findProfile(id: string) {
    return this.prisma.familyProfile.findUnique({ where: { id }, select: { id: true, name: true } });
  }

  async findVersion(id: string): Promise<VersionRow | null> {
    return this.prisma.methodologyVersion.findUnique({
      where: { id },
      select: { id: true, version: true, status: true, publishedAt: true },
    });
  }

  // The active methodology: the published version with the highest version number.
  async findActiveVersion(): Promise<VersionRow | null> {
    return this.prisma.methodologyVersion.findFirst({
      where: { status: 'published' },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true, publishedAt: true },
    });
  }

  async listProducts(): Promise<Array<{ id: string }>> {
    return this.prisma.product.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  }

  async listProductIngredients(productId: string): Promise<Array<{ inci: string }>> {
    return this.prisma.productIngredient.findMany({ where: { productId }, select: { inci: true } });
  }

  async loadIngredients(): Promise<IngredientRow[]> {
    const rows = await this.prisma.ingredient.findMany({
      select: { id: true, name: true, synonyms: { select: { variant: true } } },
    });
    return rows.map((row) => ({ id: row.id, name: row.name, variants: row.synonyms.map((s) => s.variant) }));
  }

  async loadRules(methodologyVersionId: string): Promise<RuleRow[]> {
    return this.prisma.rule.findMany({
      where: { methodologyVersionId },
      select: { ingredientId: true, severity: true, sourceCitation: true },
    });
  }

  async loadProfileContexts(profileId: string): Promise<string[]> {
    const rows = await this.prisma.profileContext.findMany({ where: { profileId }, select: { context: true } });
    return rows.map((row) => row.context);
  }

  async loadModifiers(contexts: string[]): Promise<ModifierRow[]> {
    if (contexts.length === 0) return [];
    return this.prisma.contextualModifier.findMany({
      where: { context: { in: contexts } },
      select: { context: true, ingredientId: true, severity: true, sourceCitation: true },
    });
  }

  async upsertResult(input: UpsertResultInput): Promise<void> {
    await this.prisma.classificationResult.upsert({
      where: {
        productId_methodologyVersionId_profileId: {
          productId: input.productId,
          methodologyVersionId: input.methodologyVersionId,
          profileId: input.profileId,
        },
      },
      update: { confidence: input.confidence, payload: input.payload },
      create: {
        productId: input.productId,
        methodologyVersionId: input.methodologyVersionId,
        version: input.version,
        profileId: input.profileId,
        confidence: input.confidence,
        payload: input.payload,
      },
    });
  }

  async findResults(productId: string, version: number | undefined, profileId: string): Promise<StoredResultRow[]> {
    return this.prisma.classificationResult.findMany({
      where: { productId, profileId, ...(version !== undefined ? { version } : {}) },
      orderBy: [{ version: 'asc' }, { profileId: 'asc' }],
      select: {
        id: true,
        productId: true,
        methodologyVersionId: true,
        version: true,
        profileId: true,
        confidence: true,
        payload: true,
        classifiedAt: true,
      },
    });
  }
}
