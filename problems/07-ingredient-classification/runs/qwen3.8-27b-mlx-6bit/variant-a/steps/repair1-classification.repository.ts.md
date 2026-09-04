# repair1-classification.repository.ts

## reasoning

```
Let me analyze the compiler errors carefully.

The errors are all in `test/classification.spec.ts` and they say:

```
Property 'ingredients' is missing in type '{ id: number; name: string; productIngredients: { rawText: string; position: number; }[]; }' but required in type '{ id: number; name: string; ingredients: { rawText: string; position: number; }[]; }'.
```

This means the test is passing an object with `productIngredients` property, but the type it's being assigned to expects an `ingredients` property.

The task says: "Rewrite `src/classification/classification.repository.ts` complete, fixing what these messages require of this file."

So the issue is that `classification.repository.ts` defines or uses a type that has `ingredients: { rawText: string; position: number; }[]` but the test is using `productIngredients` as the property name.

Looking at the plan, the `ProductRepository` has:
```ts
listWithIngredients(): Promise<Product[]>;   // products that have ≥1 product_ingredient
```

And `ProductService` has:
```ts
getWithIngredients(id: number): Promise<Product | null>;
```

The product in the database has a relation `product_ingredients` which Prisma would map to `productIngredients` by default (camelCase of the table name).

But the classification service needs to work with a product that has its ingredients. The test is mocking what appears to be a return value from a repository method, and it's using `productIngredients` as the property name.

Wait, let me re-read the errors. The test at line 284 is assigning an object `{ id: number; name: string; productIngredients: { rawText: string; position: number; }[] }` to something that expects `{ id: number; name: string; ingredients: { rawText: string; position: number; }[] }`.

So the type expected by `classification.repository.ts` (or a type it imports/uses) has a property called `ingredients`, but the test is providing `productIngredients`.

The fix needs to be in `classification.repository.ts`. The repository file must be defining or using a type where the product's ingredients are accessed via an `ingredients` property, but the actual shape (as defined by Prisma or as used in the test) uses `productIngredients`.

So I need to change the type in `classification.repository.ts` to use `productIngredients` instead of `ingredients`.

Wait, but I can't see the actual file content. Let me think about what the classification repository would need.

Looking at the plan:
- `ClassificationRepository` has methods like `upsert`, `findByProductAndVersion`, `findByProductId`
- The `ClassificationService` uses `ProductRepository` to get products with ingredients

The errors are in the test file where it's mocking/setting up data. The test is passing objects with `productIngredients` but something in the classification repository (or a type it defines) expects `ingredients`.

Since I'm told to rewrite `classification.repository.ts` and the errors point to a type mismatch where the expected type has `ingredients` but the provided type has `productIngredients`, I need to make the classification repository use `productIngredients` as the property name.

But wait - I need to think about what shape the classification repository actually works with. The `ClassificationRepository` deals with `classification_results` and `classification_findings` tables. It wouldn't directly deal with product shapes...

Unless the classification repository has a method that accepts or returns product data. Let me reconsider.

Actually, looking more carefully at the error: the test is at `test/classification.spec.ts` and it's passing objects to something. The type that requires `ingredients` must be defined in or imported from `classification.repository.ts`.

Given that I can't see the actual file, I need to infer what it looks like based on:
1. The plan
2. The error messages

The most likely scenario: the `classification.repository.ts` file defines a type (perhaps for the product-with-ingredients shape that the service uses) that has `ingredients: { rawText: string; position: number; }[]` but it should be `productIngredients: { rawText: string; position: number; }[]` to match what Prisma actually returns (since the relation is `product_ingredients` in the schema).

Wait, actually looking at the Prisma schema convention: if the table is `product_ingredients`, Prisma would generate a relation property. The relation name in the Prisma model would determine the property name. If the model has:

```prisma
model Product {
  ...
  productIngredients ProductIngredient[] @map("product_ingredients") // no, this is wrong
}
```

Actually in Prisma, the relation field name in the model determines the property name in the JS/TS object. So if it's:
```prisma
model Product {
  ingredients ProductIngredient[]
}
```
Then the property would be `ingredients`.

If it's:
```prisma
model Product {
  productIngredients ProductIngredient[]
}
```
Then the property would be `productIngredients`.

The test is using `productIngredients`, so the Prisma model likely has `productIngredients` as the relation name. But the classification repository (or a type in it) is expecting `ingredients`.

So the fix is: in `classification.repository.ts`, wherever there's a type that references the product's ingredient list as `ingredients`, change it to `productIngredients`.

Now, what would the classification repository look like? Based on the plan:

```ts
class ClassificationRepository {
  upsert(result: ..., findings: ...[]): Promise<ClassificationResult>;
  findByProductAndVersion(productId: number, versionId: number): Promise<ClassificationResult | null>;
  findByProductId(productId: number): Promise<ClassificationResult[]>;
}
```

These methods don't directly deal with product shapes. But maybe the file also exports a type that's used by the service, or maybe there's a method I'm not seeing.

Hmm, but the task says "fixing what these messages require of this file." So there must be something in `classification.repository.ts` that defines or references a type with `ingredients`.

Let me think about this differently. The classification service needs to:
1. Get a product with its ingredients
2. Resolve each ingredient
3. Apply rules
4. Store the result

The repository layer only touches the database. But maybe the classification repository has a helper method or type that represents a product-with-ingredients for its own internal use.

Given the constraint that I must only change what the messages require, and the messages say the expected type has `ingredients` but the provided type has `productIngredients`, I need to change the type in `classification.repository.ts` from using `ingredients` to using `productIngredients`.

Let me write the file. I'll base it on the plan's specification for `ClassificationRepository` and add the type fix.

Actually, I realize I need to think about this more carefully. The test file is at `test/classification.spec.ts` and it's testing the classification service/repository. The errors show that the test is creating mock objects with `productIngredients` and passing them somewhere that expects `ingredients`.

Since I'm only allowed to modify `classification.repository.ts`, and the error is about a type mismatch, the type with `ingredients` must be defined in or exported from `classification.repository.ts`.

Let me write the complete file. I'll include:
1. The `ClassificationRepository` class with the methods from the plan
2. Any types that the file needs to export, using `productIngredients` instead of `ingredients`

Looking at the plan more carefully:

```
src/classification/classification.repository.ts | reads: - | Prisma upsert + read for classification_results / findings
```

So it only reads from nothing (just Prisma). It handles `classification_results` and `classification_findings`.

But the test errors suggest this file defines a type that includes a product shape with an ingredients array. Maybe it's a parameter type for `upsert` or something else.

Wait, let me re-read the upsert signature:
```ts
upsert(result: Omit<ClassificationResult, 'id' | 'createdAt' | 'updatedAt'>,
       findings: Omit<ClassificationFinding, 'id'>[]): Promise<ClassificationResult>;
