# 13-product.repository.ts

## reasoning

```
Let me analyze the plan carefully to understand what `src/product/product.repository.ts` needs to contain.

From the plan:

**Repository interface:**
```ts
// product.repository.ts
class ProductRepository {
  findById(id: number): Promise<Product | null>;
  listWithIngredients(): Promise<Product[]>;   // products that have ≥1 product_ingredient
  list(): Promise<Product[]>;
  create(name: string, ingredients: string[]): Promise<Product>;
}
```

**Data model for products:**
- `products` table: `id` INT PK AI, `name` TEXT NOT NULL, `created_at` TIMESTAMPTZ DEFAULT now()
- `product_ingredients` table: `id` INT PK AI, `product_id` INT FK NOT NULL, `raw_text` TEXT NOT NULL, `position` INT NOT NULL; UNIQUE(`product_id`, `position`)

**Conventions:**
- Prisma as ORM, PostgreSQL
- NestJS
- ESM, `"type": "module"`
- `@Injectable()` decorator
- snake_case table/column names via Prisma `@map`/`@@map`
- Repository is the only layer that touches the database (Prisma client calls)

The plan says:
- `src/product/product.repository.ts | reads: - | Prisma CRUD for products + product_ingredients`

So this file needs:
1. An `@Injectable()` class `ProductRepository`
2. Uses PrismaClient
3. Methods:
   - `findById(id: number): Promise<Product | null>` — find a product by id, include its ingredients
   - `listWithIngredients(): Promise<Product[]>` — products that have ≥1 product_ingredient
   - `list(): Promise<Product[]>` — all products
   - `create(name: string, ingredients: string[]): Promise<Product>` — create a product with its ingredients

Wait, let me think about the return types. The plan says `findById` returns `Promise<Product | null>`. But looking at the service:

```ts
// product.service.ts
class ProductService {
  create(name: string, ingredients: string[]): Promise<Product>;
  getWithIngredients(id: number): Promise<Product | null>;
}
```

And the classification service needs to load product + `product_ingredients` ordered by `position`. So `findById` should include ingredients.

Actually, looking more carefully at the plan's control flow:
"1. Load product + `product_ingredients` ordered by `position`."

So `findById` should return the product with its ingredients included (ordered by position).

Let me think about what Prisma model names would be. The tables are `products` and `product_ingredients`. In Prisma, the model names would be `Product` and `ProductIngredient` (PascalCase by convention).

For the Prisma schema, the models would be:
- `Product` with `@@map("products")`
- `ProductIngredient` with `@@map("product_ingredients")`

The `create` method needs to:
1. Create the product
2. Create all product_ingredients with positions (1-based or 0-based? Let me think... "position INT NOT NULL" — I'll use 1-based as it's more natural for ordering)

Actually, let me reconsider. The plan says `position` is INT NOT NULL with UNIQUE(product_id, position). For the create, I need to assign positions. I'll use 1-based indexing (position starts at 1).

Wait, actually it could be 0-based. Let me look at the test:
"create product A with ingredients [a, b, c] and product B with [c, a, b] (same set, different positions)"

This just means the order is different. The position values themselves don't matter as long as they're consistent and allow ordering. I'll use 1-based.

Now, for `listWithIngredients`, the plan says "products that have ≥1 product_ingredient". This means I need to filter products that have at least one related product_ingredient row.

Let me write the file:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: number) {
    return this.prisma.product.findUnique({
      where: { id },
      include: { productIngredients: { orderBy: { position: 'asc' } } },
    });
  }

  async listWithIngredients() {
    return this.prisma.product.findMany({
      where: { productIngredients: { some: {} } },
      include: { productIngredients: { orderBy: { position: 'asc' } } },
    });
  }

  async list() {
    return this.prisma.product.findMany();
  }

  async create(name: string, ingredients: string[]) {
    return this.prisma.product.create({
      data: {
        name,
        productIngredients: {
          create: ingredients.map((rawText, index) => ({
            rawText,
            position: index + 1,
          })),
        },
      },
      include: { productIngredients: { orderBy: { position: 'asc' } } },
    });
  }
}
```

