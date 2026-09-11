# repair1-set

## reasoning

```
The errors are clear: both files use `@Inject(...)` as a decorator but never import `Inject` from `@nestjs/common`.

1. `src/classification/classification.service.ts` — line 72 uses `@Inject(ClassificationRepository)` but only imports `Injectable` from `@nestjs/common`.
2. `src/methodology/methodology.service.ts` — lines 39-40 use `@Inject(MethodologyRepository)` and `@Inject(ClassificationService)` but only imports `Injectable` from `@nestjs/common`.

The fix is the same in both files: add `Inject` to the import from `@nestjs/common`.

Let me reconstruct the complete files with just that change.
```

## reply

### src/classification/classification.service.ts
```ts
import { Injectable, Inject } from '@nestjs/common';
import { NoActiveMethodologyError, ResourceNotFoundError } from '../common/errors.js';
import {
  ClassificationRepository,
  type IngredientRow,
  type ModifierRow,
  type RuleRow,
} from './classification.repository.js';

export type Severity = 'banned' | 'restricted' | 'watch';
export const SEVERITIES: readonly Severity[] = ['banned', 'restricted', 'watch'];

const SEVERITY_RANK: Record<Severity, number> = { watch: 1, restricted: 2, banned: 3 };

/**
 * Modifier precedence — written down, fixed, and the only order used:
 *
 * 1. The base rules of the active methodology version establish the initial
 *    finding per ingredient. (A version carries at most one rule per
 *    ingredient by schema; if more ever exist, the highest severity wins —
 *    banned > restricted > watch — ties broken by lexicographically first
 *    citation.)
 * 2. The profile's contextual modifiers are applied afterwards, in a fixed
 *    order: `child_under_3` first, then `pregnancy`. Any context not in that
 *    list is appended in alphabetical order, so the order never depends on
 *    iteration or insertion order.
 * 3. A modifier may create a finding where none exists, or raise an existing
 *    finding to a strictly higher severity.
 *    ASSUMPTION: "tightens" is read as raise-only — a modifier never lowers
 *    a severity or clears a base flag.
 * 4. Because severity only moves up a fixed ladder and the application order
 *    is fixed, two modifiers touching the same ingredient resolve identically
 *    on every run.
 */
const MODIFIER_PRECEDENCE: readonly string[] = ['child_under_3', 'pregnancy'];

const DISCLAIMER =
  'Automated rule-based screening for informational purposes only. Findings identify ' +
  'which cited rules matched each listed ingredient and where they come from; they are ' +
  'not a safety verdict.';

export interface Finding {
  inci: string;
  ingredientId: string | null;
  canonicalName: string | null;
  status: 'flagged' | 'unflagged' | 'unknown';
  flag: boolean;
  severity: Severity | null;
  sourceCitation: string | null;
}

export interface ClassificationOutput {
  productId: string;
  methodologyVersionId: string;
  methodologyVersion: number;
  profileId: string | null;
  findings: Finding[];
  confidence: number;
  recognizedCount: number;
  totalCount: number;
  disclaimer: string;
}

export interface StoredResultView extends ClassificationOutput {
  id: string;
  classifiedAt: string;
}

@Injectable()
export class ClassificationService {
  constructor(
    @Inject(ClassificationRepository) private readonly repository: ClassificationRepository,
  ) {}

  /**
   * Classify a product under the active methodology and an optional family
   * profile, and store the result keyed by (product, methodologyVersion,
   * profile).
   * ASSUMPTION: "active methodology" means the published version with the
   * highest version number.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationOutput> {
    const product = await this.repository.findProduct(productId);
    if (!product) throw new ResourceNotFoundError('product', productId);
    if (profileId !== undefined) {
      const profile = await this.repository.findProfile(profileId);
      if (!profile) throw new ResourceNotFoundError('profile', profileId);
    }
    const active = await this.repository.findActiveVersion();
    if (!active) throw new NoActiveMethodologyError();
    return this.classifyWithVersion(product.id, active.id, profileId ?? '');
  }

  /**
   * Idempotent re-scoring: (re)computes the profile-less result of every
   * product under the given version. Re-running never duplicates rows —
   * results are upserted on the (product, version, profile) key.
   */
  async rescoreForVersion(methodologyVersionId: string): Promise<number> {
    const version = await this.repository.findVersion(methodologyVersionId);
    if (!version) throw new ResourceNotFoundError('methodology_version', methodologyVersionId);
    const products = await this.repository.listProducts();
    let rescored = 0;
    for (const product of products) {
      await this.classifyWithVersion(product.id, methodologyVersionId, '');
      rescored += 1;
    }
    return rescored;
  }

  async getResults(productId: string, version?: number, profileId?: string): Promise<StoredResultView[]> {
    const product = await this.repository.findProduct(productId);
    if (!product) throw new ResourceNotFoundError('product', productId);
    const rows = await this.repository.findResults(productId, version, profileId ?? '');
    if (rows.length === 0) {
      throw new ResourceNotFoundError('classification_result', productId, {
        methodologyVersion: version ?? null,
        profileId: profileId ?? null,
      });
    }
    return rows.map((row) => ({
      id: row.id,
      classifiedAt: row.classifiedAt.toISOString(),
      ...(JSON.parse(row.payload) as ClassificationOutput),
    }));
  }

  private async classifyWithVersion(
    productId: string,
    methodologyVersionId: string,
    profileKey: string,
  ): Promise<ClassificationOutput> {
    const version = await this.repository.findVersion(methodologyVersionId);
    if (!version) throw new ResourceNotFoundError('methodology_version', methodologyVersionId);
    const contexts = profileKey === '' ? [] : await this.repository.loadProfileContexts(profileKey);
    const [listed, ingredients, rules, modifiers] = await Promise.all([
      this.repository.listProductIngredients(productId),
      this.repository.loadIngredients(),
      this.repository.loadRules(methodologyVersionId),
      this.repository.loadModifiers(contexts),
    ]);
    const { findings, confidence, recognizedCount, totalCount } = this.computeFindings(
      listed.map((row) => row.inci),
      ingredients,
      rules,
      modifiers,
      contexts,
    );
    const output: ClassificationOutput = {
      productId,
      methodologyVersionId: version.id,
      methodologyVersion: version.version,
      profileId: profileKey === '' ? null : profileKey,
      findings,
      confidence,
      recognizedCount,
      totalCount,
      disclaimer: DISCLAIMER,
    };
    await this.repository.upsertResult({
      productId,
      methodologyVersionId: version.id,
      version: version.version,
      // "" is the profile-less ("base") classification key.
      profileId: profileKey,
      confidence,
      payload: JSON.stringify(output),
    });
    return output;
  }

  private computeFindings(
    listedInci: string[],
    ingredients: IngredientRow[],
    rules: RuleRow[],
    modifiers: ModifierRow[],
    contexts: string[],
  ): { findings: Finding[]; confidence: number; recognizedCount: number; totalCount: number } {
    const index = buildResolutionIndex(ingredients);
    const baseRuleByIngredient = pickStrongest(rules);
    const modifierByContext = groupModifiers(modifiers);

    const findings: Finding[] = listedInci.map((inci): Finding => {
      const normalized = normalizeInci(inci);
      const resolved = index.byName.get(normalized) ?? index.byVariant.get(normalized);
      if (!resolved) {
        // Unknown is a first-class outcome: listed, never dropped, never
        // treated as clean, and it lowers the overall confidence.
        return {
          inci,
          ingredientId: null,
          canonicalName: null,
          status: 'unknown',
          flag: false,
          severity: null,
          sourceCitation: null,
        };
      }
      const base = baseRuleByIngredient.get(resolved.id);
      let severity: Severity | null = base ? base.severity : null;
      let citation: string | null = base ? base.sourceCitation : null;
      for (const context of orderedContexts(contexts)) {
        const modifier = modifierByContext.get(context)?.get(resolved.id);
        if (!modifier) continue;
        if (severity === null || SEVERITY_RANK[modifier.severity] > SEVERITY_RANK[severity]) {
          severity = modifier.severity;
          citation = modifier.sourceCitation;
        }
      }
      const flagged = severity !== null;
      return {
        inci,
        ingredientId: resolved.id,
        canonicalName: resolved.name,
        status: flagged ? 'flagged' : 'unflagged',
        flag: flagged,
        severity: flagged ? severity : null,
        sourceCitation: flagged ? citation : null,
      };
    });

    // Deterministic output: findings sorted by normalized, then raw, INCI
    // string, so a shuffled ingredient list yields an identical result.
    findings.sort((a, b) => {
      const na = normalizeInci(a.inci);
      const nb = normalizeInci(b.inci);
      if (na !== nb) return na < nb ? -1 : 1;
      if (a.inci !== b.inci) return a.inci < b.inci ? -1 : 1;
      return 0;
    });

    const recognizedCount = findings.filter((finding) => finding.status !== 'unknown').length;
    const totalCount = findings.length;
    const confidence = totalCount === 0 ? 1 : Math.round((recognizedCount / totalCount) * 10000) / 10000;
    return { findings, confidence, recognizedCount, totalCount };
  }
}

/** Normalize case, accents, and whitespace before matching. */
function normalizeInci(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolution index: normalized canonical name first, then normalized
 * synonym/typo variants. On a collision the lexicographically smallest
 * ingredient id wins, so the index never depends on DB row order.
 */
function buildResolutionIndex(ingredients: IngredientRow[]): {
  byName: Map<string, IngredientRow>;
  byVariant: Map<string, IngredientRow>;
} {
  const byName = new Map<string, IngredientRow>();
  const byVariant = new Map<string, IngredientRow>();
  const ordered = [...ingredients].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const ingredient of ordered) {
    const nameKey = normalizeInci(ingredient.name);
    if (!byName.has(nameKey)) byName.set(nameKey, ingredient);
    for (const variant of ingredient.variants) {
      const variantKey = normalizeInci(variant);
      if (!byVariant.has(variantKey)) byVariant.set(variantKey, ingredient);
    }
  }
  return { byName, byVariant };
}

/** Highest severity per ingredient; ties broken by lexicographically first citation. */
function pickStrongest(
  rules: RuleRow[],
): Map<string, { severity: Severity; sourceCitation: string }> {
  const best = new Map<string, { severity: Severity; sourceCitation: string }>();
  for (const rule of rules) {
    const severity = rule.severity as Severity;
    const current = best.get(rule.ingredientId);
    if (
      !current ||
      SEVERITY_RANK[severity] > SEVERITY_RANK[current.severity] ||
      (SEVERITY_RANK[severity] === SEVERITY_RANK[current.severity] &&
        rule.sourceCitation < current.sourceCitation)
    ) {
      best.set(rule.ingredientId, { severity, sourceCitation: rule.sourceCitation });
    }
  }
  return best;
}

/** One strongest modifier per (context, ingredient), applied in fixed context order. */
function groupModifiers(
  modifiers: ModifierRow[],
): Map<string, Map<string, { severity: Severity; sourceCitation: string }>> {
  const byContext = new Map<string, Map<string, { severity: Severity; sourceCitation: string }>>();
  for (const modifier of modifiers) {
    const severity = modifier.severity as Severity;
    let byIngredient = byContext.get(modifier.context);
    if (!byIngredient) {
      byIngredient = new Map();
      byContext.set(modifier.context, byIngredient);
    }
    const current = byIngredient.get(modifier.ingredientId);
    if (
      !current ||
      SEVERITY_RANK[severity] > SEVERITY_RANK[current.severity] ||
      (SEVERITY_RANK[severity] === SEVERITY_RANK[current.severity] &&
        modifier.sourceCitation < current.sourceCitation)
    ) {
      byIngredient.set(modifier.ingredientId, { severity, sourceCitation: modifier.sourceCitation });
    }
  }
  return byContext;
}

/** The fixed modifier application order (see the precedence block above). */
function orderedContexts(contexts: string[]): string[] {
  const known = MODIFIER_PRECEDENCE.filter((context) => contexts.includes(context));
  const remaining = contexts.filter((context) => !MODIFIER_PRECEDENCE.includes(context)).sort();
  return [...known, ...remaining];
}
```

