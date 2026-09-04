# 08-ingredient.service.ts

## reasoning

```
Let me analyze what's needed for `src/ingredient/ingredient.service.ts`.

From the plan:
- It's a "Thin pass-through to repository"
- Service signature: `IngredientService { list(): Promise<Ingredient[]>; }`
- It reads from `src/ingredient/ingredient.repository.ts`
- The repository has: `findById(id: number)`, `findByName(canonicalName: string)`, `resolve(normalizedText: string)`, `list(): Promise<Ingredient[]>`
- The service only exposes `list()` per the plan's service signatures section.

The file layout convention is `<feature>/<feature>.service.ts`, so it's `src/ingredient/ingredient.service.ts`.

I need to:
1. Import NestJS decorators (`@Injectable`)
2. Import the repository
3. Create the `IngredientService` class that injects `IngredientRepository` and exposes `list()`

The `Ingredient` type would come from Prisma. Let me think about what's available. The plan references Prisma models. The `Ingredient` type would be from `@prisma/client`.

Let me write a minimal, complete service:

```ts
import { Injectable } from '@nestjs/common';
import { IngredientRepository } from './ingredient.repository';
import { Ingredient } from '@prisma/client';

@Injectable()
export class IngredientService {
  constructor(private readonly repository: IngredientRepository) {}

  list(): Promise<Ingredient[]> {
    return this.repository.list();
  }
}
```

This is a thin pass-through. The plan says the service has only `list()` as its public method. It's injectable, uses the repository, and delegates `list()` directly.

Let me make sure I'm not adding anything extra. The plan is clear: thin pass-through, only `list()` in the service signature. Done.
```

## reply

```ts
import { Injectable } from '@nestjs/common';
import { Ingredient } from '@prisma/client';
import { IngredientRepository } from './ingredient.repository';

@Injectable()
export class IngredientService {
  constructor(private readonly repository: IngredientRepository) {}

  list(): Promise<Ingredient[]> {
    return this.repository.list();
  }
}
```
