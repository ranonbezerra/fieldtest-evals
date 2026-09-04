# 21-classification.repository.ts

## reasoning

```
Let me analyze the PLAN.md to understand what `classification.repository.ts` needs to contain.

From the plan:

**Repository interface:**
```ts
class ClassificationRepository {
  upsert(result: Omit<ClassificationResult, 'id' | 'createdAt' | 'updatedAt'>,
         findings: Omit<ClassificationFinding, 'id'>[]): Promise<ClassificationResult>;
  findByProductAndVersion(productId: number, versionId: number): Promise<ClassificationResult | null>;
  findByProductId(productId: number): Promise<ClassificationResult[]>;
}
```

**Schema for classification_results:**
- `id` INT PK AI
- `product_id` INT FK NOT NULL
- `methodology_version_id` INT FK NOT NULL
- `overall_confidence` REAL NOT NULL
- `disclaimer` TEXT NOT NULL
- `created_at` TIMESTAMPTZ DEFAULT now()
- `updated_at` TIMESTAMPTZ
- **UNIQUE**(`product_id`, `methodology_version_id`)

**Schema for classification_findings:**
- `id` INT PK AI
- `classification_result_id` INT FK→classification_results.id NOT NULL
- `raw_text` TEXT NOT NULL
- `resolved_name` TEXT NULL
- `ingredient_id` INT NULL (no FK constraint; null when unknown)
- `is_unknown` BOOL DEFAULT false
- `flag` TEXT NULL
- `severity` SEV_ENUM NULL
- `source_citation` TEXT NULL

**Key behaviors:**
- Upsert is idempotent on the composite key `(product_id, methodology_version_id)`
- The upsert wraps in a transaction: upsert the result row + delete-and-insert findings rows
- Findings are sorted by position before being stored (but the findings schema doesn't have a position column... let me re-check)

Wait, looking at the findings schema again:
- `id` INT PK AI
- `classification_result_id` INT FK→classification_results.id NOT NULL
- `raw_text` TEXT NOT NULL
- `resolved_name` TEXT NULL
- `ingredient_id` INT NULL
- `is_unknown` BOOL DEFAULT false
- `flag` TEXT NULL
- `severity` SEV_ENUM NULL
- `source_citation` TEXT NULL

There's no `position` column in findings. The ordering is handled by the service layer sorting before passing to the repository. The findings are stored in order (inserted in position order), but there's no explicit position column.

Actually, looking more carefully at the plan: "delete-and-insert findings rows" — so the upsert method needs to:
1. Upsert the classification_result row (on unique key product_id + methodology_version_id)
2. Delete all existing findings for that result
3. Insert new findings

This should be in a transaction.

Now let me think about the Prisma model names. The plan uses `snake_case` for table names via `@@map`. The Prisma model names would be in PascalCase. Let me figure out the model names:

- `methodology_versions` → Model: `MethodologyVersion`
- `ingredients` → Model: `Ingredient`
- `synonyms` → Model: `Synonym`
- `rules` → Model: `Rule`
- `profiles` → Model: `Profile`
- `profile_modifiers` → Model: `ProfileModifier`
- `products` → Model: `Product`
- `product_ingredients` → Model: `ProductIngredient`
- `classification_results` → Model: `ClassificationResult`
- `classification_findings` → Model: `ClassificationFinding`

The Prisma client would be injected via constructor. In NestJS with Prisma, typically you inject `PrismaService` (from @prisma/client or a custom service).

Looking at the layout, there's no `src/prisma/` mentioned. The convention says the repository is the only layer that touches the database. So I'll inject `PrismaService` directly.

Wait, but looking at the manifest more carefully:
```
src/classification/classification.repository.ts | reads: - | Prisma upsert + read for classification_results / findings
```

It reads nothing from other files in the project (just Prisma client). Let me think about what imports I need.

I need:
- `Injectable` from `@nestjs/common`
- `PrismaService` — but where does this come from? In a typical NestJS + Prisma setup, you'd have a `PrismaService` in `src/prisma/prisma.service.ts`. But the plan doesn't mention that file. 

Hmm, the plan's manifest doesn't list a `src/prisma/prisma.service.ts` file. But Prisma needs a service to be injected. This is a common pattern. Since the plan doesn't explicitly list it, I'll assume it exists as a standard PrismaService that extends PrismaClient. This is the most defensible reading.

Actually, let me re-read the plan. The plan says:
- `src/main.ts` — Bootstrap: NestFactory, global exception filter
- `src/app.module.ts` — Root module importing all feature modules

It doesn't explicitly mention a PrismaService, but it's implied that repositories use Prisma. The most standard pattern in NestJS + Prisma is to have a `PrismaService` that extends `PrismaClient` and is provided globally or in a PrismaModule. Since the plan doesn't name this file, I'll inject it assuming it exists as `PrismaService` from a common location.

Let me write the repository:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(
    result: {
      productId: number;
      methodologyVersionId: number;
      overallConfidence: number;
      disclaimer: string;
    },
    findings: {
      rawText: string;
      resolvedName: string | null;
      ingredientId: number | null;
      isUnknown: boolean;
      flag: string | null;
      severity: string | null;
      sourceCitation: string | null;
    }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const classificationResult = await tx.classificationResult.upsert({
        where: {
          productId_methodologyVersionId: {
            productId: result.productId,
            methodologyVersionId: result.methodologyVersionId,
          },
        },
        update: {
          overallConfidence: result.overallConfidence,
          disclaimer: result.disclaimer,
        },
        create: {
          productId: result.productId,
          methodologyVersionId: result.methodologyVersionId,
          overallConfidence: result.overallConfidence,
          disclaimer: result.disclaimer,
        },
      });

      // Delete existing findings
      await tx.classificationFinding.deleteMany({
        where: { classificationResultId: classificationResult.id },
      });

      // Insert new findings
      if (findings.length > 0) {
        await tx.classificationFinding.createMany({
          data: findings.map((f) => ({
            classificationResultId: classificationResult.id,
            rawText: f.rawText,
            resolvedName: f.resolvedName,
            ingredientId: f.ingredientId,
            isUnknown: f.isUnknown,
            flag: f.flag,
            severity: f.severity,
            sourceCitation: f.sourceCitation,
          })),
        });
      }

      return classificationResult;
    });
  }

  async findByProductAndVersion(productId: number, versionId: number) {
    return this.prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId: versionId,
        },
      },
      include: { classificationFindings: true },
    });
  }

  async findByProductId(productId: number) {
    return this.prisma.classificationResult.findMany({
      where: { productId },
      include: { classificationFindings: true },
    });
  }
}
```

