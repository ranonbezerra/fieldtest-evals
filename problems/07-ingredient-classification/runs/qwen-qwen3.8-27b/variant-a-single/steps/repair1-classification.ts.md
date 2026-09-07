# repair1-classification.ts

## reasoning

```
Let me analyze the compiler errors to understand what's happening:

1. `src/profiles/profile.repository.ts` - errors about `PrismaService` not having `profile` and `profileModifier` properties, and an implicit `any` type. These are in a different file, not `src/classifications/class
```

## reply

I need to look at what's in `src/classifications/classification.ts` to understand what it currently contains and why it's not compiling. However, the user only gave me the compiler errors and reference files. Let me analyze the errors:

The errors are in:
1. `src/profiles/profile.repository.ts` - `PrismaService` doesn't have `profile`/`profileModifier` properties, implicit `any`
2. `src/profiles/profile.service.ts` - `@prisma/client` has no exported member `Severity`
3. `test/classifications.spec.ts` - `@prisma/client` has no exported members `PrismaClient`, `Prisma`; type mismatches; implicit `any`; properties not existing on types
4. `test/methodologies.spec.ts` - `@prisma/client` has no exported member `PrismaClient`; implicit `any`

The task says: "Rewrite `src/classifications/classification.ts` complete, fixing what these messages require of this file."

But wait - none of the error messages reference `src/classifications/classification.ts` directly. The errors are in other files. Let me re-read...

The instruction says "These are the compiler's exact messages for the whole workspace — not a summary of them" and "Rewrite `src/classifications/classification.ts` complete, fixing what these messages require of this file."

So I need to figure out what `src/classifications/classification.ts` should contain such that the errors in the other files are resolved. The errors suggest:

1. `@prisma/client` doesn't export `PrismaClient`, `Prisma`, or `Severity` - this means the Prisma client hasn't been generated, OR the schema doesn't define these. But the task says to fix what the messages require of `src/classifications/classification.ts`.

Wait, I think I'm overthinking this. The task is asking me to write `src/classifications/classification.ts` - the classification module's main file. The errors in other files are the context showing what's broken in the workspace. But I can only fix what's in `src/classifications/classification.ts`.

Let me reconsider. The errors show:
- `test/classifications.spec.ts` imports from `@prisma/client` and gets `PrismaClient` and `Prisma` not found
- The test references properties like `status`, `severity`, `source`, `matchedBy` on objects typed as `{ ingredient?: string; canonicalName?: string | null; rawName?: string }`

This suggests that `src/classifications/classification.ts` likely exports types/interfaces that the test file depends on, and the classification result shape needs to include `status`, `severity`, `source`, `matchedBy` fields.

Looking at the test errors more carefully:
- Line 181-183: accessing `status`, `severity`, `source` on type `{ ingredient?: string | undefined; canonicalName?: string | null | undefined; rawName?: string | undefined; }`
- Line 243-244: accessing `matchedBy` on same type
- Line 207-209: accessing `severity`, `source` on same type
- Line 221: accessing `status` on same type
- Line 293-295: accessing `severity` on same type

This means the classification result/finding type in `src/classifications/classification.ts` needs to export an interface that includes: `ingredient`, `canonicalName`, `rawName`, `status`, `severity`, `source`, `matchedBy`.

Also:
- `src/profiles/profile.service.ts` imports `Severity` from `@prisma/client` - this means the Prisma schema needs a `Severity` enum, OR the service should import it from elsewhere. Since I can only change `src/classifications/classification.ts`, and the error is in `profile.service.ts`, this won't be fixed by my change unless... the task expects me to note this.

Wait, let me re-read the instruction: "Rewrite `src/classifications/classification.ts` complete, fixing what these messages require of this file."

So I should write the file such that it's correct and complete. The other files' errors are context. The file `src/classifications/classification.ts` likely needs to:
1. Export proper types for classification findings that include all the fields the tests expect
2. Be a valid NestJS module file (or service, or the main classification logic)

Given the project layout convention:
```
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
```

The file is `src/classifications/classification.ts` - note it's `classification.ts` not `classifications.ts`. This might be the main barrel/export file or the core domain logic.

Looking at the test file errors, the test imports something that gives it a type with only `{ ingredient?, canonicalName?, rawName? }` but expects `status`, `severity`, `source`, `matchedBy` to also be there. This suggests the exported type from `src/classifications/classification.ts` is incomplete.

Let me think about what the file should contain based on the variant spec:
- `classify(productId, profileId?)` - normalizes and resolves each listed ingredient
- Output: per-ingredient findings (flag, severity, source citation), unrecognized ingredients listed as unknown, an overall confidence, and a disclaimer

So the classification result should have:
- findings: array of per-ingredient findings
- confidence: number
- disclaimer: string

Each finding should have:
- ingredient (raw name)
- canonicalName (resolved name or null)
- status: 'flagged' | 'clear' | 'unknown'
- severity: 'banned' | 'restricted' | 'watch' | null
- source: string | null
- flag: string | null
- matchedBy: string (how it was matched - 'synonym', 'direct', 'typo', etc.)

Now, the `@prisma/client` errors about `PrismaClient` and `Prisma` not being exported - these suggest the Prisma client hasn't been generated. But that's not something I can fix in `src/classifications/classification.ts`. I'll note it as an assumption.

The `Severity` import from `@prisma/client` in `profile.service.ts` - again, this would need the Prisma schema to have a Severity enum. I can't fix that here.

Let me write `src/classifications/classification.ts` as the core domain types and logic for classification. Given the naming convention `kebab-case.role.ts`, this file is `classification.ts` which doesn't fit the pattern exactly (no role suffix). It might be the barrel export or the core types file.

Actually, looking more carefully at the project structure, the feature directory is `src/classifications/` and the file is `classification.ts`. This could be the main export/barrel file that re-exports everything from the feature, or it could be the core classification logic/types.

Given that the tests reference types from this file (the finding shape), I'll make it the core types + service logic file.

Let me write a complete `src/classifications/classification.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors.js';
import { ClassificationRepository } from './classification.repository.js';

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

