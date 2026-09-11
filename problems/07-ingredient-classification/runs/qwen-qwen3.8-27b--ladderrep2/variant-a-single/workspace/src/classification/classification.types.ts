import type { Severity } from '../common/severity.js';

/** Per-ingredient finding. `flag` means "a rule of record applies". */
export interface IngredientFinding {
  raw: string;
  normalized: string;
  status: 'resolved' | 'unknown';
  ingredientId: string | null;
  canonicalName: string | null;
  matchedAs: 'canonical' | 'synonym' | null;
  flag: boolean;
  severity: Severity | null;
  /** Citation of the finding of record (regulator source or profile reason). */
  source: string | null;
  /** The base methodology rule for this ingredient, if any. */
  base: { severity: Severity; source: string } | null;
  /** The profile modifier that determined the finding, if any. */
  profile: { severity: Severity; reason: string } | null;
}

export interface ClassificationOutput {
  productId: string;
  methodologyVersionId: string;
  methodologyVersionLabel: string;
  profile: { id: string; name: string } | null;
  /** Canonical order: sorted by (normalized, raw) — independent of list order. */
  ingredients: IngredientFinding[];
  /** Raw forms that could not be resolved, sorted. */
  unknownIngredients: string[];
  /** Share of the list that was recognised; lowered by every unknown. */
  confidence: number;
  disclaimer: string;
}

/** A stored result as persisted — always the profile-less baseline. */
export interface SavedResultView {
  productId: string;
  methodologyVersionId: string;
  methodologyVersionLabel: string;
  profile: null;
  ingredients: IngredientFinding[];
  unknownIngredients: string[];
  confidence: number;
  disclaimer: string;
  savedAt: string;
}
