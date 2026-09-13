# solution

## reasoning

```
Let me carefully analyze this task. I need to build a complete solution for a marketplace operations dashboard with:

1. A projection table for fast reads (p95 < 50ms)
2. Sync hooks that run inside the writer's transaction (read-your-own-writes)
3. Concurrent-safe totals updates
4. Re-derivation routine for date windows
5. Scheduled drift-repair job
6. Dashboard query reading only the projection
7. Tests for read-your-own-writes, concurrent totals, and drift repair
8. DESIGN.md

Stack: TypeScript, NestJS, Prisma, PostgreSQL, pnpm, Vitest, ESM.

Let me design the file layout:

**Prisma schema** - Source tables: `Order`, `Event`, `Worker`, `Company`. Projection table: `OperationsProjection`.

**Feature module**: `operations-dashboard` or `operations`

Let me think about the domain model:
- `Company` - companies in the marketplace
- `Worker` - workers who process orders
- `Order` (payment order) - has company_id, worker_id, status, amount, created_at, etc.
- `Event` - events linked to orders
- `OperationsProjection` - the projection table with denormalized data for the dashboard query

The dashboard query filters by company, status, date range, sorted by recency, paginated.

Financial totals per company: sum of amounts by status.

Let me plan the files:

1. `prisma/schema.prisma` - all models
2. `src/main.ts` - NestJS entry
3. `src/app.module.ts` - root module
4. `src/operations/operations.module.ts` - feature module
5. `src/operations/operations.controller.ts` - dashboard query endpoint + approve endpoint
6. `src/operations/operations.service.ts` - business logic
7. `src/operations/operations.repository.ts` - DB access
8. `src/operations/projection-maintenance.service.ts` - sync hooks, re-derivation, drift repair
9. `src/operations/scheduled-job.service.ts` - drift repair scheduler
10. Test files
11. `DESIGN.md`

Let me think about the Prisma schema carefully:

```prisma
model Company {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
  orders    Order[]
  totals    CompanyTotal[]
}

model Worker {
  id        String   @id @default(uuid())
  name      String
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  createdAt DateTime @default(now())
  orders    Order[]
}

model Order {
  id          String   @id @default(uuid())
  companyId   String
  company     Company  @relation(fields: [companyId], references: [id])
  workerId    String
  worker      Worker   @relation(fields: [workerId], references: [id])
  status      String   // pending, approved, rejected, etc.
  amount      Float
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  events      Event[]
}

model Event {
  id        String   @id @default(uuid())
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id])
  type      String
  data      Json
  createdAt DateTime @default(now())
}

model OperationsProjection {
  id              String   @id @default(uuid())
  companyId       String
  orderId         String
  workerId        String
  workerName      String
  status          String
  amount          Float
  createdAt       DateTime
  eventCount      Int
  // mapped tables
  @@map("operations_projection")
  @@index([companyId, status, createdAt])
}

model CompanyTotal {
  id            String   @id @default(uuid())
  companyId     String   @unique
  company       Company  @relation(fields: [companyId], references: [id])
  totalAmount   Float
  approvedCount Int
  pendingCount  Int
  // ... other status counts
  @@map("company_total")
}
```

Actually, let me simplify. The key requirements are:

1. Projection table for the dashboard list query
2. Company totals table for financial totals
3. Both updated synchronously in the write transaction

Let me think about the sync hooks more carefully. The requirement says "the maintenance hooks are called by the write services and run inside the transaction that writes the source row." So in Prisma, we can use `$transaction` to do both the write and the projection update atomically.

Let me now think about the structure more carefully:

**Write path**: When an order is created or approved, the service:
1. Writes to the source table (Order)
2. Calls the projection maintenance service (same transaction)
3. The projection maintenance updates the `OperationsProjection` and `CompanyTotal` tables

**Read path**: The dashboard query reads ONLY from `OperationsProjection`.

For concurrent updates: Use Prisma's `update` with `data: { totalAmount: { increment: amount } }` which is atomic at the database level.

For re-derivation: A routine that deletes projection rows for a date range and rebuilds them from source.

For drift repair: A scheduled job that compares projection with source and repairs differences.

Let me now write all the files.

Actually, let me think about what's realistic for a single NestJS app with Prisma. I need to be careful about the structure.

Let me design a cleaner schema:

```prisma
model Company {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
  orders    Order[]
  total     CompanyTotal?
}

model Worker {
  id        String   @id @default(uuid())
  name      String
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  orders    Order[]
}

model Order {
  id        String   @id @default(uuid())
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  workerId  String
  worker    Worker   @relation(fields: [workerId], references: [id])
  status    String
  amount    Float
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  events    Event[]
}

model Event {
  id        String   @id @default(uuid())
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id])
  type      String
  createdAt DateTime @default(now())
}

model OperationsProjection {
  id              String   @id @default(uuid())
  companyId       String
  orderId         String
  workerId        String
  workerName      String
  status          String
  amount          Float
  createdAt       DateTime
  eventCount      Int      @default(0)
  @@map("operations_projection")
  @@index([companyId, status, createdAt])
  @@unique([companyId, orderId])
}

model CompanyTotal {
  id            String   @id @default(uuid())
  companyId     String   @unique
  company       Company  @relation(fields: [companyId], references: [id])
  totalAmount   Float    @default(0)
  pendingAmount Float    @default(0)
  approvedAmount Float   @default(0)
  pendingCount  Int      @default(0)
  approvedCount Int      @default(0)
  @@map("company_total")
}
```

Now let me think about the code structure more carefully.

The operations module will have:
- Controller: endpoints for dashboard query, approve order, create order (for testing), and admin endpoints for re-derivation and drift repair
- Service: business logic
- Repository: Prisma client wrapper
- Projection maintenance: sync hooks, re-derivation, drift repair logic

Let me also think about the test structure. I need:
1. Test read-your-own-writes (approve order → see it in dashboard)
2. Test concurrent updates (two concurrent approvals for same company)
3. Test drift repair (inject drift, run repair, verify fixed)

Now let me write everything out:

For the `OperationsProjection`, the covering index should be `[companyId, status, createdAt]` which matches the filter (company, status) and sort (createdAt desc) pattern.

Let me structure the files:

```
prisma/schema.prisma
src/main.ts
src/app.module.ts
src/operations/operations.module.ts
src/operations/operations.controller.ts
src/operations/operations.service.ts
src/operations/operations.repository.ts
src/operations/projection-maintenance.service.ts
test/operations.spec.ts
DESIGN.md
```

Let me also think about the `OperationsProjection` having `@@unique([companyId, orderId])` to prevent duplicates during concurrent writes.

Actually, let me think about this more carefully. When an order is approved, I need to:
1. Update Order.status from 'pending' to 'approved'
2. Update OperationsProjection (it already exists for this order since it was created)
3. Update CompanyTotal: decrement pending, increment approved (atomic increment)

When an order is created:
1. Create Order
2. Create OperationsProjection row
3. Update CompanyTotal pending

Let me now write everything. I'll be thorough.

For the `$transaction` approach in Prisma, I'll use `prisma.$transaction([...])` which runs all operations in a single transaction.

Let me think about what the `operations.service.ts` will look like. It needs:
- `createOrder` - creates order + projection + updates totals (all in transaction)
- `approveOrder` - updates order status + projection + updates totals (all in transaction)
- `getDashboard` - reads from projection only
- `rederiveWindow` - rebuilds projection for date range
- `repairDrift` - compares and repairs

Actually, let me separate concerns better. The `operations.service.ts` handles the business logic (create, approve, dashboard query). The `projection-maintenance.service.ts` handles projection updates (sync hooks, re-derivation, drift repair).

Let me finalize the architecture:

**operations.service.ts**: 
- `createOrder(data)` → calls `repository.createOrder` + `projectionMaintenance.onOrderCreated` (all in transaction)
- `approveOrder(orderId)` → calls `repository.approveOrder` + `projectionMaintenance.onOrderApproved` (all in transaction)
- `getDashboard(params)` → calls `repository.getDashboard` (reads projection only)
- `getCompanyTotal(companyId)` → reads from CompanyTotal

**projection-maintenance.service.ts**:
- `onOrderCreated(orderData)` → inserts into OperationsProjection, updates CompanyTotal
- `onOrderApproved(orderData)` → updates OperationsProjection status, updates CompanyTotal (atomic increment/decrement)
- `rederiveWindow(startDate, endDate)` → rebuilds projection for date range
- `repairDrift(windowHours)` → detects and repairs drift

**operations.repository.ts**:
- Prisma queries for source tables and projection

Let me write it all now.

One more thing: for the test, since this is an integration test with a real database, I'll need to set up the test database. In NestJS/Vitest, I can use a test database via Prisma migration. Let me use a simpler approach: spin up the app, use the Prisma client directly.

Actually for Vitest with Prisma/NestJS, a common pattern is:
- Use a separate test database
- Run migrations before tests
- Use a test module fixture

Let me keep the tests practical. I'll use a `beforeAll` to set up the database connection and `afterAll` to clean up.

Now let me write all the code:

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

```typescript
// src/app.module.ts
import { Module } from '@nestjs/core';
import { OperationsModule } from './operations/operations.module';

@Module({
  imports: [OperationsModule],
})
export class AppModule {}
```

Now for the Prisma client service:

Actually, I should provide a PrismaService that wraps the PrismaClient. Let me add that.

```typescript
// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: { url: process.env.DATABASE_URL },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Wait, with Prisma + NestJS, the standard pattern is to use `PrismaService`. Let me include it in the schema and module.

Actually let me think about what files are needed. I don't want to over-engineer but I need to cover all the requirements. Let me be practical.

Let me list all files I'll create:

1. `prisma/schema.prisma`
2. `src/main.ts`
3. `src/app.module.ts`
4. `src/prisma/prisma.service.ts`
5. `src/operations/operations.module.ts`
6. `src/operations/operations.controller.ts`
7. `src/operations/operations.service.ts`
8. `src/operations/operations.repository.ts`
9. `src/operations/projection-maintenance.service.ts`
10. `test/operations.spec.ts`
11. `DESIGN.md`

That looks comprehensive. Let me now write each file carefully.

For the schema, I need to make sure the projection table has the right shape and indexes.

For the operations controller endpoints:
- `GET /operations` - dashboard query (companyId, status, from, to, page, pageSize)
- `POST /orders` - create order
- `POST /orders/:id/approve` - approve order
- `POST /operations/rederive` - re-derive window (admin)
- `POST /operations/repair-drift` - drift repair (admin)
- `GET /companies/:id/total` - get company total

Let me start writing now. This is going to be long.

For the projection maintenance service, the key methods are:

```typescript
// Called inside the write transaction
async upsertProjection(order: { id, companyId, orderId, workerId, workerName, status, amount, createdAt, eventCount }) {
  // INSERT or UPDATE the projection row
}

async updateCompanyTotal(companyId, statusChange) {
  // Atomic update of CompanyTotal
}
```

For concurrent updates, the key is using Prisma's `increment` operator or raw SQL with `UPDATE ... SET total = total + X`.

Let me now write all files. I'll be thorough and complete.

Actually wait - let me think about the structure more. The `onOrderApproved` hook needs to:
1. Update the OperationsProjection row for this order (change status from pending to approved)
2. Atomically update CompanyTotal: subtract amount from pendingAmount/pendingCount, add amount to approvedAmount/approvedCount

And `onOrderCreated` needs to:
1. Insert into OperationsProjection
2. Atomically add amount to pendingAmount/pendingCount in CompanyTotal (new order starts as pending)

For the CompanyTotal update to be atomic and concurrent-safe:
```typescript
await prisma.$transaction([
  prisma.companyTotal.upsert({
    where: { companyId },
    create: { companyId, totalAmount: amount, pendingAmount: amount, pendingCount: 1 },
    update: { 
      totalAmount: { increment: amount },
      pendingAmount: { increment: amount },
      pendingCount: { increment: 1 },
    },
  }),
  prisma.operationsProjection.create({ data: { ... } }),
]);
```

For approval:
```typescript
await prisma.$transaction([
  prisma.order.update({ where: { id }, data: { status: 'approved' } }),
  prisma.operationsProjection.update({ 
    where: { id }, 
    data: { status: 'approved' } 
  }),
  prisma.companyTotal.upsert({
    where: { companyId },
    create: { companyId, totalAmount: amount, approvedAmount: amount, approvedCount: 1 },
    update: {
      approvedAmount: { increment: amount },
      approvedCount: { increment: 1 },
      pendingAmount: { decrement: amount },
      pendingCount: { decrement: 1 },
    },
  }),
]);
```

This is atomic and concurrent-safe because:
1. The `$transaction` ensures atomicity
2. Prisma's `increment`/`decrement` operations use `UPDATE ... SET col = col + value` which is atomic at the DB level
3. The upsert on CompanyTotal will be serialized by the unique constraint on companyId

Wait, actually I need to be careful. The `increment` operation in Prisma is indeed translated to an atomic `UPDATE` at the database level. And within a transaction, this is safe. Two concurrent transactions trying to update the same CompanyTotal row will be serialized by the database (row-level locking).

Let me now write everything:

For the dashboard query, the controller takes query parameters and passes them to the service, which queries the projection:

```typescript
GET /operations?companyId=xxx&status=approved&from=2024-01-01&to=2024-12-31&page=1&pageSize=20
```

