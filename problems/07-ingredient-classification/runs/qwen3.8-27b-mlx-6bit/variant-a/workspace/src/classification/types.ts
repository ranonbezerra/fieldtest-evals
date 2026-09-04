export type Severity = 'banned' | 'restricted' | 'watch';

export interface IngredientFinding {
  rawText: string;
  resolvedName: string | null; // null when unknown
  ingredientId: number | null;
  isUnknown: boolean;
  flag: string | null;
  severity: Severity | null;
  sourceCitation: string | null;
}

export interface ClassificationResponse {
  productId: number;
  methodologyVersionId: number;
  findings: IngredientFinding[]; // sorted by product_ingredients.position
  unknownIngredients: string[]; // rawText of each unknown, same order
  overallConfidence: number; // 0..1
  disclaimer: string; // fixed English disclaimer
}

export interface ProfiledClassificationResponse extends ClassificationResponse {
  profileId: number;
}

export class ResourceNotFound extends Error {
  readonly code = 'resource_not_found';
}

export class ConflictError extends Error {
  readonly code = 'conflict';
}
