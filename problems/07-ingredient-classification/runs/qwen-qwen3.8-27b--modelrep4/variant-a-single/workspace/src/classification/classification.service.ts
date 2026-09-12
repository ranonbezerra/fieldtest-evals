import { Injectable } from '@nestjs/common';
import {
  BadRequestError,
  MethodologyVersionExistsError,
  MethodologyVersionNotFoundError,
  NoActiveMethodologyError,
  ProfileNotFoundError,
  ProductNotFoundError,
} from '../common/api-error.filter.js';
import { ClassificationRepository } from './classification.repository.js';
import type {
  IngredientInfo,
  ProfileModifierView,
  ProfileView,
  ProductRow,
  ResolvedRuleInput,
  RuleView,
  Severity,
} from './classification.repository.js';

/** Shown on every classification; the API never issues a binary safe/toxic verdict. */
export const DISCLAIMER =
  'Informational screening only. Findings are not a safety or regulatory judgment, and the absence of a ' +
  'flag does not mean a product is safe. Unknown ingredients could not be matched to a known substance ' +
  'and should be verified manually.';

export type FindingStatus = 'flagged' | 'clear' | 'unknown';
export type FindingOrigin = 'base' | 'profile_modifier';

export interface ClassificationFinding {
  /** Raw INCI entry exactly as stored on the product. */
  input: string;
  /** Lower-cased, accent-free, whitespace-collapsed form used for matching. */
  normalized: string;
  /** Canonical ingredient name when the input resolved, else null. */
  resolved: string | null;
  /** Internal ingredient id when the input resolved, else null. */
  ingredient_id: string | null;
  status: FindingStatus;
  flagged: boolean;
  /** Final severity after profile modifiers. */
  severity: Severity | null;
  /** Severity from the active methodology's base rules (null when the base did not flag it). */
  base_severity: Severity | null;
  /** Final source citation (the profile modifier's when the profile tightened the finding). */
  source: string | null;
  /** Base rule citation, kept for traceability when the profile tightened the finding. */
  base_source: string | null;
  origin: FindingOrigin;
  note: string | null;
}

export interface ClassificationSummary {
  watch: number;
  restricted: number;
  banned: number;
}

export interface ClassificationResponse {
  product_id: string;
  methodology_version: string;
  profile: { id: string; name: string } | null;
  ingredients: ClassificationFinding[];
  /** Normalized inputs that could not be resolved to a known ingredient, sorted. */
  unknowns: string[];
  /** Share of listed ingredients that resolved to a known substance (1 = all known). */
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

export interface RuleDraft {
  /** Ingredient canonical name or synonym. */
  ingredient: string;
  severity: Severity;
  source: string;
}

const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };

interface IndexedIngredient {
  id: string;
  name: string;
}

@Injectable()
export class ClassificationService {
  constructor(readonly repository: ClassificationRepository) {}

  async createProduct(name: string, rawIngredients: string[]): Promise<{ id: string; name: string }> {
    return this.repository.createProduct(name, rawIngredients);
  }