The query:
```typescript
prisma.operationsProjection.findMany({
  where: {
    companyId,
    status,
    createdAt: { gte: from, lte: to },
  },
  orderBy: { createdAt: 'desc' },
  skip: (page - 1) * pageSize,
  take: pageSize,
});
```

With the index `[companyId, status, createdAt]`, this should be very fast.

Now let me write all the files. I'll make them complete and production-quality.

Let me also think about the re-derivation routine. It needs to:
1. For a given date range, find all orders in the source table
2. Delete projection rows for that date range and company
3. Re-insert projection rows from source data
4. Recalculate company totals

This needs to be safe to run while live (doesn't affect ongoing operations) and idempotent.

For idempotency: running it twice on the same window gives the same result because it always rebuilds from source.

For safety during live operation: We can use a transaction. Delete + re-insert within a transaction. But that's risky if concurrent operations are also writing. 

Better approach for re-derivation:
1. Build a temporary table with the correct data for the window
2. Swap it in

Or simpler:
1. Delete projection rows for the window
2. Insert fresh rows from source
3. Recalculate totals

Since this runs inside a transaction, concurrent writes would either see the old data or the new data (ACID).

Actually, the safest approach for re-derivation while live:
1. Read all orders in the window with their current state
2. Delete projection rows for that window  
3. Insert fresh projection rows
4. Recalculate totals for affected companies

All within a single transaction. This is safe because the transaction serializes access.

Let me now write all the code. This is going to be substantial.

One more consideration: the drift repair job. It needs to:
1. For a recent window (e.g., last 24 hours), compare each order in the source with its projection
2. Find mismatches (status, amount, etc.)
3. Fix them by re-syncing from source

This could be a scheduled NestJS job (using `@nestjs/schedule` or a simple setInterval).

Let me also think about how to test this. I'll need a real database for integration tests. I'll use the Prisma test database pattern.

OK, let me just write it all now. I'm going to be comprehensive.

Let me think about whether I need `@nestjs/schedule` or can just use a timer. Since the task says "scheduled drift-repair job," I'll use `@nestjs/schedule`'s `CronJob`.

Actually, looking at the conventions again - they say NestJS for API, Prisma, Postgres, Vitest. I should keep it focused. Let me use a simple timer-based approach to avoid adding another dependency, or use `@nestjs/schedule` if it's commonly used with NestJS.

Let me use `@nestjs/suite`/`@nestjs/schedule` - actually let me check. The standard way in NestJS is `@nestjs/schedule` with `@Cron` decorator. But to avoid dependency issues, I could also use a simple `setInterval` in a service. Let me use `@nestjs/schedule` since it's the NestJS way.

Hmm, actually let me keep it simple and just use a method that can be called on a schedule, without adding the schedule package. The task says "scheduled drift-repair job" - I can implement it as a service with a method that would be called by a cron or scheduler externally, or I can include a simple setInterval in the module.

Let me use `@nestjs/schedule` - it's standard.

OK here goes. Let me write all the files now.

Actually, let me reconsider the schema. The `OperationsProjection` needs to be created via a migration. Let me include a migration in the schema file (as a Prisma migration file). But actually the convention says "Every schema change ships with a migration." The Prisma schema itself defines the final state. Migrations are separate files in `prisma/migrations/`. Since I can't actually run prisma migrate, I'll include the schema and mention the migration concept.

Wait, I think I should include a migration file too. Let me check the convention again: "Every schema change ships with a migration." So I should include a migration file.

Let me include `prisma/migrations/00000000000000_initial/migration.sql` and `prisma/migrations/00000000000001_add_projection/migration.sql`.

But I can't actually generate valid SQL from Prisma without running the CLI. Let me write reasonable SQL for the migration files.

Actually, I think for this task, the schema.prisma is sufficient as the definition, and I can note that migrations should be generated. The task says "Projection table(s) and DDL with indexes" - the DDL can be in the schema or a separate SQL file.

Let me include both the schema and a migration SQL file.

Now let me finalize and write everything. I'll aim for completeness and correctness.

Here's my final file plan:

1. `prisma/schema.prisma` - All models
2. `prisma/migrations/00000000000000_initial/migration.sql` - Initial schema
3. `prisma/migrations/00000000000001_add_operations_projection/migration.sql` - Add projection tables
4. `src/main.ts`
5. `src/app.module.ts`
6. `src/prisma/prisma.service.ts`
7. `src/operations/operations.module.ts`
8. `src/operations/operations.controller.ts`
9. `src/operations/operations.service.ts`
10. `src/operations/operations.repository.ts`
11. `src/operations/projection-maintenance.service.ts`
12. `test/operations.spec.ts`
13. `DESIGN.md`

Let me start writing now. Each file will be complete and correct.

For the tests, I need to think about how to run them. Vitest with Prisma typically requires:
- A running database
- Schema pushed/migrated
- Connection string from env

I'll write tests that:
1. Set up the database connection
2. Run operations against it
3. Clean up after

Let me write a practical test setup.

OK, I'll now write all the code. Let me be thorough.

Let me reconsider one thing: the `OperationsProjection` model. It should be created by a write hook when an order is created. So when an order is placed for a company, the projection row is created AND the company total is updated, all within the same transaction.

When an order is approved, the projection row's status is updated AND the company totals are adjusted (pending→approved), all within the same transaction.

This ensures read-your-own-writes because both changes happen atomically.

Let me write the schema first:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["fullTextSearch", "fullTextIndex"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Company {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
  orders    Order[]
  total     CompanyTotal?

  @@map("companies")
}

model Worker {
  id        String   @id @default(uuid())
  name      String
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  createdAt DateTime @default(now())
  orders    Order[]

  @@map("workers")
}

model Order {
  id        String   @id @default(uuid())
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  workerId  String
  worker    Worker   @relation(fields: [workerId], references: [id])
  status    String
  amount    Float
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  events    Event[]

  @@map("orders")
}

model Event {
  id        String   @id @default(uuid())
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id])
  type      String
  createdAt DateTime @default(now())

  @@map("events")
}

model OperationsProjection {
  id              String   @id @default(uuid())
  companyId       String
  orderId         String
  workerId        String
  workerName      String
  status          String
  amount          Float
  createdAt       DateTime
  eventCount      Int      @default(0)

  @@map("operations_projection")
  @@index([companyId, status, createdAt])
  @@unique([companyId, orderId])
}

model CompanyTotal {
  id             String   @id @default(uuid())
  companyId      String   @unique
  company        Company  @relation(fields: [companyId], references: [id])
  totalAmount    Float    @default(0)
  pendingAmount  Float    @default(0)
  approvedAmount Float    @default(0)
  pendingCount   Int      @default(0)
  approvedCount  Int      @default(0)

  @@map("company_total")
}
```

Now let me think about the migration SQL files. They're not strictly needed for the solution to work (Prisma push would create them), but per convention, every schema change ships with a migration. Let me include them with reasonable SQL.

Now for the code files:

### src/prisma/prisma.service.ts
Standard NestJS Prisma service.

### src/operations/operations.module.ts
Imports PrismaService, exports nothing (operations is the feature module).

### src/operations/operations.repository.ts
All database access. Methods:
- `createOrder(data)` → create Order + create Event(s) if any
- `approveOrder(orderId)` → update Order status
- `getDashboard(params)` → query OperationsProjection
- `getCompanyTotal(companyId)` → query CompanyTotal
- `createOrderInTransaction(data, hooks)` → create order + projection updates
- `approveOrderInTransaction(orderId, hooks)` → approve + projection updates
- `getOrdersForWindow(start, end)` → get all orders in date range
- `getProjectionForWindow(start, end)` → get all projections in date range
- `rebuildProjection(orders)` → delete and recreate projections
- `recalculateTotals(companyId)` → recalculate totals from orders
- `getProjectionCountByStatusForCompany(companyId)` → used in drift detection
- `repairProjectionForOrder(orderId)` → fix a single projection row from source
- `repairProjectionForWindow(start, end)` → fix all projection rows in window

Wait, I'm mixing too many concerns in the repository. Let me separate:
- Source table access (orders, events, workers, companies)
- Projection table access
- Total table access

Let me keep it as one file per convention. The repository is the only layer that touches the database.

### src/operations/operations.controller.ts
- `GET /operations` → dashboard query
- `POST /orders` → create order
- `POST /orders/:id/approve` → approve
- `POST /orders/:id/reject` → reject (for completeness)
- `POST /admin/rederive` → re-derive window
- `POST /admin/repair-drift` → repair drift
- `GET /companies/:id/total` → company total

### src/operations/operations.service.ts
- `getDashboard(query)` → reads projection only
- `createOrder(data)` → writes source + calls projection hooks (transaction)
- `approveOrder(id)` → writes source + calls projection hooks (transaction)
- `rederiveWindow(start, end)` → re-derivation routine
- `runDriftRepair(windowHours)` → drift repair
- `getCompanyTotal(companyId)` → financial totals

### src/operations/projection-maintenance.service.ts
- `onOrderCreated(order)` → sync hook: update projection + totals
- `onOrderApproved(order)` → sync hook: update projection + totals
- `onOrderDeleted(order)` → sync hook: remove from projection + totals (optional)
- `rederiveWindow(start, end)` → re-derivation
- `detectDrift(start, end)` → detect discrepancies
- `repairDrift(start, end)` → repair discrepancies

Wait, I'm putting some things in both the service and projection-maintenance. Let me reorganize:

The `operations.service.ts` has the public API methods that the controller calls:
- `getDashboard`
- `createOrder`
- `approveOrder`
- `getCompanyTotal`
- `rederiveWindow` (delegates to projection-maintenance)
- `repairDrift` (delegates to projection-maintenance, also has scheduled version)

The `projection-maintenance.service.ts` has the internal maintenance logic:
- `onOrderCreated` (sync hook)
- `onOrderApproved` (sync hook)
- `rederiveWindow`
- `detectDrift`
- `repairDrift`
- `runScheduledDriftRepair` (the scheduled job)

Both services use the repository.

Let me finalize the code now. I need to be precise.

For the tests, I'll use Vitest. The test will need a real database. I'll use a test database URL from the environment or a default test database.

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { OperationsService } from '../src/operations/operations.service';
// ...
```

Actually, let me think about what the test needs to cover:
1. **Read-your-own-writes**: Create an order, then query dashboard → order appears. Approve order, then query dashboard → shows approved.
2. **Concurrent updates**: Two concurrent approvals for the same company → totals are exact.
3. **Drift repair**: Insert data into projection that disagrees with source → run repair → projection matches source.

Let me write tests that are practical and comprehensive.

For the concurrent test, I need to simulate two workers approving orders for the same company at the same time. I'll use `Promise.all` to run them concurrently.

OK let me just write everything now. I've been planning long enough.

One more thing: for the `@Cron` decorator, I need `@nestjs/schedule`. Let me include it. If it's not available, the scheduled job can be a method called by a simple timer. I'll use `@nestjs/schedule`.

Wait, actually, let me check: does the task explicitly require `@nestjs/schedule`? It says "a scheduled drift-repair job." I can implement this as a NestJS service with a method and call it on a timer. Using `@nestjs/schedule` is cleaner. Let me include it.

Let me add `@nestjs/schedule` to the module imports.

Now, the `OperationsModule` needs to import `ScheduleModule` and `PrismaModule` (or wherever PrismaService lives).

Let me finalize the structure. I'll create a `PrismaModule`:

Actually, the simplest approach: just register PrismaService in the root AppModule, and have OperationsModule import it.

Or even simpler: register PrismaService in the OperationsModule itself. Since the project is small, this is fine.

Let me write it all now.

Let me also consider: for the scheduled job, I need `@Cron` from `@nestjs/schedule`. Let me check: `@nestjs/schedule` provides `ScheduleModule` and the `@Cron` decorator.

OK here's my final architecture:

```
PrismaService (registered in OperationsModule providers)
OperationsModule (imports ScheduleModule)
  - OperationsController
  - OperationsService
  - ProjectionMaintenanceService
  - PrismaService
```

Let me write all the code now. I'll start from the top and work down.

Let me be careful about the transaction semantics. When creating an order, the full transaction should be:

```typescript
await this.prisma.$transaction(async (tx) => {
  // 1. Create the order in source
  const order = await tx.order.create({ data: {...} });
  
  // 2. Call projection maintenance hook (uses the tx)
  await this.projectionMaintenance.onOrderCreated(order, tx);
});
```

The `onOrderCreated` hook receives the transaction and uses it:

```typescript
async onOrderCreated(order: Order, tx: PrismaTransaction) {
  await tx.operationsProjection.create({
    data: {
      companyId: order.companyId,
      orderId: order.id,
      workerId: order.workerId,
      workerName: order.worker.name,
      status: order.status,
      amount: order.amount,
      createdAt: order.createdAt,
      eventCount: await tx.event.count({ where: { orderId: order.id } }),
    }
  });
  
  await tx.companyTotal.upsert({
    where: { companyId: order.companyId },
    create: {
      companyId: order.companyId,
      totalAmount: order.amount,
      pendingAmount: order.amount,
      pendingCount: 1,
    },
    update: {
      totalAmount: { increment: order.amount },
      pendingAmount: { increment: order.amount },
      pendingCount: { increment: 1 },
    }
  });
}
```

This all happens inside the order creation transaction, so if any part fails, everything rolls back. The operator sees the change immediately because it's committed atomically.

