# 09-ingredient.repository.ts

## reasoning

```
Let me analyze what's needed for `src/ingredient/ingredient.repository.ts` based on the PLAN.md.

From the plan, the repository interface is:

```ts
class IngredientRepository {
  findById(id: number): Promise<Ingredient | null>;
  findByName(canonicalName: string): Promise<Ingredient | null>;
  resolve(normalizedText: string): Promise<{ ingredient: Ingredient; matchedVia: 'canonical' | 'synonym' } | null>;
  list(): Promise<Ingredient[]>;
}
```

The plan says:
- It's a `@Injectable()` class
- Prisma queries for ingredients + synonym resolution
- The `resolve` method does: normalize → exact canonical match → exact synonym match. Unmatched → unknown (null).

From the data model:
- `ingredients` table: `id`, `canonical_name`, `display_name`
- `synonyms` table: `id`, `ingredient_id` (FK→ingredients.id), `synonym_text` (normalized form)

The normalization pipeline from assumptions: NFD-decompose → strip combining marks → lowercase → trim → collapse internal whitespace.

Wait, but the plan says the `resolve` method takes `normalizedText` as input. So normalization is done by the caller (the service), and the repository just does lookups with the already-normalized text.

Actually, re-reading step 2 of classify: "Resolve each `raw_text`: normalize → exact canonical match → exact synonym match. Unmatched → unknown." This happens in the service layer. The repository's `resolve` method takes a `normalizedText` parameter, so it receives already-normalized text and does the lookups.

The `resolve` method should:
1. Try exact match on `canonical_name` (which is stored in normalized form? Or raw form?)
2. If no match, try exact match on `synonyms.synonym_text` (stored in normalized form per the schema)

Wait, looking at the schema more carefully:
- `ingredients.canonical_name` is UNIQUE NOT NULL - it's the canonical name
- `synonyms.synonym_text` is UNIQUE NOT NULL and noted as *(normalized form)*

So the `canonical_name` might be in display form (like "Glycerol") while `synonym_text` is normalized. But the plan says the resolve method takes `normalizedText`. 

Let me think about this more carefully. The `canonical_name` is the canonical name of the ingredient. The `synonym_text` is explicitly noted as being in normalized form. 

For the `resolve` method:
1. First try matching `canonical_name` - but since the input is normalized, should we normalize the canonical name too? Or is the canonical name already stored in normalized form?

Actually, looking at the assumptions again: "Normalization pipeline: NFD-decompose → strip combining marks → lowercase → trim → collapse internal whitespace."

And assumption 6: "Synonym/typo resolution is a seeded lookup table (exact match on normalized synonym text), not fuzzy."

The `resolve` method signature takes `normalizedText: string`. This means the caller has already normalized the input. The repository needs to match this against:
1. The canonical name (but is it stored normalized?) - I think the canonical_name might be in a display form, so we'd need to normalize it for comparison. But that would mean the repository does normalization too...

Actually, wait. Let me re-read: the plan says "exact canonical match → exact synonym match". If the input is already normalized, then for an "exact canonical match" to work, either:
- The canonical_name is stored in normalized form, OR
- We normalize the canonical_name at query time

Given that `synonym_text` is explicitly noted as "(normalized form)", it's implied that `canonical_name` might NOT be in normalized form. But that would make "exact match" tricky.

Hmm, but actually the simplest reading is: since we're doing exact string matching in SQL (using Prisma's `where` with `equals`), and the input is already normalized, we should store both `canonical_name` and `synonym_text` in their normalized forms for lookup purposes. Or alternatively, the repository normalizes the canonical_name before comparing.

Actually, I think the most defensible reading is:
- The `canonical_name` is stored in a human-readable form (e.g., "Glycerol")
- The `synonym_text` is stored in normalized form (e.g., "glycerol")
- The `resolve` method receives already-normalized text
- For the canonical match, we need to normalize the stored canonical_name... but that's not possible with a simple SQL query

Wait, let me reconsider. Maybe the simplest approach is:
- Store `canonical_name` in its canonical/display form
- The `resolve` method first tries to find by `synonym_text = normalizedText` (since synonyms are stored normalized)
- If found, return with `matchedVia: 'synonym'`
- If not found, we need to also check if the normalized text matches the canonical name

Actually, I think the cleanest approach given the plan is:
- The `canonical_name` in the ingredients table IS the normalized canonical name (lowercase, no accents)
- The `display_name` is the human-readable version
- `synonym_text` is also normalized

This makes sense because:
- `canonical_name` is UNIQUE and used as the identity
- `display_name` is for display purposes
- The resolve method can do exact matches on both

So `resolve(normalizedText)`:
1. Try `prisma.ingredient.findUnique({ where: { canonicalName: normalizedText } })` → if found, return `{ ingredient, matchedVia: 'canonical' }`
2. Try `prisma.synonym.findUnique({ where: { synonymText: normalizedText }, include: { ingredient: true } })` → if found, return `{ ingredient: synonym.ingredient, matchedVia: 'synonym' }`
3. Return null

This is clean and uses indexed lookups (both are UNIQUE columns).

Now let me write the file:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service'; // Hmm, what's the Prisma service name?
```