  /**
   * Classify a product under the active methodology, optionally tightened by a
   * family profile. The profile-independent base result is stored under
   * (product, methodologyVersion) on every call; profile modifiers are applied
   * on top for the response only and are never persisted.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationResponse> {
    const product = await this.repository.findProductWithIngredients(productId);
    if (!product) throw new ProductNotFoundError(productId);

    const methodology = await this.repository.findActiveMethodology();
    if (!methodology) throw new NoActiveMethodologyError();

    const profile = profileId ? await this.repository.findProfileWithModifiers(profileId) : null;
    if (profileId && !profile) throw new ProfileNotFoundError(profileId);

    const [rules, ingredients] = await Promise.all([
      this.repository.findRulesByVersion(methodology.id),
      this.repository.findIngredients(),
    ]);

    const base = this.buildBaseClassification(product, methodology.code, rules, buildIngredientIndex(ingredients));
    await this.repository.upsertResult({
      productId: product.id,
      methodologyVersionId: methodology.id,
      payload: base,
      confidence: base.confidence,
      worstSeverity: worstSeverityOf(base.summary),
    });

    return profile ? this.applyProfile(base, profile) : base;
  }

  /**
   * Publish a new (immutable) methodology version: it becomes the active one,
   * the previous active version is retired, and every product is re-scored
   * against it. Results of earlier versions remain stored and retrievable.
   */
  async publishVersion(input: { code: string; rules: RuleDraft[] }): Promise<{
    id: string;
    code: string;
    status: 'active';
    published: boolean;
    rescanned_products: number;
  }> {
    const existing = await this.repository.findMethodologyByCode(input.code);
    if (existing) throw new MethodologyVersionExistsError(existing.code);

    const index = buildIngredientIndex(await this.repository.findIngredients());
    const resolved: ResolvedRuleInput[] = [];
    const missing: string[] = [];
    for (const draft of input.rules) {
      const entry = index.get(normalizeTerm(draft.ingredient));
      if (!entry) {
        missing.push(draft.ingredient);
        continue;
      }
      resolved.push({ ingredientId: entry.id, severity: draft.severity, source: draft.source });
    }
    if (missing.length > 0) {
      throw new BadRequestError(
        'unknown_ingredient_in_rule',
        'Every rule must reference a known ingredient (canonical name or synonym).',
        { ingredients: missing },
      );
    }

    const version = await this.repository.publishVersion({ code: input.code, rules: resolved });
    const rescannedProducts = await this.rescoreVersion(version.id);
    return {
      id: version.id,
      code: version.code,
      status: 'active',
      published: true,
      rescanned_products: rescannedProducts,
    };
  }

  /**
   * Re-score every product against a methodology version. Idempotent: the
   * payload is a pure function of (ingredients, rules, synonyms) and results
   * are upserted on (product, methodologyVersion), so repeating it is a no-op.
   */
  async rescoreVersion(methodologyVersionId: string): Promise<number> {
    const version = await this.repository.findMethodologyById(methodologyVersionId);
    if (!version) throw new MethodologyVersionNotFoundError(methodologyVersionId);

    const [rules, ingredients, products] = await Promise.all([
      this.repository.findRulesByVersion(methodologyVersionId),
      this.repository.findIngredients(),
      this.repository.listProducts(),
    ]);
    const index = buildIngredientIndex(ingredients);
    for (const product of products) {
      const base = this.buildBaseClassification(product, version.code, rules, index);
      await this.repository.upsertResult({
        productId: product.id,
        methodologyVersionId,
        payload: base,
        confidence: base.confidence,
        worstSeverity: worstSeverityOf(base.summary),
      });
    }
    return products.length;
  }

  async listStoredResults(productId: string, methodologyVersionId?: string) {
    return this.repository.findResultsByProduct(productId, methodologyVersionId);
  }

