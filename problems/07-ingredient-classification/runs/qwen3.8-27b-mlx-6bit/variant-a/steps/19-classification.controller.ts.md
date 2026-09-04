# 19-classification.controller.ts

## reasoning

```
Let me analyze the plan to determine what `src/classification/classification.controller.ts` should contain.

From the PLAN.md:

1. The controller endpoint table shows:
   - POST | `/classify` | `{ productId: number, profileId?: number }` | `200 ClassificationResponse`

2. The service signature:
   ```ts
   class ClassificationService {
     classify(productId: number, profileId?: number): Promise<ClassificationResponse | ProfiledClassificationResponse>;
     rescoreAll(versionId: number): Promise<void>;
   }
   ```

3. The manifest says:
   - `src/classification/classification.controller.ts` reads: `src/classification/classification.service.ts`
   - Declares controller, provides+exports service and repository (that's the module)

4. The layout convention says:
   - `src/<feature>/<feature>.controller.ts`

5. The controller validates input and calls the service. Zero business logic.

6. Types from `src/classification/types.ts`:
   - `ClassificationResponse` has: productId, methodologyVersionId, findings, unknownIngredients, overallConfidence, disclaimer
   - `ProfiledClassificationResponse extends ClassificationResponse` has: profileId

Now, the controller needs to:
- Have a `@Controller()` decorator (no path since the endpoint is `/classify` at root, or maybe `@Controller('classify')`... wait, the endpoint is POST `/classify`. Let me think about this.

Actually looking at the endpoints table:
- POST `/classify` - this is the classification controller's endpoint

In NestJS, I could use `@Controller()` with `@Post('classify')` or `@Controller('classify')` with `@Post()`. Either works. Let me use `@Controller()` and `@Post('classify')` to keep the path explicit, or actually `@Controller('classify')` with `@Post()` is cleaner.

Wait, looking at the layout convention more carefully - the endpoint is `kebab-case`, plural. But `/classify` is a verb, not a noun. The plan explicitly states `POST /classify` so I'll follow that.

Let me think about what the controller needs:
1. A DTO or body type for `{ productId: number, profileId?: number }`
2. The `@Post('classify')` handler
3. Call `this.classificationService.classify(productId, profileId)`

For input validation - the plan says "controller validates input and calls the service." I should validate that productId is a number. In NestJS, this could be done with class-validator or manual checks. But the plan doesn't mention a DTO class or validation decorators explicitly. Let me keep it simple - accept the body, validate it's a number, and pass to service.

Actually, looking more carefully at the plan, it doesn't specify a DTO file. The manifest only lists the files mentioned. So I'll do inline validation - check that `productId` is provided and is a number, and `profileId` if provided is a number.

Wait, but "Do not add an export, a feature or a file the plan does not name." - I should not create additional files. The controller itself is the file I'm writing.

Let me write the controller:

```ts
import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { ClassificationService } from './classification.service';

// I need to handle the response type. The service returns ClassificationResponse | ProfiledClassificationResponse.
```

Actually, for the response type annotation, I can import from `./types` since that's listed in the manifest.

Let me also think about whether I need `@HttpCode(200)` - POST defaults to 201 in some frameworks, but in NestJS POST defaults to 201 actually... wait no. In NestJS, the default status code for POST is 201 Created. But the plan says it returns 200. So I need `@HttpCode(200)`.

Let me write the complete file:

```ts
import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { ClassificationService } from './classification.service';
import type { ClassificationResponse, ProfiledClassificationResponse } from './types';

