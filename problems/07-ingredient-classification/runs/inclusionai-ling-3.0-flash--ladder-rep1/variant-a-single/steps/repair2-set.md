# repair2-set

## reasoning

```
Let me analyze the errors:

1. `src/classification/classification.controller.ts(41,39)`: The controller calls `this.classificationService.classificationRepo.getResult(...)` but `classificationRepo` is a private property of `ClassificationService`. The fix is to either expose it or add a method in the service. Looking at the controller, it's trying to call `getResult` on the repository through the service. The simplest fix consistent with the architecture is to add a `getResult` method to `ClassificationService` that delegates to the repository. But wait - the controller is calling `this.classificationService.classificationRepo.getResult` - it's accessing a private field. The fix should be to add a public method on the service.

2. `src/methodology/methodology.repository.ts(36,7)`: The `source` field is typed as `string` but should be `RuleSource` enum. The fix is to change the parameter type from `string` to `RuleSource`.

Let me also check - are there other files I need to look at? The error mentions only these two files. But let me think about what files I need to produce.

For error 1, the controller calls `this.classificationService.classificationRepo.getResult(productId, versionId, profileId ?? null)`. I need to add a `getResult` method to `ClassificationService` that delegates to the repository. Let me check - the service doesn't have this method. I need to add it.

For error 2, the `addRule` method accepts `source: string` but Prisma expects `RuleSource`. I need to change the type to `RuleSource`.

Let me also check if there's a `getResult` method already somewhere. Looking at the classification repository... I don't have the repository file, but based on the controller call, it has `getResult(productId, versionId, profileId)`.

Now, the service needs a `getResult` method. Let me add it.

Wait, but the task says "Fix all of them in one reply" and "Return only the files you changed." Let me determine exactly which files to change:

1. `src/methodology/methodology.repository.ts` - fix the `source` parameter type
2. `src/classification/classification.controller.ts` - fix the private access (or rather, add method to service)
3. `src/classification/classification.service.ts` - add `getResult` method

Actually, for the controller error, the cleanest fix is to add a `getResult` method on `ClassificationService` and change the controller to call it. That keeps the architecture clean (controller doesn't access private fields).

Let me produce the three files.
```

## reply

### src/methodology/methodology.repository.ts
```ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service.js";
import { RuleSource } from "../generated/prisma-client/index.js";

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createVersion(version: string): Promise<any> {
    return this.prisma.methodologyVersion.create({ data: { version } });
  }

  async findById(id: string): Promise<any | null> {
    return this.prisma.methodologyVersion.findUnique({ where: { id } });
  }

  async getActiveVersion(): Promise<any | null> {
    return this.prisma.methodologyVersion.findFirst({
      where: { active: true },
    });
  }

  async getRulesForVersion(versionId: string): Promise<any[]> {
    return this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
    });
  }

  async addRule(versionId: string, rule: {
    name: string;
    ingredientName: string;
    severity: string;
    sourceCitation: string;
    source: RuleSource;
  }): Promise<any> {
    return this.prisma.rule.create({
      data: {
        ...rule,
        methodologyVersion: { connect: { id: versionId } },
      },
    });
  }

  async publishVersion(versionId: string): Promise<any> {
    return this.prisma.$transaction(async (tx: any) => {
      await tx.methodologyVersion.updateMany({
        data: { active: false },
        where: { id: { not: versionId } },
      });
      return tx.methodologyVersion.update({
        where: { id: versionId },
        data: { isPublished: true, active: true },
      });
    });
  }

  async deactivateOthers(versionId: string): Promise<void> {
    await this.prisma.methodologyVersion.updateMany({
      data: { active: false },
      where: { id: { not: versionId } },
    });
  }
}
```

