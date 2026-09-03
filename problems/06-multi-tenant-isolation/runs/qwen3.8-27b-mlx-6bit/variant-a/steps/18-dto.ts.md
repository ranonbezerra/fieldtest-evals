# 18-dto.ts

## reasoning

```
The user wants me to write `src/order/dto.ts` based on the plan specification.

From the plan, I can see:

For orders table:
| Column | Type | Notes |
|---|---|---|
| id | String (uuid) | PK |
| tenant_id | String | FK → tenants.id, `@map("tenant_id")` |
| customer_id | String | FK → customers.id, `@map("customer_id")` |
| plan_id | String | FK → plans.id, `@map("plan_id")` |
| status | String | default `"pending"` |
| total_cents | Int | `@map("total_cents")` |
| created_at | DateTime | |
| updated_at | DateTime | |

The plan says: "Analogous `CreatePlanInput`, `UpdatePlanInput`, `Plan`, `CreateOrderInput`, `UpdateOrderInput`, `Order`."

So I need to define:
- `CreateOrderInput` — the fields needed to create an order (excluding id, tenantId, createdAt, updatedAt)
- `UpdateOrderInput` — optional fields that can be updated
- `Order` — the full entity shape

Looking at the customer example:
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

So for orders:
- `CreateOrderInput`: customer_id, plan_id, status (optional since it has a default), total_cents
- `UpdateOrderInput`: optional versions of mutable fields (customer_id, plan_id, status, total_cents)
- `Order`: id, customerId, planId, status, totalCents, createdAt, updatedAt

Wait, should I include tenant_id in the Order type? Looking at the customer example, it does NOT include tenantId in the Customer interface. The plan says "Repositories never reference `tenantId` in their parameters or bodies." So the DTO types should NOT include tenantId.

For CreateOrderInput:
- customerId: string (FK)
- planId: string (FK)
- status?: string (has default "pending")
- totalCents: number

For UpdateOrderInput:
- customerId?: string
- planId?: string
- status?: string
- totalCents?: number

For Order:
- id: string
- customerId: string
- planId: string
- status: string
- totalCents: number
- createdAt: Date
- updatedAt: Date

This matches the pattern shown in the customer DTO. Let me write this out.
```

## reply

```ts
export interface CreateOrderInput {
  customerId: string;
  planId: string;
  status?: string;
  totalCents: number;
}

export interface UpdateOrderInput {
  customerId?: string;
  planId?: string;
  status?: string;
  totalCents?: number;
}

export interface Order {
  id: string;
  customerId: string;
  planId: string;
  status: string;
  totalCents: number;
  createdAt: Date;
  updatedAt: Date;
}
```