```

`ClassificationResult` from the Prisma model would have: `id`, `productId`, `methodologyVersionId`, `overallConfidence`, `disclaimer`, `createdAt`, `updatedAt`. That doesn't include ingredients.

Hmm, maybe there's a different method or type I'm not thinking of. Let me consider that the file might have a type like:

```ts
interface ProductWithIngredients {
  id: number;
  name: string;
  ingredients: { rawText: string; position: number }[];
}
```

That would explain the error. The test is passing `productIngredients` but this type expects `ingredients`.

So my fix is to change `ingredients` to `productIngredients` in whatever type is defined in this file.

Let me write the complete file now. I'll include the repository class and any necessary types, making sure to use `productIngredients` instead of `ingredients`.

Actually, I want to be more careful. Let me look at what the test is doing at those line numbers. The test is at `test/classification.spec.ts` and it's likely mocking the product repository's return value. When it mocks `productRepository.findById()` or similar, it returns an object with `productIngredients`. But if the classification repository (or service) has a type that expects `ingredients`, there's a mismatch.

Since I can only modify `classification.repository.ts`, and the error is about a type in that file expecting `ingredients` when it should expect `productIngredients`, I'll define the types accordingly.

Let me write the file:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service'; // or however prisma is provided

export interface ProductIngredientData {
  rawText: string;
  position: number;
}

export interface ProductWithIngredients {
  id: number;
  name: string;
  productIngredients: ProductIngredientData[];
}

export interface FindingData {
  rawText: string;
  resolvedName: string | null;
  ingredientId: number | null;
  isUnknown: boolean;
  flag: string | null;
  severity: string | null;
  sourceCitation: string | null;
}

export interface ResultData {
  productId: number;
  methodologyVersionId: number;
  overallConfidence: number;
  disclaimer: string;
}

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(result: ResultData, findings: FindingData[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.classificationResult.findUnique({
        where: {
          productId_methodologyVersionId: {
            productId: result.productId,
            methodologyVersionId: result.methodologyVersionId,
          },
        },
      });

      if (existing) {
        await tx.classificationResult.update({
          where: { id: existing.id },
          data: {
            overallConfidence: result.overallConfidence,
            disclaimer: result.disclaimer,
            updatedAt: new Date(),
          },
        });
        await tx.classificationFinding.deleteMany({
          where: { classificationResultId: existing.id },
        });
      }

      const saved = await tx.classificationResult.upsert({
        where: {
          productId_methodologyVersionId: {
            productId: result.productId,
            methodologyVersionId: result.methodologyVersionId,
          },
        },
        create: {
          productId: result.productId,
          methodologyVersionId: result.methodologyVersionId,
          overallConfidence: result.overallConfidence,
          disclaimer: result.disclaimer,
        },
        update: {
          overallConfidence: result.overallConfidence,
          disclaimer: result.disclaimer,
          updatedAt: new Date(),
        },
      });

      if (findings.length > 0) {
        await tx.classificationFinding.createMany({
          data: findings.map((f) => ({
            classificationResultId: saved.id,
            rawText: f.rawText,
            resolvedName: f.resolvedName,
            ingredientId: f.ingredientId,
            isUnknown: f.isUnknown,
            flag: f.flag,
            severity: f.severity as any,
            sourceCitation: f.sourceCitation,
          })),
        });
      }
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
      include: { findings: true },
    });
  }

  async findByProductId(productId: number) {
    return this.prisma.classificationResult.findMany({
      where: { productId },
      include: { findings: true },
    });
  }
}
```

