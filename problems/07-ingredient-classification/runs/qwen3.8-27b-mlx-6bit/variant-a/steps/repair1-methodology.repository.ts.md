# repair1-methodology.repository.ts

## reasoning

```
Let me analyze the compiler errors carefully.

The errors are all in `test/classification.spec.ts`, not in `src/methodology/methodology.repository.ts` directly. But the task says to rewrite `src/methodology/methodology.repository.ts` to fix these errors.

Let me look at the errors:

1. Multiple `TS2741` errors: `Property 'ingredients' is missing in type '{ id: number; name: string; productIngredients: { rawText: string; position: number; }[]; }' but required in type '{ id: number; name: string; ingredients: { rawText: string; position: number; }[]; }'`

This means somewhere a type is defined that expects `ingredients: { rawText: string; position: number; }[]` but the actual object being passed has `productIngredients` instead of `ingredients`.

2. `TS18046`: `'v1FindingsCall' is of type 'unknown'` at line 472.

So the issue is that the `ProductRepository.findById` (or similar) method returns a type with `productIngredients` (matching the Prisma relation name), but the service or some other code expects it to have `ingredients` as the property name.

Wait, but I'm asked to fix `src/methodology/methodology.repository.ts`. Let me think about how that file could cause these errors.

Looking at the plan:
- `MethodologyRepository` has methods: `getActive()`, `getById(id)`, `getRules(versionId)`, `create(data)`, `publish(versionId)`

The `ClassificationService` uses `MethodologyRepository`. If the `MethodologyRepository` imports or re-exports a type that's used elsewhere...

Wait, let me reconsider. The errors say the test is passing an object with `productIngredients` where a type expects `ingredients`. This means somewhere in the code, a method that's supposed to return `{ id: number; name: string; ingredients: { rawText: string; position: number; }[] }` is actually returning `{ id: number; name: string; productIngredients: { rawText: string; position: number; }[] }`.

Looking at the plan, `ProductRepository.findById` returns `Promise<Product | null>` and `listWithIngredients()` returns `Promise<Product[]>`. The `Product` type presumably has an `ingredients` field (the mapped relation name).

But wait - the task says to fix `src/methodology/methodology.repository.ts`. How would that file affect the product's return type?

Let me think differently. Maybe the issue is that `MethodologyRepository` is importing a type from somewhere, or maybe the `ClassificationService` is using `MethodologyRepository` in a way that affects type inference.

Actually, wait. Let me re-read the error messages more carefully:

```
Property 'ingredients' is missing in type '{ id: number; name: string; productIngredients: { rawText: string; position: number; }[]; }' but required in type '{ id: number; name: string; ingredients: { rawText: string; position: number; }[]; }'
```

The "but required in type" part tells us what the expected type is: `{ id: number; name: string; ingredients: { rawText: string; position: number; }[]; }`

The actual type being passed has `productIngredients` instead of `ingredients`.

This looks like a Prisma relation naming issue. In Prisma, when you include a relation, the key in the returned object matches the field name in the schema. If the schema uses `@map` for column names but the relation field is named `productIngredients` in the Prisma model, then the returned object will have `productIngredients` as the key.

So the fix would be in how the repository maps the Prisma result to the expected type. But that would be in `product.repository.ts`, not `methodology.repository.ts`.

Hmm, but the task specifically says to rewrite `src/methodology/methodology.repository.ts`. Let me think about whether there's a way the methodology repository could be causing this...

Wait, maybe I'm overthinking this. Perhaps the `MethodologyRepository` file is importing types or has a type that's being used by the test, and the type definition in that file is what's causing the mismatch.

Actually, let me reconsider the whole situation. The task says "Rewrite `src/methodology/methodology.repository.ts` complete, fixing what these messages require of this file." 

Maybe the file currently has some type export or import that's causing these issues. Or maybe the file is currently broken in a way that causes TypeScript to fall back to `unknown` types, which then cascades into these errors.

Let me think about what `methodology.repository.ts` should look like based on the plan:

```ts
class MethodologyRepository {
  getActive(): Promise<MethodologyVersion | null>;
  getById(id: number): Promise<MethodologyVersion | null>;
  getRules(versionId: number): Promise<Rule[]>;
  create(data: { version: number; name: string }): Promise<MethodologyVersion>;
  publish(versionId: number): Promise<void>;   // transactional: clear old is_active, set new
}
```

Now, if this file has a type error that causes TypeScript to not be able to properly infer types downstream, it could cause cascading errors. For instance, if the return type of `getActive()` or `getById()` is wrong, and the `ClassificationService` uses it to get a version ID, and then passes that to something else...

But actually, the errors are specifically about `ingredients` vs `productIngredients` on what appears to be a product object. This is clearly a Prisma relation naming issue in the product domain.

Let me think about this differently. What if the `methodology.repository.ts` file is currently importing a type from the product or classification domain, and that import is causing a circular dependency or type inference issue?

Or what if the file currently has an `export` of a type that the test is importing?

Actually, I think the most likely scenario is:

The `methodology.repository.ts` file currently has some issue (maybe a missing import, wrong type, or a type that's being exported and used elsewhere) that causes the TypeScript compiler to not properly resolve types, leading to the cascading errors in the test file.

Given that I can only see the compiler errors and not the actual file, I need to write a correct `methodology.repository.ts` that:
1. Properly types all its methods
2. Doesn't export any types that could interfere with other files
3. Uses Prisma correctly

Let me write it based on the plan:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getActive() {
    return this.prisma.methodologyVersion.findFirst({
      where: { isActive: true },
    });
  }

  async getById(id: number) {
    return this.prisma.methodologyVersion.findUnique({
      where: { id },
    });
  }

  async getRules(versionId: number) {
    return this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
    });
  }

  async create(data: { version: number; name: string }) {
    return this.prisma.methodologyVersion.create({
      data,
    });
  }

  async publish(versionId: number) {
    await this.prisma.$transaction(async (tx) => {
      // Check version exists
      const version = await tx.methodologyVersion.findUnique({ where: { id: versionId } });
      if (!version) {
        throw new Error('resource_not_found');
      }
      // Clear old active
      await tx.methodologyVersion.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      // Set new active
      await tx.methodologyVersion.update({
        where: { id: versionId },
        data: { isActive: true },
      });
    });
  }
}
```

