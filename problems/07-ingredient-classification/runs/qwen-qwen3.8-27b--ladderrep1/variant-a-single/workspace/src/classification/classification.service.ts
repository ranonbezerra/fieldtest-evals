import { Injectable } from '@nestjs/common';
import { RuleKind, VersionStatus } from '@prisma/client';
import type { ClassificationResult, MethodologyVersion, Product, Profile } from '@prisma/client';
import { Errors } from '../common/api-error.js';
import {
  ClassificationRepository,
  type ProductWithIngredients,
  type ResolutionEntry,
  type RuleWithIngredient,
} from './classification.repository.js';
import { normalizeInci } from './inci-normalizer.js';
import type { IngredientFixture, MethodologyFixture } from './fixtures.js';

export type Severity = 'banned' | 'restricted' | 'watch';
export type Flag = 'unknown' | 'none' | Severity;

export interface Finding {
  raw: string;
  canonical: string | null;
  recognized: boolean;
  flag: Flag;
  severity: Severity | null;
  source: string | null;
  matchedVia: 'canonical' | 'synonym' | null;
  modifierContext: string | null;
}

export interface ClassificationSummary {
  total: number;
  recognized: number;
  unknown: number;
}

export interface StoredPayload {
  schema: 1;
  methodologyVersion: string;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
}

export interface ClassificationOutput {
  productId: string;
  methodologyVersion: string;
  profile: string | null;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

export interface StoredResultView {
  productId: string;
  methodologyVersion: string;
  findings: Finding[];
  confidence: number;
  summary: ClassificationSummary;
  disclaimer: string;
}

export interface ModifierRow {
  canonicalName: string;
  context: string;
  severity: Severity;
  source: string;
}

export const DISCLAIMER =
  'These findings list which rules fired for each ingredient and cite the source of each rule. ' +
  'They are not a safety verdict: an ingredient without a flag only means no rule in this ' +
  'methodology version matched it, which is not the same as it being safe.';

/**
 * Modifier precedence — written down; the only permitted resolution order.
 *
 * 1. Start from the base severity of the ingredient in the active methodology
 *    version (which may be "no rule", i.e. unflagged).
 * 2. A context modifier only tightens, never loosens: the effective severity is
 *    the maximum of the base severity and the severities of all modifiers whose
 *    context is present in the profile (banned > restricted > watch).
 * 3. Ties are broken by fixed context precedence: child_under_3 before
 *    pregnancy. If the base rule and a modifier tie, the base citation wins.
 * 4. Contexts outside the precedence list sort after the listed ones; their
 *    relative order is the deterministic rule-table order.
 * 5. Modifiers never apply to unknown (unresolved) ingredients.
 *
 * The winner is chosen by (severity rank, precedence index) — never by array
 * iteration order — so two modifiers on one ingredient resolve the same way
 * every time.
 */
export const MODIFIER_PRECEDENCE: readonly string[] = ['child_under_3', 'pregnancy'];

const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };

interface ModifierCandidate {
  rank: number;
  order: number;
  severity: Severity;
  source: string;
  context: string | null;
}

function findingSortKey(finding: Finding): string {
  return finding.recognized
    ? `0\u0000${finding.canonical}\u0000${finding.raw}`
    : `1\u0000${normalizeInci(finding.raw)}\u0000${finding.raw}`;
}

/**
 * Applies a profile's contextual modifiers to base findings using the
 * precedence written above. Pure and deterministic.
 */