Wait, I need to think about the Prisma model field names. The plan uses `raw_text` for the column, which in Prisma would be mapped from a field name. By Prisma convention, if the column is `raw_text` with `@map("raw_text")`, the Prisma field name would be `rawText`.

Similarly, `position` maps to `position` (no special mapping needed since it's already a single word).

The relation between Product and ProductIngredient: In Prisma, the model `Product` would have a field like `productIngredients: ProductIngredient[]` and `ProductIngredient` would have `productId: Int` with the relation.

Actually, I need to be careful about the field naming. Let me think about what the Prisma schema would look like based on the plan:

```prisma
model Product {
  id        Int               @id @default(autoincrement())
  name      String
  createdAt DateTime          @default(now()) @map("created_at")
  productIngredients ProductIngredient[]

  @@map("products")
}

model ProductIngredient {
  id        Int     @id @default(autoincrement())
  productId Int     @map("product_id")
  rawText   String  @map("raw_text")
  position  Int

  product   Product @relation(fields: [productId], references: [id])

  @@unique([productId, position])
  @@map("product_ingredients")
}
```

So in the Prisma client, I'd use:
- `this.prisma.product` (lowercase model name)
- Field `rawText` for the `raw_text` column
- Field `productId` for the `product_id` column
- Relation field on Product would be... hmm, what would it be called?

Actually, the plan doesn't specify the exact Prisma field name for the relation. In typical Prisma convention, if the model is `ProductIngredient`, the relation field on `Product` might be called `productIngredients` or just `ingredients`. 

This is a point where I need to make an assumption. The plan doesn't explicitly name the Prisma relation field. Let me look at what makes sense...

Given the table is `product_ingredients` and the model would be `ProductIngredient`, the relation field on Product could be either:
- `productIngredients` (matching the model name pluralized)
- `ingredients` (shorter, more readable)

Since the plan doesn't specify, I'll go with `productIngredients` as it's the most conventional Prisma naming (pluralized model name). But actually, in many Prisma projects, the relation is named after the concept. Since the plan calls them "ingredients" in various places ("product with ingredient lists", "products with ingredient lists"), maybe `ingredients` is better.

Hmm, but I should be consistent with what the schema would generate. Let me think about this differently - the plan says "Prisma CRUD for products + product_ingredients". The table is `product_ingredients`. The Prisma model would be `ProductIngredient`. The relation field... 

I'll go with `productIngredients` as the relation field name since it directly maps to the model name. This is the safest assumption.

Actually wait - let me reconsider. Looking at the classification service, it needs to load "product + product_ingredients ordered by position". The plan's repository interface for products says:

```ts
findById(id: number): Promise<Product | null>;
```

The return type is just `Product` (the Prisma type). With `include`, it would be `Product & { productIngredients: ProductIngredient[] }`.

I think my implementation is correct. Let me finalize it.

One more thought: should I import specific types or just use Prisma's generated types? Since the plan doesn't show explicit type imports for the repository, and it's a Prisma repository, I'll just let TypeScript infer from Prisma client methods.

Let me also make sure the `create` method handles the case where `ingredients` is an empty array. In that case, we'd just create a product with no ingredients. That should work fine with Prisma's nested create.

Final check on the plan:
- "Prisma CRUD for products + product_ingredients" ✓
- Methods match the interface ✓
- Uses PrismaClient ✓
- @Injectable() ✓

I'm satisfied with this implementation.
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: number) {
    return this.prisma.product.findUnique({
      where: { id },
      include: {
        productIngredients: { orderBy: { position: 'asc' } },
      },
    });
  }

  async listWithIngredients() {
    return this.prisma.product.findMany({
      where: { productIngredients: { some: {} } },
      include: {
        productIngredients: { orderBy: { position: 'asc' } },
      },
    });
  }

  async list() {
    return this.prisma.product.findMany();
  }

  async create(name: string, ingredients: string[]) {
    return this.prisma.product.create({
      data: {
        name,
        productIngredients: {
          create: ingredients.map((rawText, index) => ({
            rawText,
            position: index + 1,
          })),
        },
      },
      include: {
        productIngredients: { orderBy: { position: 'asc' } },
      },
    });
  }
}
```
