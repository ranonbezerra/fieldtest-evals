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
}