export function applyProfileModifiers(
  findings: Finding[],
  modifiers: ModifierRow[],
  contexts: readonly string[],
): Finding[] {
  const activeContexts = new Set(contexts);
  if (activeContexts.size === 0 || modifiers.length === 0) {
    return findings;
  }

  const byIngredient = new Map<string, ModifierRow[]>();
  for (const modifier of modifiers) {
    if (!activeContexts.has(modifier.context)) {
      continue;
    }
    const list = byIngredient.get(modifier.canonicalName);
    if (list) {
      list.push(modifier);
    } else {
      byIngredient.set(modifier.canonicalName, [modifier]);
    }
  }

  return findings.map((finding) => {
    if (!finding.recognized || finding.canonical === null) {
      return finding;
    }
    const candidates: ModifierCandidate[] = [];
    if (finding.severity !== null && finding.source !== null) {
      candidates.push({
        rank: SEVERITY_RANK[finding.severity],
        order: -1,
        severity: finding.severity,
        source: finding.source,
        context: null,
      });
    }
    for (const modifier of byIngredient.get(finding.canonical) ?? []) {
      const precedence = MODIFIER_PRECEDENCE.indexOf(modifier.context);
      candidates.push({
        rank: SEVERITY_RANK[modifier.severity],
        order: precedence === -1 ? MODIFIER_PRECEDENCE.length : precedence,
        severity: modifier.severity,
        source: modifier.source,
        context: modifier.context,
      });
    }
    if (candidates.length === 0) {
      return finding;
    }
    candidates.sort((a, b) => b.rank - a.rank || a.order - b.order);
    const winner = candidates[0];
    return {
      ...finding,
      flag: winner.severity,
      severity: winner.severity,
      source: winner.source,
      modifierContext: winner.context,
    };
  });
}

/**
 * Pure base classification: normalize + resolve each raw ingredient, apply the
 * version's base rules, sort deterministically, and derive confidence.
 */
