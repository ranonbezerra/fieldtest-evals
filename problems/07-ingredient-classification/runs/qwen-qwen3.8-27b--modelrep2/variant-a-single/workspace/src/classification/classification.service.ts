import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type {
  ClassificationResult as StoredClassificationRow,
  Ingredient,
  Severity,
} from '@prisma/client';
import { NoActiveMethodologyException, ResourceNotFoundException } from '../common/exceptions.js';
import { normalizeLabel } from '../common/normalization.js';
import { IngredientRepository } from '../ingredient/ingredient.repository.js';
import { METHODOLOGY_PUBLISHED_EVENT } from '../methodology/methodology.service.js';
import type { PublishedMethodology } from '../methodology/methodology.service.js';
import { MethodologyRepository } from '../methodology/methodology.repository.js';
import { ProductRepository } from '../product/product.repository.js';
import { ProfileRepository } from '../profile/profile.repository.js';
import { ClassificationRepository } from './classification.repository.js';

export const CLASSIFICATION_DISCLAIMER =
  'This screening is informational only. It does not determine whether a product is safe or toxic.';

const SEVERITY_RANK: Record<Severity, number> = {
  watch: 1,
  restricted: 2,
  banned: 3,
};

export interface Finding {
  /** The label exactly as listed on the product. */
  label: string;
  /** Normalized form of the label, used for matching and deterministic sorting. */
  normalizedLabel: string;
  /** Canonical ingredient name once resolved through synonyms and OCR typos. */
  ingredient: string | null;
  flagged: boolean;
  severity: Severity | null;
  /** Citation of the rule or profile modifier that drives the finding. */
  source: string | null;
  /** True when a profile contextual modifier created or tightened the finding. */
  profileAdjusted: boolean;
}

export interface ClassificationOutcome {
  productId: string;
  methodologyVersionId: string;
  profileId: string | null;
  findings: Finding[];
  unknown: string[];
  confidence: number;
  disclaimer: string;
}

export interface StoredClassification {
  productId: string;
  methodologyVersionId: string;
  findings: Finding[];
  unknown: string[];
  confidence: number;
  disclaimer: string;
  classifiedAt: Date;
}

interface RuleView {
  severity: Severity;
  sourceCitation: string;
}

interface ModifierView {
  severity: Severity;
  citation: string;
}

interface ResolutionDictionary {
  byNormalized: Map<string, Ingredient>;
  bySynonym: Map<string, Ingredient>;
}

@Injectable()
export class ClassificationService {
  constructor(
    private readonly results: ClassificationRepository,
    private readonly products: ProductRepository,
    private readonly ingredients: IngredientRepository,
    private readonly methodologies: MethodologyRepository,
    private readonly profiles: ProfileRepository,
  ) {}

  /**
   * Publishing a methodology version re-scores every affected product
   * against it. The re-score is idempotent: each (product, version) pair
   * maps to exactly one stored row, rewritten in place on repetition.
   */
  @OnEvent(METHODOLOGY_PUBLISHED_EVENT)
  async onMethodologyPublished(payload: PublishedMethodology): Promise<void> {
    await this.rescoreForVersion(payload.versionId, payload.rules);
  }

  async rescoreForVersion(versionId: string, rules: ReadonlyArray<RuleView>): Promise<number> {
    const ruleIndex = new Map<string, RuleView>();
    for (const rule of rules) {
      ruleIndex.set(rule.ingredientId, rule);
    }
    const dictionary = await this.buildDictionary();
    const products = await this.products.list();
    for (const product of products) {
      const { findings, unknown, confidence } = this.evaluate(
        product.ingredients.map((entry) => entry.label),
        ruleIndex,
        null,
        dictionary,
      );
      await this.results.upsert(product.id, versionId, {
        findings: JSON.stringify(findings),
        unknowns: JSON.stringify(unknown),
        confidence,
      });
    }
    return products.length;
  }