### src/methodology/methodology.service.ts
```ts
import { Injectable, Inject } from '@nestjs/common';
import {
  DuplicateVersionError,
  InvalidRequestError,
  ResourceNotFoundError,
} from '../common/errors.js';
import { ClassificationService, type Severity } from '../classification/classification.service.js';
import { MethodologyRepository } from './methodology.repository.js';

export interface CreateRuleInput {
  ingredientId: string;
  severity: Severity;
  sourceCitation: string;
}

export interface CreateMethodologyInput {
  version: number;
  name?: string;
  rules: CreateRuleInput[];
}

export interface CreateMethodologyResult {
  id: string;
  version: number;
  status: string;
}

export interface PublishResult {
  id: string;
  version: number;
  status: 'published';
  publishedAt: string | null;
  rescoredProducts: number;
}

@Injectable()
export class MethodologyService {
  constructor(
    @Inject(MethodologyRepository) private readonly repository: MethodologyRepository,
    @Inject(ClassificationService) private readonly classification: ClassificationService,
  ) {}

  async create(input: CreateMethodologyInput): Promise<CreateMethodologyResult> {
    const existing = await this.repository.findByVersion(input.version);
    if (existing) throw new DuplicateVersionError(input.version);
    const seen = new Set<string>();
    for (const rule of input.rules) {
      if (seen.has(rule.ingredientId)) {
        throw new InvalidRequestError('Only one rule per ingredient is allowed per version.', {
          ingredientId: rule.ingredientId,
        });
      }
      seen.add(rule.ingredientId);
      const ingredient = await this.repository.findIngredient(rule.ingredientId);
      if (!ingredient) throw new ResourceNotFoundError('ingredient', rule.ingredientId);
    }
    const version = await this.repository.createWithRules(input);
    return { id: version.id, version: version.version, status: version.status };
  }

  /**
   * Publish a version — from then on it is immutable: only status and
   * publishedAt change, never its rules — and trigger the idempotent
   * re-scoring of all products under it. Publishing twice is safe:
   * re-scoring upserts the same rows.
   */
  async publish(methodologyVersionId: string): Promise<PublishResult> {
    const version = await this.repository.findVersion(methodologyVersionId);
    if (!version) throw new ResourceNotFoundError('methodology_version', methodologyVersionId);
    let current = version;
    if (version.status !== 'published') {
      current = await this.repository.markPublished(methodologyVersionId);
    }
    const rescoredProducts = await this.classification.rescoreForVersion(methodologyVersionId);
    return {
      id: current.id,
      version: current.version,
      status: 'published',
      publishedAt: current.publishedAt ? current.publishedAt.toISOString() : null,
      rescoredProducts,
    };
  }
}
```