### src/classification/classification.service.ts
```ts
import { Injectable } from "@nestjs/common";
import { ProductRepository } from "../product/product.repository.js";
import { MethodologyRepository } from "../methodology/methodology.repository.js";
import { ProfileRepository } from "../profile/profile.repository.js";
import { SynonymRepository } from "../synonym/synonym.repository.js";
import { ClassificationRepository } from "./classification.repository.js";
import { IngredientRepository } from "../ingredient/ingredient.repository.js";
import { normalizeString } from "../common/normalize.js";
import { AppException } from "../common/app-exception.js";

// ASSUMPTION: Profile modifiers have higher precedence than base rules.
// When a profile modifier targets a canonical ingredient, it overrides
// the base rule's severity and flag. Only one modifier per ingredient
// per profile exists (enforced by unique constraint), so there is no
// ambiguity when multiple modifiers touch different ingredients.
// Modifiers are matched by exact canonical ingredient name, making the
// resolution independent of iteration order.

export interface Finding {
  ingredientName: string;
  canonicalIngredient: string | null;
  flag: boolean;
  severity: string | null;
  sourceCitation: string | null;
  isUnknown: boolean;
}

export interface ClassificationOutput {
  findings: Finding[];
  unknownIngredients: string[];
  confidence: number;
  disclaimer: string;
}

@Injectable()
export class ClassificationService {
  constructor(
    private readonly productRepo: ProductRepository,
    private readonly methodologyRepo: MethodologyRepository,
    private readonly profileRepo: ProfileRepository,
    private readonly synonymRepo: SynonymRepository,
    private readonly classificationRepo: ClassificationRepository,
    private readonly ingredientRepo: IngredientRepository,
  ) {}

  /**
   * Public classify API.
   * Resolves the active methodology version internally.
   */
  async classify(
    productId: string,
    profileId?: string,
  ): Promise<ClassificationOutput> {
    const version = await this.methodologyRepo.getActiveVersion();
    if (!version) {
      throw new AppException(
        "no_active_methodology",
        "No active methodology version found",
        400,
      );
    }
    return this.classifyWithVersion(productId, version.id, profileId);
  }

  /**
   * Internal classify that uses a specific methodology version.
   * Used by the re-scoring path.
   */
  async classifyWithVersion(
    productId: string,
    versionId: string,
    profileId?: string,
  ): Promise<ClassificationOutput> {
    const product = await this.productRepo.findById(productId);
    if (!product) {
      throw new AppException(
        "product_not_found",
        `Product ${productId} not found`,
        404,
      );
    }

    const version = await this.methodologyRepo.findById(versionId);
    if (!version) {
      throw new AppException(
        "methodology_version_not_found",
        `Methodology version ${versionId} not found`,
        404,
      );
    }

    const rules = await this.methodologyRepo.getRulesForVersion(versionId);
    const ruleMap = new Map<string, (typeof rules)[0]>();
    for (const rule of rules) {
      ruleMap.set(normalizeString(rule.ingredientName), rule);
    }

    const synonyms = await this.synonymRepo.findAll();
    const resolveMap = new Map<string, string>();
    for (const syn of synonyms) {
      resolveMap.set(
        normalizeString(syn.alternateName),
        normalizeString(syn.ingredient.name),
      );
    }

    let profileModifiers: Map<string, string> = new Map();
    if (profileId) {
      const profile = await this.profileRepo.findById(profileId);
      if (!profile) {
        throw new AppException(
          "profile_not_found",
          `Profile ${profileId} not found`,
          404,
        );
      }
      const mods = await this.profileRepo.getModifiers(profileId);
      for (const mod of mods) {
        profileModifiers.set(
          normalizeString(mod.targetIngredient),
          mod.newSeverity,
        );
      }
    }

    const findings: Finding[] = [];

    for (const inciItem of product.inciList) {
      const normalized = normalizeString(inciItem);

      let canonicalName: string | null = null;

      if (ruleMap.has(normalized)) {
        canonicalName = normalized;
      } else if (resolveMap.has(normalized)) {
        canonicalName = resolveMap.get(normalized)!;
      } else {
        const ingredient = await this.ingredientRepo.findByName(inciItem);
        if (ingredient) {
          canonicalName = normalizeString(ingredient.name);
        }
      }

      if (!canonicalName) {
        findings.push({
          ingredientName: inciItem,
          canonicalIngredient: null,
          flag: false,
          severity: null,
          sourceCitation: null,
          isUnknown: true,
        });
        continue;
      }

      const rule = ruleMap.get(canonicalName);
      let finding: Finding;

      if (rule) {
        finding = {
          ingredientName: inciItem,
          canonicalIngredient: canonicalName,
          flag: true,
          severity: rule.severity,
          sourceCitation: rule.sourceCitation,
          isUnknown: false,
        };
      } else {
        finding = {
          ingredientName: inciItem,
          canonicalIngredient: canonicalName,
          flag: false,
          severity: null,
          sourceCitation: null,
          isUnknown: false,
        };
      }

      // Apply profile modifiers — higher precedence than base rules.
      // Modifier is keyed by canonical ingredient name, deterministic lookup.
      if (profileId && profileModifiers instanceof Map) {
        const modifierSeverity = profileModifiers.get(canonicalName);
        if (modifierSeverity !== undefined) {
          finding.severity = modifierSeverity;
          finding.flag = true;
        }
      }

      findings.push(finding);
    }

    // Sort by normalized ingredient name for determinism regardless of INCI order
    findings.sort((a, b) =>
      (a.ingredientName || "").localeCompare(b.ingredientName || ""),
    );

    const unknownCount = findings.filter((f) => f.isUnknown).length;
    const confidence =
      product.inciList.length > 0
        ? ((product.inciList.length - unknownCount) / product.inciList.length) *
          100
        : 100;

    const disclaimer =
      `This assessment was conducted using methodology version ${version.version}. ` +
      `Findings reflect regulatory and curated watch list analysis as of the version's publish date. ` +
      `This is an informational classification, not a safety determination.`;

    return {
      findings,
      unknownIngredients: findings
        .filter((f) => f.isUnknown)
        .map((f) => f.ingredientName),
      confidence,
      disclaimer,
    };
  }

  /**
   * Re-scoring path: classify all products against a published version.
   * Idempotent — skips products that already have a result for this version.
   */
  async rescoreProducts(versionId: string): Promise<void> {
    const products = await this.productRepo.findAll();
    for (const product of products) {
      await this.rescoreProduct(product.id, versionId);
    }
  }

  async rescoreProduct(
    productId: string,
    versionId: string,
  ): Promise<void> {
    const existing = await this.classificationRepo.findByProductVersionProfile(
      productId,
      versionId,
      null,
    );
    if (existing) {
      return;
    }

    const output = await this.classifyWithVersion(productId, versionId);
    await this.classificationRepo.saveResult(productId, versionId, null, output);
  }

  async getResult(
    productId: string,
    versionId: string,
    profileId: string | null,
  ) {
    return this.classificationRepo.getResult(productId, versionId, profileId);
  }
}
```

### src/classification/classification.controller.ts
```ts
import { Controller, Post, Get, Body, Param, Query } from "@nestjs/common";
import { ClassificationService } from "./classification.service.js";

@Controller("classification")
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Post("classify")
  async classify(
    @Body("productId") productId: string,
    @Body("profileId") profileId?: string,
  ) {
    return this.classificationService.classify(productId, profileId);
  }

  @Post("rescore")
  async rescore(@Body("versionId") versionId: string) {
    await this.classificationService.rescoreProducts(versionId);
    return { success: true };
  }

  @Post("version/:versionId/classify")
  async classifyWithVersion(
    @Param("versionId") versionId: string,
    @Body("productId") productId: string,
    @Body("profileId") profileId?: string,
  ) {
    return this.classificationService.classifyWithVersion(
      productId,
      versionId,
      profileId,
    );
  }

  @Get("result")
  async getResult(
    @Query("productId") productId: string,
    @Query("versionId") versionId: string,
    @Query("profileId") profileId?: string,
  ) {
    return this.classificationService.getResult(
      productId,
      versionId,
      profileId ?? null,
    );
  }
}
```
