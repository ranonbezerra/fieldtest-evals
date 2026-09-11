import { Inject, Injectable } from '@nestjs/common';
import type { Severity as PrismaSeverity } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { fromPrismaSeverity, severityRank } from '../common/severity.js';
import { IngredientRepository } from '../ingredient/ingredient.repository.js';
import { MethodologyRepository } from '../methodology/methodology.repository.js';
import { ProductRepository } from '../product/product.repository.js';
import { ProfileRepository } from '../profile/profile.repository.js';
import { ClassificationRepository } from './classification.repository.js';
import type { ClassificationOutput, IngredientFinding, SavedResultView } from './classification.types.js';
import { normalizeInci } from './normalization.js';

const DISCLAIMER =
  'Each finding reports the rule that applies, its severity and its source citation under the methodology version in effect. ' +
  'This output is not a safe or toxic verdict for the product.';

interface BaseRuleView {
  severity: PrismaSeverity;
  source: string;
}

interface ModifierView {
  id: string;
  severity: PrismaSeverity;
  reason: string;
}

/**
 * Modifier precedence — deterministic and independent of iteration order:
 *
 * 1. A resolved ingredient starts from the base rule of the active methodology, if any.
 * 2. Profile modifiers only tighten: a modifier overrides the base rule only when its
 *    severity is strictly higher (banned > restricted > watch). A profile can never
 *    loosen or hide a base rule, so a regulatory citation is never lost.
 * 3. When several modifiers apply to the same ingredient, the highest severity wins;
 *    ties are broken by the smallest modifier id. The outcome is therefore the same
 *    no matter how the modifiers are stored or iterated.
 * 4. A severity tie between the base rule and a modifier is won by the base rule,
 *    keeping the regulatory citation as the citation of record.
 * 5. Unresolved (unknown) ingredients are never matched against any rule: no flag,
 *    no severity — but they are reported as unknown and lower the confidence.
 */
function resolveEffective(
  base: BaseRuleView | null,
  modifiers: ModifierView[],
): { severity: PrismaSeverity; source: string; modifier: ModifierView | null } | null {
  const bestModifier =
    [...modifiers].sort(
      (a, b) =>
        severityRank(fromPrismaSeverity(b.severity)) - severityRank(fromPrismaSeverity(a.severity)) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )[0] ?? null;

  if (base === null) {
    if (bestModifier === null) return null;
    return { severity: bestModifier.severity, source: bestModifier.reason, modifier: bestModifier };
  }
  if (bestModifier === null) {
    return { severity: base.severity, source: base.source, modifier: null };
  }
  if (severityRank(fromPrismaSeverity(bestModifier.severity)) <= severityRank(fromPrismaSeverity(base.severity))) {
    return { severity: base.severity, source: base.source, modifier: null };
  }
  return { severity: bestModifier.severity, source: bestModifier.reason, modifier: bestModifier };
}

@Injectable()
export class ClassificationService {
  constructor(
    @Inject(ProductRepository)
    private readonly products: ProductRepository,
    @Inject(IngredientRepository)
    private readonly ingredients: IngredientRepository,
    @Inject(MethodologyRepository)
    private readonly methodologies: MethodologyRepository,
    @Inject(ProfileRepository)
    private readonly profiles: ProfileRepository,
    @Inject(ClassificationRepository)
    private readonly results: ClassificationRepository,
  ) {}

  /**
   * Classifies a product under the active methodology version, optionally
   * tightened by a family profile. This is a computation: it does not write
   * stored results. Stored results are written by the re-scoring path so that
   * (product, methodology version) stays the unambiguous key for them.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationOutput> {
    const [product, active] = await Promise.all([
      this.products.findByIdWithIngredients(productId),
      this.methodologies.findActiveVersionWithRules(),
    ]);
    const profile = profileId ? await this.profiles.findById(profileId) : null;

    if (!product) throw new ApiError(404, 'resource_not_found', 'Product not found.', { productId });
    if (!active) throw new ApiError(409, 'no_active_methodology', 'No methodology version has been published yet.', {});

    const rulesByIngredient = new Map(
      active.rules.map((rule): [string, BaseRuleView] => [rule.ingredientId, { severity: rule.severity, source: rule.source }]),
    );
    const modifiersByIngredient = new Map<string, ModifierView[]>();
    if (profile) {
      for (const modifier of profile.modifiers) {
        const bucket = modifiersByIngredient.get(modifier.ingredientId) ?? [];
        bucket.push({ id: modifier.id, severity: modifier.severity, reason: modifier.reason });
        modifiersByIngredient.set(modifier.ingredientId, bucket);
      }
    }

    const findings = await this.buildFindings(product.ingredients, rulesByIngredient, modifiersByIngredient);
    return this.toOutput(
      product.id,
      active.id,
      active.label,
      profile ? { id: profile.id, name: profile.name } : null,
      findings,
    );
  }

  /**
   * Idempotent re-scoring of a published methodology version: every product with
   * an INCI list gets (or refreshes) exactly one stored baseline result for this
   * version. Running it twice yields the same rows, never duplicates, and results
   * of other versions are never touched.
   */
  async recomputeForVersion(methodologyVersionId: string): Promise<{ rescoredProducts: number }> {
    const version = await this.methodologies.findVersionWithRules(methodologyVersionId);
    if (!version) {
      throw new ApiError(404, 'resource_not_found', 'Methodology version not found.', { methodologyVersionId });
    }
    if (version.status !== 'PUBLISHED') {
      throw new ApiError(409, 'methodology_not_published', 'Only a published methodology version can be scored.', {
        methodologyVersionId,
      });
    }

    const products = await this.products.findAllWithIngredients();
    const rulesByIngredient = new Map(
      version.rules.map((rule): [string, BaseRuleView] => [rule.ingredientId, { severity: rule.severity, source: rule.source }]),
    );

    for (const product of products) {
      const findings = await this.buildFindings(product.ingredients, rulesByIngredient, new Map());
      await this.results.upsert({
        productId: product.id,
        methodologyVersionId,
        findings,
        confidence: confidenceOf(findings),
        disclaimer: DISCLAIMER,
      });
    }
    return { rescoredProducts: products.length };
  }