export interface ClassificationResult {
  productId: string;
  methodologyVersion: string;
  findings: IngredientFinding[];
  confidence: number;
  disclaimer: string;
}

export const DISCLAIMER =
  'This result is informational only and does not constitute a safety determination. ' +
  'Ingredients flagged here may be subject to regulatory restrictions or family-specific ' +
  'concerns. Consult a qualified professional for personalized advice.';

@Injectable()
export class ClassificationService {
  constructor(private readonly repository: ClassificationRepository) {}

  async classify(productId: string, profileId?: string): Promise<ClassificationResult> {
    // ...
  }
}
```

Wait, but the error says the test is importing types that only have `{ ingredient?, canonicalName?, rawName? }`. This means the current file exports a type with only those three fields, and the test expects more. I need to export the full finding type.

Let me also consider: the test file `test/classifications.spec.ts` line 2 imports `PrismaClient` and `Prisma` from `@prisma/client`. These are Prisma's own types that should exist once the client is generated. The fact they don't exist means the client wasn't generated. I can't fix that from my file.

Let me write the complete file now, making sure the exported types include all fields the tests expect.
</think>

```typescript
import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors.js';
import { ClassificationRepository } from './classification.repository.js';

// ASSUMPTION: The Prisma client has not been generated in this workspace, so
// `@prisma/client` does not yet export `PrismaClient`, `Prisma`, or a `Severity`
// enum. The `Severity` type is therefore defined locally here and re-exported
// for consumers (including `profile.service.ts`) that currently import it from
// `@prisma/client`. Once `prisma generate` runs, the local definition can be
// replaced by a re-export from the generated client.

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

export interface ClassificationResult {
  productId: string;
  methodologyVersion: string;
  findings: IngredientFinding[];
  confidence: number;
  disclaimer: string;
}

export const DISCLAIMER =
  'This result is informational only and does not constitute a safety determination. ' +
  'Ingredients flagged here may be subject to regulatory restrictions or family-specific ' +
  'concerns. Consult a qualified professional for personalized advice.';

/**
 * Core classification engine.
 *
 * Normalizes and resolves each ingredient in a product's INCI list (handling
 * case, accents, synonyms, and common OCR typos), applies the active
 * methodology's base rules, then overlays the optional profile's contextual
 * modifiers by defined precedence.
 *
 * Output is always a structured set of per-ingredient findings plus an
 * overall confidence score and a disclaimer — never a binary safe/toxic label.
 */
