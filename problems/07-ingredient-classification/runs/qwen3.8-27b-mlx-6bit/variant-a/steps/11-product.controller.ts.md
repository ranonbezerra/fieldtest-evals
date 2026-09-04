# 11-product.controller.ts

## reasoning

```
Let me analyze what's needed for `src/product/product.controller.ts`:

From the plan:
- Controller endpoints for product:
  - POST `/products` — Body: `{ name: string, ingredients: string[] }` → Returns `201 Product`
  - GET `/products/:id/results` — Returns `200 ClassificationResponse[]` (all versions)

From the plan's manifest:
- `src/product/product.controller.ts` reads: `src/product/product.service.ts`
- "POST /products, GET /products/:id/results (delegates to classification for results)"

So the controller:
1. POST `/products` — validates input, calls `ProductService.create(name, ingredients)`, returns 201
2. GET `/products/:id/results` — delegates to classification for results. This means it needs to call something from the classification service to get results for a product across all versions.

Looking at the plan more carefully:
- `ProductService` has: `create(name, ingredients)` and `getWithIngredients(id)`
- The classification service has the logic for results

For GET `/products/:id/results`, the plan says it "delegates to classification for results". The classification repository has `findByProductId(productId)` which returns all results for a product. But the controller should call the service, not the repository directly.

Wait, let me re-read the layer rules:
- `controller` validates input and calls the service. Zero business logic.
- `service` holds the logic.
- `repository` is the only layer that touches the database.

The controller for GET `/products/:id/results` needs to get classification results. The plan says it "delegates to classification for results". This means the product controller would need to inject something from the classification module.

But wait - looking at the module wiring conventions: "A provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other."

The classification module exports `ClassificationService`. The product module would import the classification module to access it.

But actually, looking more carefully at the plan's endpoint table:
- GET `/products/:id/results` returns `ClassificationResponse[]` (all versions)

The classification service has `classify` and `rescoreAll` methods. There's no explicit "getResults" method listed in the service signatures.

Let me re-read the service signatures:
```ts
class ClassificationService {
  classify(productId: number, profileId?: number): Promise<ClassificationResponse | ProfiledClassificationResponse>;
  rescoreAll(versionId: number): Promise<void>;
}
```

Hmm, there's no `getResults` method. But the endpoint needs to return stored results for all versions of a product.

Looking at the repository:
```ts
class ClassificationRepository {
  findByProductId(productId: number): Promise<ClassificationResult[]>;
}
```

So the classification repository can fetch results by product ID. But the controller can't call the repository directly - it must go through a service.

The plan says the product controller "delegates to classification for results." This implies the product controller injects something from the classification module. But the ClassificationService as defined in the plan doesn't have a method to retrieve stored results.

Wait, I need to think about this differently. The plan is my specification and it's what I must implement. Let me look at what makes sense:

Option 1: The product controller injects ClassificationService and calls a method on it. But no such method is defined in the plan for retrieving stored results.

Option 2: The product controller injects ClassificationRepository. But controllers shouldn't call repositories directly per the layer rules.

Option 3: The ProductService has a method that delegates to classification. But the plan only lists `create` and `getWithIngredients` for ProductService.

Hmm, this is a bit of a gap. The plan says the product controller "delegates to classification for results" but doesn't explicitly define a method on ClassificationService for retrieving stored results.

Actually, wait. Let me re-read: "GET `/products/:id/results` — Returns `200 ClassificationResponse[]` (all versions)"

The classification repository has `findByProductId` which returns `ClassificationResult[]`. But the response type is `ClassificationResponse[]` which includes findings.

I think the most defensible reading is:
- The product controller injects `ClassificationService` (from the classification module)
- It calls a method to get results for a product

But since no such method is explicitly defined... Let me think about what's "most defensible."

Actually, looking again at the plan structure - the product controller is described as handling "POST /products, GET /products/:id/results (delegates to classification for results)". The word "delegates" strongly implies it calls into the classification service or module.

Given the layer constraints, the most defensible approach is:
1. The product controller injects `ProductService` for POST /products
2. For GET /products/:id/results, it injects something from classification

Since the plan doesn't explicitly define a `getResults` or similar method on ClassificationService, but the endpoint exists and must be implemented, I'll need to make an assumption here.

The most natural reading: the ClassificationService should have a method to retrieve stored results for a product. Since it's not explicitly in the plan's service signatures but the endpoint requires it, I'll add a `getResultsForProduct` method call on ClassificationService.

Wait, but the instructions say "Implement exactly what the plan specifies for this file." The plan specifies this controller handles these two endpoints. It says it "delegates to classification for results." So I should write the controller that calls into classification.

Let me look at what the response should be: `ClassificationResponse[]`. The `ClassificationRepository.findByProductId` returns `ClassificationResult[]` (the DB model), not `ClassificationResponse[]`. So there must be some transformation happening in the service layer.

I think the cleanest approach, given the plan's structure:
- Inject `ProductService` for product creation
- Inject `ClassificationService` for getting results (with an assumption comment about the method)

Actually, let me reconsider. Maybe I should look at this from a different angle. The plan says the product module's controller handles both endpoints. For the results endpoint, it "delegates to classification for results." 

In NestJS, a controller can inject services from other modules if those modules are imported. So the ProductController would inject:
- `ProductService` (from its own module)
- `ClassificationService` (from the classification module, which would need to be imported by the product module)

For the method on ClassificationService - since the plan doesn't explicitly list a "get stored results" method, but the endpoint requires it, I'll assume there's a method like `getResults(productId: number)` on ClassificationService. This is the most defensible reading because:
1. The controller must call a service (layer rule)
2. The plan says it "delegates to classification for results"
3. The classification repository already has `findByProductId`
4. The service would wrap that and transform to the response format

Let me write the controller:

```typescript
import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ProductService } from './product.service';
import { ClassificationService } from '../classification/classification.service';