Now let me think about the approve path:

```typescript
await this.prisma.$transaction(async (tx) => {
  // 1. Update order status in source
  const order = await tx.order.update({
    where: { id: orderId },
    data: { status: 'approved' },
  });
  
  // 2. Call projection maintenance hook
  await this.projectionMaintenance.onOrderApproved(order, tx);
});
```

The hook:

```typescript
async onOrderApproved(order: Order, tx: PrismaTransaction) {
  // Update projection row
  await tx.operationsProjection.update({
    where: { orderId: order.id }, // or { id: projectionId }
    data: { status: 'approved' },
  });
  
  // Atomically update totals (pending → approved)
  await tx.companyTotal.upsert({
    where: { companyId: order.companyId },
    create: {
      companyId: order.companyId,
      totalAmount: order.amount,
      approvedAmount: order.amount,
      approvedCount: 1,
    },
    update: {
      totalAmount: { increment: order.amount }, // Wait, this shouldn't change total, just redistribute
      // Actually total stays the same, only pending→approved
      approvedAmount: { increment: order.amount },
      approvedCount: { increment: 1 },
      pendingAmount: { decrement: order.amount },
      pendingCount: { decrement: 1 },
    }
  });
}
```

Hmm, but what if the CompanyTotal doesn't exist yet for this company? Then the create branch needs to set approvedAmount properly. This would happen if an order was approved before any order was created through the system (shouldn't happen, but for safety).

Actually, in the design, CompanyTotal is created when the first order is created. So when an order is approved, CompanyTotal should always exist. But let me handle both cases for robustness.

Now for the re-derivation routine:

```typescript
async rederiveWindow(startDate: Date, endDate: Date) {
  // Get all companies with orders in this window
  const companies = await this.prisma.order.findMany({
    where: { createdAt: { gte: startDate, lte: endDate } },
    distinct: ['companyId'],
    select: { companyId: true },
  });
  
  for (const { companyId } of companies) {
    // Rebuild projection for this company in the window
    await this.rederiveForCompany(companyId, startDate, endDate);
  }
}
```

Wait, actually re-derivation should be simpler. Let me think about what the requirements say:

"A routine that rebuilds the projection for a date range from the source tables."

So for a given date range:
1. Find all orders in that range
2. Delete projection rows for those orders
3. Rebuild projection rows from source
4. Recalculate company totals for affected companies

Let me implement it more directly:

```typescript
async rederiveWindow(startDate: Date, endDate: Date) {
  const orders = await this.prisma.order.findMany({
    where: { createdAt: { gte: startDate, lte: endDate } },
    include: { events: true, worker: true },
  });
  
  const companyIds = [...new Set(orders.map(o => o.companyId))];
  
  // Use a transaction for safety
  await this.prisma.$transaction(async (tx) => {
    // Delete existing projection rows for these orders
    const orderIds = orders.map(o => o.id);
    await tx.operationsProjection.deleteMany({
      where: { orderId: { in: orderIds } },
    });
    
    // Recreate projection rows
    for (const order of orders) {
      await tx.operationsProjection.create({
        data: {
          companyId: order.companyId,
          orderId: order.id,
          workerId: order.workerId,
          workerName: order.worker?.name || 'Unknown',
          status: order.status,
          amount: order.amount,
          createdAt: order.createdAt,
          eventCount: order.events?.length || 0,
        },
      });
    }
    
    // Recalculate totals for affected companies
    for (const companyId of companyIds) {
      await this.recalculateCompanyTotal(tx, companyId);
    }
  });
}
```

And `recalculateCompanyTotal`:

```typescript
async recalculateCompanyTotal(tx: PrismaTransaction, companyId: string) {
  // Get all orders for this company (not just the window, since we need accurate totals)
  // Actually, for the re-derivation context, we might want to recalculate only for the window
  // But totals should be for all orders. Let me think...
  
  // Actually, the requirement says "financial totals per company must be exact"
  // So totals should be across all orders for the company, not just a window.
  
  // But during re-derivation of a window, we're rebuilding the projection for that window.
  // The totals that depend on the window's orders need to be recalculated.
  
  // Simpler approach: recalculate totals from ALL orders for the company
  const orders = await tx.order.findMany({
    where: { companyId },
    select: { status: true, amount: true },
  });
  
  const totalAmount = orders.reduce((sum, o) => sum + o.amount, 0);
  const pendingAmount = orders.filter(o => o.status === 'pending').reduce((sum, o) => sum + o.amount, 0);
  const approvedAmount = orders.filter(o => o.status === 'approved').reduce((sum, o) => sum + o.amount, 0);
  const pendingCount = orders.filter(o => o.status === 'pending').length;
  const approvedCount = orders.filter(o => o.status === 'approved').length;
  
  await tx.companyTotal.upsert({
    where: { companyId },
    create: {
      companyId,
      totalAmount,
      pendingAmount,
      approvedAmount,
      pendingCount,
      approvedCount,
    },
    update: {
      totalAmount,
      pendingAmount,
      approvedAmount,
      pendingCount,
      approvedCount,
    },
  });
}
```

Wait, but this approach has a race condition. If orders are being modified concurrently, the recalculation might capture an inconsistent state. But since it's in a transaction, it should be consistent at the transaction's snapshot.

Actually, there's a bigger issue. The re-derivation recalculates totals for ALL orders, but during re-derivation, other transactions might be modifying orders. This could lead to incorrect totals.

For the re-derivation, I think the safest approach is:
1. It's meant to rebuild from source
2. It runs in a transaction
3. Concurrent modifications will be blocked by the transaction's isolation

In PostgreSQL's default Read Committed isolation, the transaction will see a consistent snapshot. In Repeatable Read or Serializable, it's even stronger.

For the re-derivation, let me just calculate totals from all orders of the company. If it's slow for companies with many orders, that's fine - re-derivation is an occasional maintenance operation.

Now for the drift repair:

```typescript
async detectDrift(startDate: Date, endDate: Date) {
  // Get all orders in the window from source
  const orders = await this.prisma.order.findMany({
    where: { createdAt: { gte: startDate, lte: endDate } },
    include: { events: true, worker: true },
  });
  
  // Get all projections for the same orders
  const orderIds = orders.map(o => o.id);
  const projections = await this.prisma.operationsProjection.findMany({
    where: { orderId: { in: orderIds } },
  });
  
  const projectionMap = new Map(projections.map(p => [p.orderId, p]));
  
  const drifts = [];
  for (const order of orders) {
    const projection = projectionMap.get(order.id);
    if (!projection) {
      drifts.push({ orderId: order.id, type: 'missing', current: null });
    } else if (
      projection.status !== order.status ||
      projection.amount !== order.amount ||
      projection.workerName !== (order.worker?.name || 'Unknown')
    ) {
      drifts.push({
        orderId: order.id,
        type: 'mismatch',
        current: { status: order.status, amount: order.amount, workerName: order.worker?.name },
        projected: { status: projection.status, amount: projection.amount, workerName: projection.workerName },
      });
    }
  }
  
  // Also check for orphan projections
  const orderIdSet = new Set(orderIds);
  for (const projection of projections) {
    if (!orderIdSet.has(projection.orderId)) {
      drifts.push({ orderId: projection.orderId, type: 'orphan', current: null });
    }
  }
  
  return drifts;
}

async repairDrift(startDate: Date, endDate: Date) {
  const drifts = await this.detectDrift(startDate, endDate);
  
  await this.prisma.$transaction(async (tx) => {
    for (const drift of drifts) {
      if (drift.type === 'missing' || drift.type === 'mismatch') {
        const order = await this.prisma.order.findUnique({
          where: { id: drift.orderId },
          include: { events: true, worker: true },
        });
        
        if (order) {
          // Upsert projection
          await tx.operationsProjection.upsert({
            where: { orderId: order.id },
            update: {
              status: order.status,
              amount: order.amount,
              workerName: order.worker?.name || 'Unknown',
              eventCount: order.events?.length || 0,
            },
            create: {
              companyId: order.companyId,
              orderId: order.id,
              workerId: order.workerId,
              workerName: order.worker?.name || 'Unknown',
              status: order.status,
              amount: order.amount,
              createdAt: order.createdAt,
              eventCount: order.events?.length || 0,
            },
          });
        }
      } else if (drift.type === 'orphan') {
        await tx.operationsProjection.delete({
          where: { orderId: drift.orderId },
        });
      }
    }
    
    // Recalculate totals for affected companies
    const affectedCompanyIds = [...new Set(drifts.map(d => {
      // need to look up the company from the order
      // Actually let me track this differently
    }))];
  });
}
```

This is getting complex. Let me simplify the drift repair to focus on the key requirement: "compare projection against source for a recent window and repair what disagrees."

OK I think I've planned enough. Let me write the actual code now, keeping it clean and focused.

One important design decision for the scheduled drift repair: I'll use a simple interval-based approach in the module's `onModuleInit`, or better yet, `@nestjs/schedule`.

Let me now write everything. I need to be practical about the length but comprehensive in coverage.

For the test, I realize I should structure it carefully:

```typescript
describe('Operations', () => {
  let app;
  let operationsService;
  let prisma;
  
  beforeAll(async () => {
    const moduleFixture = await Test.createTestModule({
      imports: [OperationsModule],
    }).compile();
    
    app = moduleFixture.createNestApplication();
    await app.init();
    
    operationsService = moduleFixture.get(OperationsService);
    prisma = moduleFixture.get(PrismaService);
    
    // Set up test data
    // Create test companies, workers
  });
  
  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });
  
  beforeEach(async () => {
    // Clean up database
    await prisma.$executeRaw`TRUNCATE operations_projection, company_total, orders, events, workers, companies CASCADE`;
  });
  
  describe('read-your-own-writes', () => { ... });
  describe('concurrent updates', () => { ... });
  describe('drift repair', () => { ... });
});
```

Let me now write all the files. I'll be thorough.

Actually, one more consideration: the test database. I'll use `DATABASE_URL` from environment, with a default test database URL.

Now let me write the complete code. I'll organize it cleanly.

Let me start with the files now. I'll go file by file.

For the migration SQL, I need to create proper SQL. Let me write it.

Let me also think about a few edge cases:
- What if the `OperationsProjection.upsert` uses `orderId` as the unique key? Then `@@unique([companyId, orderId])` is the constraint, but for upsert in the hook, I'd want to use `orderId` alone. Let me add `@@unique([orderId])` or just use the `id` field for upsert.

Actually, let me simplify: `OperationsProjection` has its own `id` and a `unique([companyId, orderId])` constraint. For upsert in hooks, I'll use `orderId` as the key. Let me add `@@unique([orderId])` to make it simple.

Or better: just use `@@unique([orderId])` since each order maps to exactly one projection row. The `companyId` is in the projection for filtering.

Let me use `@@unique([orderId])` and `@@index([companyId, status, createdAt])`.

This makes the hooks simpler: `upsert({ where: { orderId }, ... })`.

Now let me write it all. Here goes:

I realize I should also think about what the `Event` model's relation to Order looks like. An order has many events. In the projection, I store `eventCount`. When a new event is added, the projection's event count should also be updated. But the task doesn't mention events being a primary concern for the dashboard, so I'll handle them in the projection maintenance but won't add a specific hook for events (the task focuses on order status changes).

Actually, let me keep it focused on the requirements. The task is about:
1. Projection for the dashboard query
2. Sync hooks for order writes (create, approve)
3. Concurrent-safe totals
4. Re-derivation
5. Drift repair

Events are mentioned in the schema as part of the original join, but the projection just stores `eventCount` for completeness. I won't add a separate hook for events unless it's needed for the tests.

Let me write the code now. Final attempt, no more planning.

I want to make sure the schema handles `createdAt` properly in the projection. When a projection row is created, its `createdAt` should match the order's `createdAt` (not the projection's own creation time). This way, sorting by `createdAt` in the dashboard query gives the same order as sorting by order creation time.

OK here goes. Let me also decide on endpoint naming:
- `GET /operations` - dashboard query
- `POST /orders` - create order
- `POST /orders/:id/approve` - approve order
- `GET /companies/:id/total` - company total
- `POST /admin/rederive-window` - re-derive
- `POST /admin/repair-drift` - drift repair

Now I'll write all the code, one file at a time.

For the `PrismaService`, I'll extend `PrismaClient` and handle lifecycle.

For the `OperationsModule`, I need to register all providers.

Let me also check: should I use `PrismaModule` pattern? In the NestJS Prisma integration, the typical pattern is:

```typescript
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

I'll include this as part of the `OperationsModule` since the project is small. Or I could have it separate. Let me include it in `OperationsModule` to keep it simple.

Let me now finalize and write all code.

Oh wait, one more thing about the test: I need to make sure the test database schema is set up. I'll run `prisma db push` equivalent in the test setup. In practice, the test will use the Prisma client directly and assume the schema is pushed.

Actually, for Vitest tests with Prisma, a common pattern is:
1. Before all tests: `npx prisma migrate deploy` or `npx prisma db push`
2. Run tests
3. After all tests: disconnect

Since I can't actually run commands, I'll include the setup in the test file's `beforeAll` using raw SQL to create tables, or I'll assume the schema is already migrated.

Actually, let me include a `beforeAll` that does `prisma.$executeRaw` to set up the schema if needed. Or I'll just document that the test expects the schema to be pushed.

For simplicity, I'll have the test use `prisma.$executeRaw` to create the necessary tables if they don't exist. Or even simpler: use Prisma's `extend` to add an `$on` hook.

Hmm, let me just include the assumption that the database is set up, and use a `beforeAll` that tries to connect and set up test data.

Let me finalize now. Here's the full code:

Let me be very careful with the TypeScript types and ensure everything compiles.

Here's what I'll write for the repository:

```typescript
// operations.repository.ts
@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}
  
  // Source table operations
  async createOrder(data: CreateOrderInput): Promise<Order> {
    return this.prisma.order.create({
      data: {
        companyId: data.companyId,
        workerId: data.workerId,
        status: data.status || 'pending',
        amount: data.amount,
        events: {
          create: data.events || [],
        },
      },
    });
  }
  
  async approveOrder(orderId: string): Promise<Order> {
    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'approved' },
    });
  }
  
  // Dashboard query (reads ONLY from projection)
  async getDashboard(params: DashboardQuery): Promise<OperationsProjection[]> {
    return this.prisma.operationsProjection.findMany({
      where: {
        companyId: params.companyId,
        ...(params.status && { status: params.status }),
        ...(params.from && { createdAt: { gte: new Date(params.from) } }),
        ...(params.to && { createdAt: { lte: new Date(params.to) } }),
      },
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    });
  }
  
  // Company total
  async getCompanyTotal(companyId: string): Promise<CompanyTotal | null> {
    return this.prisma.companyTotal.findUnique({
      where: { companyId },
    });
  }
  
  // Re-derivation helpers
  async getOrdersForWindow(start: Date, end: Date): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { createdAt: { gte: start, lte: end } },
      include: { events: true, worker: true },
    });
  }
  
  async getProjectionsForOrders(orderIds: string[]): Promise<OperationsProjection[]> {
    return this.prisma.operationsProjection.findMany({
      where: { orderId: { in: orderIds } },
    });
  }
  
  async getOrdersForCompany(companyId: string): Promise<Order[]> {
    return this.prisma.order.findMany({
      where: { companyId },
      select: { status: true, amount: true },
    });
  }
  
  // Transaction helpers
  async withTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
  
  // Drift repair helpers
  async deleteProjectionsForOrders(orderIds: string[], tx: Prisma.TransactionClient): Promise<void> {
    await tx.operationsProjection.deleteMany({
      where: { orderId: { in: orderIds } },
    });
  }
  
  async createProjection(projection: any, tx: Prisma.TransactionClient): Promise<OperationsProjection> {
    return tx.operationsProjection.create({ data: projection });
  }
}
```

Hmm wait, the convention says "the service holds the logic. Zero raw SQL, zero Prisma client calls." and "repository is the only layer that touches the database." So the service should not call `prisma` directly, and should go through the repository.

Let me restructure. The service will call repository methods for data access. The projection maintenance service will also call repository methods (or have its own methods that call Prisma through the repository).

Actually, the projection maintenance service needs to perform projection updates inside transactions. This is a bit tricky because the repository pattern would normally have each method call Prisma independently. But for transaction support, the repository needs to accept an optional transaction client parameter.

Let me have the repository accept a transaction client in its methods, and the services pass it when in a transaction.

This is clean and follows the conventions. Let me adjust.

OK, now let me also think about what data transfer objects (DTOs) I need. The controller validates input, so I should have DTOs for:
- `CreateOrderDto`
- `ApproveOrderDto` (just the order ID, actually)
- `DashboardQueryDto`

But the conventions say "controller validates input and calls the service." So I'll use validation pipes or just check in the controller. Let me use simple parameter objects.

Actually, NestJS has `class-validator` and `class-transformer`. But to keep it simple, I'll use plain TypeScript interfaces for DTOs and document the validation in the controller.

Let me finalize now. I'll write all the code.

One more thought: for the scheduled drift-repair job, I'll use `@nestjs/schedule`. The `ScheduleModule` needs to be imported.

Let me check if `@nestjs/schedule` is a standard NestJS package. Yes, it is. It provides cron-based scheduling.

For the drift repair schedule, I'll run it every hour or every 15 minutes. Let me say every 15 minutes.

Now let me write the complete solution. I'll be comprehensive but focused.

Here's my final file list and order of writing:

1. `prisma/schema.prisma`
2. `src/main.ts`
3. `src/app.module.ts`
4. `src/operations/operations.module.ts`
5. `src/operations/operations.controller.ts`
6. `src/operations/operations.service.ts`
7. `src/operations/operations.repository.ts`
8. `src/operations/projection-maintenance.service.ts`
9. `test/operations.spec.ts`
10. `DESIGN.md`

Let me now write them all.

I need to also handle the PrismaService. Where to put it? I'll put it in `src/prisma/prisma.service.ts` and import it in the OperationsModule.

Let me add that to the list:

1. `prisma/schema.prisma`
2. `src/main.ts`
3. `src/app.module.ts`
4. `src/prisma/prisma.service.ts`
5. `src/operations/operations.module.ts`
6. `src/operations/operations.controller.ts`
7. `src/operations/operations.service.ts`
8. `src/operations/operations.repository.ts`
9. `src/operations/projection-maintenance.service.ts`
10. `test/operations.spec.ts`
11. `DESIGN.md`

Now let me actually write them. I'll keep the code clean and production-quality.

I'm going to start writing now, for real this time.

Wait, one more thing. For the `OperationsProjection` model, I realize that `workerName` is a denormalized field. This is correct for a projection - we store what we need for the query, not foreign key relationships.

Also, the `@@index([companyId, status, createdAt])` on `OperationsProjection` should be a composite index that covers the common query pattern. But actually, for the dashboard query which filters by companyId, optionally by status, and sorts by createdAt desc, the ideal index is:

For the specific query: `WHERE companyId = X AND status = Y AND createdAt BETWEEN A AND B ORDER BY createdAt DESC LIMIT N`

The index `[companyId, status, createdAt DESC]` would be perfect. Prisma's `@@index` with columns `["companyId", "status", { createdAt: "desc" }]` - actually Prisma doesn't support that syntax directly in `@@index`. Let me use `@@index([companyId, status, createdAt])` and let PostgreSQL handle the DESC via index scan backward.

Or use `@@index([companyId, status, { createdAt: "desc" }])` - hmm, Prisma 5.x supports index types. Let me use:

```prisma
@@index([companyId, status, createdAt], map: "idx_ops_projection_company_status_created")
```

And in the migration SQL, specify the descending order.

Actually, let me keep it simple and use `@@index([companyId, status, createdAt])`. PostgreSQL will use this efficiently for both ASC and DESC scans.

Now, let me also create a migration SQL file. I'll include both the initial migration and the projection migration.

Let me now write everything. No more planning.

Actually let me think about one more thing - how to handle `PrismaService` in tests. In Vitest, the NestJS app needs to be bootstrapped. For integration tests with a real database, I'll:

1. Set `DATABASE_URL` to a test database URL (or use a default)
2. Bootstrap the NestJS app
3. Push the schema to the test database
4. Run tests
5. Clean up

For step 3, I'll call `prisma.$executeRaw` to create tables if needed, or better yet, use `execa` or similar to run `npx prisma db push`. But since I can't run commands, I'll document that the test database should have the schema pushed, and use `beforeAll` to ensure the connection works.

Alternatively, I can create tables using raw SQL in `beforeAll`:

```typescript
await prisma.$executeRawUnsafe(`
  CREATE TABLE IF NOT EXISTS companies (...);
  CREATE TABLE IF NOT EXISTS workers (...);
  -- etc.
`);
```

But this is error-prone. Let me just assume the schema is pushed (via `prisma db push`) and focus the test on the behavior.

Actually, for the test, let me use `prisma.$executeRaw` to set up the necessary schema. Since PostgreSQL supports `CREATE TABLE IF NOT EXISTS`, this should work.

Hmm, but this would duplicate the Prisma schema in SQL. That's maintenance burden. Let me just use the Prisma migration approach: run `prisma migrate deploy` or `prisma db push` in a `beforeAll`.

I'll document this in the test file and use a practical approach:

```typescript
beforeAll(async () => {
  // Assumes schema has been pushed to the test database
  // Run: npx prisma db push --schema=prisma/schema.prisma
  const moduleFixture = await Test.createTestModule({
    imports: [OperationsModule],
  }).compile();
  // ...
});
```

This is a reasonable approach. The test expects the database schema to be set up externally.

OK, NOW let me write all the code. For real. No more deliberation.

Let me also consider: should I create helper files? Like DTOs? Let me keep DTOs inline in the controller or as simple interfaces. The task says don't create files that aren't called for.

I'll define DTOs as TypeScript interfaces in the controller file or a separate file. Since they're small, I'll put them in the controller file.

Final file list:
1. `prisma/schema.prisma`
2. `src/main.ts`
3. `src/app.module.ts`
4. `src/prisma/prisma.service.ts`
5. `src/operations/operations.module.ts`
6. `src/operations/operations.controller.ts`
7. `src/operations/operations.service.ts`
8. `src/operations/operations.repository.ts`
9. `src/operations/projection-maintenance.service.ts`
10. `test/operations.spec.ts`
11. `DESIGN.md`

Writing now.

OK, I want to also reconsider: should I include a `PrismaModule`? In a real NestJS app, the PrismaService would be in its own module. But since this is a focused solution, I'll just provide the PrismaService and register it directly in the OperationsModule.

Let me write the code now. I'll structure it carefully.

Let me start with the schema, as everything builds on it.

For the schema, I want to make sure:
- All table names are `snake_case` (via `@@map`)
- All column names are `snake_case`
- The projection table has the right indexes
- All relations are properly defined

Here's the schema:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Company {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
  orders    Order[]
  total     CompanyTotal?

  @@map("companies")
}

model Worker {
  id        String   @id @default(uuid())
  name      String
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  createdAt DateTime @default(now())
  orders    Order[]

  @@map("workers")
}

model Order {
  id        String   @id @default(uuid())
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  workerId  String
  worker    Worker   @relation(fields: [workerId], references: [id])
  status    String
  amount    Float
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  events    Event[]

  @@map("orders")
}

model Event {
  id        String   @id @default(uuid())
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id])
  type      String
  createdAt DateTime @default(now())

  @@map("events")
}

model OperationsProjection {
  id              String  @id @default(uuid())
  companyId       String
  orderId         String
  workerId        String
  workerName      String
  status          String
  amount          Float
  createdAt       DateTime
  eventCount      Int     @default(0)

  @@map("operations_projection")
  @@index([companyId, status, createdAt], map: "idx_ops_projection_co_st_cr")
  @@unique([orderId])
}

model CompanyTotal {
  id             String  @id @default(uuid())
  companyId      String  @unique
  company        Company @relation(fields: [companyId], references: [id])
  totalAmount    Float   @default(0)
  pendingAmount  Float   @default(0)
  approvedAmount Float   @default(0)
  pendingCount   Int     @default(0)
  approvedCount  Int     @default(0)

  @@map("company_total")
}
```

Now for the controller. Endpoints:

```typescript
@Controller('operations')
export class OperationsController {
  @Get()
  async getDashboard(@Query() query: DashboardQueryDto): Promise<OperationsProjection[]> { ... }
  
  @Post('orders')
  async createOrder(@Body() dto: CreateOrderDto): Promise<{ id: string }> { ... }
  
  @Post('orders/:id/approve')
  async approveOrder(@Param('id') id: string): Promise<Order> { ... }
  
  @Get('companies/:companyId/total')
  async getCompanyTotal(@Param('companyId') companyId: string): Promise<CompanyTotal> { ... }
  
  @Post('admin/rederive-window')
  async rederiveWindow(@Body() body: { from: string; to: string }): Promise<void> { ... }
  
  @Post('admin/repair-drift')
  async repairDrift(@Body() body: { hours?: number }): Promise<void> { ... }
}
```

For the service, the key transaction method is `createOrder`:

```typescript
async createOrder(data: CreateOrderDto) {
  return this.prisma.$transaction(async (tx) => {
    const order = await this.repository.createOrderInTx(data, tx);
    await this.projectionMaintenance.onOrderCreated(order, tx);
    return order;
  });
}

async approveOrder(orderId: string) {
  return this.prisma.$transaction(async (tx) => {
    const order = await this.repository.approveOrderInTx(orderId, tx);
    await this.projectionMaintenance.onOrderApproved(order, tx);
    return order;
  });
}

async getDashboard(query: DashboardQueryDto) {
  return this.repository.getDashboard(query);
}
```

OK, let me now write the actual file contents. I'll be precise and complete.

For the test, I realize that I need a way to create test data (companies, workers) before testing orders. Let me include methods in the repository for creating companies and workers.

Actually, companies and workers are not the focus of this task. They're part of the domain but the tests focus on orders and projections. Let me include basic company/worker creation in the repository for test setup.

Let me also think about what the test database setup looks like. I'll use a separate schema or truncate tables between tests. Let me use `beforeEach` to clean up.

