# 05-app.module.ts

## reasoning

```
The task is to write `src/app.module.ts` — the root module that imports all feature modules.

From the PLAN.md manifest, the feature modules are:
- `src/ingredient/ingredient.module.ts` → `IngredientModule`
- `src/product/product.module.ts` → `ProductModule`
- `src/methodology/methodology.module.ts` → `MethodologyModule`
- `src/classification/classification.module.ts` → `ClassificationModule`
- `src/profile/profile.module.ts` → `ProfileModule`

The plan says: "Root module importing all feature modules"

Following the NestJS convention and the project layout, the root `AppModule` imports all five feature modules.

Class name: `AppModule` (PascalCase).
File: `src/app.module.ts` (kebab-case.role.ts — "app" is the feature name).

Imports for NestJS:
- `@Module` from `@nestjs/common`

Imports for the feature modules — following ESM (`"type": "module"`) and the layout:
- `IngredientModule` from `./ingredient/ingredient.module`
- `ProductModule` from `./product/product.module`
- `MethodologyModule` from `./methodology/methodology.module`
- `ClassificationModule` from `./classification/classification.module`
- `ProfileModule` from `./profile/profile.module`

That's it. Simple and clean. No controllers or providers at the root level since all logic lives in feature modules.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { IngredientModule } from './ingredient/ingredient.module';
import { ProductModule } from './product/product.module';
import { MethodologyModule } from './methodology/methodology.module';
import { ClassificationModule } from './classification/classification.module';
import { ProfileModule } from './profile/profile.module';

@Module({
  imports: [
    IngredientModule,
    ProductModule,
    MethodologyModule,
    ClassificationModule,
    ProfileModule,
  ],
})
export class AppModule {}
```