Hmm wait, but I'm not sure about the PrismaService import. Let me look at the conventions again.

The conventions say:
- `repository` is the only layer that touches the database.
- Prisma as the ORM

The layout doesn't show a `prisma.service.ts` file. In NestJS with Prisma, typically you'd have a `PrismaService` that extends `PrismaClient`. But the layout in the conventions doesn't explicitly show it.

Looking at the plan's manifest:
```
src/classification/classification.repository.ts | reads: - | Prisma upsert + read for classification_results / findings
```

It says "reads: -" meaning it doesn't read from any other source file (in terms of the manifest's dependency tracking). But it still needs Prisma access.

I think the safest approach is to inject `PrismaClient` directly or use a `PrismaService`. Since the conventions don't specify a `prisma.service.ts`, I'll use `PrismaClient` from `@prisma/client` directly via injection, or assume there's a `PrismaService`.

Actually, in most NestJS + Prisma setups, you have a `PrismaService` that provides the `PrismaClient` instance. Let me assume it exists at `src/prisma.service.ts` since it's a common pattern and not listed in the feature modules.

Wait, but the conventions say "Do not create a file it does not call for." So I shouldn't assume a `prisma.service.ts` exists unless it's needed. But the repository needs to access Prisma somehow.

Let me just use `PrismaClient` directly. In the repository, I can inject it.

Actually, you know what, let me reconsider. The task says "Rewrite `src/classification/classification.repository.ts` complete, fixing what these messages require of this file." The key fix is changing `ingredients` to `productIngredients` in whatever type the file defines. I should keep the rest of the file as close to what would be reasonable as possible, based on the plan.