For the concurrent test:
```typescript
it('two concurrent approvals for same company → exact totals', async () => {
  // Setup: create company, worker, two pending orders
  const company = await prisma.company.create({ data: { name: 'Test Co' } });
  const worker = await prisma.worker.create({ data: { name: 'W1', companyId: company.id } });
  
  const order1 = await prisma.order.create({ data: { companyId: company.id, workerId: worker.id, status: 'pending', amount: 100 } });
  const order2 = await prisma.order.create({ data: { companyId: company.id, workerId: worker.id, status: 'pending', amount: 200 } });
  
  // Create projection rows and initial totals
  // ...
  
  // Concurrently approve both orders through the service
  await Promise.all([
    operationsService.approveOrder(order1.id),
    operationsService.approveOrder(order2.id),
  ]);
  
  // Check totals: should be exactly 300 approved, nothing pending
  const total = await prisma.companyTotal.findUnique({ where: { companyId: company.id } });
  expect(total.approvedAmount).toBe(300);
  expect(total.pendingAmount).toBe(0);
  expect(total.approvedCount).toBe(2);
  expect(total.pendingCount).toBe(0);
});
```

Wait, but there's an issue. When I create orders directly via Prisma (not through the service), the projection rows and totals are NOT created. I need to also create them, or I need to create orders through the service.

Let me create orders through the service in the test setup, so that projection and totals are also created.

```typescript
const order1 = await operationsService.createOrder({ companyId: company.id, workerId: worker.id, amount: 100 });
const order2 = await operationsService.createOrder({ companyId: company.id, workerId: worker.id, amount: 200 });
```

This way, the full transaction path is exercised, and projection + totals are set up.

For the concurrent test, I then approve both orders concurrently through the service, which exercises the concurrent-safe totals update.

This is a much better test because it exercises the full write path including the hooks.

Let me refine the concurrent test:
1. Create company and worker
2. Create two orders via service (this creates projection rows + totals)
3. Concurrently approve both via service (this updates projection rows + totals atomically)
4. Verify totals are exact

And the read-your-own-writes test:
1. Create company and worker
2. Create order via service
3. Query dashboard → should see the order
4. Approve order via service
5. Query dashboard → should see approved order

And the drift repair test:
1. Create company and worker, create order via service (sets up correct projection)
2. Directly modify the projection to create drift (e.g., change status in projection to 'rejected')
3. Run drift repair
4. Query projection → should match source again

Let me write it all now. Final final attempt.

Let me think about the `@nestjs/schedule` usage for the scheduled drift repair. I'll add a cron job in the projection maintenance service:

```typescript
import { Cron, CronService } from '@nestjs/schedule';

@Injectable()
export class ProjectionMaintenanceService {
  // ...
  
  @Cron('0 */15 * * * *') // Every 15 minutes
  async scheduledDriftRepair() {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const now = new Date();
    await this.repairDrift(twoHoursAgo, now);
  }
}
```

And import `ScheduleModule.forRoot()` in the module.

But wait, I want to also provide a method that can be called directly (for testing). The cron method will call the same logic.

```typescript
async runDriftRepair(windowHours: number = 24): Promise<void> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const now = new Date();
  await this.repairDrift(cutoff, now);
}

@Cron('0 */15 * * * *')
async scheduledDriftRepair() {
  await this.runDriftRepair(24);
}
```

Good.

Now let me finalize the code. I'm going to write it all now, methodically.

Let me also decide: should the `operations.controller.ts` have validation? The conventions say "controller validates input." I'll add basic validation (checking required fields) in the controller, not using class-validator pipes (to keep it simple).

Actually, let me use `class-validator` since it's standard with NestJS. No wait, that adds complexity. Let me just do manual validation in the controller. Simple checks like "if (!companyId) throw BadRequestException".

OK, now writing. For real. Here we go.

Let me structure the operations controller:

```typescript
@Api(tags: ['operations'])
@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}
  
  @Get()
  async getDashboard(@Query() query: DashboardQuery): Promise<OperationsProjection[]> {
    return this.operationsService.getDashboard(query);
  }
  
  @Post('orders')
  async createOrder(@Body() dto: CreateOrderDto): Promise<Order> {
    if (!dto.companyId || !dto.workerId || dto.amount == null) {
      throw new BadRequestException('companyId, workerId, and amount are required');
    }
    return this.operationsService.createOrder(dto);
  }
  
  @Post('orders/:id/approve')
  async approveOrder(@Param('id') id: string): Promise<Order> {
    return this.operationsService.approveOrder(id);
  }
  
  @Get('companies/:companyId/total')
  async getCompanyTotal(@Param('companyId') companyId: string): Promise<CompanyTotal | null> {
    return this.operationsService.getCompanyTotal(companyId);
  }
  
  @Post('admin/rederive-window')
  async rederiveWindow(@Body() body: { from: string; to: string }): Promise<void> {
    return this.operationsService.rederiveWindow(new Date(body.from), new Date(body.to));
  }
  
  @Post('admin/repair-drift')
  async repairDrift(@Body() body: { hours?: number }): Promise<void> {
    return this.operationsService.runDriftRepair(body.hours ?? 24);
  }
}
```

This looks good. Let me now write the full code for every file.

I'm going to write it now. Really this time. Let me go file by file, starting from the schema.

Let me also double-check the dashboard query against the index. The query is:

```sql
SELECT * FROM operations_projection
WHERE companyId = ? AND status = ? AND createdAt BETWEEN ? AND ?
ORDER BY createdAt DESC
LIMIT ? OFFSET ?
```

The index `[companyId, status, createdAt]` handles:
1. Filter by companyId ✓ (first column)
2. Filter by status ✓ (second column)
3. Filter by createdAt range ✓ (third column)
4. Sort by createdAt DESC ✓ (can scan index backward)

This is a covering index for this query. 

Now, what about a query without status filter? Like `WHERE companyId = ? AND createdAt BETWEEN ? AND ? ORDER BY createdAt DESC`? The index `[companyId, status, createdAt]` still helps: it filters by companyId (first column) and then createdAt (third column, with status as a gap). It won't be as efficient as `[companyId, createdAt]` but it's still usable. For this task, the primary access pattern includes status, so `[companyId, status, createdAt]` is appropriate.

OK, final code time.

Let me also think about: for the re-derivation routine, when it runs in a transaction and deletes all projection rows in the window, what happens to concurrent dashboard reads? They'll either see the old data (before the transaction commits) or nothing/new data (after commit). This is fine - ACID guarantees.

And for the re-derivation being idempotent: running it twice produces the same result because it always rebuilds from the current source data. ✓

Let me now write the complete code. I'll structure it carefully.

One final consideration: the `PrismaService` in tests. Since Vitest runs in a Node process, I need to configure the Prisma client to connect to the right database. The `DATABASE_URL` environment variable should be set. I'll use a test database URL as a default.

Also, in the test, I'll use `Test.createTestModule` which bootstraps the NestJS module but doesn't create the application (or does, depending on what I need). For the tests, I need the services and Prisma client.

Let me now write the code. No more planning. I promise.

Let me also handle a subtlety: when the `OperationsProjection` is created during the order creation hook, it needs the `workerName`. The order has a `workerId`, and the worker has a `name`. I need to look up the worker's name. This can be done with a `join` in the hook.

Wait, but the hook runs inside the transaction. Let me look up the worker name as part of the hook:

```typescript
async onOrderCreated(order: Order, tx: TransactionClient) {
  const worker = await tx.worker.findUnique({ where: { id: order.workerId } });
  // ... create projection with workerName: worker?.name || 'Unknown'
}
```

This is fine since it's inside the transaction.

OK, now writing the actual code.

Let me think about one more thing: the `TransactionClient` type. In Prisma, when you use `$transaction`, the transaction client has the same methods as the PrismaClient but with transaction semantics. The type is inferred from the callback.

In the hook methods, I'll use `PrismaClient<PrismaClientOptions>` as the transaction type, which is what Prisma's `$transaction` provides. Let me use a type alias:

```typescript
type PrismaTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'>;
```

This is the standard way to type the transaction client.

Now, writing the code:

For `projection-maintenance.service.ts`:

```typescript
@Injectable()
export class ProjectionMaintenanceService {
  constructor(private readonly repository: OperationsRepository) {}
  
  async onOrderCreated(order: Order, tx: PrismaTx): Promise<void> {
    const worker = await tx.worker.findUnique({ where: { id: order.workerId } });
    
    const eventCount = await tx.event.count({ where: { orderId: order.id } });
    
    await tx.operationsProjection.create({
      data: {
        companyId: order.companyId,
        orderId: order.id,
        workerId: order.workerId,
        workerName: worker?.name || 'Unknown',
        status: order.status,
        amount: order.amount,
        createdAt: order.createdAt,
        eventCount,
      },
    });
    
    // Atomic totals update
    await tx.companyTotal.upsert({
      where: { companyId: order.companyId },
      create: {
        companyId: order.companyId,
        totalAmount: order.amount,
        pendingAmount: order.amount,
        pendingCount: 1,
      },
      update: {
        totalAmount: { increment: order.amount },
        pendingAmount: { increment: order.amount },
        pendingCount: { increment: 1 },
      },
    });
  }
  
  async onOrderApproved(order: Order, tx: PrismaTx): Promise<void> {
    await tx.operationsProjection.update({
      where: { orderId: order.id },
      data: { status: order.status },
    });
    
    await tx.companyTotal.upsert({
      where: { companyId: order.companyId },
      create: {
        companyId: order.companyId,
        totalAmount: order.amount,
        approvedAmount: order.amount,
        approvedCount: 1,
      },
      update: {
        approvedAmount: { increment: order.amount },
        approvedCount: { increment: 1 },
        pendingAmount: { decrement: order.amount },
        pendingCount: { decrement: 1 },
      },
    });
  }
  
  async rederiveWindow(startDate: Date, endDate: Date): Promise<void> {
    const orders = await this.repository.getOrdersForWindow(startDate, endDate);
    const companyIds = [...new Set(orders.map(o => o.companyId))];
    
    await this.repository.$transaction(async (tx) => {
      for (const companyId of companyIds) {
        const companyOrders = orders.filter(o => o.companyId === companyId);
        const orderIds = companyOrders.map(o => o.id);
        
        // Delete existing projections for these orders
        await tx.operationsProjection.deleteMany({
          where: { orderId: { in: orderIds } },
        });
        
        // Recreate projections
        for (const order of companyOrders) {
          const worker = await tx.worker.findUnique({ where: { id: order.workerId } });
          const eventCount = await tx.event.count({ where: { orderId: order.id } });
          
          await tx.operationsProjection.create({
            data: {
              companyId: order.companyId,
              orderId: order.id,
              workerId: order.workerId,
              workerName: worker?.name || 'Unknown',
              status: order.status,
              amount: order.amount,
              createdAt: order.createdAt,
              eventCount,
            },
          });
        }
        
        // Recalculate company totals
        await this.recalculateCompanyTotal(tx, companyId);
      }
    });
  }
  
  private async recalculateCompanyTotal(tx: PrismaTx, companyId: string): Promise<void> {
    const orders = await tx.order.findMany({
      where: { companyId },
      select: { status: true, amount: true },
    });
    
    let totalAmount = 0;
    let pendingAmount = 0;
    let approvedAmount = 0;
    let pendingCount = 0;
    let approvedCount = 0;
    
    for (const order of orders) {
      totalAmount += order.amount;
      if (order.status === 'pending') {
        pendingAmount += order.amount;
        pendingCount++;
      } else if (order.status === 'approved') {
        approvedAmount += order.amount;
        approvedCount++;
      }
    }
    
    await tx.companyTotal.upsert({
      where: { companyId },
      create: {
        companyId,
        totalAmount,
        pendingAmount,
        approvedAmount,
        pendingCount,
        approvedCount,
      },
      update: {
        totalAmount,
        pendingAmount,
        approvedAmount,
        pendingCount,
        approvedCount,
      },
    });
  }
  
  async detectDrift(startDate: Date, endDate: Date): Promise<DriftEntry[]> {
    const orders = await this.repository.getOrdersForWindow(startDate, endDate);
    const orderIds = orders.map(o => o.id);
    const projections = await this.repository.getProjectionsForOrders(orderIds);
    
    const projectionMap = new Map(projections.map(p => [p.orderId, p]));
    const drifts: DriftEntry[] = [];
    
    for (const order of orders) {
      const projection = projectionMap.get(order.id);
      if (!projection) {
        drifts.push({ type: 'missing', orderId: order.id });
        continue;
      }
      if (
        projection.status !== order.status ||
        projection.amount !== order.amount ||
        projection.workerName !== (order.worker?.name || 'Unknown')
      ) {
        drifts.push({
          type: 'mismatch',
          orderId: order.id,
          source: { status: order.status, amount: order.amount },
          projected: { status: projection.status, amount: projection.amount },
        });
      }
    }
    
    return drifts;
  }
  
  async repairDrift(startDate: Date, endDate: Date): Promise<number> {
    const drifts = await this.detectDrift(startDate, endDate);
    
    if (drifts.length === 0) return 0;
    
    await this.repository.$transaction(async (tx) => {
      for (const drift of drifts) {
        const order = await tx.order.findUnique({
          where: { id: drift.orderId },
          include: { events: true, worker: true },
        });
        
        if (!order) continue;
        
        const worker = await tx.worker.findUnique({ where: { id: order.workerId } });
        
        await tx.operationsProjection.upsert({
          where: { orderId: order.id },
          update: {
            status: order.status,
            amount: order.amount,
            workerName: worker?.name || 'Unknown',
            eventCount: order.events?.length || 0,
          },
          create: {
            companyId: order.companyId,
            orderId: order.id,
            workerId: order.workerId,
            workerName: worker?.name || 'Unknown',
            status: order.status,
            amount: order.amount,
            createdAt: order.createdAt,
            eventCount: order.events?.length || 0,
          },
        });
      }
      
      // Recalculate totals for affected companies
      const affectedCompanyIds = [...new Set(drifts.map(async (d) => {
        const order = await tx.order.findUnique({ where: { id: d.orderId } });
        return order?.companyId;
      }))];
      
      // Wait, that won't work because I can't await in a spread with async
      // Let me fix this
    });
  }
}
```

