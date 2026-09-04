# 07-ingredient.controller.ts

## reasoning

```
Let me analyze what I need to write for `src/ingredient/ingredient.controller.ts`.

From the PLAN.md:
- File: `src/ingredient/ingredient.controller.ts`
- Reads: `src/ingredient/ingredient.service.ts`
- Endpoint: GET /ingredients
- Returns: `200 Ingredient[]`

From the plan's controller endpoints table:
| GET | `/ingredients` | — | `200 Ingredient[]` |

The service signature:
```ts
// ingredient.service.ts
class IngredientService {
  list(): Promise<Ingredient[]>;
}
```

The layout convention says:
- `src/<feature>/<feature>.controller.ts`

The conventions say:
- Controller validates input and calls the service. Zero business logic.
- Endpoint: kebab-case, plural → `/ingredients` is already plural and kebab-case.

Now I need to write a NestJS controller that:
1. Is decorated with `@Controller('ingredients')`
2. Has a GET method at the root path (since it's `/ingredients`)
3. Calls `this.ingredientService.list()`
4. Returns the result (200 by default)

Let me think about imports:
- `@Controller` from `@nestjs/common`
- `@Get` from `@nestjs/common`
- `Injectable` from `@nestjs/common`
- `IngredientService` from `./ingredient.service`

The controller is simple - just a GET that returns the list. No params, no body validation needed.

Let me write it:

```ts
import { Controller, Get } from '@nestjs/common';
import { IngredientService } from './ingredient.service';

@Controller('ingredients')
export class IngredientController {
  constructor(private readonly ingredientService: IngredientService) {}

  @Get()
  list() {
    return this.ingredientService.list();
  }
}
```

Wait, should I add a return type? The plan says it returns `Ingredient[]`. But the service's `list()` already returns `Promise<Ingredient[]>`. The controller just delegates. I could add a return type annotation for clarity, but the plan doesn't specify the exact return type annotation on the controller method. Let me keep it simple and let TypeScript infer, or I could add `Promise<Ingredient[]>`. 

Actually, looking at the plan more carefully, it says the service has `list(): Promise<Ingredient[]>`. The controller just calls it. I'll keep it clean without explicit return type since it's a thin pass-through.

Actually, let me reconsider. The convention says "controller validates input and calls the service. Zero business logic." This is a pure pass-through GET with no input to validate. So the controller method just delegates.

I'll keep it minimal and clean.
```

## reply

```ts
import { Controller, Get } from '@nestjs/common';
import { IngredientService } from './ingredient.service';

@Controller('ingredients')
export class IngredientController {
  constructor(private readonly ingredientService: IngredientService) {}

  @Get()
  list() {
    return this.ingredientService.list();
  }
}
```
