import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import type {
  CanonicalIngredientRow,
  ClassificationRepositoryPort,
  MethodologyVersionRow,
  ProfileRow,
  RuleContext,
  RuleRow,
  Severity,
  SynonymRow,
} from './classification.repository.js';

/**
 * DI token for the repository port. A string token keeps this module free of a
 * runtime import of the Prisma-backed repository (its types are imported with
 * `import type`), so consumers and tests never load the database layer.
 */
export const CLASSIFICATION_REPOSITORY = 'CLASSIFICATION_REPOSITORY';

/**
 * Modifier precedence (fixed; independent of any iteration order):
 *
 * 1. A rule matches an ingredient when its context is `base` or one of the
 *    active profile's contexts.
 * 2. The effective severity is the highest severity among all matching rules
 *    (banned > restricted > watch). A contextual rule can therefore introduce
 *    a finding the base rules alone would not flag, or escalate the base
 *    severity.
 * 3. The reported citation belongs to the rule that provides the effective
 *    severity. Ties are broken by context precedence:
 *    child_under_3 (rank 2) > pregnancy (rank 1) > base (rank 0) — the more
 *    vulnerable population decides first.
 *
 * Because severity resolution is a max over a finite set and context rank is a
 * total order, two modifiers touching one ingredient resolve the same way
 * every time, regardless of the order rules are iterated.
 */
const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };
const CONTEXT_RANK: Record<RuleContext, number> = { base: 0, pregnancy: 1, child_under_3: 2 };

export interface Finding {
  severity: Severity;
  context: RuleContext;
  sourceCitation: string;
}

export interface IngredientResult {
  /** The ingredient exactly as listed on the product. */
  raw: string;
  /** Canonical INCI name, or null when the string could not be resolved. */
  canonical: string | null;
  unknown: boolean;
  flagged: boolean;
  /** Effective severity across all matching rules, or null when none matched. */
  severity: Severity | null;
  /** Citation of the rule that decides `severity`. */
  sourceCitation: string | null;
  /** Every rule that matched, most decisive first (audit trail). */
  findings: Finding[];
}

export interface ClassificationResultDto {
  productId: string;
  methodology: { id: string; version: number; label: string; publishedAt: string };
  profile: { id: string; name: string; contexts: RuleContext[] } | null;
  ingredients: IngredientResult[];
  unknownIngredients: string[];
  /** Recognised / (recognised + unknown), 4-decimal rounded; 1 for an empty list. */
  confidence: number;
  disclaimer: string;
}

export interface PublishResultDto {
  methodologyVersionId: string;
  publishedAt: string;
  reScored: number;
}

const DISCLAIMER =
  'This output reports which rules matched each ingredient and where each rule comes from. ' +
  'It is not a safety or toxicity determination. Ingredients listed as unknown could not be ' +
  'identified and have not been assessed.';

/** Normalize an INCI string: case, accents, hyphens, whitespace. */
function normalizeInci(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ');
}

interface IngredientResolver {
  resolve(raw: string): CanonicalIngredientRow | null;
}