The affected company IDs collection needs fixing. Let me rewrite:

```typescript
async repairDrift(startDate: Date, endDate: Date): Promise<number> {
  const drifts = await this.detectDrift(startDate, endDate);
  
  if (drifts.length === 0) return 0;
  
  await this.repository.$transaction(async (tx) => {
    const affectedCompanyIds = new Set<string>();
    
    for (const drift of drifts) {
      const order = await tx.order.findUnique({
        where: { id: drift.orderId },
        include: { events: true, worker: true },
      });
      
      if (!order) continue;
      affectedCompanyIds.add(order.companyId);
      
      const worker = await tx.worker.findUnique({ where: { id: order.workerId } });
      
      await tx.operationsProjection.upsert({
        where: { orderId: order.id },
        update: {
          status: order.status,
          amount: order.amount,
          workerName: worker?.name || 'Unknown',
          eventCount: order.events?.length || 0,
        },
        create: {
          companyId: order.companyId,
          orderId: order.id,
          workerId: order.workerId,
          workerName: worker?.name || 'Unknown',
          status: order.status,
          amount: order.amount,
          createdAt: order.createdAt,
          eventCount: order.events?.length || 0,
        },
      });
    }
    
    for (const companyId of affectedCompanyIds) {
      await this.recalculateCompanyTotal(tx, companyId);
    }
  });
  
  return drifts.length;
}
```

This is cleaner.

Now let me write all the files in their final form. I'll compile everything I've designed into clean, complete files.

Actually, wait. Let me think about whether the repository should expose `$transaction`. Currently I have `this.repository.$transaction(...)` in the code. But `$transaction` is a method of PrismaClient, not the repository. Let me make the repository expose it:

```typescript
async withTransaction<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
  return this.prisma.$transaction(fn);
}
```

And in the service:
```typescript
await this.repository.withTransaction(async (tx) => { ... });
```

But actually, in the `operations.service.ts`, the `createOrder` and `approveOrder` methods use `this.prisma.$transaction` directly (or through a helper). Let me keep it simple and have the service use `this.prisma.$transaction` for the high-level transactions, and the repository methods accept an optional transaction parameter.

Let me restructure:

In `operations.service.ts`:
```typescript
async createOrder(dto: CreateOrderDto) {
  return this.prisma.$transaction(async (tx) => {
    const order = await this.repository.createOrder(dto, tx);
    await this.projectionMaintenance.onOrderCreated(order, tx);
    return order;
  });
}
```

In `repository.ts`:
```typescript
async createOrder(dto: CreateOrderDto, tx?: PrismaTx): Promise<Order> {
  const client = tx || this.prisma;
  return client.order.create({
    data: {
      companyId: dto.companyId,
      workerId: dto.workerId,
      status: 'pending',
      amount: dto.amount,
    },
  });
}
```

This is cleaner. Each repository method works with either a transaction client or the main Prisma client.

For the `getOrdersForWindow` method used in re-derivation:
```typescript
async getOrdersForWindow(start: Date, end: Date): Promise<Order[]> {
  return this.prisma.order.findMany({
    where: { createdAt: { gte: start, lte: end } },
    include: { events: true, worker: true },
  });
}
```

This uses the main client (read-only, outside transaction). But in re-derivation, we use it to read before entering the transaction. That's fine.

OK, let me now finalize all files and write them. I'll compile everything I've designed.

Actually, one important detail: in the `operations.service.ts`, the `rederiveWindow` method needs to call `getOrdersForWindow` (read) and then do a transaction (write). Let me implement it as:

```typescript
async rederiveWindow(from: Date, to: Date) {
  await this.projectionMaintenance.rederiveWindow(from, to);
}
```

Delegating to the projection maintenance service which handles both reading and writing.

And in the controller:
```typescript
@Post('admin/rederive-window')
async rederiveWindow(@Body() body: { from: string; to: string }): Promise<void> {
  return this.operationsService.rederiveWindow(new Date(body.from), new Date(body.to));
}
```

Now let me write the final code. I promise I'll start now.

I realize I should also be careful about the `@nestjs/schedule` import. The `ScheduleModule.forRoot()` import is needed for the `@Cron` decorator to work. I'll include it in the `OperationsModule`.

But wait, `@nestjs/schedule` might not be installed by default. The package.json would need it. Since I can't modify package.json (it's not mentioned in the files), let me check: the task says "TypeScript + NestJS + Prisma + PostgreSQL" and doesn't explicitly mention `@nestjs/schedule`. 

Let me use a simple timer-based approach instead. I'll create a method in the projection maintenance service that runs on a `setInterval`. Or I'll just expose the method and let it be called externally (e.g., by a cron job that calls the API endpoint).

Actually, the cleanest approach that doesn't require additional dependencies: use the `@nestjs/schedule` package but include it in the imports. If it's not available, use a timer. Since the task is about the design and code, I'll use `@nestjs/schedule` and add it to the module.

Alternatively, I can just implement a method and document that it should be called by a scheduler. But the task says "a scheduled drift-repair job" so I should implement the scheduling.

Let me use `@nestjs/schedule`. It's a standard NestJS package and reasonable to include.

Wait, let me re-read the convention: "Decide the file layout yourself." and "Do exactly what the task asks. Do not create a file it does not call for."

The task says "a scheduled drift-repair job." So I need to implement scheduling. `@nestjs/schedule` is the standard way.

I'll include it. If it's not in the package.json, I'll note it as an assumption.

OK, let me also add a `PrismaModule` for clean separation:

No, let me keep it simple. Just register `PrismaService` directly in `OperationsModule`.

Now, the `OperationsModule`:

```typescript
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    PrismaService,
    OperationsController,
    OperationsService,
    OperationsRepository,
    ProjectionMaintenanceService,
  ],
})
export class OperationsModule {}
```

And `AppModule`:

```typescript
@Module({
  imports: [OperationsModule],
})
export class AppModule {}
```

This should work. Let me now write everything.

I also need to make sure the `@nestjs/common` and `@nestjs/core` imports are correct.

Let me write the code now. Complete files, one by one.

Hmm, I realize I should also think about `CronJob` vs `@Cron`. The `@nestjs/schedule` package provides both. `@Cron` is a decorator, and `CronJob` is a class. I'll use `@Cron`.

Actually, for the scheduled job, let me make it a method in the `ProjectionMaintenanceService`:

```typescript
@Cron('0 */15 * * * *') // Every 15 minutes
async runScheduledDriftRepair() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await this.repairDrift(cutoff, new Date());
}
```

This requires `ScheduleModule.forRoot()` in the imports.

Now I need to also provide a non-scheduled version for testing:

```typescript
async runDriftRepair(hours: number = 24): Promise<number> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.repairDrift(cutoff, new Date());
}
```

Good.

Now let me write all the code. I'm going to type it out now, carefully and completely.

Let me also reconsider the DTOs/interfaces:

```typescript
interface CreateOrderDto {
  companyId: string;
  workerId: string;
  amount: number;
}

interface DashboardQuery {
  companyId: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}
```

These are simple TypeScript interfaces. I'll put them in the controller file or the service file.

OK, I'm now going to write all the code. Final output.

Let me also consider: the `PrismaService` needs to be configured with the `DATABASE_URL`. The `@prisma/client` reads this from the environment automatically if it was generated with it. Let me just extend `PrismaClient` normally.

```typescript
@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    super();
  }
  
  async onModuleInit() {
    await this.$connect();
  }
  
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

The `PrismaClient` will use `DATABASE_URL` from the environment (set when generating the client or at runtime).

Now, let me write all the code. I'll be comprehensive and ensure correctness.

Wait, one more thing about the test. For the concurrent approvals test, I need to make sure that the two concurrent approvals don't deadlock or fail. In PostgreSQL with Prisma's `$transaction`, concurrent updates to the same `CompanyTotal` row will be handled by row-level locking. One transaction will wait for the other to complete. The increment operations are atomic, so no updates are lost.

The test verifies that by checking the final totals: if two approvals of $100 and $200 run concurrently, the approved total should be exactly $300, not $100 or $200 (which would indicate a lost update in a read-modify-write approach).

OK, now writing. Let me also make sure I handle the `eventCount` correctly. When an order is created with events, the projection stores the event count. When a new event is added later, the `eventCount` in the projection is stale. But the task doesn't require handling event additions. The `eventCount` is a static snapshot at the time of projection creation.

However, for drift repair, if we recalculate the projection, the `eventCount` would be updated. This is fine.

OK, I'm starting now. No more deliberation.

Let me think about the total length of code and make sure I cover all requirements from the task:

1. ✅ Projection table(s) and DDL with indexes - `OperationsProjection` + `CompanyTotal` in schema with indexes
2. ✅ Maintenance hooks invoked by write services - `onOrderCreated`, `onOrderApproved` called inside transaction
3. ✅ Re-derivation routine for arbitrary date window - `rederiveWindow`
4. ✅ Scheduled drift-repair job - `runScheduledDriftRepair` with `@Cron`
5. ✅ New dashboard query reads only projection - `getDashboard` queries only `OperationsProjection`
6. ✅ Tests for read-your-own-writes
7. ✅ Tests for concurrent totals
8. ✅ Tests for drift repair
9. ✅ DESIGN.md justifying sync hooks vs alternatives

All requirements covered. Let me write the code.

Actually, one more thing: let me double-check the Prisma `increment` operation. In Prisma, you can do:

```typescript
await tx.companyTotal.update({
  where: { companyId },
  data: {
    pendingAmount: { decrement: order.amount },
  },
});
```

This generates SQL like: `UPDATE company_total SET pendingAmount = pendingAmount - ? WHERE companyId = ?`

This is atomic at the database level. Two concurrent transactions updating the same row will be serialized by PostgreSQL's row-level locking. So the concurrent test will pass.

Also, Prisma's `$transaction` uses either:
- Implicit transactions (multiple queries wrapped in BEGIN/COMMIT)
- Explicit transactions with `prisma.$transaction([...])`

For the nested transaction pattern (where the hook receives the transaction client), Prisma uses the `Prisma.TransactionClient` which is a thin wrapper.

OK, I'm now writing the code for real. Let me go.

Let me write all files and ensure they are complete, correct, and comprehensive.

For the `test/operations.spec.ts`, I need a setup that:
1. Connects to the database (via PrismaService)
2. Bootstraps the NestJS app
3. Runs tests
4. Cleans up

I'll use `beforeAll` to bootstrap, `afterAll` to clean up, and `beforeEach` to reset the database.

The test database can be the same as the development database but a dedicated test database. I'll use `DATABASE_URL` from environment with a fallback.

Let me also think about whether the test needs to push the schema. I'll assume it does and document it, or I'll use `prisma.$executeRaw` to create tables.

Actually, the simplest approach for tests: Use `prisma.dbPush()` in beforeAll if available, or just document that the test database needs the schema.

Wait, I should not overcomplicate the test setup. Let me just use a practical approach:

```typescript
beforeAll(async () => {
  const moduleFixture = await Test.createTestModule({
    imports: [OperationsModule],
  }).compile();
  
  app = moduleFixture.createNestApplication();
  await app.init();
  
  // Ensure database schema exists
  // In practice: npx prisma db push --schema=prisma/schema.prisma
  // We assume this has been done
});
```

This is reasonable. The test documents what prerequisites are needed.

For the test cleanup:
```typescript
beforeEach(async () => {
  await prisma.$executeRaw`TRUNCATE TABLE companies, workers, orders, events, operations_projection, company_total CASCADE`;
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});
```

This ensures a clean state for each test.

Now let me write everything. FINAL ATTEMPT.

Actually, let me also think about edge cases in the code:

1. What if `companyTotal` doesn't exist when `onOrderApproved` is called? The `upsert` handles both create and update, so it's fine. The create branch sets `approvedAmount: order.amount` and `approvedCount: 1`.

2. What if the `OperationsProjection` row doesn't exist when `onOrderApproved` is called? The `update` will fail. But in the design, the projection is created when the order is created, so it should always exist. If it doesn't, that's a data integrity issue that the drift repair addresses. For robustness, I could use `upsert` instead:

```typescript
await tx.operationsProjection.upsert({
  where: { orderId: order.id },
  update: { status: order.status },
  create: {
    companyId: order.companyId,
    orderId: order.id,
    workerId: order.workerId,
    workerName: 'Unknown',
    status: order.status,
    amount: order.amount,
    createdAt: order.createdAt,
    eventCount: 0,
  },
});
```

But this shouldn't happen in normal operation. Let me use `update` for the normal path (which would throw if the row doesn't exist, alerting to a problem) and let the drift repair fix any inconsistencies.

Actually, for robustness, let me use `upsert`. It's safer.

3. What if there are no orders in the company when recalculating totals? All amounts and counts would be 0. The `upsert` would create or update with zeros. This is correct.

4. What if the drift repair finds an order in the source but not in the projection? It recreates the projection row. ✓
5. What if the drift repair finds a projection without a source order? It deletes the projection (orphan). ✓ (handled in detectDrift, and repair should handle it)

Wait, I need to handle the "orphan projection" case in the repair. Let me add it:

```typescript
async detectDrift(startDate: Date, endDate: Date): Promise<DriftEntry[]> {
  const orders = await this.repository.getOrdersForWindow(startDate, endDate);
  const orderIds = orders.map(o => o.id);
  const projections = await this.repository.getProjectionsForOrders(orderIds);
  
  const orderIdSet = new Set(orderIds);
  const projectionMap = new Map(projections.map(p => [p.orderId, p]));
  const drifts: DriftEntry[] = [];
  
  // Check for missing or mismatched projections
  for (const order of orders) {
    const projection = projectionMap.get(order.id);
    if (!projection) {
      drifts.push({ type: 'missing', orderId: order.id });
      continue;
    }
    if (
      projection.status !== order.status ||
      projection.amount !== order.amount ||
      projection.workerName !== (order.worker?.name || 'Unknown')
    ) {
      drifts.push({
        type: 'mismatch',
        orderId: order.id,
      });
    }
  }
  
  // Check for orphan projections (projections without matching orders)
  for (const projection of projections) {
    if (!orderIdSet.has(projection.orderId)) {
      drifts.push({ type: 'orphan', orderId: projection.orderId });
    }
  }
  
  return drifts;
}
```

And in `repairDrift`, handle orphans by deleting:

```typescript
for (const drift of drifts) {
  if (drift.type === 'orphan') {
    await tx.operationsProjection.delete({ where: { orderId: drift.orderId } });
    continue;
  }
  // ... existing fix logic
}
```

Good. Now I have a complete design. Let me write the code.

One last thing: for the `recalculateCompanyTotal` in the drift repair, after fixing projections, I need to recalculate totals for affected companies. I already planned for this. ✓

Also, after the `rederiveWindow`, I should recalculate totals for all affected companies. ✓

And the `onOrderCreated`/`onOrderApproved` hooks update totals atomically. ✓

All paths are covered. Let me now write the complete code.

OK let me also think about the company total schema more carefully. The current `CompanyTotal` has:
- `totalAmount` (sum of all order amounts)
- `pendingAmount` (sum of pending orders)
- `approvedAmount` (sum of approved orders)
- `pendingCount` (count of pending orders)
- `approvedCount` (count of approved orders)

What about other statuses? If orders can be `rejected`, the totals wouldn't include rejected amounts. That's by design - pending and approved are the financial categories.

But what about `rejected` orders? Their amounts are in `totalAmount` but not in `pendingAmount` or `approvedAmount`. This means `totalAmount ≠ pendingAmount + approvedAmount` if there are rejected orders. This is fine - the `totalAmount` is the sum of all orders, and the status-specific totals are subsets.

For the concurrent test, I'll only use `pending` → `approved` transitions, so this isn't an issue.

Now, truly, let me write all the code. I'll go through each file systematically.

One more consideration: in the `AppModule`, I need to ensure `PrismaService` is properly registered. Since `OperationsModule` will import it (or register it as a provider), the `OperationsService` can inject it.

Let me have `OperationsModule` directly register `PrismaService` as a provider. This avoids needing a separate `PrismaModule`.

Alright, here's the final structure and code:

One thing I just realized: the `getOrdersForWindow` method in the repository includes `{ events: true, worker: true }`. This means it joins `events` and `worker` tables. But in the re-derivation, this is fine since re-derivation is not on the hot path. The hot path (dashboard query) only reads from `OperationsProjection`.

Also, the `recalculateCompanyTotal` method only selects `{ status: true, amount: true }` from orders, which is efficient.

Now let me write the code. I'm going to be thorough and complete. Let me structure the output as required: heading + code block for each file.

I think I have a very solid design now. Let me execute.

Let me think about the `Test` structure one more time. I want to use real NestJS module compilation, which means the `OperationsModule` needs to be importable by `Test.createTestModule`. This means all providers must be resolvable.

The `OperationsModule` will import `ScheduleModule.forRoot()` (for the cron), and register all providers including `PrismaService`. The `PrismaService` has `onModuleInit` which connects to the database, so the database must be available before the test runs.

Let me handle this in the test setup:

```typescript
import { PrismaClient } from '@prisma/client';