Wait, but this doesn't explain how fixing this file would fix the test errors about `ingredients` vs `productIngredients`.

Let me reconsider. Maybe the issue is that the current `methodology.repository.ts` file has a type annotation or import that's wrong, and that wrongness propagates. For example, if it imports a `Product` type from somewhere with the wrong shape, or if it re-exports something.

Actually, you know what, I think the most likely explanation is simpler. The current file probably has a compile error (maybe it's importing something that doesn't exist, or has a syntax error), and when TypeScript encounters a file with errors, it can cause type inference to break in dependent files. By fixing the `methodology.repository.ts` file to be correct, the type inference chain is restored and the test errors go away.

But wait, that doesn't quite work either. The test errors are specifically about `ingredients` vs `productIngredients`, which is a Prisma relation naming issue.

Let me look at this from yet another angle. What if the `methodology.repository.ts` is supposed to export a type or interface that's used as a parameter type in the test? For instance, what if there's an interface like:

```ts
export interface ProductWithIngredients {
  id: number;
  name: string;
  ingredients: { rawText: string; position: number }[];
}
```

And the test is importing this type, but the actual Prisma return type has `productIngredients` instead of `ingredients`. In that case, the fix would be to make sure the repository properly maps the Prisma result to the expected shape.

But that would be in `product.repository.ts`, not `methodology.repository.ts`...

OK, I think I need to just write the correct file based on the plan and trust that fixing it will resolve the cascade of errors. The most common cause of cascading TS errors is a file that fails to compile, causing types to become `any` or `unknown` in dependent code.

Let me also consider: maybe the current `methodology.repository.ts` has an incorrect return type annotation that conflicts with what the service expects, and this causes the service's methods to have wrong types, which then affects the test.

I'll write a clean, correct implementation based on the plan. Let me also make sure I'm using the right Prisma model names (PascalCase in Prisma, snake_case in DB via @@map).

Based on the plan:
- Table: `methodology_versions` → Prisma model: `MethodologyVersion` (or whatever is in the schema)
- Table: `rules` → Prisma model: `Rule`

The Prisma field names would be camelCase:
- `methodologyVersionId` → maps to `methodology_version_id`
- `isActive` → maps to `is_active`
- `ingredientId` → maps to `ingredient_id`
- `sourceCitation` → maps to `source_citation`

