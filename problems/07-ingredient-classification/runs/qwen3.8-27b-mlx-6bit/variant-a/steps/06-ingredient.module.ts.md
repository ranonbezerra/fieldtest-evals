# 06-ingredient.module.ts

## reasoning

```
The user wants me to write exactly one file: `src/ingredient/ingredient.module.ts`.

From the PLAN.md manifest:
```
src/ingredient/ingredient.module.ts | reads: - | Declares controller, provides+exports service and repository
```

So this module:
- Declares the `IngredientController` (in `controllers`)
- Provides and exports `IngredientService` and `IngredientRepository`

Following the conventions:
- File: `kebab-case.role.ts` → `ingredient.module.ts` ✓
- Class: PascalCase → `IngredientModule`
- The module imports NestJS decorators

Let me write it:

```ts
import { Module } from '@nestjs/common';
import { IngredientController } from './ingredient.controller';
import { IngredientService } from './ingredient.service';
import { IngredientRepository } from './ingredient.repository';

@Module({
  controllers: [IngredientController],
  providers: [IngredientService, IngredientRepository],
  exports: [IngredientService, IngredientRepository],
})
export class IngredientModule {}
```

This is straightforward. The plan says "Declares controller, provides+exports service and repository". No other imports are needed since the ingredient module doesn't depend on other modules (the manifest shows `reads: -` meaning no dependencies on other files' symbols beyond its own).

Let me verify the class names from the plan:
- `src/ingredient/ingredient.controller.ts` → class would be `IngredientController` (PascalCase)
- `src/ingredient/ingredient.service.ts` → class would be `IngredientService` (PascalCase)
- `src/ingredient/ingredient.repository.ts` → class would be `IngredientRepository` (PascalCase)

This looks correct and complete.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { IngredientController } from './ingredient.controller';
import { IngredientService } from './ingredient.service';
import { IngredientRepository } from './ingredient.repository';

@Module({
  controllers: [IngredientController],
  providers: [IngredientService, IngredientRepository],
  exports: [IngredientService, IngredientRepository],
})
export class IngredientModule {}
```