Wait, the plan doesn't mention a `PrismaService`. In a typical NestJS + Prisma setup, you'd have a `PrismaService` that extends `PrismaClient`. But the plan doesn't name this file. Let me check...

The manifest lists these files:
- prisma/schema.prisma
- prisma/seed.ts
- prisma/migrations/0001_init/migration.sql
- src/main.ts
- src/app.module.ts
- src/ingredient/* (module, controller, service, repository)
- src/product/* (module, controller, service, repository)
- src/methodology/* (module, controller, service, repository)
- src/classification/* (module, controller, service, repository, types)
- src/profile/* (module, controller, service, repository)
- test/classification.spec.ts

There's no explicit `prisma.service.ts` in the manifest. However, for NestJS + Prisma, you typically need a `PrismaService`. Since the plan says repositories are "the only layer that touches the database" and they use Prisma, there must be a way to access the Prisma client.

The most standard NestJS + Prisma pattern is to have a `PrismaService` that's provided and injected. Since it's not explicitly in the manifest but is universally needed, I'll use `PrismaService` from a conventional location. In a typical setup it would be at `src/prisma.service.ts` or `src/prisma/prisma.service.ts`.

Given the layout convention `<feature>/<feature>.role.ts`, a Prisma service isn't really a feature. It's likely at `src/prisma.service.ts`. I'll import from there.

Actually, let me just use `PrismaClient` directly or a `PrismaService`. The most common NestJS pattern is:

```ts
@Injectable()
export class PrismaService extends PrismaClient {
  constructor() { super(); }
}
```

And it's typically in `src/prisma.service.ts`. Since the plan doesn't explicitly name this file but it's a universal necessity for NestJS+Prisma, I'll import it from `../prisma.service`.

Let me write the complete file now:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class IngredientRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: number) {
    return this.prisma.ingredient.findUnique({ where: { id } });
  }

  async findByName(canonicalName: string) {
    return this.prisma.ingredient.findUnique({ where: { canonicalName } });
  }

  async resolve(normalizedText: string) {
    const byCanonical = await this.prisma.ingredient.findUnique({
      where: { canonicalName: normalizedText },
    });
    if (byCanonical) {
      return { ingredient: byCanonical, matchedVia: 'canonical' as const };
    }

    const bySynonym = await this.prisma.synonym.findUnique({
      where: { synonymText: normalizedText },
      include: { ingredient: true },
    });
    if (bySynonym) {
      return { ingredient: bySynonym.ingredient, matchedVia: 'synonym' as const };
    }

    return null;
  }

  async list() {
    return this.prisma.ingredient.findMany();
  }
}
```

Wait, I need to think about the return types. The plan says:
- `findById(id: number): Promise<Ingredient | null>`
- `findByName(canonicalName: string): Promise<Ingredient | null>`
- `resolve(normalizedText: string): Promise<{ ingredient: Ingredient; matchedVia: 'canonical' | 'synonym' } | null>`
- `list(): Promise<Ingredient[]>`

Where `Ingredient` is the Prisma model type. I should use the Prisma generated types. In Prisma, the model type is `Ingredient` from `@prisma/client`.

Let me add proper type annotations:

```ts
import { Injectable } from '@nestjs/common';
import { Ingredient } from '@prisma/client';
import { PrismaService } from '../prisma.service';
```

Actually, in newer Prisma versions with ESM, the import might be different. But `@prisma/client` is standard.

Let me also consider: the plan uses ESM (`"type": "module"`). So imports should work fine with standard ES import syntax.

Let me finalize the file. I want to make sure:
1. It's `@Injectable()` 
2. It uses Prisma for all DB access
3. The `resolve` method does canonical first, then synonym
4. Return types match the plan

One more thought: should I use `findUnique` or `findFirst`? Since `canonical_name` is UNIQUE and `synonym_text` is UNIQUE, `findUnique` is correct and more performant.

I'm satisfied with the implementation. Let me write the final version.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { Ingredient } from '@prisma/client';
import { PrismaService } from '../prisma.service';

@Injectable()
export class IngredientRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: number): Promise<Ingredient | null> {
    return this.prisma.ingredient.findUnique({ where: { id } });
  }

  async findByName(canonicalName: string): Promise<Ingredient | null> {
    return this.prisma.ingredient.findUnique({ where: { canonicalName } });
  }

  async resolve(
    normalizedText: string,
  ): Promise<{ ingredient: Ingredient; matchedVia: 'canonical' | 'synonym' } | null> {
    const byCanonical = await this.prisma.ingredient.findUnique({
      where: { canonicalName: normalizedText },
    });
    if (byCanonical) {
      return { ingredient: byCanonical, matchedVia: 'canonical' };
    }

    const bySynonym = await this.prisma.synonym.findUnique({
      where: { synonymText: normalizedText },
      include: { ingredient: true },
    });
    if (bySynonym) {
      return { ingredient: bySynonym.ingredient, matchedVia: 'synonym' };
    }

    return null;
  }

  async list(): Promise<Ingredient[]> {
    return this.prisma.ingredient.findMany();
  }
}
```
