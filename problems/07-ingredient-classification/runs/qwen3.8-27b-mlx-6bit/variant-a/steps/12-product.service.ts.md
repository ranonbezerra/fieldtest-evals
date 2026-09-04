# 12-product.service.ts

## reasoning

```
Let me analyze the PLAN.md to understand what `src/product/product.service.ts` needs to contain.

From the plan:
- **Service signatures:**
```ts
class ProductService {
  create(name: string, ingredients: string[]): Promise<Product>;
  getWithIngredients(id: number): Promise<Product | null>;
}
```

- **ProductRepository:**
```ts
class ProductRepository {
  findById(id: number): Promise<Product | null>;
  listWithIngredients(): Promise<Product[]>;   // products that have ≥1 product_ingredient
  list(): Promise<Product[]>;
  create(name: string, ingredients: string[]): Promise<Product>;
}
```

- The product.service.ts "reads" (depends on) `src/product/product.repository.ts`
- It "raises ResourceNotFound" - but wait, looking at the controller endpoints:
  - `POST /products` → 201 Product
  - `GET /products/:id/results` → delegates to classification for results

Wait, let me re-read. The plan says:
- `product.service.ts | reads: src/product/product.repository.ts | create, getWithIngredients; raises ResourceNotFound`

So the service:
1. `create(name, ingredients)` - delegates to repository
2. `getWithIngredients(id)` - gets product with ingredients; raises ResourceNotFound

Wait, but the signature says `getWithIngredients(id: number): Promise<Product | null>`. If it returns `Product | null`, when does it raise ResourceNotFound? Let me re-read...

Actually, looking more carefully at the plan's error table:
- `ResourceNotFound` | product id, profile id, or version id not found in DB

And the service signature says `getWithIngredients(id: number): Promise<Product | null>`. 

Hmm, but the manifest says "raises ResourceNotFound". Let me think about this. The controller for `GET /products/:id/results` delegates to classification for results. But there's no explicit `GET /products/:id` endpoint in the controller list.

Wait, looking at the controller endpoints again:
- POST `/products` → 201 Product
- GET `/products/:id/results` → 200 ClassificationResponse[] (all versions) - delegates to classification

So `getWithIngredients` might be used internally by other services (like classification) or by the product controller. But the plan says it "raises ResourceNotFound".

Looking at the signature: `getWithIngredients(id: number): Promise<Product | null>` - this returns null when not found. But the manifest says "raises ResourceNotFound". These seem contradictory.

Wait, let me re-read the manifest line: `src/product/product.service.ts | reads: src/product/product.repository.ts | create, getWithIngredients; raises ResourceNotFound`

I think the "raises ResourceNotFound" refers to the service as a whole - perhaps in some contexts it raises it. But the signature clearly says `Promise<Product | null>`. 

Actually, I think the most defensible reading is:
- `getWithIngredients` returns `Product | null` (as per the signature)
- The "raises ResourceNotFound" might refer to an additional method or to the fact that when called in certain contexts (like from a controller), if the result is null, the caller raises it.

But wait - looking at the product controller: `GET /products/:id/results` delegates to classification. So where is `getWithIngredients` actually used that would raise ResourceNotFound?

Let me reconsider. Maybe the service has a method that raises ResourceNotFound when the product isn't found, separate from the nullable return. Or perhaps `getWithIngredients` actually raises ResourceNotFound and the signature in the plan is slightly misleading (or the null return is for a different internal use).

Actually, re-reading more carefully: the plan says the service signature is `getWithIngredients(id: number): Promise<Product | null>`. The manifest annotation "raises ResourceNotFound" might just be describing that this is the service responsible for the domain error type, or it could be that in practice when the product controller needs to return a 404, it calls this and checks for null.

I'll go with the explicit signature: `getWithIngredients` returns `Promise<Product | null>`. The "raises ResourceNotFound" in the manifest is likely describing that the service module is where that error type is relevant/used, or perhaps there's an internal validation. But I should follow the explicit signature.

Wait, actually let me reconsider. Maybe `getWithIngredients` is supposed to raise ResourceNotFound (throw) rather than return null. The signature `Promise<Product | null>` might be the repository's behavior, and the service wraps it to throw. Let me look at the repository:

```ts
class ProductRepository {
  findById(id: number): Promise<Product | null>;
  ...
}
```

The repository returns `Product | null`. The service could:
1. Call repository.findById()
2. If null, throw ResourceNotFound
3. Otherwise return the product

But the plan's service signature says `getWithIngredients(id: number): Promise<Product | null>` which suggests it returns null, not throws.

Hmm, but the manifest explicitly says "raises ResourceNotFound". I think the most defensible reading given the explicit conflict is:

The service signature as stated returns `Product | null`. The "raises ResourceNotFound" in the manifest is a general annotation about the service's error behavior (perhaps for other internal uses or for when it's called by controllers that need to distinguish "not found" from other errors).

Actually, you know what, let me look at this differently. The product controller has:
- `POST /products` - creates
- `GET /products/:id/results` - delegates to classification

There's no `GET /products/:id` endpoint. So `getWithIngredients` is likely used internally (by classification service or by the results endpoint). In that internal use, returning null and letting the caller handle it makes sense.

I'll go with: `getWithIngredients` returns `Promise<Product | null>`, delegating to the repository. The "raises ResourceNotFound" in the manifest is a general annotation that doesn't change the explicit signature.

Now, what does "getWithIngredients" actually return? The plan's repository has `findById` which returns `Product | null`. But "with ingredients" suggests it includes the product_ingredients relation. In Prisma, this would be a `findUnique` with `include: { productIngredients: true }`.

But wait - the repository interface only shows `findById(id: number): Promise<Product | null>`. There's no `findWithIngredients` method. So the service's `getWithIngredients` likely calls `findById` and the Prisma model already includes the ingredients relation, or the service needs to do something else.

Hmm, but the repository is the only layer that touches the database. So `getWithIngredients` must call a repository method. The only available method that takes an id is `findById`. So I'll have the service call `productRepository.findById(id)` and return the result.

The "WithIngredients" part of the name is just descriptive - the Prisma model for Product likely has a `productIngredients` relation that's included by default or the repository's `findById` already includes it.

Let me write the service:

```ts
import { Injectable } from '@nestjs/common';
import { ProductRepository } from './product.repository';

