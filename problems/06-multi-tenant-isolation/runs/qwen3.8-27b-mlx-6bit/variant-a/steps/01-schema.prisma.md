# 01-schema.prisma

## reasoning

```
The user wants me to write the `prisma/schema.prisma` file based on the PLAN.md specification. Let me carefully extract the data model from the plan.

From the plan:

**tenants** (`@@map("tenants")`)
| id | String (uuid) | PK, `@default(uuid())` |
| name | String | |
| domain | String | unique, e.g. `app.operator-x.com` |
| branding | Json (JsonB) | `{ primary_color: string, logo_url: string, ... }` |
| feature_flags | Json (JsonB) | `{ plan_management: boolean, ... }` |
| created_at | DateTime | `@default(now())` |
| updated_at | DateTime | `@updatedAt` |

**customers** (`@@map("customers")`)
| id | String (uuid) | PK |
| tenant_id | String | FK → tenants.id, `@map("tenant_id")` |
| email | String | `@map("email")` |
| name | String | |
| created_at | DateTime | |
| updated_at | DateTime | |

Unique: `[tenant_id, email]` (`@@unique([tenantId, email], name: "customer_tenant_email_unique")`)

**plans** (`@@map("plans")`)
| id | String (uuid) | PK |
| tenant_id | String | FK → tenants.id |
| name | String | |
| price_cents | Int | `@map("price_cents")` |
| created_at | DateTime | |
| updated_at | DateTime | |

**orders** (`@@map("orders")`)
| id | String (uuid) | PK |
| tenant_id | String | FK → tenants.id |
| customer_id | String | FK → customers.id, `@map("customer_id")` |
| plan_id | String | FK → plans.id, `@map("plan_id")` |
| status | String | default `"pending"` |
| total_cents | Int | `@map("total_cents")` |
| created_at | DateTime | |
| updated_at | DateTime | |

Now let me write the Prisma schema:

- Generator: prisma-client-js
- Datasource: postgresql, env("DATABASE_URL")

For tenants:
- model Tenant
- @@map("tenants")
- id: String @id @default(uuid())
- name: String
- domain: String @unique
- branding: Json
- feature_flags: Json @map("feature_flags")
- created_at: DateTime @default(now()) @map("created_at")
- updated_at: DateTime @updatedAt @map("updated_at")

For customers:
- model Customer
- @@map("customers")
- id: String @id @default(uuid())
- tenantId: String @map("tenant_id")
- email: String
- name: String
- createdAt: DateTime @default(now()) @map("created_at")
- updatedAt: DateTime @updatedAt @map("updated_at")
- tenant: Tenant @relation(fields: [tenantId], references: [id])
- @@unique([tenantId, email], name: "customer_tenant_email_unique")

For plans:
- model Plan
- @@map("plans")
- id: String @id @default(uuid())
- tenantId: String @map("tenant_id")
- name: String
- priceCents: Int @map("price_cents")
- createdAt: DateTime @default(now()) @map("created_at")
- updatedAt: DateTime @updatedAt @map("updated_at")
- tenant: Tenant @relation(fields: [tenantId], references: [id])

For orders:
- model Order
- @@map("orders")
- id: String @id @default(uuid())
- tenantId: String @map("tenant_id")
- customerId: String @map("customer_id")
- planId: String @map("plan_id")
- status: String @default("pending")
- totalCents: Int @map("total_cents")
- createdAt: DateTime @default(now()) @map("created_at")
- updatedAt: DateTime @updatedAt @map("updated_at")
- tenant: Tenant @relation(fields: [tenantId], references: [id])
- customer: Customer @relation(fields: [customerId], references: [id])
- plan: Plan @relation(fields: [planId], references: [id])

I need to add relation fields on the parent side too. Let me think about this:

Tenant has relations to Customer, Plan, Order. So Tenant needs:
- customers: Customer[]
- plans: Plan[]
- orders: Order[]

Customer has relation to Order. So Customer needs:
- orders: Order[]

Plan has relation to Order. So Plan needs:
- orders: Order[]

Let me also think about whether `email` needs `@map`. The plan says `@map("email")` but email in snake_case is just "email", so the column name would be "email" anyway. However, the plan explicitly states `@map("email")` for the email field. Actually, looking more carefully, the convention is snake_case for columns. "email" in snake_case is just "email", so `@map("email")` is redundant but harmless. I'll include it since the plan specifies it.

Wait, actually re-reading the conventions: "Table and column: snake_case (via Prisma `@map`/`@@map`)." So the TS field is camelCase and the column is snake_case via @map. For "email", the snake_case is "email" (no change needed), so @map("email") is technically redundant. But the plan explicitly lists it. I'll include it to match the plan exactly.

Actually, let me reconsider. In Prisma, if you don't put @map, the field name is used as-is for the column. So `email` would map to column `email` which is already snake_case. Adding `@map("email")` is explicit but redundant. The plan lists it, so I'll include it for fidelity.

Let me also think about the `feature_flags` field. In TS it would be `featureFlags` (camelCase), and the column is `feature_flags` (snake_case). So: `featureFlags Json @map("feature_flags")`.

Similarly `branding` - in TS it's `branding`, column is `branding`. No @map needed unless we want to be explicit. The plan doesn't mention @map for branding specifically, just says it's a Json column.

Let me finalize the schema now.
```

## reply

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Tenant {
  id            String    @id @default(uuid())
  name          String
  domain        String    @unique
  branding      Json
  featureFlags  Json      @map("feature_flags")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  customers Customer[]
  plans     Plan[]
  orders    Order[]

  @@map("tenants")
}

model Customer {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  email     String   @map("email")
  name      String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  tenant Tenant  @relation(fields: [tenantId], references: [id])
  orders Order[]

  @@unique([tenantId, email], name: "customer_tenant_email_unique")
  @@map("customers")
}

model Plan {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  name       String
  priceCents Int      @map("price_cents")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  tenant Tenant  @relation(fields: [tenantId], references: [id])
  orders Order[]

  @@map("plans")
}

model Order {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  customerId String   @map("customer_id")
  planId     String   @map("plan_id")
  status     String   @default("pending")
  totalCents Int      @map("total_cents")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  tenant   Tenant   @relation(fields: [tenantId], references: [id])
  customer Customer @relation(fields: [customerId], references: [id])
  plan     Plan     @relation(fields: [planId], references: [id])

  @@map("orders")
}
```