Wait, I need to think about the return type of `upsert`. The plan says it returns `Promise<ClassificationResult>`. The `ClassificationResult` type from Prisma would be the model type. I don't need to explicitly type it if TypeScript infers it, but I could use `Prisma.ClassificationResultGetPayload` or just let it be inferred.

Actually, looking at the plan's type definitions in section 3:
```ts
export interface ClassificationResponse {
  productId: number;
  methodologyVersionId: number;
  findings: IngredientFinding[];
  unknownIngredients: string[];
  overallConfidence: number;
  disclaimer: string;
}
```

This is the API response type, not the Prisma model type. The repository returns the Prisma model. Let me keep it simple and let TypeScript infer.

Now, about the `severity` field — in Prisma, if it's an enum (`SEV_ENUM`), the type would be the enum type. But since I'm not sure of the exact Prisma enum import, and the plan says `SEV_ENUM: BANNED, RESTRICTED, WATCH`, in Prisma this would be a $nativeType or a Prisma enum. The input for create/upsert would accept the string value.

Actually, in Prisma, if you define an enum in the schema:
```prisma
enum SEV_ENUM {
  BANNED
  RESTRICTED
  WATCH
}
```

Then in the client, you'd import `SEV_ENUM` from `@prisma/client`. But since I'm just passing through values, TypeScript should handle it. The `severity` field in findings would be typed as `SEV_ENUM | null` in the Prisma client.

Let me also consider: does the plan say the repository should import types from `types.ts`? Looking at the manifest:
```
src/classification/classification.repository.ts | reads: - | Prisma upsert + read for classification_results / findings
```

It reads nothing. So it shouldn't import from `types.ts`. It works with raw Prisma types and plain objects.

Let me also think about whether I need to handle the `updatedAt` field. The schema has `updated_at TIMESTAMPTZ`. In Prisma, this would be a field on the model. On upsert update, I could set it to `new Date()`. Let me include that.

Actually, looking at the plan's schema:
- `created_at` TIMESTAMPTZ DEFAULT now() — this is set automatically
- `updated_at` TIMESTAMPTZ — no default mentioned, so it's just nullable or needs to be set

