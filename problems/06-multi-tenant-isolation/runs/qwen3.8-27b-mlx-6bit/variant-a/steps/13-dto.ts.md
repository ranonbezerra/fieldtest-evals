# 13-dto.ts

## reasoning

```
The task is to write `src/plan/dto.ts` with three exports: `CreatePlanInput`, `UpdatePlanInput`, and `Plan`.

From the plan:
- **plans** table columns: id (uuid), tenant_id, name (String), price_cents (Int, `@map("price_cents")`), created_at (DateTime), updated_at (DateTime)

From the DTO pattern shown in the plan for customers:
```ts
export interface CreateCustomerInput {
  email: string;
  name: string;
}
export interface UpdateCustomerInput {
  email?: string;
  name?: string;
}
export interface Customer {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}
```

So for plans, following the same pattern:
- `CreatePlanInput`: fields needed to create a plan (excluding id, tenantId, timestamps). That's `name` and `priceCents`.
- `UpdatePlanInput`: same fields but optional. `name?` and `priceCents?`.
- `Plan`: the full shape as returned. `id`, `name`, `priceCents`, `createdAt`, `updatedAt`.

The column `price_cents` maps to `priceCents` in TypeScript (camelCase via Prisma convention).

Let me write the file.
```

## reply

```ts
export interface CreatePlanInput {
  name: string;
  priceCents: number;
}

export interface UpdatePlanInput {
  name?: string;
  priceCents?: number;
}

export interface Plan {
  id: string;
  name: string;
  priceCents: number;
  createdAt: Date;
  updatedAt: Date;
}
```