export function buildBaseClassification(
  rawIngredients: string[],
  resolutionMap: Map<string, ResolutionEntry>,
  baseRules: Map<string, { severity: Severity; source: string }>,
): { findings: Finding[]; confidence: number; summary: ClassificationSummary } {
  const findings: Finding[] = rawIngredients.map((raw) => {
    const key = normalizeInci(raw);
    const hit = key === '' ? undefined : resolutionMap.get(key);
    if (hit === undefined) {
      // Unknown is a first-class outcome: listed, counted against confidence,
      // never dropped and never treated as clean.
      return {
        raw,
        canonical: null,
        recognized: false,
        flag: 'unknown' as const,
        severity: null,
        source: null,
        matchedVia: null,
        modifierContext: null,
      };
    }
    const rule = baseRules.get(hit.canonicalName);
    return {
      raw,
      canonical: hit.canonicalName,
      recognized: true,
      flag: rule ? rule.severity : 'none',
      severity: rule ? rule.severity : null,
      source: rule ? rule.source : null,
      matchedVia: hit.matchedVia,
      modifierContext: null,
    };
  });

  // Deterministic order: recognised findings by canonical name, then unknowns
  // by normalized raw text. The stored ingredient order never leaks through.
  findings.sort((a, b) => {
    const keyA = findingSortKey(a);
    const keyB = findingSortKey(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  const total = findings.length;
  const recognized = findings.reduce((count, finding) => count + (finding.recognized ? 1 : 0), 0);
  const unknown = total - recognized;
  // Confidence = the fraction of the list we could resolve to a known
  // ingredient; unknown ingredients lower it. An empty list has no
  // recognisable content, so 0.
  const confidence = total === 0 ? 0 : Math.round((recognized / total) * 10000) / 10000;

  return { findings, confidence, summary: { total, recognized, unknown } };
}

@Injectable()
export class ClassificationService {
  constructor(private readonly repository: ClassificationRepository) {}

  // ------------------------------------------------- ingestion (ops/tests)

  async ingestIngredients(
    fixtures: IngredientFixture[],
  ): Promise<{ ingredients: number; synonyms: number }> {
    let synonyms = 0;
    for (const fixture of fixtures) {
      const ingredient = await this.repository.upsertIngredient(fixture.name);
      for (const synonym of fixture.synonyms) {
        await this.repository.upsertSynonym(ingredient.id, synonym);
        synonyms += 1;
      }
    }
    return { ingredients: fixtures.length, synonyms };
  }

  /**
   * Ingests a methodology version from a fixture. Idempotent for identical
   * input; once the version is published, any change is rejected
   * (published versions never change).
   */
  async ingestMethodology(fix: MethodologyFixture): Promise<{
    versionId: string;
    slug: string;
    upserted: number;
    unchanged: number;
  }> {
    const existing = await this.repository.findVersion(fix.slug);
    const version = existing ?? (await this.repository.createVersion(fix.slug, fix.name));
    let upserted = 0;
    let unchanged = 0;
    for (const rule of fix.rules) {
      if (rule.kind === 'context' && !rule.context) {
        throw Errors.invalidInput('A context rule requires a context.', { ingredient: rule.ingredient });
      }
      const kind = rule.kind === 'context' ? RuleKind.CONTEXT : RuleKind.BASE;
      const context = rule.kind === 'context' ? (rule.context ?? '') : '';
      const found = await this.repository.findRuleByKeys(version.id, rule.ingredient, kind, context);
      const identical =
        found !== null && found.severity.toLowerCase() === rule.severity && found.source === rule.source;
      if (identical) {
        unchanged += 1;
        continue;
      }
      if (version.status === VersionStatus.PUBLISHED) {
        throw Errors.methodologyImmutable(version.slug, rule.ingredient);
      }
      await this.repository.upsertRule(version.id, rule.ingredient, rule.severity, rule.source, kind, context);
      upserted += 1;
    }
    return { versionId: version.id, slug: version.slug, upserted, unchanged };
  }

  // ------------------------------------------------- lifecycle

  async publish(versionIdOrSlug: string): Promise<{
    versionId: string;
    slug: string;
    newlyPublished: boolean;
    products: number;
  }> {
    const version = await this.repository.findVersion(versionIdOrSlug);
    if (!version) {
      throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
    }
    const newlyPublished = version.status === VersionStatus.DRAFT;
    if (newlyPublished) {
      await this.repository.markVersionPublished(version.id);
    }
    const { products } = await this.rescore(version.id);
    return { versionId: version.id, slug: version.slug, newlyPublished, products };
  }

  /**
   * Re-scores every product under the given methodology version, upserting the
   * stored result keyed by (product, version). Idempotent: running it again
   * produces the same rows, not duplicates, because the key is unique and the
   * payload is deterministic.
   */
  async rescore(versionIdOrSlug: string): Promise<{ versionId: string; products: number }> {
    const version = await this.repository.findVersion(versionIdOrSlug);
    if (!version) {
      throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
    }
    const [products, resolutionMap, rules] = await Promise.all([
      this.repository.listProducts(),
      this.repository.findResolutionMap(),
      this.repository.findRulesByVersion(version.id),
    ]);
    for (const product of products) {
      await this.upsertStoredResult(product, version, resolutionMap, rules);
    }
    return { versionId: version.id, products: products.length };
  }

  async listVersions(): Promise<
    Array<{ id: string; slug: string; name: string; status: string; publishedAt: string | null }>
  > {
    const versions = await this.repository.listVersions();
    return versions.map((version) => ({
      id: version.id,
      slug: version.slug,
      name: version.name,
      status: version.status,
      publishedAt: version.publishedAt ? version.publishedAt.toISOString() : null,
    }));
  }

  // ------------------------------------------------- products & profiles

  async createProduct(name: string, brand: string | null, ingredients: string[]): Promise<Product> {
    return this.repository.createProduct(name, brand, ingredients);
  }

  async createProfile(name: string, contexts: string[]): Promise<Profile> {
    return this.repository.createProfile(name, contexts);
  }

  async reorderProductIngredients(productId: string, orderedRaws: string[]): Promise<void> {
    const product = await this.repository.findProduct(productId);
    if (!product) {
      throw Errors.resourceNotFound('Product', productId);
    }
    const existing = product.ingredients.map((row) => row.raw).sort();
    const wanted = [...orderedRaws].sort();
    if (existing.length !== wanted.length || existing.some((value, index) => value !== wanted[index])) {
      throw Errors.invalidInput('Reordering must use exactly the same ingredient list as the product.', {
        productId,
      });
    }
    await this.repository.reorderProductIngredients(product.id, orderedRaws);
  }

  // ------------------------------------------------- classification

  /**
   * Classifies a product against the active (latest published) methodology
   * version, optionally tightened by a profile's contextual modifiers.
   *
   * The base findings come from the stored result for (product, active
   * version) — the immutable snapshot written by re-scoring — so a result never
   * changes under a reader. Profile modifiers are applied deterministically on
   * top; the profile is not part of the stored key.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationOutput> {
    const product = await this.repository.findProduct(productId);
    if (!product) {
      throw Errors.resourceNotFound('Product', productId);
    }
    let profile: Profile | null = null;
    if (profileId) {
      profile = await this.repository.findProfile(profileId);
      if (!profile) {
        throw Errors.resourceNotFound('Profile', profileId);
      }
    }
    const version = await this.repository.findActiveVersion();
    if (!version) {
      throw Errors.noPublishedMethodology();
    }
    const [stored, rules] = await Promise.all([
      this.repository.findResult(product.id, version.id),
      this.repository.findRulesByVersion(version.id),
    ]);
    let storedRow = stored;
    if (!storedRow) {
      // Product created after the version was published: score it lazily under
      // the active version.
      const resolutionMap = await this.repository.findResolutionMap();
      storedRow = await this.upsertStoredResult(product, version, resolutionMap, rules);
    }
    const payload = storedRow.payload as unknown as StoredPayload;
    const modifiers: ModifierRow[] = rules
      .filter((rule) => rule.kind === RuleKind.CONTEXT)
      .map((rule) => ({
        canonicalName: rule.ingredient.name,
        context: rule.context,
        severity: rule.severity.toLowerCase() as Severity,
        source: rule.source,
      }));
    const findings = applyProfileModifiers(payload.findings, modifiers, profile ? profile.contexts : []);
    return {
      productId: product.id,
      methodologyVersion: version.slug,
      profile: profile ? profile.id : null,
      findings,
      confidence: payload.confidence,
      summary: payload.summary,
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Returns the stored result for an explicit (product, methodology version)
   * pair — the exact snapshot written when that version was (re-)scored.
   */
  async getStoredResult(productId: string, versionIdOrSlug: string): Promise<StoredResultView> {
    const product = await this.repository.findProduct(productId);
    if (!product) {
      throw Errors.resourceNotFound('Product', productId);
    }
    const version = await this.repository.findVersion(versionIdOrSlug);
    if (!version) {
      throw Errors.resourceNotFound('Methodology version', versionIdOrSlug);
    }
    const stored = await this.repository.findResult(product.id, version.id);
    if (!stored) {
      throw Errors.resourceNotFound('Classification result', `${product.id} under ${version.slug}`);
    }
    const payload = stored.payload as unknown as StoredPayload;
    return {
      productId: product.id,
      methodologyVersion: version.slug,
      findings: payload.findings,
      confidence: payload.confidence,
      summary: payload.summary,
      disclaimer: DISCLAIMER,
    };
  }

  // ------------------------------------------------- internals

  private async upsertStoredResult(
    product: ProductWithIngredients,
    version: Pick<MethodologyVersion, 'id' | 'slug'>,
    resolutionMap: Map<string, ResolutionEntry>,
    rules: RuleWithIngredient[],
  ): Promise<ClassificationResult> {
    const baseRules = new Map<string, { severity: Severity; source: string }>();
    for (const rule of rules) {
      if (rule.kind !== RuleKind.BASE) {
        continue;
      }
      baseRules.set(rule.ingredient.name, {
        severity: rule.severity.toLowerCase() as Severity,
        source: rule.source,
      });
    }
    const { findings, confidence, summary } = buildBaseClassification(
      product.ingredients.map((row) => row.raw),
      resolutionMap,
      baseRules,
    );
    const payload: StoredPayload = {
      schema: 1,
      methodologyVersion: version.slug,
      findings,
      confidence,
      summary,
    };
    return this.repository.upsertResult(product.id, version.id, payload);
  }
}