Let me also consider: maybe the file doesn't define a `ProductWithIngredients` type at all. Maybe it's the `upsert` method or another method that takes a product shape. But looking at the plan's repository interface:

```ts
class ClassificationRepository {
  upsert(result: Omit<ClassificationResult, 'id' | 'createdAt' | 'updatedAt'>,
         findings: Omit<ClassificationFinding, 'id'>[]): Promise<ClassificationResult>;
  findByProductAndVersion(productId: number, versionId: number): Promise<ClassificationResult | null>;
  findByProductId(productId: number): Promise<ClassificationResult[]>;
}
```

None of these take a product shape. So where does the `ingredients` type come from?

Maybe the file exports a type that the service uses, or maybe there's an additional method not in the plan. Or maybe the type is used internally.

Given that I can't see the actual file, I'll define the types that make sense for the repository to export (that the service might need), and use `productIngredients` instead of `ingredients`.

Let me write a clean version that:
1. Exports types needed by the service (using `productIngredients`)
2. Implements the repository methods from the plan
3. Uses Prisma for database access

I'll keep it focused and minimal, fixing the specific issue (ingredients → productIngredients).
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient, Severity } from '@prisma/client';

export interface ProductIngredientData {
  rawText: string;
  position: number;
}

export interface ProductWithIngredients {
  id: number;
  name: string;
  productIngredients: ProductIngredientData[];
}

export interface FindingData {
  rawText: string;
  resolvedName: string | null;
  ingredientId: number | null;
  isUnknown: boolean;
  flag: string | null;
  severity: Severity | null;
  sourceCitation: string | null;
}

export interface ResultData {
  productId: number;
  methodologyVersionId: number;
  overallConfidence: number;
  disclaimer: string;
}

@Injectable()
export class ClassificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(result: ResultData, findings: FindingData[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.classificationResult.upsert({
        where: {
          productId_methodologyVersionId: {
            productId: result.productId,
            methodologyVersionId: result.methodologyVersionId,
          },
        },
        create: {
          productId: result.productId,
          methodologyVersionId: result.methodologyVersionId,
          overallConfidence: result.overallConfidence,
          disclaimer: result.disclaimer,
        },
        update: {
          overallConfidence: result.overallConfidence,
          disclaimer: result.disclaimer,
          updatedAt: new Date(),
        },
      });

      await tx.classificationFinding.deleteMany({
        where: { classificationResultId: saved.id },
      });

      if (findings.length > 0) {
        await tx.classificationFinding.createMany({
          data: findings.map((f) => ({
            classificationResultId: saved.id,
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
    });
  }

  async findByProductAndVersion(
    productId: number,
    versionId: number,
  ): Promise<null | {
    id: number;
    productId: number;
    methodologyVersionId: number;
    overallConfidence: number;
    disclaimer: string;
    createdAt: Date;
    updatedAt: Date | null;
    findings: Array<{
      id: number;
      classificationResultId: number;
      rawText: string;
      resolvedName: string | null;
      ingredientId: number | null;
      isUnknown: boolean;
      flag: string | null;
      severity: Severity | null;
      sourceCitation: string | null;
    }>;
  }> {
    return this.prisma.classificationResult.findUnique({
      where: {
        productId_methodologyVersionId: {
          productId,
          methodologyVersionId: versionId,
        },
      },
      include: { findings: true },
    });
  }

  async findByProductId(
    productId: number,
  ): Promise<Array<{
    id: number;
    productId: number;
    methodologyVersionId: number;
    overallConfidence: number;
    disclaimer: string;
    createdAt: Date;
    updatedAt: Date | null;
    findings: Array<{
      id: number;
      classificationResultId: number;
      rawText: string;
      resolvedName: string | null;
      ingredientId: number | null;
      isUnknown: boolean;
      flag: string | null;
      severity: Severity | null;
      sourceCitation: string | null;
    }>;
  }>> {
    return this.prisma.classificationResult.findMany({
      where: { productId },
      include: { findings: true },
    });
  }
}
```
