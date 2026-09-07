# repair1-classification.repository.ts

## reasoning

```
We need to rewrite repository to use PrismaService any types and avoid importing missing models. Likely remove imports from @prisma/client. Provide functions signatures using any. Implement minimal stub.

We just need to compile; no logic required. Use PrismaService with any delegates already defined. So repository can reference prisma.product etc.

Implement class ClassificationRepository with methods used elsewhere. Look at service file to know needed methods. Not provided, but we can guess minimal: findProduct, findMethodologyVersion, findRules, findProfileOverrides, findIngredientByName, findSynonym, createClassificationResult, findClassificationResult, etc.

Implement with any returns and using prisma delegations.

Also need to export repository.

Let's write generic methods with any types.
```

## reply

```typescript
// src/classification/classification.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * ClassificationRepository – data‑access layer for the ingredient‑classification
 * feature.
 *
 * The real Prisma client models (`Product`, `MethodologyVersion`, `Rule`,
 * `ProfileOverride`, `Ingredient`, `Synonym`, `ClassificationResult`,
 * `ClassificationFinding`, `Severity`) are not available in this sandbox, so we
 * interact with the `PrismaService` façade whose delegates are typed as `any`.
 *
 * All methods return `any` – the service layer works with the shape produced by
 * the actual Prisma client at runtime.  This keeps the compilation happy while
 * preserving the intended contract.
 *
 * // ASSUMPTION: The exact fields of each model are unknown; we forward the
 * // parameters straight to Prisma without transformation.
 */
@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** -----------------------------------------------------------------------
   * Product queries
   * --------------------------------------------------------------------- */
  async findProductById(productId: number): Promise<any> {
    return this.prisma.product.findUnique({
      where: { id: productId },
    });
  }

  /** -----------------------------------------------------------------------
   * Methodology version queries
   * --------------------------------------------------------------------- */
  async getActiveMethodologyVersion(): Promise<any> {
    // Assumes an `active` boolean field; adjust as needed in real schema.
    return this.prisma.methodologyVersion.findFirst({
      where: { active: true },
    });
  }

  async findMethodologyVersionById(id: number): Promise<any> {
    return this.prisma.methodologyVersion.findUnique({
      where: { id },
    });
  }

  /** -----------------------------------------------------------------------
   * Rule queries
   * --------------------------------------------------------------------- */
  async findRulesByMethodologyVersion(versionId: number): Promise<any[]> {
    return this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
    });
  }

  /** -----------------------------------------------------------------------
   * Profile override queries
   * --------------------------------------------------------------------- */
  async findProfileOverrides(
    profileId: number,
    versionId: number,
  ): Promise<any[]> {
    return this.prisma.profileOverride.findMany({
      where: {
        profileId,
        methodologyVersionId: versionId,
      },
    });
  }

  /** -----------------------------------------------------------------------
   * Ingredient & synonym queries
   * --------------------------------------------------------------------- */
  async findIngredientByName(name: string): Promise<any> {
    return this.prisma.ingredient.findFirst({
      where: { name },
    });
  }

  async findSynonymByName(name: string): Promise<any> {
    return this.prisma.synonym.findFirst({
      where: { name },
    });
  }

  /** -----------------------------------------------------------------------
   * Classification result persistence
   * --------------------------------------------------------------------- */
  async createClassificationResult(data: any): Promise<any> {
    return this.prisma.classificationResult.create({
      data,
    });
  }

  async findClassificationResult(
    productId: number,
    methodologyVersionId: number,
  ): Promise<any> {
    return this.prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId,
        },
      },
      include: {
        findings: true,
      },
    });
  }

  async upsertClassificationResult(
    productId: number,
    methodologyVersionId: number,
    data: any,
  ): Promise<any> {
    return this.prisma.classificationResult.upsert({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId,
        },
      },
      create: {
        productId,
        methodologyVersionId,
        ...data,
      },
      update: data,
      include: { findings: true },
    });
  }
}
```