  private buildBaseClassification(
    product: ProductRow,
    methodologyVersion: string,
    rules: RuleView[],
    index: Map<string, IndexedIngredient>,
  ): ClassificationResponse {
    const ruleByIngredient = new Map<string, RuleView>();
    for (const rule of rules) {
      ruleByIngredient.set(rule.ingredientId, rule);
    }

    const findings: ClassificationFinding[] = product.ingredients.map((line) => {
      const normalized = normalizeTerm(line.raw);
      const entry = index.get(normalized);
      if (!entry) {
        return {
          input: line.raw,
          normalized,
          resolved: null,
          ingredient_id: null,
          status: 'unknown' as FindingStatus,
          flagged: false,
          severity: null,
          base_severity: null,
          source: null,
          base_source: null,
          origin: 'base' as FindingOrigin,
          note: null,
        };
      }
      const rule = ruleByIngredient.get(entry.id) ?? null;
      return {
        input: line.raw,
        normalized,
        resolved: entry.name,
        ingredient_id: entry.id,
        status: rule ? ('flagged' as FindingStatus) : ('clear' as FindingStatus),
        flagged: rule !== null,
        severity: rule ? rule.severity : null,
        base_severity: rule ? rule.severity : null,
        source: rule ? rule.source : null,
        base_source: rule ? rule.source : null,
        origin: 'base' as FindingOrigin,
        note: null,
      };
    });

    // Stable byte-wise order (normalized name, then raw input). Sorting rather
    // than using the stored INCI position is what makes results independent of
    // the order the ingredients were entered in.
    findings.sort(compareStable);

    const unknownFindings = findings.filter((finding) => finding.status === 'unknown');
    const unknowns = uniqueSorted(unknownFindings.map((finding) => finding.normalized));
    const total = findings.length;
    const confidence = total === 0 ? 1 : round4((total - unknownFindings.length) / total);

    const summary: ClassificationSummary = { watch: 0, restricted: 0, banned: 0 };
    for (const finding of findings) {
      if (finding.severity) summary[finding.severity] += 1;
    }

    return {
      product_id: product.id,
      methodology_version: methodologyVersion,
      profile: null,
      ingredients: findings,
      unknowns,
      confidence,
      summary,
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Defined precedence: the active methodology's base rules first, then the
   * profile's contextual modifiers. Modifiers only tighten: they may escalate
   * a flagged ingredient or introduce a new flag, but never loosen a base
   * finding.
   */
  private applyProfile(base: ClassificationResponse, profile: ProfileView): ClassificationResponse {
    const modifierByIngredient = new Map<string, ProfileModifierView>();
    for (const modifier of profile.modifiers) {
      modifierByIngredient.set(modifier.ingredientId, modifier);
    }

    const ingredients: ClassificationFinding[] = base.ingredients.map((finding) => {
      if (finding.status === 'unknown') return finding;
      const modifier = finding.ingredient_id ? modifierByIngredient.get(finding.ingredient_id) : undefined;
      if (!modifier) return finding;
      if (finding.base_severity !== null && SEVERITY_RANK[modifier.severity] <= SEVERITY_RANK[finding.base_severity]) {
        return finding; // modifiers tighten only
      }
      return {
        ...finding,
        status: 'flagged' as FindingStatus,
        flagged: true,
        severity: modifier.severity,
        source: modifier.source,
        origin: 'profile_modifier' as FindingOrigin,
        note: modifier.reason ?? null,
      };
    });

    const summary: ClassificationSummary = { watch: 0, restricted: 0, banned: 0 };
    for (const finding of ingredients) {
      if (finding.severity) summary[finding.severity] += 1;
    }

    return { ...base, profile: { id: profile.id, name: profile.name }, ingredients, summary };
  }
}

/** Lower-case, strip accents, collapse whitespace. Deterministic across environments. */
export function normalizeTerm(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}

function buildIngredientIndex(ingredients: IngredientInfo[]): Map<string, IndexedIngredient> {
  const index = new Map<string, IndexedIngredient>();
  for (const ingredient of ingredients) {
    index.set(normalizeTerm(ingredient.name), { id: ingredient.id, name: ingredient.name });
  }
  for (const ingredient of ingredients) {
    for (const synonym of ingredient.synonyms) {
      // Canonical names always win; the first synonym wins a synonym collision.
      const term = normalizeTerm(synonym);
      if (!index.has(term)) {
        index.set(term, { id: ingredient.id, name: ingredient.name });
      }
    }
  }
  return index;
}

function compareStable(a: ClassificationFinding, b: ClassificationFinding): number {
  if (a.normalized !== b.normalized) return a.normalized < b.normalized ? -1 : 1;
  if (a.input !== b.input) return a.input < b.input ? -1 : 1;
  return 0;
}

function uniqueSorted(values: string[]): string[] {
  const unique = [...new Set(values)];
  unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return unique;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function worstSeverityOf(summary: ClassificationSummary): Severity | null {
  if (summary.banned > 0) return 'banned';
  if (summary.restricted > 0) return 'restricted';
  if (summary.watch > 0) return 'watch';
  return null;
}