@Controller('products')
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly classificationService: ClassificationService,
  ) {}

  @Post()
  async create(@Body() body: { name: string; ingredients: string[] }) {
    return this.productService.create(body.name, body.ingredients);
  }

  @Get(':id/results')
  async getResults(@Param('id', ParseIntPipe) id: number) {
    return this.classificationService.getResults(id);
  }
}
```

Wait, but I'm not sure about the method name on ClassificationService. Let me think about what's most defensible...

The plan's endpoint returns `ClassificationResponse[]`. The classification repository has `findByProductId`. The most natural service method name would be something like `getResults` or `findResultsByProduct`.

Actually, I realize I should also consider: does the plan specify error handling? If the product doesn't exist for the results endpoint, should it return 404? The plan says `ResourceNotFound` is raised when "product id, profile id, or version id not found in DB." So yes, if the product doesn't exist, it should raise ResourceNotFound.

But that logic would be in the service, not the controller. The controller just calls the service.

Let me also check: the plan says endpoints are `kebab-case, plural`. So `/products` is correct. The path parameter for results would be `:id`.

Let me also think about the import path. The plan's layout shows:
```
src/<feature>/<feature>.module.ts
src/<feature>/<feature>.controller.ts
src/<feature>/<feature>.service.ts
src/<feature>/<feature>.repository.ts
```

So the classification service would be at `src/classification/classification.service.ts`. From `src/product/product.controller.ts`, the relative import would be `../classification/classification.service`.

Now, about the method name - I'll use `getResults` as it's the most natural and maps directly to the endpoint. I'll add an ASSUMPTION comment since this method isn't explicitly defined in the plan's service signatures.

Actually wait - let me re-read the instructions: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence and do not reason around it: write the file using the most defensible reading and mark it with one `// ASSUMPTION: <what was unresolved>` comment at the point it matters."

The method to retrieve stored results for a product from ClassificationService is genuinely absent from the plan's explicit service signatures. So I should mark it with an ASSUMPTION comment.

Let me finalize:

```typescript
import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ProductService } from './product.service';
import { ClassificationService } from '../classification/classification.service';

@Controller('products')
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly classificationService: ClassificationService,
  ) {}

  @Post()
  create(@Body() body: { name: string; ingredients: string[] }) {
    return this.productService.create(body.name, body.ingredients);
  }

  // ASSUMPTION: ClassificationService.getResults is not explicitly defined in the plan's service signatures but is required by the GET /products/:id/results endpoint which "delegates to classification for results."
  @Get(':id/results')
  getResults(@Param('id', ParseIntPipe) id: number) {
    return this.classificationService.getResults(id);
  }
}
```

Hmm, but should I use `async` keyword? In NestJS, controller methods can be sync or async. Since the service methods return promises, I don't strictly need `async` - NestJS will handle the promise. But it's cleaner to be explicit. Actually, in NestJS it's common to not use async when you're just returning a promise directly. Let me keep it simple without async since we're just passing through the promise.

Actually, let me reconsider the structure. The plan says "controller validates input and calls the service." For POST /products, I'm passing `body.name` and `body.ingredients` - that's basic validation (ensuring the shape). I could add more validation but the plan doesn't specify DTOs or validators beyond the body shape.

Let me also make sure I'm not adding anything the plan doesn't name. The plan names:
- POST /products with `{ name, ingredients }` returning 201 Product
- GET /products/:id/results returning ClassificationResponse[]

That's it for this controller. Let me keep it minimal.
```

## reply

```typescript
import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ProductService } from './product.service';
import { ClassificationService } from '../classification/classification.service';

@Controller('products')
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly classificationService: ClassificationService,
  ) {}

  @Post()
  create(@Body() body: { name: string; ingredients: string[] }) {
    return this.productService.create(body.name, body.ingredients);
  }

  // ASSUMPTION: ClassificationService.getResults is not explicitly listed in the plan's service
  // signatures but is required by this endpoint which "delegates to classification for results."
  @Get(':id/results')
  getResults(@Param('id', ParseIntPipe) id: number) {
    return this.classificationService.getResults(id);
  }
}
```
