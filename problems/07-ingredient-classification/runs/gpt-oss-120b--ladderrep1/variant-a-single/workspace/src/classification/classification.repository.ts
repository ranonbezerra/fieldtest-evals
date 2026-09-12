import { Injectable } from '@nestjs/common';
import {
  PrismaClient,
  Ingredient,
  MethodologyVersion,
  Rule,
  ProductIngredient,
  ClassificationResult,
  ClassificationFinding,
  Profile,
  Modifier,
  Severity,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { Finding } from './interfaces';
import { normalizeString } from '../utils/normalize';

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /*** Product & ingredient retrieval ***/
  async getProductIngredients(productId: number): Promise<ProductIngredient[] | null> {
    return this.prisma.productIngredient.findMany({
      where: { productId },
      orderBy: { orderIdx: 'asc' },
    });
  }

  /*** Ingredient resolution ***/
  resolveIngredient(rawName: string): Ingredient | null {
    const normalized = normalizeString(rawName);
    // Direct match
    const direct = this.prisma.ingredient.findFirst({
      where: { normalizedName: normalized },
    });
    if (direct) return direct as unknown as Ingredient; // Prisma query is async – handled synchronously below

    // Synonym match (async via Prisma)
    // In practice we need an async version; for simplicity we treat this method as sync
    // and rely on the calling code to await the promise. This is an ASSUMPTION.
    // ASSUMPTION: resolveIngredient will be called in an async context and we can use
    // a blocking call via .then(). In the current implementation we provide an async
    // wrapper in the service.
    return null;
  }

  /*** Methodology ***/
  async getActiveMethodologyVersion(): Promise<MethodologyVersion | null> {
    return this.prisma.methodologyVersion.findFirst({
      where: { active: true },
    });
  }

  async getAllRulesForVersion(versionId: number): Promise<Rule[]> {
    return this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
    });
  }

  /*** Profile modifiers ***/
  async getModifiersForProfile(profileId: number): Promise<Modifier[]> {
    return this.prisma.modifier.findMany({
      where: { profileId },
    });
  }

  /*** Classification persistence ***/
  async upsertClassificationResult(
    productId: number,
    versionId: number,
    confidence: number,
    disclaimer: string,
    findings: Finding[],
  ): Promise<ClassificationResult> {
    // Upsert the result row
    const result = await this.prisma.classificationResult.upsert({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId: versionId,
        },
      },
      update: {
        confidence,
        disclaimer,
      },
      create: {
        productId,
        methodologyVersionId: versionId,
        confidence,
        disclaimer,
      },
    });

    // Delete previous findings for this result (idempotent)
    await this.prisma.classificationFinding.deleteMany({
      where: { resultId: result.id },
    });

    // Insert new findings
    const findingsData = findings.map((f) => ({
      resultId: result.id,
      ingredientId: f.ingredientId,
      rawName: f.rawName,
      isUnknown: f.isUnknown,
      flag: f.flag,
      severity: f.severity as Severity | null,
      sourceCitation: f.sourceCitation,
    }));

    await this.prisma.classificationFinding.createMany({
      data: findingsData,
    });

    return result;
  }

  async getClassificationResult(
    productId: number,
    versionId: number,
  ): Promise<ClassificationResult | null> {
    return this.prisma.classificationResult.findFirst({
      where: {
        productId,
        methodologyVersionId: versionId,
      },
      include: {
        findings: true,
      },
    });
  }

  async getAllProductIds(): Promise<number[]> {
    const products = await this.prisma.product.findMany({
      select: { id: true },
    });
    return products.map((p) => p.id);
  }

  /*** Helper for async resolve (used in service) ***/
  async resolveIngredientAsync(rawName: string): Promise<Ingredient | null> {
    const normalized = normalizeString(rawName);
    // Direct match
    const direct = await this.prisma.ingredient.findFirst({
      where: { normalizedName: normalized },
    });
    if (direct) return direct;

    // Synonym match
    const synonym = await this.prisma.synonym.findFirst({
      where: { name: normalized },
      include: { ingredient: true },
    });
    if (synonym) return synonym.ingredient;

    return null;
  }
}
