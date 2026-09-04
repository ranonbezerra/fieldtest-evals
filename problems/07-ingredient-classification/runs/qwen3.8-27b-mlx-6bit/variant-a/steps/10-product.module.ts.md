# 10-product.module.ts

## reasoning

```
Let me look at the plan to understand what `src/product/product.module.ts` should contain.

From the manifest:
```
src/product/product.module.ts | reads: - | Declares controller, provides+exports service and repository
```

From the layout conventions:
- `src/<feature>/<feature>.module.ts`

From the naming conventions:
- TS file: `kebab-case.role.ts`
- Class: `PascalCase`

The plan says this file "Declares controller, provides+exports service and repository".

So the module should:
1. Declare the controller (`ProductController`)
2. Provide and export `ProductService`
3. Provide and export `ProductRepository`

Let me check what the product module needs:
- Controller: `ProductController` from `./product.controller.ts`
- Service: `ProductService` from `./product.service.ts`
- Repository: `ProductRepository` from `./product.repository.ts`

The file is `src/product/product.module.ts`, so the class name should be `ProductModule`.

Imports:
- `@nestjs/common` for `Module`
- `./product.controller` for `ProductController`
- `./product.service` for `ProductService`
- `./product.repository` for `ProductRepository`

The convention says: "A service, repository or processor is listed in its module's `providers`. A provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other."

So both service and repository should be in both `providers` and `exports`.

Let me write the file:

```typescript
import { Module } from '@nestjs/common';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { ProductRepository } from './product.repository';

@Module({
  controllers: [ProductController],
  providers: [ProductService, ProductRepository],
  exports: [ProductService, ProductRepository],
})
export class ProductModule {}
```

This is clean and matches the plan exactly. The file path uses kebab-case (`product.module.ts`), the class is PascalCase (`ProductModule`). No extra files, no extra exports. Done.
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { ProductRepository } from './product.repository';

@Module({
  controllers: [ProductController],
  providers: [ProductService, ProductRepository],
  exports: [ProductService, ProductRepository],
})
export class ProductModule {}
```