  /**
   * Live classification: the active methodology version's base rules first,
   * then the optional profile's contextual modifiers. Nothing is stored
   * here; storage happens only through the publish-time re-score.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationOutcome> {
    const product = await this.products.findById(productId);
    if (!product) {
      throw new ResourceNotFoundException('product', { productId });
    }
    const version = await this.methodologies.findActiveWithRules();
    if (!version) {
      throw new NoActiveMethodologyException();
    }

    let modifiers: Map<string, ModifierView> | null = null;
    if (profileId !== undefined) {
      const profile = await this.profiles.findById(profileId);
      if (!profile) {
        throw new ResourceNotFoundException('profile', { profileId });
      }
      modifiers = new Map<string, ModifierView>();
      for (const modifier of profile.modifiers) {
        modifiers.set(modifier.ingredientId, {
          severity: modifier.severity,
          citation: modifier.citation,
        });
      }
    }

    const ruleIndex = new Map<string, RuleView>();
    for (const rule of version.rules) {
      ruleIndex.set(rule.ingredientId, {
        severity: rule.severity,
        sourceCitation: rule.sourceCitation,
      });
    }
    const dictionary = await this.buildDictionary();
    const { findings, unknown, confidence, disclaimer } = this.evaluate(
      product.ingredients.map((entry) => entry.label),
      ruleIndex,
      modifiers,
      dictionary,
    );

    return {
      productId: product.id,
      methodologyVersionId: version.id,
      profileId: profileId ?? null,
      findings,
      unknown,
      confidence,
      disclaimer,
    };
  }

  async getStored(productId: string, methodologyVersionId: string): Promise<StoredClassification> {
    const row = await this.results.findByProductAndVersion(productId, methodologyVersionId);
    if (!row) {
      throw new ResourceNotFoundException('classification result', {
        productId,
        methodologyVersionId,
      });
    }
    return this.toStoredDto(row);
  }

  async listStoredForProduct(productId: string): Promise<StoredClassification[]> {
    const product = await this.products.findById(productId);
    if (!product) {
      throw new ResourceNotFoundException('product', { productId });
    }
    const rows = await this.results.listForProduct(productId);
    return rows.map((row) => this.toStoredDto(row));
  }

  private toStoredDto(row: StoredClassificationRow): StoredClassification {
    return {
      productId: row.productId,
      methodologyVersionId: row.methodologyVersionId,
      findings: JSON.parse(row.findings) as Finding[],
      unknown: JSON.parse(row.unknowns) as string[],
      confidence: row.confidence,
      disclaimer: CLASSIFICATION_DISCLAIMER,
      classifiedAt: row.classifiedAt,
    };
  }

  /**
   * Loads the full resolution dictionary: every canonical ingredient plus
   * every synonym, including curated OCR typo variants.
   */
  private async buildDictionary(): Promise<ResolutionDictionary> {
    const [ingredients, synonyms] = await Promise.all([
      this.ingredients.listAll(),
      this.ingredients.listAllSynonymsWithIngredients(),
    ]);
    const byNormalized = new Map<string, Ingredient>();
    for (const ingredient of ingredients) {
      byNormalized.set(ingredient.normalized, ingredient);
    }
    const bySynonym = new Map<string, Ingredient>();
    for (const synonym of synonyms) {
      bySynonym.set(synonym.normalized, synonym.ingredient);
    }
    return { byNormalized, bySynonym };
  }

  /**
   * Precedence per ingredient:
   *   1. Base rule of the active methodology version (flag, severity, citation).
   *   2. Profile contextual modifier: tightens the base rule when it is more
   *      severe, or creates a finding when no base rule exists. A modifier
   *      never loosens a base rule.
   *
   * Output is order-independent: findings and unknowns are sorted, so the
   * same ingredient set yields an identical result under any list order.
   * Confidence degrades with the share of unrecognized labels.
   */
  private evaluate(
    labels: string[],
    ruleIndex: Map<string, RuleView>,
    modifiers: Map<string, ModifierView> | null,
    dictionary: ResolutionDictionary,
  ): { findings: Finding[]; unknown: string[]; confidence: number; disclaimer: string } {
    const findings: Finding[] = [];
    const unknown: string[] = [];

    for (const label of labels) {
      const normalizedLabel = normalizeLabel(label);
      const ingredient =
        dictionary.byNormalized.get(normalizedLabel) ?? dictionary.bySynonym.get(normalizedLabel);

      if (!ingredient) {
        // Unrecognized labels are reported, never guessed.
        unknown.push(label);
        continue;
      }

      const rule = ruleIndex.get(ingredient.id);
      const modifier = modifiers?.get(ingredient.id);

      let flagged = false;
      let severity: Severity | null = null;
      let source: string | null = null;
      let profileAdjusted = false;

      if (rule) {
        flagged = true;
        severity = rule.severity;
        source = rule.sourceCitation;
      }
      if (modifier) {
        if (!rule) {
          flagged = true;
          severity = modifier.severity;
          source = modifier.citation;
          profileAdjusted = true;
        } else if (severity !== null && SEVERITY_RANK[modifier.severity] > SEVERITY_RANK[severity]) {
          severity = modifier.severity;
          source = modifier.citation;
          profileAdjusted = true;
        }
      }

      findings.push({
        label,
        normalizedLabel,
        ingredient: ingredient.name,
        flagged,
        severity,
        source,
        profileAdjusted,
      });
    }

    findings.sort(
      (a, b) => compareStrings(a.normalizedLabel, b.normalizedLabel) || compareStrings(a.label, b.label),
    );
    unknown.sort(compareStrings);

    const total = labels.length;
    const confidence = total === 0 ? 1 : round4((total - unknown.length) / total);

    return { findings, unknown, confidence, disclaimer: CLASSIFICATION_DISCLAIMER };
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
