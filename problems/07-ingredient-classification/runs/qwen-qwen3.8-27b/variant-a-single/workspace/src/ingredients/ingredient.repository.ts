import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service.js';

export type Severity = 'banned' | 'restricted' | 'watch';
export type FindingStatus = 'flagged' | 'clear' | 'unknown';
export type MatchedBy = 'direct' | 'synonym' | 'typo' | null;

export interface IngredientFinding {
  ingredient: string;
  canonicalName: string | null;
  rawName: string;
  status: FindingStatus;
  severity: Severity | null;
  source: string | null;
  flag: string | null;
  matchedBy: MatchedBy;
}

export interface CanonicalIngredient {
  id: string;
  canonicalName: string;
  normalized: string;
}

export interface Synonym {
  id: string;
  ingredientId: string;
  synonym: string;
  normalized: string;
}

@Injectable()
export class IngredientRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findCanonicalByNormalized(normalized: string): Promise<string | null> {
    const result = await this.prisma.$queryRaw<Array<{ canonicalName: string }>>`
      SELECT "canonicalName" FROM "ingredients" WHERE "normalized" = ${normalized} LIMIT 1
    `;
    return result.length > 0 ? result[0].canonicalName : null;
  }

  async findCanonicalBySynonym(normalized: string): Promise<string | null> {
    const result = await this.prisma.$queryRaw<Array<{ canonicalName: string }>>`
      SELECT i."canonicalName"
      FROM "synonyms" s
      JOIN "ingredients" i ON i.id = s."ingredientId"
      WHERE s."normalized" = ${normalized}
      LIMIT 1
    `;
    return result.length > 0 ? result[0].canonicalName : null;
  }

  async findCanonicalByTypo(normalized: string): Promise<string | null> {
    // Fuzzy match via Levenshtein distance <= 2 on normalized form.
    const result = await this.prisma.$queryRaw<Array<{ canonicalName: string }>>`
      SELECT i."canonicalName"
      FROM "ingredients" i
      WHERE levenshtein(i."normalized", ${normalized}) <= 2
      ORDER BY levenshtein(i."normalized", ${normalized})
      LIMIT 1
    `;
    return result.length > 0 ? result[0].canonicalName : null;
  }
}