In Prisma, if `updatedAt` has no `@default`, it would be nullable. But typically you'd set it on update. Let me add `updatedAt: new Date()` in the update part of the upsert.

Let me finalize my implementation. I'll keep it clean and aligned with the plan.

One more consideration: the `Omit<ClassificationResult, 'id' | 'createdAt' | 'updatedAt'>` in the plan's interface means the caller doesn't pass id, createdAt, or updatedAt. So the repository receives just `productId`, `methodologyVersionId`, `overallConfidence`, `disclaimer`. That matches what I have.

For findings: `Omit<ClassificationFinding, 'id'>` means the caller passes everything except id. So: `classificationResultId`? Wait no — looking at the findings schema, `classification_result_id` is a field. But in the upsert signature, the findings are separate from the result. The repository needs to assign the `classificationResultId` after creating/upserting the result. So the caller doesn't pass `classificationResultId` — the repository assigns it.

Actually wait, let me re-read: `findings: Omit<ClassificationFinding, 'id'>[]`. The `ClassificationFinding` Prisma model includes `classificationResultId`. So `Omit<ClassificationFinding, 'id'>` would still include `classificationResultId`. But that doesn't make sense because the caller wouldn't know the result id before the upsert.

I think the plan's intent is that the findings parameter excludes both `id` and `classificationResultId` (since those are assigned by the repository). Let me look at this more carefully.

Actually, in the control flow section:
> 8. **Upsert stored result** (base findings only, no profile overlay) + delete-and-insert findings rows, keyed by `(productId, activeVersionId)`.

The service builds the findings without knowing the result id, then passes them to the repository. The repository assigns the `classificationResultId`. So the findings parameter should NOT include `classificationResultId`.

But the plan's type says `Omit<ClassificationFinding, 'id'>[]`. If `ClassificationFinding` in Prisma has fields: id, classificationResultId, rawText, resolvedName, ingredientId, isUnknown, flag, severity, sourceCitation — then `Omit<ClassificationFinding, 'id'>` still has `classificationResultId`.

I think the most defensible reading is that the caller passes findings without `id` and without `classificationResultId`, and the repository assigns both. I'll type the findings parameter to exclude both, or just accept a partial type that doesn't include those two fields.

Let me just type it practically: the findings array items have `rawText`, `resolvedName`, `ingredientId`, `isUnknown`, `flag`, `severity`, `sourceCitation`. The repository adds `classificationResultId` and lets Prisma generate `id`.

I'll write the file now. Let me also make sure I'm using the right Prisma client method names. In Prisma, the model delegate is typically camelCase of the model name: `classificationResult`, `classificationFinding`.

Let me write the final version.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(
    result: {
      productId: number;
      methodologyVersionId: number;
      overallConfidence: number;
      disclaimer: string;
    },
    findings: {
      rawText: string;
      resolvedName: string | null;
      ingredientId: number | null;
      isUnknown: boolean;
      flag: string | null;
      severity: string | null;
      sourceCitation: string | null;
    }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const classificationResult = await tx.classificationResult.upsert({
        where: {
          productId_methodologyVersionId: {
            productId: result.productId,
            methodologyVersionId: result.methodologyVersionId,
          },
        },
        update: {
          overallConfidence: result.overallConfidence,
          disclaimer: result.disclaimer,
          updatedAt: new Date(),
        },
        create: {
          productId: result.productId,
          methodologyVersionId: result.methodologyVersionId,
          overallConfidence: result.overallConfidence,
          disclaimer: result.disclaimer,
        },
      });

      await tx.classificationFinding.deleteMany({
        where: { classificationResultId: classificationResult.id },
      });

      if (findings.length > 0) {
        await tx.classificationFinding.createMany({
          data: findings.map((f) => ({
            classificationResultId: classificationResult.id,
            rawText: f.rawText,
            resolvedName: f.resolvedName,
            ingredientId: f.ingredientId,
            isUnknown: f.isUnknown,
            flag: f.flag,
            severity: f.severity,
            sourceCitation: f.sourceCitation,
          })),
        });
      }

      return classificationResult;
    });
  }

  async findByProductAndVersion(productId: number, versionId: number) {
    return this.prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId: versionId,
        },
      },
      include: { classificationFindings: true },
    });
  }

  async findByProductId(productId: number) {
    return this.prisma.classificationResult.findMany({
      where: { productId },
      include: { classificationFindings: true },
    });
  }
}
```