@Injectable()
export class ProductService {
  constructor(private readonly productRepository: ProductRepository) {}

  async create(name: string, ingredients: string[]) {
    return this.productRepository.create(name, ingredients);
  }

  async getWithIngredients(id: number) {
    return this.productRepository.findById(id);
  }
}
```

Wait, but the plan says it "raises ResourceNotFound". Let me look at where ResourceNotFound is defined: `src/classification/types.ts`. So the service would import from there.

Actually, I think I'm overthinking this. The manifest line is:
`src/product/product.service.ts | reads: src/product/product.repository.ts | create, getWithIngredients; raises ResourceNotFound`

The "raises ResourceNotFound" might mean that the service is responsible for raising it in certain scenarios. But looking at the explicit signature `getWithIngredients(id: number): Promise<Product | null>`, it returns null.

Unless... the service has additional logic where if the product is not found, it raises the error. Let me look at this from the controller perspective:

The product controller has `GET /products/:id/results` which "delegates to classification for results". So the controller probably:
1. Calls `productService.getWithIngredients(id)` to verify the product exists
2. If null/not found, the error filter handles it (or the service raises it)
3. Otherwise delegates to classification

Given the "raises ResourceNotFound" annotation, I think the most defensible reading is that `getWithIngredients` actually throws `ResourceNotFound` when the product isn't found, rather than returning null. The signature `Promise<Product | null>` in the plan might be a simplification or error, OR it could be that the method can return null in some internal contexts but raises in API-facing contexts.

But I should follow the explicit signature. The plan clearly states: `getWithIngredients(id: number): Promise<Product | null>`. I'll follow that.

The "raises ResourceNotFound" in the manifest is just a general note about what errors this service module is associated with (perhaps for the create operation if there's a conflict, or for documentation purposes).

Let me finalize my implementation. The service is simple:
- `create(name, ingredients)` → delegates to repository
- `getWithIngredients(id)` → delegates to repository.findById

No business logic in the service for create (just pass-through). For getWithIngredients, also just pass-through to repository.

Actually wait - I need to think about whether `getWithIngredients` should do something beyond just calling `findById`. The name suggests it returns a product WITH its ingredients. If the repository's `findById` already includes ingredients (via Prisma include), then it's a simple delegation. If not, the service can't do anything because it's zero Prisma calls allowed in the service layer.

Given the constraints (service has zero Prisma client calls), and the repository only exposes `findById`, I'll just delegate.

Let me write the final file.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { ProductRepository } from './product.repository';

@Injectable()
export class ProductService {
  constructor(private readonly productRepository: ProductRepository) {}

  async create(name: string, ingredients: string[]) {
    return this.productRepository.create(name, ingredients);
  }

  async getWithIngredients(id: number) {
    return this.productRepository.findById(id);
  }
}
```
