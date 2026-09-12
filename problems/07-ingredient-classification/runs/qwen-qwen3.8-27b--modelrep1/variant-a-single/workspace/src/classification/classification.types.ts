export type Severity = 'banned' | 'restricted' | 'watch';

export const SEVERITIES: readonly Severity[] = ['banned', 'restricted', 'watch'];

const SEVERITY_RANK: Record<Severity, number> = {
  watch: 1,
  restricted: 2,
  banned: 3,
};

/** Numeric precedence used to resolve conflicts (banned > restricted > watch). */
export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity];
}

/**
 * Canonical name normalization: case folding, accent stripping and whitespace
 * collapse. OCR typos are not handled here; they are matched through the
 * synonym table (see prisma/seed-data.ts).
 */
export function normalizeIngredientName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface RuleRef {
  ingredientId: string;
  severity: Severity;
  source: string;
  note: string | null;
}

export interface ModifierRef {
  ingredientId: string;
  severity: Severity;
  source: string;
  note: string | null;
}

export interface ProfileRef {
  id: string;
  name: string;
  description: string | null;
  modifiers: ModifierRef[];
}

export interface ProductRecord {
  id: string;
  name: string;
  /** Raw INCI names exactly as listed on the product. */
  listedIngredients: string[];
}

export interface VersionSummary {
  id: string;
  version: number;
  name: string;
  status: string;
  isActive: boolean;
}

export interface ScoringContext {
  version: VersionSummary;
  rules: RuleRef[];
  /** ingredient id -> canonical name */
  ingredientNameById: Record<string, string>;
  /** normalized form (synonym / typo / canonical) -> ingredient id */
  synonymFormToIngredientId: Record<string, string>;
  /** normalized canonical name -> ingredient id */
  canonicalNameToIngredientId: Record<string, string>;
  products: ProductRecord[];
}

export type FindingStatus = 'flagged' | 'clear' | 'unknown';

export interface Finding {
  /** The raw name exactly as it appears on the product's ingredient list. */
  listedName: string;
  canonicalName: string | null;
  status: FindingStatus;
  /** True when the entry needs human attention (a rule hit or an unknown). */
  flag: boolean;
  severity: Severity | null;
  /** The rule/profile citation backing this finding, when any. */
  source: string | null;
  note: string | null;
}

export interface BaseResult {
  findings: Finding[];
  unknowns: string[];
  confidence: number;
  disclaimer: string;
}

export interface StoredResult extends BaseResult {
  id: string;
  productId: string;
  methodologyVersionId: string;
  classifiedAt: Date;
}

export interface StoredClassificationResponse extends BaseResult {
  productId: string;
  methodologyVersionId: string;
  methodologyVersion: number;
  classifiedAt: Date;
}

export interface ClassificationOutput extends BaseResult {
  productId: string;
  productName: string;
  methodologyVersionId: string;
  methodologyVersion: number;
  profileId: string | null;
  profileName: string | null;
  classifiedAt: Date;
}