function buildResolver(ingredients: CanonicalIngredientRow[], synonyms: SynonymRow[]): IngredientResolver {
  const byId = new Map<string, CanonicalIngredientRow>(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const byCanonicalName = new Map<string, string>();
  for (const ingredient of ingredients) {
    byCanonicalName.set(normalizeInci(ingredient.name), ingredient.id);
  }
  const byAlias = new Map<string, string>();
  for (const synonym of synonyms) {
    if (!byId.has(synonym.ingredientId)) continue; // skip a dangling alias row
    byAlias.set(normalizeInci(synonym.alias), synonym.ingredientId);
  }
  return {
    resolve(raw: string): CanonicalIngredientRow | null {
      const key = normalizeInci(raw);
      const id = byCanonicalName.get(key) ?? byAlias.get(key);
      return id ? (byId.get(id) ?? null) : null;
    },
  };
}

const byDecisiveness = (a: RuleRow, b: RuleRow): number => {
  const severity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (severity !== 0) return severity;
  const context = CONTEXT_RANK[b.context] - CONTEXT_RANK[a.context];
  if (context !== 0) return context;
  return a.sourceCitation < b.sourceCitation ? -1 : a.sourceCitation > b.sourceCitation ? 1 : 0;
};

const byEntryOrder = (a: IngredientResult, b: IngredientResult): number => {
  const groupA = a.unknown ? 1 : 0;
  const groupB = b.unknown ? 1 : 0;
  if (groupA !== groupB) return groupA - groupB;
  const keyA = normalizeInci(a.canonical ?? a.raw);
  const keyB = normalizeInci(b.canonical ?? b.raw);
  if (keyA !== keyB) return keyA < keyB ? -1 : 1;
  return a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0;
};

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

@Injectable()
export class ClassificationService {
  constructor(@Inject(CLASSIFICATION_REPOSITORY) private readonly repo: ClassificationRepositoryPort) {}

  /**
   * Classify a product against the active (most recently published) methodology
   * version, optionally tightened by a profile. The result is stored keyed by
   * (product, methodologyVersion, profile) and returned.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationResultDto> {
    const version = await this.repo.getActiveMethodologyVersion();
    if (!version) {
      throw new ApiError(
        'no_active_methodology',
        'No published methodology version is available to classify against.',
        {},
        HttpStatus.CONFLICT,
      );
    }
    const result = await this.computeClassification(productId, profileId ?? null, version);
    await this.repo.upsertClassification({
      productId,
      methodologyVersionId: version.id,
      profileId: profileId ?? null,
      payload: result,
    });
    return result;
  }

  /** All stored results for a product, across versions and profiles, exactly as computed. */
  async getStoredResults(
    productId: string,
  ): Promise<Array<{ methodologyVersionId: string; profileId: string | null; result: ClassificationResultDto }>> {
    const product = await this.repo.getProduct(productId);
    if (!product) {
      throw new ApiError('resource_not_found', 'Product not found.', { productId }, HttpStatus.NOT_FOUND);
    }
    const rows = await this.repo.getClassificationsForProduct(productId);
    return rows.map((row) => ({
      methodologyVersionId: row.methodologyVersionId,
      profileId: row.profileId,
      result: row.payload as ClassificationResultDto,
    }));
  }

  /** A single stored result for (product, methodologyVersion, profile), exactly as it was. */
  async getStoredResult(
    productId: string,
    methodologyVersionId: string,
    profileId?: string,
  ): Promise<ClassificationResultDto> {
    const product = await this.repo.getProduct(productId);
    if (!product) {
      throw new ApiError('resource_not_found', 'Product not found.', { productId }, HttpStatus.NOT_FOUND);
    }
    const row = await this.repo.getClassification(productId, methodologyVersionId, profileId ?? null);
    if (!row) {
      throw new ApiError(
        'resource_not_found',
        'No stored classification for this product, methodology version and profile.',
        { productId, methodologyVersionId, profileId: profileId ?? null },
        HttpStatus.NOT_FOUND,
      );
    }
    return row.payload as ClassificationResultDto;
  }

  /**
   * Publish a methodology version and re-score every (product, profile) pair
   * that has stored results ("affected products"). Idempotent: the upsert
   * targets the (product, methodologyVersion, profile) key and the computation
   * is deterministic, so a second run produces the same rows, not duplicates.
   */
  async publishMethodologyVersion(methodologyVersionId: string): Promise<PublishResultDto> {
    const version = await this.repo.getMethodologyVersion(methodologyVersionId);
    if (!version) {
      throw new ApiError(
        'resource_not_found',
        'Methodology version not found.',
        { methodologyVersionId },
        HttpStatus.NOT_FOUND,
      );
    }
    const published = await this.repo.markMethodologyVersionPublished(methodologyVersionId);
    if (!published.publishedAt) {
      throw new ApiError(
        'no_active_methodology',
        'Methodology version is not marked as published.',
        { methodologyVersionId },
        HttpStatus.CONFLICT,
      );
    }
    const pairs = await this.repo.distinctProductProfilePairs();
    let reScored = 0;
    for (const pair of pairs) {
      if (pair.profileId) {
        const profile = await this.repo.getProfile(pair.profileId);
        if (!profile) continue; // profile removed: its prior results remain retrievable, it is not re-scored
      }
      const result = await this.computeClassification(pair.productId, pair.profileId, published);
      await this.repo.upsertClassification({
        productId: pair.productId,
        methodologyVersionId: published.id,
        profileId: pair.profileId,
        payload: result,
      });
      reScored += 1;
    }
    return { methodologyVersionId: published.id, publishedAt: published.publishedAt, reScored };
  }

  private async computeClassification(
    productId: string,
    profileId: string | null,
    version: MethodologyVersionRow,
  ): Promise<ClassificationResultDto> {
    if (version.status !== 'published' || !version.publishedAt) {
      throw new ApiError(
        'no_active_methodology',
        'Classification requires a published methodology version.',
        { methodologyVersionId: version.id },
        HttpStatus.CONFLICT,
      );
    }

    const product = await this.repo.getProduct(productId);
    if (!product) {
      throw new ApiError('resource_not_found', 'Product not found.', { productId }, HttpStatus.NOT_FOUND);
    }

    let profile: ProfileRow | null = null;
    if (profileId) {
      profile = await this.repo.getProfile(profileId);
      if (!profile) {
        throw new ApiError('resource_not_found', 'Profile not found.', { profileId }, HttpStatus.NOT_FOUND);
      }
    }

    const [rawStrings, ingredients, synonyms, rules] = await Promise.all([
      this.repo.getProductIngredients(productId),
      this.repo.listIngredients(),
      this.repo.listSynonyms(),
      this.repo.listRules(version.id),
    ]);

    const resolver = buildResolver(ingredients, synonyms);
    const rulesByIngredient = new Map<string, RuleRow[]>();
    for (const rule of rules) {
      const list = rulesByIngredient.get(rule.ingredientId) ?? [];
      list.push(rule);
      rulesByIngredient.set(rule.ingredientId, list);
    }

    // 'base' always applies; a profile adds its own contexts.
    const contexts = new Set<RuleContext>(['base', ...(profile ? profile.contexts : [])]);

    // Dedupe on the normalized string, then sort, so the output never depends
    // on the stored order of the ingredient list.
    const seen = new Set<string>();
    const entries: IngredientResult[] = [];
    for (const raw of rawStrings) {
      const key = normalizeInci(raw);
      if (seen.has(key)) continue;
      seen.add(key);

      const canonical = resolver.resolve(raw);
      if (!canonical) {
        // Unknown is a first-class outcome: listed, never dropped, never clean.
        entries.push({
          raw,
          canonical: null,
          unknown: true,
          flagged: false,
          severity: null,
          sourceCitation: null,
          findings: [],
        });
        continue;
      }

      const matched = (rulesByIngredient.get(canonical.id) ?? [])
        .filter((rule) => contexts.has(rule.context))
        .sort(byDecisiveness);
      const deciding = matched.length > 0 ? matched[0] : null;
      entries.push({
        raw,
        canonical: canonical.name,
        unknown: false,
        flagged: matched.length > 0,
        severity: deciding ? deciding.severity : null,
        sourceCitation: deciding ? deciding.sourceCitation : null,
        findings: matched.map((rule) => ({
          severity: rule.severity,
          context: rule.context,
          sourceCitation: rule.sourceCitation,
        })),
      });
    }
    entries.sort(byEntryOrder);

    const total = entries.length;
    const recognized = total - entries.filter((entry) => entry.unknown).length;
    const confidence = total === 0 ? 1 : round4(recognized / total);

    return {
      productId,
      methodology: {
        id: version.id,
        version: version.version,
        label: version.label,
        publishedAt: version.publishedAt,
      },
      profile: profile ? { id: profile.id, name: profile.name, contexts: [...profile.contexts].sort() } : null,
      ingredients: entries,
      unknownIngredients: entries.filter((entry) => entry.unknown).map((entry) => entry.raw),
      confidence,
      disclaimer: DISCLAIMER,
    };
  }
}