// First, ensure the database is available and schema is set up
const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
  // Schema should already be pushed
  
  const moduleFixture = await Test.createTestModule({
    imports: [OperationsModule],
  }).compile();
  
  app = moduleFixture.createNestApplication();
  await app.init();
  
  // Get services from the app context
  operationsService = moduleFixture.get(OperationsService);
  prismaService = moduleFixture.get(PrismaService);
});

afterAll(async () => {
  await prismaService.$disconnect();
  await app.close();
});

beforeEach(async () => {
  await prismaService.$executeRaw`TRUNCATE companies, workers, orders, events, operations_projection, company_total CASCADE`;
});
```

Wait, there's a subtle issue. The `PrismaService` in the NestJS app and the standalone `PrismaClient` used for setup are separate instances. But since they share the same database connection, the data created by one is visible to the other.

Actually, it's simpler to just use the `PrismaService` from the app for everything. Let me adjust:

```typescript
beforeAll(async () => {
  const moduleFixture = await Test.createTestModule({
    imports: [OperationsModule],
  }).compile();
  
  app = moduleFixture.createNestApplication();
  await app.init();
  
  operationsService = moduleFixture.get(OperationsService);
  prismaService = moduleFixture.get(PrismaService);
});

beforeEach(async () => {
  await prismaService.$executeRaw`TRUNCATE companies, workers, orders, events, operations_projection, company_total CASCADE`;
});

afterAll(async () => {
  await prismaService.$disconnect();
  await app.close();
});
```

This is cleaner. All database access goes through the `PrismaService` from the app.

Let me now write the complete code for all files. I'll go through them one by one.

For the `OperationsService`, I need to inject `PrismaService` (for `$transaction`) and `OperationsRepository` (for data access) and `ProjectionMaintenanceService` (for hooks).

Wait, but `OperationsRepository` also needs `PrismaService`. And `ProjectionMaintenanceService` also needs `OperationsRepository`. This creates a dependency chain: `OperationsService` → `OperationsRepository` + `ProjectionMaintenanceService` → `PrismaService`. All are registered in the module, so NestJS can resolve them.

Let me finalize the service code:

```typescript
@Injectable()
export class OperationsService {
  constructor(
    private readonly repository: OperationsRepository,
    private readonly projectionMaintenance: ProjectionMaintenanceService,
    private readonly prisma: PrismaService,
  ) {}
  
  async getDashboard(query: DashboardQuery): Promise<OperationsProjection[]> {
    return this.repository.getDashboard(query);
  }
  