@Controller()
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Post('classify')
  @HttpCode(200)
  async classify(
    @Body() body: { productId: number; profileId?: number },
  ): Promise<ClassificationResponse | ProfiledClassificationResponse> {
    const { productId, profileId } = body;

    if (typeof productId !== 'number' || !Number.isInteger(productId)) {
      throw new Error('...'); // Hmm, but what error? The plan says ResourceNotFound for product not found, but that's raised by the service.
    }

    return this.classificationService.classify(productId, profileId);
  }
}
```

Wait - the plan says "controller validates input and calls the service. Zero business logic." What validation does the controller do? It should validate that the input shape is correct (productId is a number, profileId if present is a number). But what error to throw? The plan's error types are `ResourceNotFound` and `ConflictError`. Those are for domain errors raised by services.

For input validation errors (like missing productId), the plan doesn't explicitly define a validation error type. But the convention says errors use the envelope format. In NestJS, if I throw a BadRequestException, the global exception filter should map it.

Actually, looking at this more carefully - the plan says the global exception filter in `main.ts` maps domain errors to the error envelope. The controller's job is to validate input shape and delegate. If `productId` is missing or not a number, that's a bad request. I could use NestJS's `BadRequestException` or just let it flow through.

But wait - "Do not add an export, a feature or a file the plan does not name." The plan doesn't define a validation error class. Let me keep it minimal: just pass the values to the service. The service will raise `ResourceNotFound` if the product doesn't exist. If `productId` is undefined, the service's repository call will fail or return null, and the service raises `ResourceNotFound`.

Actually, I think the simplest defensible approach is:
- Accept the body
- Pass `productId` and `profileId` to the service
- Let the service handle all validation/domain logic

But "controller validates input" - so I should at least check that productId is present. Let me do a minimal check and throw a BadRequestException (from @nestjs/common) if productId is not a valid number.

Hmm, but actually the plan doesn't specify what happens for malformed input at the controller level. It only specifies `ResourceNotFound` and `ConflictError` as error types. Let me just do a basic type check and use NestJS's built-in `BadRequestException`. The global filter in main.ts would handle mapping it to the envelope.

Let me finalize:

```ts
import { Controller, Post, Body, HttpCode, BadRequestException } from '@nestjs/common';
import { ClassificationService } from './classification.service';
import type { ClassificationResponse, ProfiledClassificationResponse } from './types';

@Controller()
export class ClassificationController {
  constructor(private readonly classificationService: ClassificationService) {}

  @Post('classify')
  @HttpCode(200)
  async classify(
    @Body() body: { productId: number; profileId?: number },
  ): Promise<ClassificationResponse | ProfiledClassificationResponse> {
    const { productId, profileId } = body;

    if (productId === undefined || typeof productId !== 'number') {
      throw new BadRequestException('productId is required and must be a number');
    }

    return this.classificationService.classify(productId, profileId);
  }
}
```

This is clean, follows the plan, validates input minimally, delegates to service. The `HttpCode(200)` ensures POST returns 200 as specified.

Let me double-check against conventions:
- File name: `classification.controller.ts` ✓ (kebab-case.role.ts)
- Class: `ClassificationController` ✓ (PascalCase)
- Endpoint: `classify` - hmm, the convention says "Endpoint: kebab-case, plural". But `/classify` is a verb endpoint. The plan explicitly says `POST /classify` so I follow the plan over the convention (the plan governs).
- No business logic in controller ✓
- Calls service ✓

I think this is correct and complete.
```

## reply

```ts
import { Controller, Post, Body, HttpCode, BadRequestException } from '@nestjs/common';
import { ClassificationService } from './classification.service';
import type {
  ClassificationResponse,
  ProfiledClassificationResponse,
} from './types';

@Controller()
export class ClassificationController {
  constructor(
    private readonly classificationService: ClassificationService,
  ) {}

  @Post('classify')
  @HttpCode(200)
  async classify(
    @Body() body: { productId: number; profileId?: number },
  ): Promise<ClassificationResponse | ProfiledClassificationResponse> {
    const { productId, profileId } = body;

    if (productId === undefined || typeof productId !== 'number') {
      throw new BadRequestException('productId is required and must be a number');
    }

    return this.classificationService.classify(productId, profileId);
  }
}
```