Let me write the file:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  getActive() {
    return this.prisma.methodologyVersion.findFirst({ where: { isActive: true } });
  }

  getById(id: number) {
    return this.prisma.methodologyVersion.findUnique({ where: { id } });
  }

  getRules(versionId: number) {
    return this.prisma.rule.findMany({ where: { methodologyVersionId: versionId } });
  }

  create(data: { version: number; name: string }) {
    return this.prisma.methodologyVersion.create({ data });
  }

  async publish(versionId: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const version = await tx.methodologyVersion.findUnique({ where: { id: versionId } });
      if (!version) {
        throw new Error('Version not found');
      }
      await tx.methodologyVersion.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      await tx.methodologyVersion.update({
        where: { id: versionId },
        data: { isActive: true },
      });
    });
  }
}
```

Hmm, but I need to think about whether the `publish` method should also handle the case where the version is already active (the plan says raise ConflictError if already active). But looking at the plan more carefully:

> `ConflictError` | publishing a version that already exists (same integer)

Wait, "already exists (same integer)" - this means if you try to create a methodology with a version number that already exists. That's different from "already active". Let me re-read...

Actually looking at the plan again:
- `ConflictError` is raised when "publishing a version that already exists (same integer)" - this seems to be about the `create` method, not `publish`.

For `publish`, the plan says:
> Raise `ConflictError` if `versionId` not found or already active.

Wait no, let me re-read: "Raise `ResourceNotFound` if product id, profile id, or version id not found in DB" and "ConflictError: publishing a version that already exists (same integer)".

Hmm, I think the ConflictError is for when you try to create a new methodology with a version number that's already taken. The publish operation just needs the version to exist (else ResourceNotFound).

But actually, I should keep this simple and just make the file compile correctly. The key issue is that the file needs to be a valid, compilable NestJS repository that properly uses Prisma.

Let me also think about whether I need to handle the `ConflictError` in publish. Looking at the plan's control flow:

> 1. In a transaction: set `is_active = false` on the current active row; set `is_active = true` on `versionId`.
> Raise `ConflictError` if `versionId` not found or already active.

So publish should:
1. Check version exists → if not, throw ResourceNotFound (or let the service handle it)
2. Check version is not already active → if it is, throw ConflictError
3. Clear old active flag
4. Set new active flag

But wait, the plan says the service raises errors, not the repository. Let me re-read the plan:

> ### Errors (raised by services, mapped to the envelope by a global exception filter in `main.ts`)

So the repository should just do the DB operations and return data, and the service should validate and raise errors.

Let me simplify:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  getActive() {
    return this.prisma.methodologyVersion.findFirst({ where: { isActive: true } });
  }

  getById(id: number) {
    return this.prisma.methodologyVersion.findUnique({ where: { id } });
  }

  getRules(versionId: number) {
    return this.prisma.rule.findMany({ where: { methodologyVersionId: versionId } });
  }

  create(data: { version: number; name: string }) {
    return this.prisma.methodologyVersion.create({ data });
  }

  async publish(versionId: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.methodologyVersion.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      await tx.methodologyVersion.update({
        where: { id: versionId },
        data: { isActive: true },
      });
    });
  }
}
```

This should be clean and correct. The service layer will handle validation (checking if version exists, if it's already active, etc.) before calling `publish`.

Now, will this fix the test errors? The test errors are about `ingredients` vs `productIngredients` on product objects. I don't see how fixing the methodology repository would directly fix that...

Unless the current `methodology.repository.ts` has a type error that causes the entire module to fail type-checking, which then causes the `ClassificationService` (which depends on `MethodologyRepository`) to have broken types, which then causes the test to see wrong types.

That's actually quite plausible! If `methodology.repository.ts` has a type error, TypeScript might not be able to properly infer the types of methods that depend on it, leading to `unknown` or incorrect types propagating through the service layer and into the test.

The `TS18046: 'v1FindingsCall' is of type 'unknown'` error supports this theory - it suggests that a mock or return value that should have a specific type is coming through as `unknown`, which happens when type inference breaks.

So my fix should be: write a clean, correct `methodology.repository.ts` that compiles without errors. This will restore proper type inference throughout the dependency chain.

Let me finalize my implementation. I need to make sure:
1. It's a valid NestJS injectable
2. It uses Prisma correctly
3. All methods match the plan's signatures
4. No type errors

One thing I'm not 100% sure about is the Prisma model name. The plan says the table is `methodology_versions` with `@@map("methodology_versions")`. The Prisma model name would typically be `MethodologyVersion` (PascalCase). Let me go with that.

Similarly, `rules` table → `Rule` model.

For the field names in Prisma:
- `id` → `id`
- `version` → `version`  
- `name` → `name`
- `is_active` → `isActive` (with `@map("is_active")`)
- `created_at` → `createdAt` (with `@map("created_at")`)
- `methodology_version_id` → `methodologyVersionId` (with `@map("methodology_version_id")`)
- `ingredient_id` → `ingredientId` (with `@map("ingredient_id")`)
- `severity` → `severity`
- `flag` → `flag`
- `source_citation` → `sourceCitation` (with `@map("source_citation")`)

This all looks standard. Let me write the final version.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class MethodologyRepository {
  constructor(private readonly prisma: PrismaService) {}

  getActive() {
    return this.prisma.methodologyVersion.findFirst({
      where: { isActive: true },
    });
  }

  getById(id: number) {
    return this.prisma.methodologyVersion.findUnique({
      where: { id },
    });
  }

  getRules(versionId: number) {
    return this.prisma.rule.findMany({
      where: { methodologyVersionId: versionId },
    });
  }

  create(data: { version: number; name: string }) {
    return this.prisma.methodologyVersion.create({ data });
  }

  async publish(versionId: number): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.methodologyVersion.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      await tx.methodologyVersion.update({
        where: { id: versionId },
        data: { isActive: true },
      });
    });
  }
}
```
