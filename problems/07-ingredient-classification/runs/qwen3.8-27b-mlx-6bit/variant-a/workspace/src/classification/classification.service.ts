import { Injectable } from '@nestjs/common';
import { ProductRepository } from '../product/product.repository.js';
import { IngredientRepository } from '../ingredient/ingredient.repository.js';
import { MethodologyRepository } from '../methodology/methodology.repository.js';
import { ProfileRepository } from '../profile/profile.repository.js';
import { ClassificationRepository } from './classification.repository.js';
import {
  Severity,
  IngredientFinding,
  ClassificationResponse,
  ProfiledClassificationResponse,
  ResourceNotFound,
} from './types.js';

const SEVERITY_ORDINAL: Record<Severity, number> = {
  watch: 1,
  restricted: 2,
  banned: 3,
};

const DISCLAIMER =
  'This classification is for informational purposes only and does not constitute a safety assessment. Consult a qualified professional before making decisions about product use.';

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function toSeverity(value: string): Severity {
  return value.toLowerCase() as Severity;
}

interface ResolvedIngredient {
  id: number;
  canonicalName: string;
}

interface RuleEntry {
  ingredientId: number;
  severity: string;
  flag: string;
  sourceCitation: string;
}

interface ModifierEntry {
  ingredientId: number;
  severity: string;
  flag: string;
  sourceCitation: string;
}

@Injectable()
export class ClassificationService {
  constructor(
    private readonly productRepo: ProductRepository,
    private readonly ingredientRepo: IngredientRepository,
    private readonly methodologyRepo: MethodologyRepository,
    private readonly profileRepo: ProfileRepository,
    private readonly classificationRepo: ClassificationRepository,
  ) {}

  async classify(
    productId: number,
    profileId?: number,
  ): Promise<ClassificationResponse | ProfiledClassificationResponse> {
    // Step 1: Load product with ingredients ordered by position
    // ASSUMPTION: productRepo.findById returns the product with its `ingredients` relation included.
    const product = (await this.productRepo.findById(productId)) as
      | { id: number; name: string; ingredients: { rawText: string; position: number }[] }
      | null;

    if (!product) {
      throw new ResourceNotFound(`Product with id ${productId} not found`);
    }

    const sortedIngredients = [...product.ingredients].sort((a, b) => a.position - b.position);

    // Step 2: Load active methodology version and its rules
    const activeVersion = (await this.methodologyRepo.getActive()) as
      | { id: number; version: number; name: string }
      | null;

    if (!activeVersion) {
      throw new ResourceNotFound('No active methodology version found');
    }

    const rules = (await this.methodologyRepo.getRules(activeVersion.id)) as RuleEntry[];
    const ruleByIngredientId = new Map<number, RuleEntry>();
    for (const rule of rules) {
      ruleByIngredientId.set(rule.ingredientId, rule);
    }

    // Step 3: Resolve each ingredient and build base findings
    const baseFindings: IngredientFinding[] = [];

    for (const pi of sortedIngredients) {
      const normalized = normalizeText(pi.rawText);
      const resolution = (await this.ingredientRepo.resolve(normalized)) as
        | { ingredient: ResolvedIngredient; matchedVia: 'canonical' | 'synonym' }
        | null;

      if (!resolution) {
        baseFindings.push({
          rawText: pi.rawText,
          resolvedName: null,
          ingredientId: null,
          isUnknown: true,
          flag: null,
          severity: null,
          sourceCitation: null,
        });
      } else {
        const ingredient = resolution.ingredient;
        const rule = ruleByIngredientId.get(ingredient.id) ?? null;
        baseFindings.push({
          rawText: pi.rawText,
          resolvedName: ingredient.canonicalName,
          ingredientId: ingredient.id,
          isUnknown: false,
          flag: rule ? rule.flag : null,
          severity: rule ? toSeverity(rule.severity) : null,
          sourceCitation: rule ? rule.sourceCitation : null,
        });
      }
    }

    // Step 4: Apply profile modifiers (tighten-only) if profileId provided
    let finalFindings = baseFindings;

    if (profileId !== undefined) {
      const profile = await this.profileRepo.findById(profileId);
      if (!profile) {
        throw new ResourceNotFound(`Profile with id ${profileId} not found`);
      }

      const modifiers = (await this.profileRepo.getModifiers(profileId)) as ModifierEntry[];
      const modifierByIngredientId = new Map<number, ModifierEntry>();
      for (const mod of modifiers) {
        modifierByIngredientId.set(mod.ingredientId, mod);
      }

      finalFindings = baseFindings.map((finding) => {
        if (finding.isUnknown || finding.ingredientId === null) {
          return finding;
        }

        const modifier = modifierByIngredientId.get(finding.ingredientId);
        if (!modifier) {
          return finding;
        }

        const modifierSeverity = toSeverity(modifier.severity);

        // Tighten-only: escalate if modifier severity > base severity, or if no base severity
        if (
          finding.severity === null ||
          SEVERITY_ORDINAL[modifierSeverity] > SEVERITY_ORDINAL[finding.severity]
        ) {
          return {
            ...finding,
            flag: modifier.flag,
            severity: modifierSeverity,
            sourceCitation: modifier.sourceCitation,
          };
        }

        return finding;
      });
    }

    // Step 5: Compute overall confidence
    const unknownCount = finalFindings.filter((f) => f.isUnknown).length;
    const overallConfidence = Math.max(0, 1 - 0.1 * unknownCount);

    // Step 6: Build the response
    const baseResponse: ClassificationResponse = {
      productId,
      methodologyVersionId: activeVersion.id,
      findings: finalFindings,
      unknownIngredients: finalFindings.filter((f) => f.isUnknown).map((f) => f.rawText),
      overallConfidence,
      disclaimer: DISCLAIMER,
    };

    // Step 7: Upsert stored result (base findings only, no profile overlay)
    const storedFindings = baseFindings.map((f) => ({
      rawText: f.rawText,
      resolvedName: f.resolvedName,
      ingredientId: f.ingredientId,
      isUnknown: f.isUnknown,
      flag: f.flag,
      // ASSUMPTION: Prisma enum values are uppercase; convert from our lowercase Severity.
      severity: f.severity !== null ? (f.severity.toUpperCase() as never) : null,
      sourceCitation: f.sourceCitation,
    }));

    await this.classificationRepo.upsert(
      {
        productId,
        methodologyVersionId: activeVersion.id,
        overallConfidence,
        disclaimer: DISCLAIMER,
      },
      storedFindings as never[],
    );

    // Step 8: Return response (with profile overlay if applicable)
    if (profileId !== undefined) {
      return {
        ...baseResponse,
        findings: finalFindings,
        profileId,
      } as ProfiledClassificationResponse;
    }

    return baseResponse;
  }

  async rescoreAll(_versionId: number): Promise<void> {
    const products = (await this.productRepo.listWithIngredients()) as { id: number }[];

    for (const product of products) {
      // The newly published version is already active; classify uses it implicitly.
      // Each upsert targets its own (product, version) key — idempotent on retry.
      await this.classify(product.id);
    }
  }
}
