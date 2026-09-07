# repair1-ingredient.repository.ts

## reasoning

```
Let me analyze the compiler errors and determine what `src/ingredients/ingredient.repository.ts` needs to export.

Looking at the errors:

1. `src/profiles/profile.repository.ts(37,39): error TS2339: Property 'profile' does not exist on type 'Prisma
```

## reply

Looking at the compiler errors, I need to determine what `src/ingredients/ingredient.repository.ts` needs to export. The errors are in other files, but they reference the Prisma client not being generated. The key insight is:

- `test/classifications.spec.ts` and `test/methodologies.spec.ts` fail because `@prisma/client` doesn't export `PrismaClient` or `Prisma` — this is expected in a workspace where `prisma generate` hasn't been run.
- The errors in `profile.repository.ts` are about `PrismaService` not having `.profile` / `.profileModifier` — same root cause.
- The errors in `test/classifications.spec.ts` at lines 181-244 reference properties like `status`, `severity`, `source`, `matchedBy` on a type that only has `{ ingredient?: string; canonicalName?: string | null; rawName?: string }` — this means the test is importing a type from the ingredient repository that's incomplete.

The task says to fix `src/ingredients/ingredient.repository.ts` to satisfy what these messages require of **this file**. The test file imports types from this file (or from the classification service which imports from it). The type shape `{ ingredient?: string; canonicalName?: string | null; rawName?: string }` suggests the test is importing an interface from this file that only has those three fields — it's missing `status`, `severity`, `source`, `matchedBy`.

Looking at the classification service, it defines `IngredientFinding` with all those fields. The test likely imports a type from `ingredient.repository.ts` that should be the full finding shape. Since the test uses properties like `status`, `severity`, `source`, `matchedBy`, the repository file must export a type that includes all of them.

The repository should export:
1. An `IngredientFinding` interface (or similar) with all fields the test accesses
2. A repository class with methods for ingredient/synonym resolution

Let me write the file that exports the complete `IngredientFinding` type (matching what the classification service uses) and provides the repository methods needed for ingredient resolution.

```typescript
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
```