  /** Reads a stored result — the baseline exactly as it was computed for that version. */
  async savedResult(productId: string, methodologyVersionId?: string): Promise<SavedResultView> {
    const product = await this.products.findById(productId);
    if (!product) throw new ApiError(404, 'resource_not_found', 'Product not found.', { productId });

    let versionId = methodologyVersionId;
    if (!versionId) {
      const active = await this.methodologies.findActiveVersion();
      if (!active) {
        throw new ApiError(409, 'no_active_methodology', 'No methodology version has been published and no version was specified.', {});
      }
      versionId = active.id;
    }

    const row = await this.results.findByProductAndVersion(productId, versionId);
    if (!row) {
      throw new ApiError(
        404,
        'resource_not_found',
        'No stored classification result for this product and methodology version.',
        { productId, methodologyVersionId: versionId },
      );
    }

    const findings = row.findings as unknown as IngredientFinding[];
    return {
      productId: row.productId,
      methodologyVersionId: row.methodologyVersionId,
      methodologyVersionLabel: row.methodologyVersion.label,
      profile: null,
      ingredients: findings,
      unknownIngredients: unknownRawForms(findings),
      confidence: row.confidence,
      disclaimer: row.disclaimer,
      savedAt: row.createdAt.toISOString(),
    };
  }

  private async buildFindings(
    entries: Array<{ raw: string }>,
    rulesByIngredient: Map<string, BaseRuleView>,
    modifiersByIngredient: Map<string, ModifierView[]>,
  ): Promise<IngredientFinding[]> {
    const normalized = entries.map((entry) => ({ raw: entry.raw, key: normalizeInci(entry.raw) }));
    const resolution = await this.ingredients.resolveByNormalizedKeys(normalized.map((entry) => entry.key));

    const findings = normalized.map((entry): IngredientFinding => {
      const match = resolution.get(entry.key);
      if (!match) {
        return {
          raw: entry.raw,
          normalized: entry.key,
          status: 'unknown',
          ingredientId: null,
          canonicalName: null,
          matchedAs: null,
          flag: false,
          severity: null,
          source: null,
          base: null,
          profile: null,
        };
      }
      const base = rulesByIngredient.get(match.ingredientId) ?? null;
      const modifiers = modifiersByIngredient.get(match.ingredientId) ?? [];
      const effective = resolveEffective(base, modifiers);
      return {
        raw: entry.raw,
        normalized: entry.key,
        status: 'resolved',
        ingredientId: match.ingredientId,
        canonicalName: match.canonicalName,
        matchedAs: match.matchedAs,
        flag: effective !== null,
        severity: effective ? fromPrismaSeverity(effective.severity) : null,
        source: effective ? effective.source : null,
        base: base ? { severity: fromPrismaSeverity(base.severity), source: base.source } : null,
        profile:
          effective && effective.modifier
            ? { severity: fromPrismaSeverity(effective.modifier.severity), reason: effective.modifier.reason }
            : null,
      };
    });

    // Canonical order: the output never depends on the order the INCI list was stored in.
    findings.sort((a, b) =>
      a.normalized === b.normalized ? (a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0) : a.normalized < b.normalized ? -1 : 1,
    );
    return findings;
  }

  private toOutput(
    productId: string,
    methodologyVersionId: string,
    methodologyVersionLabel: string,
    profile: { id: string; name: string } | null,
    findings: IngredientFinding[],
  ): ClassificationOutput {
    return {
      productId,
      methodologyVersionId,
      methodologyVersionLabel,
      profile,
      ingredients: findings,
      unknownIngredients: unknownRawForms(findings),
      confidence: confidenceOf(findings),
      disclaimer: DISCLAIMER,
    };
  }
}

function confidenceOf(findings: IngredientFinding[]): number {
  if (findings.length === 0) return 1;
  const resolved = findings.filter((finding) => finding.status === 'resolved').length;
  return resolved / findings.length;
}

function unknownRawForms(findings: IngredientFinding[]): string[] {
  return [...new Set(findings.filter((finding) => finding.status === 'unknown').map((finding) => finding.raw))].sort();
}