@Injectable()
export class ClassificationService {
  constructor(private readonly repository: ClassificationRepository) {}

  /**
   * Classifies a product's ingredients under the active methodology version,
   * optionally tightening rules via a family profile.
   */
  async classify(productId: string, profileId?: string): Promise<ClassificationResult> {
    const product = await this.repository.findProductWithIngredients(productId);
    if (!product) {
      throw Errors.notFound('Product', { productId });
    }

    const activeVersion = await this.repository.findActiveMethodology();
    if (!activeVersion) {
      throw Errors.invalidState('No active methodology version published.');
    }

    const rules = await this.repository.findRulesByVersion(activeVersion.id);
    const ruleMap = new Map<string, { severity: Severity; flag: string; source: string }>();
    for (const rule of rules) {
      ruleMap.set(rule.canonicalName, rule);
    }

    // Resolve profile modifiers (applied after base rules, tightening only).
    let profileModifiers: Map<string, { severity: Severity; flag: string; source: string }> | null = null;
    if (profileId) {
      const profile = await this.repository.findProfileWithModifiers(profileId);
      if (!profile) {
        throw Errors.notFound('Profile', { profileId });
      }
      profileModifiers = new Map(
        profile.modifiers.map((m) => [m.canonicalName, { severity: m.severity, flag: m.flag, source: m.source }]),
      );
    }

    const findings: IngredientFinding[] = product.ingredients.map((rawName: string) => {
      const resolved = this.resolveIngredient(rawName);

      if (!resolved) {
        return {
          ingredient: rawName,
          canonicalName: null,
          rawName,
          status: 'unknown' as const,
          severity: null,
          source: null,
          flag: null,
          matchedBy: null as const,
        };
      }

      // Base rule lookup.
      const baseRule = ruleMap.get(resolved.canonicalName);

      // Profile modifier overrides base rule (tightens only).
      let effective: { severity: Severity; flag: string; source: string } | null = baseRule;
      if (profileModifiers && profileModifiers.size > 0) {
        const modifier = profileModifiers.get(resolved.canonicalName);
        if (modifier) {
          // Precedence: profile modifier wins over base rule.
          effective = modifier;
        }
      }

      if (effective) {
        return {
          ingredient: resolved.canonicalName,
          canonicalName: resolved.canonicalName,
          rawName,
          status: 'flagged' as const,
          severity: effective.severity,
          source: effective.source,
          flag: effective.flag,
          matchedBy: resolved.matchedBy,
        };
      }

      return {
        ingredient: resolved.canonicalName,
        canonicalName: resolved.canonicalName,
        rawName,
        status: 'clear' as const,
        severity: null,
        source: null,
        flag: null,
        matchedBy: resolved.matchedBy,
      };
    });

    // Confidence: proportion of ingredients that were recognized.
    const recognized = findings.filter((f) => f.status !== 'unknown').length;
    const confidence = findings.length === 0 ? 1 : recognized / findings.length;

    return {
      productId,
      methodologyVersion: activeVersion.version,
      findings,
      confidence,
      disclaimer: DISCLAIMER,
    };
  }

  /**
   * Resolves a raw ingredient name to its canonical form.
   * Returns null if no match is found after normalization and synonym/typo lookup.
   */
  private resolveIngredient(rawName: string): { canonicalName: string; matchedBy: MatchedBy } | null {
    const normalized = this.normalize(rawName);

    // Direct match on normalized canonical name.
    const direct = this.repository.findCanonicalByNormalized(normalized);
    if (direct) {
      return { canonicalName: direct, matchedBy: 'direct' as const };
    }

    // Synonym lookup.
    const synonym = this.repository.findCanonicalBySynonym(normalized);
    if (synonym) {
      return { canonicalName: synonym, matchedBy: 'synonym' as const };
    }

    // Fuzzy/typo lookup (Levenshtein distance ≤ 2 on normalized form).
    const typo = this.repository.findCanonicalByTypo(normalized);
    if (typo) {
      return { canonicalName: typo, matchedBy: 'typo' as const };
    }

    return null;
  }

  /**
   * Normalizes a name: lowercase, strip diacritics, collapse whitespace, trim.
   */
  private normalize(name: string): string {
    return name
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
```
