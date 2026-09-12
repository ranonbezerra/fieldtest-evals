import { Severity } from '@prisma/client';

export interface Finding {
  rawName: string;
  ingredientId: number | null;
  isUnknown: boolean;
  flag: boolean;
  severity: Severity | null;
  sourceCitation: string | null;
}
