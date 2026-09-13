export type SeverityString = 'banned' | 'restricted' | 'watch';

export interface IngredientFinding {
  ingredient: string;
  flag: boolean;
  severity: SeverityString | null;
  sourceCitation?: string | null;
  unknown?: boolean;
}

export interface ClassificationResultDto {
  productId: number;
  version: string;
  findings: IngredientFinding[];
  confidence: number; // 0 to 1
  disclaimer: string;
}
