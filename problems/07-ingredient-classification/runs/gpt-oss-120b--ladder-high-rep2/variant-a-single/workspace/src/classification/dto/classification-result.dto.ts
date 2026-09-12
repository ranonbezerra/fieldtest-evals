export type Severity = 'banned' | 'restricted' | 'watch';

export interface Finding {
  ingredient: string;
  flag: boolean;
  severity?: Severity;
  sourceCitation?: string;
  unknown: boolean;
}

export interface ClassificationResult {
  findings: Finding[];
  confidence: number; // 0 .. 1
  disclaimer: string;
}
