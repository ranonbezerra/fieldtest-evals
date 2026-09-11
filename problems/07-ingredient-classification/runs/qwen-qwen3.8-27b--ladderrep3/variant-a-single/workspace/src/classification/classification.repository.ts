import { Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** Domain values as stored in the database (mirror the Prisma enums). */
export type Severity = 'banned' | 'restricted' | 'watch';
export type RuleContext = 'base' | 'pregnancy' | 'child_under_3';
export type SynonymKind = 'synonym' | 'typo';
export type MethodologyVersionStatus = 'draft' | 'published';

export interface ProductRow {
  id: string;
  name: string;
}

export interface CanonicalIngredientRow {
  id: string;
  name: string;
}

export interface SynonymRow {
  id: string;
  ingredientId: string;
  alias: string;
  kind: SynonymKind;
}

export interface MethodologyVersionRow {
  id: string;
  version: number;
  label: string;
  status: MethodologyVersionStatus;
  /** ISO-8601 timestamp, null while the version is a draft. */
  publishedAt: string | null;
}

export interface RuleRow {
  id: string;
  methodologyVersionId: string;
  ingredientId: string;
  context: RuleContext;
  severity: Severity;
  sourceCitation: string;
}

export interface ProfileRow {
  id: string;
  name: string;
  /** 'base' never appears here; it always applies. */
  contexts: RuleContext[];
}

export interface StoredClassificationRow {
  id: string;
  productId: string;
  methodologyVersionId: string;
  profileId: string | null;
  /** The ClassificationResultDto serialized as JSON. */
  payload: unknown;
}

export interface ProductProfilePair {
  productId: string;
  profileId: string | null;
}

export interface UpsertClassificationInput {
  productId: string;
  methodologyVersionId: string;
  profileId: string | null;
  payload: unknown;
}

/**
 * The contract the service depends on. The Prisma-backed implementation lives
 * in this same file; tests provide an in-memory implementation of the port.
 */
export interface ClassificationRepositoryPort {
  getProduct(id: string): Promise<ProductRow | null>;
  getProductIngredients(productId: string): Promise<string[]>;
  listIngredients(): Promise<CanonicalIngredientRow[]>;
  listSynonyms(): Promise<SynonymRow[]>;
  getMethodologyVersion(id: string): Promise<MethodologyVersionRow | null>;
  getActiveMethodologyVersion(): Promise<MethodologyVersionRow | null>;
  listRules(methodologyVersionId: string): Promise<RuleRow[]>;
  getProfile(id: string): Promise<ProfileRow | null>;
  markMethodologyVersionPublished(id: string): Promise<MethodologyVersionRow>;
  upsertClassification(input: UpsertClassificationInput): Promise<StoredClassificationRow>;
  getClassificationsForProduct(productId: string): Promise<StoredClassificationRow[]>;
  getClassification(
    productId: string,
    methodologyVersionId: string,
    profileId: string | null,
  ): Promise<StoredClassificationRow | null>;
  distinctProductProfilePairs(): Promise<ProductProfilePair[]>;
}

function toVersionRow(row: {
  id: string;
  version: number;
  label: string;
  status: MethodologyVersionStatus;
  publishedAt: Date | null;
}): MethodologyVersionRow {
  return {
    id: row.id,
    version: row.version,
    label: row.label,
    status: row.status,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  };
}

function toResultRow(row: {
  id: string;
  productId: string;
  methodologyVersionId: string;
  profileId: string | null;
  payload: unknown;
}): StoredClassificationRow {
  return {
    id: row.id,
    productId: row.productId,
    methodologyVersionId: row.methodologyVersionId,
    profileId: row.profileId,
    payload: row.payload,
  };
}

@Injectable()
export class ClassificationRepository implements ClassificationRepositoryPort {
  private readonly prisma = new PrismaClient();

  async getProduct(id: string): Promise<ProductRow | null> {
    const row = await this.prisma.product.findUnique({ where: { id } });
    return row ? { id: row.id, name: row.name } : null;
  }

  async getProductIngredients(productId: string): Promise<string[]> {
    const rows = await this.prisma.productIngredient.findMany({
      where: { productId },
      orderBy: { position: 'asc' },
    });
    return rows.map((row) => row.rawIncistring);
  }

  async listIngredients(): Promise<CanonicalIngredientRow[]> {
    const rows = await this.prisma.ingredient.findMany();
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  async listSynonyms(): Promise<SynonymRow[]> {
    const rows = await this.prisma.ingredientSynonym.findMany();
    return rows.map((row) => ({
      id: row.id,
      ingredientId: row.ingredientId,
      alias: row.alias,
      kind: row.kind,
    }));
  }

  async getMethodologyVersion(id: string): Promise<MethodologyVersionRow | null> {
    const row = await this.prisma.methodologyVersion.findUnique({ where: { id } });
    return row ? toVersionRow(row) : null;
  }

  /** The most recently published version; null when nothing has been published. */
  async getActiveMethodologyVersion(): Promise<MethodologyVersionRow | null> {
    const row = await this.prisma.methodologyVersion.findFirst({
      where: { status: 'published' },
      orderBy: { version: 'desc' },
    });
    return row ? toVersionRow(row) : null;
  }

  async listRules(methodologyVersionId: string): Promise<RuleRow[]> {
    const rows = await this.prisma.rule.findMany({ where: { methodologyVersionId } });
    return rows.map((row) => ({
      id: row.id,
      methodologyVersionId: row.methodologyVersionId,
      ingredientId: row.ingredientId,
      context: row.context,
      severity: row.severity,
      sourceCitation: row.sourceCitation,
    }));
  }

  async getProfile(id: string): Promise<ProfileRow | null> {
    const row = await this.prisma.profile.findUnique({ where: { id } });
    if (!row) return null;
    // Stored as TEXT[] in the database; values are constrained to RuleContext at the write boundary.
    return { id: row.id, name: row.name, contexts: row.contexts as RuleContext[] };
  }

  /** Idempotent: a version that is already published is returned unchanged. */
  async markMethodologyVersionPublished(id: string): Promise<MethodologyVersionRow> {
    const row = await this.prisma.methodologyVersion.findUnique({ where: { id } });
    if (!row) {
      throw new Error(`methodology version not found: ${id}`);
    }
    if (row.status === 'published') {
      return toVersionRow(row);
    }
    const updated = await this.prisma.methodologyVersion.update({
      where: { id },
      data: { status: 'published', publishedAt: new Date() },
    });
    return toVersionRow(updated);
  }

  async upsertClassification(input: UpsertClassificationInput): Promise<StoredClassificationRow> {
    const { productId, methodologyVersionId, profileId, payload } = input;
    // Postgres treats NULLs as distinct inside unique indexes, so the profile-less
    // row is located with an explicit IS NULL match rather than relying on the
    // composite unique index alone.
    const existing = await this.prisma.classificationResult.findFirst({
      where: {
        productId,
        methodologyVersionId,
        ...(profileId === null ? { profileId: null } : { profileId }),
      },
    });
    const jsonPayload = payload as Prisma.InputJsonValue;
    const row = existing
      ? await this.prisma.classificationResult.update({
          where: { id: existing.id },
          data: { payload: jsonPayload },
        })
      : await this.prisma.classificationResult.create({
          data: { productId, methodologyVersionId, profileId, payload: jsonPayload },
        });
    return toResultRow(row);
  }

  async getClassificationsForProduct(productId: string): Promise<StoredClassificationRow[]> {
    const rows = await this.prisma.classificationResult.findMany({
      where: { productId },
      orderBy: { id: 'asc' },
    });
    return rows.map(toResultRow);
  }

  async getClassification(
    productId: string,
    methodologyVersionId: string,
    profileId: string | null,
  ): Promise<StoredClassificationRow | null> {
    const row = await this.prisma.classificationResult.findFirst({
      where: {
        productId,
        methodologyVersionId,
        ...(profileId === null ? { profileId: null } : { profileId }),
      },
    });
    return row ? toResultRow(row) : null;
  }

  async distinctProductProfilePairs(): Promise<ProductProfilePair[]> {
    const rows = await this.prisma.classificationResult.findMany({
      distinct: ['productId', 'profileId'],
      select: { productId: true, profileId: true },
    });
    return rows.map((row) => ({ productId: row.productId, profileId: row.profileId }));
  }
}
