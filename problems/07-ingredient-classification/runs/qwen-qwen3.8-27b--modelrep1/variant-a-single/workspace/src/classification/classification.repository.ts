import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  BaseResult,
  ProfileRef,
  ScoringContext,
  Severity,
  StoredResult,
  VersionSummary,
} from './classification.types.js';

export interface IClassificationRepository {
  loadScoringContext(versionId: string): Promise<ScoringContext | null>;
  findVersion(id: string): Promise<VersionSummary | null>;
  findActiveVersion(): Promise<VersionSummary | null>;
  findProfile(profileId: string): Promise<ProfileRef | null>;
  findResult(productId: string, methodologyVersionId: string): Promise<StoredResult | null>;
  upsertResult(input: { productId: string; methodologyVersionId: string } & BaseResult): Promise<StoredResult>;
}

@Injectable()
export class ClassificationRepository implements IClassificationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Everything the classification engine needs to score one methodology
   * version: that version's rules, the full lookup tables and every product.
   * Read-only access to methodology_versions is duplicated here (the
   * methodology module owns writes) to keep module dependencies acyclic.
   */
  async loadScoringContext(versionId: string): Promise<ScoringContext | null> {
    const version = await this.prisma.methodologyVersion.findUnique({ where: { id: versionId } });
    if (!version) return null;

    const [rules, synonyms, ingredients, products] = await Promise.all([
      this.prisma.rule.findMany({ where: { methodologyVersionId: versionId } }),
      this.prisma.ingredientSynonym.findMany(),
      this.prisma.ingredient.findMany(),
      this.prisma.product.findMany({ include: { ingredients: { select: { name: true } } } }),
    ]);

    return {
      version: toVersionSummary(version),
      rules: rules.map((rule) => ({
        ingredientId: rule.ingredientId,
        severity: rule.severity as Severity,
        source: rule.source,
        note: rule.note,
      })),
      ingredientNameById: Object.fromEntries(ingredients.map((ingredient) => [ingredient.id, ingredient.name])),
      synonymFormToIngredientId: Object.fromEntries(synonyms.map((synonym) => [synonym.form, synonym.ingredientId])),
      canonicalNameToIngredientId: Object.fromEntries(ingredients.map((ingredient) => [ingredient.name, ingredient.id])),
      products: products.map((product) => ({
        id: product.id,
        name: product.name,
        listedIngredients: product.ingredients.map((ingredient) => ingredient.name),
      })),
    };
  }

  async findVersion(id: string): Promise<VersionSummary | null> {
    const version = await this.prisma.methodologyVersion.findUnique({ where: { id } });
    return version ? toVersionSummary(version) : null;
  }

  async findActiveVersion(): Promise<VersionSummary | null> {
    const version = await this.prisma.methodologyVersion.findFirst({ where: { isActive: true } });
    return version ? toVersionSummary(version) : null;
  }

  async findProfile(profileId: string): Promise<ProfileRef | null> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      include: { modifiers: true },
    });
    if (!profile) return null;
    return {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      modifiers: profile.modifiers.map((modifier) => ({
        ingredientId: modifier.ingredientId,
        severity: modifier.severity as Severity,
        source: modifier.source,
        note: modifier.note,
      })),
    };
  }

  async findResult(productId: string, methodologyVersionId: string): Promise<StoredResult | null> {
    const row = await this.prisma.classificationResult.findUnique({
      where: { productId_methodologyVersionId: { productId, methodologyVersionId } },
    });
    return row ? toStoredResult(row) : null;
  }

  /**
   * Results are keyed by (product, methodology version), so rescoring a
   * version simply upserts and is therefore idempotent.
   */
  async upsertResult(input: {
    productId: string;
    methodologyVersionId: string;
  } & BaseResult): Promise<StoredResult> {
    const row = await this.prisma.classificationResult.upsert({
      where: {
        productId_methodologyVersionId: {
          productId: input.productId,
          methodologyVersionId: input.methodologyVersionId,
        },
      },
      create: {
        productId: input.productId,
        methodologyVersionId: input.methodologyVersionId,
        findings: toJsonArray(input.findings),
        unknowns: toJsonArray(input.unknowns),
        confidence: input.confidence,
        disclaimer: input.disclaimer,
      },
      update: {
        findings: toJsonArray(input.findings),
        unknowns: toJsonArray(input.unknowns),
        confidence: input.confidence,
        disclaimer: input.disclaimer,
        classifiedAt: new Date(),
      },
    });
    return toStoredResult(row);
  }
}

function toJsonArray(value: unknown): Prisma.JsonArray {
  return value as Prisma.JsonArray;
}

function toVersionSummary(row: {
  id: string;
  version: number;
  name: string;
  status: string;
  isActive: boolean;
}): VersionSummary {
  return { id: row.id, version: row.version, name: row.name, status: row.status, isActive: row.isActive };
}

function toStoredResult(row: {
  id: string;
  productId: string;
  methodologyVersionId: string;
  findings: Prisma.JsonValue;
  unknowns: Prisma.JsonValue;
  confidence: number;
  disclaimer: string;
  classifiedAt: Date;
}): StoredResult {
  return {
    id: row.id,
    productId: row.productId,
    methodologyVersionId: row.methodologyVersionId,
    findings: row.findings as unknown as StoredResult['findings'],
    unknowns: row.unknowns as unknown as string[],
    confidence: row.confidence,
    disclaimer: row.disclaimer,
    classifiedAt: row.classifiedAt,
  };
}
