import { Injectable, NotFoundException } from '@nestjs/common';
import { ClassificationRepository } from './classification.repository';
import {
  ClassificationResult,
  Finding,
  Severity,
} from './dto/classification-result.dto';
import { Product, Rule, ProfileModifier } from '@prisma/client';

@Injectable()
export class ClassificationService {
  constructor(private readonly repository: ClassificationRepository) {}

  /**
   * Classify a product using the currently active methodology version.
   * Optionally apply a profile's contextual modifiers.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationResult> {
    const product = await this.repository.getProductById(productId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const activeVersion = await this.repository.getActiveMethodologyVersion();
    if (!activeVersion) {
      throw new NotFoundException('Active methodology version not found');
    }

    const result = await this.computeClassification(product, activeVersion.id, profileId);
    await this.repository.upsertClassificationResult(product.id, activeVersion.id, result);
    return result;
  }

  /**
   * Publish a new methodology version and re‑score all products.
   * The operation is idempotent – re‑publishing the same version does not duplicate rows.
   */
  async publishMethodologyVersion(
    name: string,
    ruleInputs: { ingredientName: string; severity: Severity; sourceCitation: string }[],
  ): Promise<void> {
    // Deactivate any existing active versions.
    await this.repository.deactivateAllMethodologyVersions();

    // Create the new (active) version.
    const version = await this.repository.createMethodologyVersion(name, true);

    // Ensure each rule's ingredient exists and create the rule.
    for (const { ingredientName, severity, sourceCitation } of ruleInputs) {
      const normalized = this.normalizeIngredientName(ingredientName);
      let ingredient = await this.repository.findIngredientByNormalizedName(normalized);
      if (!ingredient) {
        ingredient = await this.repository.createIngredient(ingredientName);
      }
      // Prisma's enum is upper‑case; convert.
      const prismaSeverity = severity.toUpperCase() as any;
      await this.repository.createRule(version.id, ingredient.id, prismaSeverity, sourceCitation);
    }

    // Re‑score all products for the new version (no profile overrides).
    const productIds = await this.repository.getAllProductIds();
    for (const pid of productIds) {
      const product = await this.repository.getProductById(pid);
      if (!product) continue;
      const result = await this.computeClassification(product, version.id);
      await this.repository.upsertClassificationResult(pid, version.id, result);
    }
  }

  /**
   * Retrieve a stored classification result for a given product and methodology version.
   */
  async getResult(productId: string, versionId: string): Promise<ClassificationResult | null> {
    const stored = await this.repository.getClassificationResult(productId, versionId);
    return stored?.result as ClassificationResult | null;
  }

  /** --------------------------------------------------------------------- */
  /** Internal helper that performs the actual classification logic.         */
  private async computeClassification(
    product: Product,
    versionId: string,
    profileId?: string,
  ): Promise<ClassificationResult> {
    // Load all reference data in parallel.
    const [
      ingredients,
      synonyms,
      rules,
      profileModifiers,
    ] = await Promise.all([
      this.repository.getAllIngredients(),
      this.repository.getAllSynonyms(),
      this.repository.getRulesByMethodologyVersion(versionId),
      profileId ? this.repository.getProfileModifiers(profileId) : Promise.resolve([] as ProfileModifier[]),
    ]);

    // Build lookup maps.
    const ingredientIdByNormalized = new Map<string, string>();
    const ingredientNameById = new Map<string, string>();
    for (const ing of ingredients) {
      ingredientIdByNormalized.set(ing.nameNormalized, ing.id);
      ingredientNameById.set(ing.id, ing.name);
    }

    const synonymMap = new Map<string, string>(); // normalized synonym -> ingredientId
    for (const syn of synonyms) {
      synonymMap.set(syn.synonymNormalized, syn.ingredientId);
    }

    const ruleMap = new Map<string, { severity: Severity; sourceCitation: string }>();
    for (const rule of rules) {
      ruleMap.set(rule.ingredientId, {
        severity: rule.severity.toLowerCase() as Severity,
        sourceCitation: rule.sourceCitation,
      });
    }

    const modifierMap = new Map<string, { severity: Severity; sourceCitation: string }>();
    for (const mod of profileModifiers) {
      modifierMap.set(mod.ingredientId, {
        severity: mod.severity.toLowerCase() as Severity,
        sourceCitation: mod.sourceCitation,
      });
    }

    // Process each raw ingredient.
    const rawIngredients: string[] = (product.ingredientList as unknown) as string[];
    const totalCount = rawIngredients.length;
    let knownCount = 0;
    const findings: Finding[] = [];

    for (const raw of rawIngredients) {
      const normalized = this.normalizeIngredientName(raw);
      let ingredientId: string | undefined;

      if (synonymMap.has(normalized)) {
        ingredientId = synonymMap.get(normalized);
      } else if (ingredientIdByNormalized.has(normalized)) {
        ingredientId = ingredientIdByNormalized.get(normalized);
      }

      if (!ingredientId) {
        // Unknown ingredient.
        findings.push({
          ingredient: raw,
          flag: false,
          unknown: true,
        });
        continue;
      }

      knownCount += 1;

      // Base rule (if any).
      let severity: Severity | undefined;
      let sourceCitation: string | undefined;
      let flag = false;

      const baseRule = ruleMap.get(ingredientId);
      if (baseRule) {
        severity = baseRule.severity;
        sourceCitation = baseRule.sourceCitation;
        flag = true;
      }

      // Profile overrides take precedence.
      const mod = modifierMap.get(ingredientId);
      if (mod) {
        severity = mod.severity;
        sourceCitation = mod.sourceCitation;
        flag = true; // Even if no base rule existed.
      }

      findings.push({
        ingredient: raw,
        flag,
        severity,
        sourceCitation,
        unknown: false,
      });
    }

    // Deterministic ordering: sort by normalized ingredient name.
    findings.sort((a, b) => {
      const aNorm = this.normalizeIngredientName(a.ingredient);
      const bNorm = this.normalizeIngredientName(b.ingredient);
      return aNorm.localeCompare(bNorm);
    });

    const confidence = totalCount === 0 ? 1 : knownCount / totalCount;
    const disclaimer = `Classification based on methodology version ${versionId}`;

    return {
      findings,
      confidence,
      disclaimer,
    };
  }

  /** --------------------------------------------------------------------- */
  /** Normalizes an ingredient string for matching: lower‑case, trim, strip accents. */
  private normalizeIngredientName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }
}