  async createOrder(dto: CreateOrderDto): Promise<Order> {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.repository.createOrder(dto, tx);
      await this.projectionMaintenance.onOrderCreated(order, tx);
      return order;
    });
  }
  
  async approveOrder(orderId: string): Promise<Order> {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.repository.approveOrder(orderId, tx);
      await this.projectionMaintenance.onOrderApproved(order, tx);
      return order;
    });
  }
  
  async getCompanyTotal(companyId: string): Promise<CompanyTotal | null> {
    return this.repository.getCompanyTotal(companyId);
  }
  
  async rederiveWindow(from: Date, to: Date): Promise<void> {
    await this.projectionMaintenance.rederiveWindow(from, to);
  }
  
  async runDriftRepair(hours: number = 24): Promise<number> {
    return this.projectionMaintenance.runDriftRepair(hours);
  }
}
```

This is clean. The service:
- For reads: goes through repository (which reads from projection for dashboard, from companyTotal for totals)
- For writes: uses `$transaction` with repository + projection maintenance hooks
- For admin: delegates to projection maintenance

Now let me also think about what `Order` type I'm using. It's the Prisma model type. Let me use `import { Order, CompanyTotal, OperationsProjection, Event, Worker, Company } from '@prisma/client';`.

OK let me finalize and write all code now. For real this time. I'm going to produce the complete output.

Let me estimate the total code size:
- Schema: ~80 lines
- Main: ~10 lines
- AppModule: ~10 lines
- PrismaService: ~20 lines
- OperationsModule: ~20 lines
- Controller: ~80 lines
- Service: ~80 lines
- Repository: ~120 lines
- ProjectionMaintenance: ~250 lines
- Test: ~150 lines
- DESIGN.md: ~150 lines

Total: ~970 lines. That's manageable.

Let me write it all now.

Wait, I should also include the `DriftEntry` type/interface. I'll define it in the `ProjectionMaintenanceService` file.

```typescript
interface DriftEntry {
  type: 'missing' | 'mismatch' | 'orphan';
  orderId: string;
  source?: { status: string; amount: number };
  projected?: { status: string; amount: number };
}
```

OK, writing the code now. I'll make it clean and production-quality.

Let me also handle one more thing: the `OperationsRepository.getOrdersForWindow` method. In the re-derivation, this is called BEFORE entering the transaction. Then, inside the transaction, I use the data to delete and recreate projections. But between the read and the write, other transactions could modify orders. This is fine because:
1. The re-derivation runs in a transaction
2. The delete + recreate inside the transaction is atomic
3. If concurrent modifications happen, the transaction will either see the old state (and fix it) or wait for the concurrent transaction to complete

For stronger consistency, I could use `SELECT ... FOR UPDATE` in the read, but that might cause unnecessary locking. For a maintenance routine, the current approach is fine.

Now let me write the code. Here it is:

Hmm, actually I realize I need to think about one more detail. The `recalculateCompanyTotal` in `rederiveWindow` recalculates totals from ALL orders for the company, not just the window. Is this correct?

The re-derivation routine is called for a specific date window. It rebuilds the projection for orders in that window. But the company totals should reflect all orders, not just the window.

The issue is: if I only recalculate totals using orders in the window, I might set incorrect totals. For example, if a company has $1000 in orders outside the window, and I recalculate with only $500 in orders in the window, the total would be $500 instead of $1500.

So the `recalculateCompanyTotal` should indeed use ALL orders for the company. ✓ My current design does this.

But there's a subtlety: during re-derivation, if we recalculate totals using ALL orders, and meanwhile another transaction is modifying an order outside the window, we might get inconsistent totals. But this is handled by the transaction isolation - the recalculation sees a consistent snapshot.

OK, I'm confident the design is sound. Let me write the code now.

Let me also make the `recalculateCompanyTotal` private to `ProjectionMaintenanceService` since it's an internal method.

One more: for the `recalculateCompanyTotal` method, when running in the drift repair's transaction, after fixing projections, I need to recalculate the totals. But the projections I just fixed are for orders in the drift window. The totals should be calculated from all orders (including those outside the window). So `recalculateCompanyTotal` should look at all orders for the company. ✓

Alright, NOW I'm writing the code. No more analysis.

Actually, I want to double-check one thing: in the `rederiveWindow`, I read orders outside the transaction (via `getOrdersForWindow`), then start a transaction to delete and recreate projections. In between these two steps, orders could be modified. But since the delete + recreate is atomic, and it uses the `orderIds` from the read (which is a snapshot), there could be an issue if new orders are created in the window after the read but before the delete. Those orders wouldn't be deleted (they weren't in the original list) and wouldn't be recreated either.

To handle this properly, I could:
1. Use a single transaction for the entire re-derivation (read + delete + recreate)
2. Lock the projection rows for the window during the transaction

But since re-derivation is a maintenance operation (not on the hot path), this is acceptable. The re-derivation might miss orders created during the gap between the read and the transaction, but this is an edge case for a maintenance routine.

Actually, let me fix this by doing everything inside the transaction:

```typescript
async rederiveWindow(startDate: Date, endDate: Date): Promise<void> {
  await this.repository.$transaction(async (tx) => {
    const orders = await tx.order.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } },
      include: { events: true, worker: true },
    });
    
    const companyIds = [...new Set(orders.map(o => o.companyId))];
    
    for (const companyId of companyIds) {
      const companyOrders = orders.filter(o => o.companyId === companyId);
      const orderIds = companyOrders.map(o => o.id);
      
      // Delete existing projections for these orders
      await tx.operationsProjection.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      
      // Recreate projections
      for (const order of companyOrders) {
        const worker = await tx.worker.findUnique({ where: { id: order.workerId } });
        const eventCount = await tx.event.count({ where: { orderId: order.id } });
        
        await tx.operationsProjection.create({
          data: {
            companyId: order.companyId,
            orderId: order.id,
            workerId: order.workerId,
            workerName: worker?.name || 'Unknown',
            status: order.status,
            amount: order.amount,
            createdAt: order.createdAt,
            eventCount,
          },
        });
      }
      
      // Recalculate company totals (using ALL orders, not just window)
      await this.recalculateCompanyTotal(tx, companyId);
    }
  });
}
```

Now everything happens in a single transaction. The read and write are atomic. New orders created during the transaction will either be seen (if committed before) or not (if committed after). The snapshot is consistent.

Good. This is much better. Let me write the code now.

Let me also reconsider the test for drift repair. The test should:
1. Set up data via service (order + projection + totals)
2. Directly modify the projection (simulate drift)
3. Run drift repair
4. Verify projection matches source

For step 2, I'll use `prismaService.operationsProjection.update(...)` to change the status.

```typescript
it('drift repair fixes projection', async () => {
  // Setup
  const company = await prismaService.company.create({ data: { name: 'Test Co' } });
  const worker = await prismaService.worker.create({ data: { name: 'W1', companyId: company.id } });
  const order = await operationsService.createOrder({ companyId: company.id, workerId: worker.id, amount: 100 });
  
  // Verify normal state
  let projection = await prismaService.operationsProjection.findUnique({ where: { orderId: order.id } });
  expect(projection.status).toBe('pending');
  
  // Inject drift: change projection status
  await prismaService.operationsProjection.update({
    where: { orderId: order.id },
    data: { status: 'rejected' },
  });
  
  // Verify drift exists
  projection = await prismaService.operationsProjection.findUnique({ where: { orderId: order.id } });
  expect(projection.status).toBe('rejected');
  
  // Repair drift
  await operationsService.runDriftRepair(1); // Last 1 hour
  
  // Verify repair
  projection = await prismaService.operationsProjection.findUnique({ where: { orderId: order.id } });
  expect(projection.status).toBe('pending'); // Back to source state
});
```

Wait, but the drift repair should also recalculate totals. If the projection said 'rejected' but the source said 'pending', and totals were based on the projection being 'rejected', after repair, totals should reflect 'pending'.

Actually, in the setup, `createOrder` creates a projection with status 'pending' and adds the amount to pending totals. If I change the projection to 'rejected' (drift), the pending totals are still correct (they match the source). The drift repair should:
1. Fix the projection (back to 'pending')
2. Recalculate totals (which are already correct since they were based on source)

So the test should verify both projection and totals after repair.

Actually, let me make the drift injection more meaningful: change the projection AND make the totals wrong too.

Hmm, but the totals are maintained by hooks. If I bypass the hooks and directly modify the projection, the totals don't get affected (because the totals are correct based on source). The drift repair fixes the projection and recalculates totals, which should result in correct values.

For a more interesting drift test, I could:
1. Create an order (pending, $100)
2. Approve it (pending→approved, totals shift)
3. Inject drift: change projection status back to pending (but source says approved)
4. Now totals show $100 in pending (projection) but $100 in approved (source)
5. Repair drift → projection shows approved, totals recalculated correctly

Wait, but the totals are based on SOURCE, not projection. The hooks that update totals run on the source write. So after approving the order, the totals are correct (approved: $100, pending: $0). If I then change the projection to 'pending' (drift), the totals are still correct (approved: $100, pending: $0) because they're maintained from source, not projection.

So in the drift test, after repair:
- Projection should match source (status = 'approved')
- Totals should still be correct (approved: $100, pending: $0)

This is actually a good test. Let me write it:

```typescript
it('drift repair fixes projection and maintains exact totals', async () => {
  const company = await prismaService.company.create({ data: { name: 'Test Co' } });
  const worker = await prismaService.worker.create({ data: { name: 'W1', companyId: company.id } });
  const order = await operationsService.createOrder({ companyId: company.id, workerId: worker.id, amount: 100 });
  
  // Approve the order
  await operationsService.approveOrder(order.id);
  
  // Verify post-approval state
  let projection = await prismaService.operationsProjection.findUnique({ where: { orderId: order.id } });
  expect(projection.status).toBe('approved');
  
  let total = await prismaService.companyTotal.findUnique({ where: { companyId: company.id } });
  expect(total.approvedAmount).toBe(100);
  expect(total.pendingAmount).toBe(0);
  
  // Inject drift: change projection status to pending (source says approved)
  await prismaService.operationsProjection.update({
    where: { orderId: order.id },
    data: { status: 'pending' },
  });
  
  // Verify drift
  projection = await prismaService.operationsProjection.findUnique({ where: { orderId: order.id } });
  expect(projection.status).toBe('pending'); // Drift!
  
  // Totals are still correct (based on source, not projection)
  total = await prismaService.companyTotal.findUnique({ where: { companyId: company.id } });
  expect(total.approvedAmount).toBe(100); // Still correct
  expect(total.pendingAmount).toBe(0);    // Still correct
  
  // Repair drift
  await operationsService.runDriftRepair(1);
  
  // Verify repair
  projection = await prismaService.operationsProjection.findUnique({ where: { orderId: order.id } });
  expect(projection.status).toBe('approved'); // Fixed
  
  total = await prismaService.companyTotal.findUnique({ where: { companyId: company.id } });
  expect(total.approvedAmount).toBe(100);
  expect(total.pendingAmount).toBe(0);
});
```

This is a comprehensive test. ✓

Now let me think about the concurrent totals test more carefully:

```typescript
it('concurrent approvals for same company → exact totals', async () => {
  const company = await prismaService.company.create({ data: { name: 'Test Co' } });
  const worker = await prismaService.worker.create({ data: { name: 'W1', companyId: company.id } });
  
  // Create two pending orders
  const order1 = await operationsService.createOrder({ companyId: company.id, workerId: worker.id, amount: 100 });
  const order2 = await operationsService.createOrder({ companyId: company.id, workerId: worker.id, amount: 200 });
  
  // Verify initial totals
  let total = await prismaService.companyTotal.findUnique({ where: { companyId: company.id } });
  expect(total.pendingAmount).toBe(300);
  expect(total.approvedAmount).toBe(0);
  
  // Approve both concurrently
  await Promise.all([
    operationsService.approveOrder(order1.id),
    operationsService.approveOrder(order2.id),
  ]);
  
  // Verify exact totals
  total = await prismaService.companyTotal.findUnique({ where: { companyId: company.id } });
  expect(total.pendingAmount).toBe(0);
  expect(total.approvedAmount).toBe(300);
  expect(total.pendingCount).toBe(0);
  expect(total.approvedCount).toBe(2);
});
```

If the totals were using read-modify-write, one of the updates could be lost (e.g., approvedAmount would be $200 instead of $300). The atomic increment prevents this. ✓

Now let me write the read-your-own-writes test:

```typescript
it('approved order appears on next dashboard request', async () => {
  const company = await prismaService.company.create({ data: { name: 'Test Co' } });
  const worker = await prismaService.worker.create({ data: { name: 'W1', companyId: company.id } });
  
  // Create order (pending)
  const order = await operationsService.createOrder({ companyId: company.id, workerId: worker.id, amount: 50 });
  
  // Dashboard should show it
  const dashboard1 = await operationsService.getDashboard({ companyId: company.id, status: 'pending', page: 1, pageSize: 10 });
  expect(dashboard1.find(p => p.orderId === order.id)).toBeTruthy();
  
  // Approve
  await operationsService.approveOrder(order.id);
  
  // Dashboard should show approved
  const dashboard2 = await operationsService.getDashboard({ companyId: company.id, status: 'approved', page: 1, pageSize: 10 });
  expect(dashboard2.find(p => p.orderId === order.id)).toBeTruthy();
  
  // Should NOT appear in pending anymore
  const dashboard3 = await operationsService.getDashboard({ companyId: company.id, status: 'pending', page: 1, pageSize: 10 });
  expect(dashboard3.find(p => p.orderId === order.id)).toBeFalsy();
});
```

This test verifies:
1. A created order appears in the dashboard immediately
2. After approval, it appears in the "approved" filter
3. After approval, it no longer appears in the "pending" filter

All of this happens without any delay or refresh, because the projection was updated atomically with the write. ✓

Let me now finalize and write the output. I'm confident in the design. Let me produce the code.

Actually, let me also add a test for idempotency of re-derivation:

```typescript
it('re-derivation is idempotent', async () => {
  const company = await prismaService.company.create({ data: { name: 'Test Co' } });
  const worker = await prismaService.worker.create({ data: { name: 'W1', companyId: company.id } });
  const order = await operationsService.createOrder({ companyId: company.id, workerId: worker.id, amount: 100 });
  
  const now = new Date();
  const end = new Date(now.getTime() + 86400000); // +1 day
  
  await operationsService.rederiveWindow(now, end);
  
  const projection1 = await prismaService.operationsProjection.findUnique({ where: { orderId: order.id } });
  
  await operationsService.rederiveWindow(now, end);
  
  const projection2 = await prismaService.operationsProjection.findUnique({ where: { orderId: order.id } });
  
  expect(projection1.status).toBe(projection2.status);
  expect(projection1.amount).toBe(projection2.amount);
});
```

This verifies that running re-derivation twice gives the same result. ✓

But wait, the `re-derivation` test also needs a test for running it twice with modifications in between. The idempotency test is:
1. Re-derive window → state X
2. Re-derive same window → state X (no change)

And also:
1. Re-derive window → state matches source
2. Make a change to source (approve order)
3. Re-derive window → state matches new source

Let me include both.

OK, now I'm writing the final output. This is it. Let me produce comprehensive, complete code.

Let me also be careful about TypeScript types. All methods should have proper types.

And let me make sure all error handling is in place. The controller should throw appropriate HTTP exceptions.

Let me also handle the case where `getCompanyTotal` returns null (company has no total yet). The controller should handle this gracefully.

In `operations.controller.ts`:
```typescript
@Get('companies/:companyId/total')
async getCompanyTotal(@Param('companyId') companyId: string): Promise<CompanyTotal | null> {
  return this.operationsService.getCompanyTotal(companyId);
}
```

It just returns null if no total exists. The caller can handle it.

OK, writing the final output now. Complete, comprehensive code for all files.

Let me now carefully write out every file. I'll keep the code clean and production-quality.

Hmm, I just realized something: in my `operations.module.ts`, I'm importing `ScheduleModule.forRoot()`. But I need to check if `ScheduleModule` is available. Since I'm assuming `@nestjs/schedule` is installed, I'll include it. If not, I should provide a fallback.

Actually, let me check: the task says "a scheduled drift-repair job." The simplest way in NestJS without extra packages is to use `setInterval`. But `@nestjs/schedule` is the idiomatic way.

Let me include `@nestjs/schedule` and document it. If it's not in the package.json, the user needs to install it:
`pnpm add @nestjs/schedule`

I'll add this note in the DESIGN.md.

Now, writing. Final output coming up.

Let me organize the code writing in a logical order. I'll start with the schema and work through each file.

Wait, one more thing. I want to make sure the `PrismaService` `onModuleInit` and `onModuleDestroy` hooks work properly in tests. In Vitest, the module lifecycle is managed by the test framework. The `onModuleInit` should be called when the provider is instantiated.

In the test, when I do `Test.createTestModule({ imports: [OperationsModule] })`, NestJS instantiates all providers, including `PrismaService`, which triggers `onModuleInit` → `await this.$connect()`. This requires the database to be available.

For the test to work, the `DATABASE_URL` environment variable must be set to a valid PostgreSQL database. I'll use a default URL in the test or document the requirement.

```typescript
// ASSUMPTION: DATABASE_URL is set to a PostgreSQL test database
// Run: export DATABASE_URL="postgresql://user:password@localhost:5432/marketplace_test"
// Then: npx prisma db push --schema=prisma/schema.prisma
```

OK, this is getting very detailed. Let me just write the code and include reasonable assumptions.

WRITING THE CODE NOW. FOR REAL.
```

## reply

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Company {
  id        String   @id @default(uuid())
  name      String
  createdAt DateTime @default(now())
  orders    Order[]
  total     CompanyTotal?

  @@map("companies")
}

model Worker {
  id        String   @id @default(uuid())
  name      String
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  createdAt DateTime @default(now())
  orders    Order[]

  @@map("workers")
}

model Order {
  id        String   @id @default(uuid())
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  workerId  String
  worker    Worker   @relation(fields: [workerId], references: [id])
  status    String
  amount    Float
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  events    Event[]

  @@map("orders")
}

model Event {
  id        String   @id @default(uuid())
  orderId   String
  order     Order    @relation(fields: [orderId], references: [id])
  type      String
  createdAt DateTime @default(now())

  @@map("events")
}

model OperationsProjection {
  id              String  @id @default(uuid())
  companyId       String
  orderId         String
  workerId        String
  workerName      String
  status          String
  amount          Float
  createdAt       DateTime
  eventCount      Int     @default(0)

  @@map("operations_projection")
  @@index([companyId, status, createdAt], map: "idx_ops_proj_co_st_cr")
  @@unique([orderId])
}

model CompanyTotal {
  id             String  @id @default(uuid())
  companyId      String  @unique
  company        Company @relation(fields: [companyId], references: [id])
  totalAmount    Float   @default(0)
  pendingAmount  Float   @default(0)
  approvedAmount Float   @default(0)
  pendingCount   Int     @default(0)
  approvedCount  Int     @default(0)

  @@map("company_total")
}
```

### prisma/migrations/20240101000000_initial/migration.sql
```sql
CREATE TABLE IF NOT EXISTS "companies" (
    "id" VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "workers" (
    "id" VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "company_id" VARCHAR(36) NOT NULL REFERENCES "companies"("id"),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "orders" (
    "id" VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    "company_id" VARCHAR(36) NOT NULL REFERENCES "companies"("id"),
    "worker_id" VARCHAR(36) NOT NULL REFERENCES "workers"("id"),
    "status" VARCHAR(50) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "events" (
    "id" VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    "order_id" VARCHAR(36) NOT NULL REFERENCES "orders"("id"),
    "type" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "operations_projection" (
    "id" VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
    "company_id" VARCHAR(36)
