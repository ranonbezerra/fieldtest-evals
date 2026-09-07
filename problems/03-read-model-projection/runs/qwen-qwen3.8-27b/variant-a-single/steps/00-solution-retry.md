# solution-retry

## reasoning

```
We need answer user wants build whole solution in one reply. Need output only file headings and fenced blocks, no prose. Need solve problem: marketplace operations dashboard. Need TypeScript + NestJS + Prisma + Postgres. Files complete. Need infer layout from conventions? User says decide file layout yourself. But includes read-only reference variant A. Need deliver complete solution. Need be careful with format: for each file, level-3 heading only path, immediately one fenced block only content. No other prose.

We must produce solution for projection tables + DDL with indexes; maintenance hooks invoked by write services (simulate write path); re-derivation routine for arbitrary date window; scheduled drift-repair job; new dashboard query; tests for read-your-own-writes, concurrent updates to one company's totals, drift repair. Include short DESIGN.md.

Need use TypeScript, NestJS, Prisma, Postgres, Vitest. No tools. Need produce complete files. Since no package.json? Could include package.json, tsconfig, vitest config, prisma schema, main, app.module, features, tests, DESIGN.md, maybe .env? Config from env only. Need avoid hardcoded connection strings.

Need think architecture.

Domain: Operations = join of payment orders, events, workers, filtered by company, status, date range, sorted by recency, paginated. With 3M orders slow. Need read model projection. We need maintain projections from writes. Requirements: operators must see own writes immediately (read-your-own-writes). Financial totals per company exact not approximate. Dashboard query uses projection.

Need model source tables: payment orders, events, workers maybe companies. We can design source of truth: PaymentOrder, Event, Worker, maybe Company. Projection: operations_read_model row per operation? And company_financial_totals row exact? Or operation includes payment order fields and status derived from events. Operators write: approve an order → reflects next request. Need maintenance hooks invoked by write services simulate write path. Need scheduled drift-repair job and re-derivation for window. Need tests.

Potential approach:
- Source tables:
  - companies: id, name, ...
  - workers: id, company_id, name, email
  - payment_orders: id, company_id, worker_id?, amount_cents, currency, status enum pending/approved/rejected/refunded? created_at, updated_at, approved_at? version? We need events: order events (id, order_id, worker_id?, type, payload, occurred_at) maybe source events that cause status changes.
  - Operation is a projection from order + latest event? We need dashboard lists operations: maybe id = payment order id, company_id, worker_id, worker_name, order_status, amount_cents, currency, last_event_at, occurred_at? Sort recency = last_event_at or created_at? Variant says sorted by recency; could be updated_at / last_event_at. We'll use updated_at from order or event.

Need exact financial totals per company: projection table company_financial_totals with totals by status maybe: pending_cents, approved_cents, refunded_cents, net_cents? Exact integer cents. Maintained transactionally with source writes. Drift repair recomputes from source for window or all. Dashboard query can join operations projection and totals? Operators see dashboard list and totals? Task says new dashboard query; financial totals per company must be exact. So service returns items + totals for company maybe.

Need p95 < 50ms. Projection query indexed. In 3M rows, pagination with composite index (company_id, status, occurred_at desc) plus maybe keyset? Requirement filtered by company, status, date range, sorted recency, paginated. Offset pagination can be slow for deep pages. To guarantee 50ms, use keyset pagination with cursor (occurred_at, id). But API maybe requires page? We can implement cursor pagination. Need without changing what operators see: list contents same, but pagination method can be cursor? It changes API? Maybe acceptable if still paginated? "without changing what operators see" likely data not performance. We can support limit and cursor; default? Could include page? Keyset is better. Need query stable sort by occurred_at desc, id desc. Index: (company_id, status, occurred_at DESC, id DESC) WHERE status? status optional. For status optional, could create partial? Or include status in index and use when provided; when not, index company_id, occurred_at desc, id desc. We can have two indexes: idx_ops_company_status_time and idx_ops_company_time. But for status optional, query can use company_time if no status. For date range: occurred_at >= from AND <= to. Index supports.

Exact totals: company_financial_totals table company_id pk, pending_cents, approved_cents, rejected_cents, refunded_cents, net_cents, updated_at, version. Updated in same transaction as source writes. But if write service updates order status, need adjust totals by delta. Since status changes: old status -> new status. Need atomic? Single writer? Concurrent updates to one company's totals: use database constraints and row update with SQL `UPDATE ... SET pending_cents = pending_cents + delta ...` to avoid lost updates. Prisma can do raw? Layers: repository only touches DB. Service logic. Can use Prisma transactions and update with arithmetic? Prisma update requires absolute value, not increment. Prisma 5 supports `increment` on Int? For Decimal? If Int cents, `increment: delta`. But concurrency: if we read then update absolute can race; Prisma increment is atomic. But need compute delta from old to new status. Could do repository method `applyOrderStatusChange` using raw SQL? But layers: repository can touch DB, zero raw SQL in service. Repository can use Prisma client, maybe `$executeRaw`? Is that raw SQL in repository allowed? "Zero raw SQL, zero Prisma client calls" only service. Repository is only layer touches database; likely can use Prisma client and raw. But convention says Prisma ORM; maybe repository can use Prisma query builder. For arithmetic atomic, use Prisma's increment: `update({ where: { company_id }, data: { pending_cents: { increment: deltaPending } ... }})`. That's atomic. Need upsert create with increments? For first event, if row missing, upsert update increments. But concurrent upserts? Use `upsert` with `update` increments; if two concurrent inserts conflict, one update? Prisma upsert not fully race-safe? Postgres upsert? Better `create` then catch unique violation and `update` increment? Or use raw `INSERT ... ON CONFLICT DO UPDATE SET ... increment`. Since repository allowed raw? Could use Prisma `$executeRaw` for exact idempotent aggregate. But need maybe raw SQL in repository okay? It says repository is only layer that touches database; not forbidding raw in repo. But "Prisma as ORM" maybe prefer Prisma client. To guarantee exact, can use raw in repository. Yet tests with real DB? Need maybe use Prisma test client? We can't run. But deliver code.

Need maintenance hooks invoked by write services (simulate write path). We can have write services: OrderWriteService? `PaymentOrderService` for create/approve/reject/refund; `WorkerService`? Hooks call `ProjectionMaintenanceService` or `ReadModelSyncService` inside same transaction. Since no actual existing write services, we simulate. Need module providers exports.

Need re-derivation routine for arbitrary date window: method rebuild window from source into projection, using temp or delete/insert. Must be safe. Need idempotent. Could use staging table and `DELETE FROM operation_read_model WHERE occurred_at in window ...`? Re-derivation for date window: delete existing projection rows whose last_event_at in window, then insert from source aggregation. But if operation spans events outside window? We can define projection row `occurred_at` = latest event for that order. Re-derive window of occurred_at; source events within? Need include orders whose latest event in window; computing from source may need all events for orders in window? If event outside window changed status but latest inside? Hard. Simpler: re-derive by date window of source events: reconstruct operation rows from orders and latest event whose occurred_at in [from,to]? But if latest event before window, no row? Actually projection rows persist; re-derive arbitrary date window likely for backfill: for all orders with created_at or updated_at in window, rebuild their projection. We can define window by `payment_orders.updated_at`/`occurred_at`. We'll implement rederiveWindow(from,to): delete projection rows where `occurred_at between from and to` and then insert recomputed rows from source orders whose `updated_at between from and to` or latest event in window. Need ensure exact. Could use source of truth `payment_orders` plus `order_events`; query latest event per order in window? For backfill, better compute full latest event per order regardless window, but only for orders whose `updated_at` in window? But if an event occurs in window, the order's updated_at updated in same transaction, so window on updated_at works. We'll set `payment_orders.updated_at` and `occurred_at` projection equals `payment_orders.updated_at`? Or latest event occurred_at? Simpler: operation projection row's `recency` is `payment_orders.updated_at`. Source `payment_orders.status` current. Worker name from worker. Projection row: operation_id = order id, company_id, worker_id, worker_name, status, amount_cents, currency, occurred_at = updated_at, source version? For financial totals from orders current status. Re-derive window based on `payment_orders.updated_at` window. That avoids event complexity. But variant mentions events as join; maybe operation is join of payment orders, events, workers. We can include `last_event_type` and `last_event_at` from events, but recency maybe event. However source orders status might be derived by events. Need decide.

Maybe model:
- `payment_orders` has fields: id uuid, company_id, worker_id, amount_cents, currency, status (source current), created_at, updated_at, approved_at? 
- `order_events` immutable: id, order_id, worker_id?, type, created_at. Source of history.
- Projection `operations_read_model` row per order: operation_id, company_id, worker_id, worker_name, status, amount_cents, currency, last_event_type, last_event_at, occurred_at (last_event_at or updated_at), created_at, updated_at. We can use `occurred_at` = `COALESCE(last_event_at, created_at)`.

Maintenance hooks:
- When order created: insert projection row; insert totals delta amount to status pending? Financial totals should count amounts per status. On create pending: total pending += amount.
- When status changes from old to new: update projection row; totals: decrement old status, increment new. For refund status? Need statuses: pending, approved, rejected, refunded. Net total maybe approved - refunded? Exact totals per company: columns: pending_cents, approved_cents, rejected_cents, refunded_cents, approved_net_cents? Let's define:
  - `pending_cents` sum amount where status = pending
  - `approved_cents` sum amount where status = approved
  - `rejected_cents` sum amount where status = rejected
  - `refunded_cents` sum amount where status = refunded
  - `net_cents` = approved_cents - refunded_cents (we can store or compute)
Exact via increments.
- When worker name changes: update projection rows for worker? Operators see worker name. Could be heavy but okay. Need hook for worker update: update operation rows where worker_id. If worker belongs to company? Could also rederive worker's orders. For exact totals unaffected. For read-your-own-writes, if operator updates worker, dashboard reflects next request. We can maintain `worker_name` in projection; on worker name update, `UPDATE operations_read_model SET worker_name = ? WHERE worker_id = ?`. Index? Use worker_id index. If many rows, could be heavy but acceptable. Could instead denormalize latest worker profile? We'll include.
- When company name? Dashboard filters by company; not necessary.

But write services simulate: `payment-order.service.ts` with methods `createOrder`, `approveOrder`, `rejectOrder`, `refundOrder`, maybe `setStatus`. It calls repository to persist source and projection maintenance in same transaction. But service zero Prisma calls; repository source + projection. Need transaction: Nest service can call a repository method that does transaction? Repository can use `prisma.$transaction`. Service calls `paymentOrderRepository.createWithProjection` maybe. For status change: service calls `paymentOrderRepository.changeStatusWithProjection`. The maintenance logic maybe in `read-model.repository` called by write repository? Layers? Could have `ReadModelSyncService` with logic but zero Prisma calls; it calls `ReadModelRepository` and `CompanyTotalsRepository`. Write service can call sync service inside transaction? But transaction callback needs Prisma? If service cannot call Prisma, can't open transaction. Nest can use TransactionalRepository pattern? We can make repository methods use `prisma.$transaction` inside. Service calls one repository method that maintains source and projection atomically. But if service needs business logic (determine delta) and then repository executes source and projection. Could be `PaymentOrderRepository.applyStatusChange(orderId, newStatus, actorId?)` uses `prisma.$transaction` to read old status, update source, upsert totals, update projection. Service validates and returns. That is okay: service has logic for allowed transitions; repository does DB.

But "maintenance hooks invoked by the write services" suggests write service calls read-model service after write, maybe same transaction. We can design a `ReadModelMaintenanceService` that receives an event/command and calls repository. But service must not call Prisma. It can call repository. However to ensure same transaction as source, repository can expose a `runInWriteTransaction(fn)`? But fn from service? Service can't use Prisma but can pass callback to repository; repository uses prisma.$transaction inside callback? Example:
```
await paymentOrderRepository.withTransaction(async (tx) => {
  const order = await paymentOrderRepository.saveOrder(..., tx);
  await readModelSyncService.syncOrderCreated(order, tx);
});
```
But readModelSyncService would need tx? It would call readModelRepository.syncWithTx. Service passing tx from repository violates? Maybe okay? Simpler: repositories encapsulate transaction: `paymentOrderRepository.create(input)` does source insert + projection upsert + totals in one `prisma.$transaction`. The write service just calls repository. That meets hooks? It is a hook invoked by write service. Could create `ReadModelSyncService` not used? We need maintenance hooks invoked by write services; could be `ReadModelMaintenanceService` with methods, but then service cannot ensure transaction unless repository. We can implement write repository methods that call `ReadModelRepository` and `FinancialTotalsRepository` within transaction. Service calls write repository. That's fine.

Need module wiring: 
- `PaymentOrderModule` providers: PaymentOrderRepository, ReadModelRepository, FinancialTotalsRepository, PaymentOrderService, maybe ReadModelSyncService? exports: PaymentOrderRepository, ReadModelRepository? 
- `DashboardModule` imports PaymentOrderModule? For query service uses ReadModelRepository and FinancialTotalsRepository. If repositories exported.
- `BackfillModule` maybe re-derivation and drift repair.

But maybe simpler one `operations` feature? Layout convention `src/<feature>`. Could create features:
  - `payment-order` (write source)
  - `operations-dashboard` (read query)
  - `operations-read-model` (projection maintenance and query repositories?)
  - `backfill` or `operations-backfill` (re-derive, drift repair)
Need avoid too many modules? Could use one `operations` feature for projection and dashboard, plus `payment-orders` write. But convention: feature. We'll create:
- `src/payment-orders/payment-orders.module.ts`
- `src/payment-orders/payment-order.repository.ts`
- `src/payment-orders/payment-order.service.ts`
- `src/payment-orders/payment-order.controller.ts` maybe simulate write endpoints? The task says write services simulate; maybe need endpoints? Could include controllers for orders: create, approve, reject, refund. Also workers update? Need source write path. Could include worker controller? Maybe not. But for read-your-own-writes test, can call service not HTTP. But Nest solution likely needs controllers. We can include minimal controllers for orders and dashboard.

- `src/operations/operations.module.ts`
- `src/operations/operations.repository.ts` (read model query)
- `src/operations/operations.service.ts` (dashboard query)
- `src/operations/operations.controller.ts` (GET /operations dashboard)
- `src/operations/financial-totals.repository.ts`?
- `src/operations/read-model-maintenance.repository.ts`?
Maybe combine projection and totals in `read-model.repository.ts`.

Need Prisma schema with source and projection tables. Also DDL with indexes? Prisma schema can define `@@index`. But "projection table(s) + DDL with appropriate indexes" Could include SQL migration file. Conventions: every schema change ships with migration. We need Prisma schema and migration SQL. Since we can't run prisma migrate, include migration SQL. Need file `prisma/migrations/0001_init/migration.sql` maybe. But Prisma migration naming? Use `prisma/migrations/0001_init/migration.sql`. Need include CREATE TABLE and indexes. But if schema.prisma is source, migrations generated; we can provide migration SQL. Need ensure matches schema. We can include `prisma/schema.prisma` and `prisma/migrations/20240101000000_init/migration.sql` maybe. Need not include dbpush? We'll include one migration.

Need tests using Vitest. Need test behavior: read-your-own-writes, concurrent updates to one company's totals, drift repair. How to test without DB? Could use Prisma with real Postgres? In unit tests, can use in-memory? Prisma needs DB. We can write tests against repositories/services with mocked repositories? But "Never assert only that a call happens. Test behaviour." Mocking repository and asserting service returns maybe okay but not real. Need tests for read-your-own-writes, concurrent updates, drift repair. Could test at service level with in-memory fakes that emulate transactional behavior? But exact totals and concurrency requires DB semantics. Could use `pg-mem`? Not standard. We can write integration tests requiring test Postgres. Use Vitest with `PrismaClient` connected to `DATABASE_URL` (env). For CI, maybe `pg-mem`? Package? Could include `pg-mem` as dev dependency to test? But no package.json? Could create package.json with vitest, prisma, nestjs. If using pg-mem, need adapter? Prisma doesn't support pg-mem directly except `@prisma/client` via `prisma-client-js`? There is `prisma-plus`? Could be overkill.

Better: Write tests at repository level using a test double `PrismaClientLike`? But concurrency tests need to emulate row-level increment. Could implement repository logic in pure functions and test with a fake database that emulates SQL? Hmm.

Given no execution, need deliver plausible tests. We can use PrismaClient connected to test DB via env `DATABASE_URL`. The tests can create real Postgres and run migrations? In test setup, use `prisma db push`? No shell. Could include global setup that runs `prisma migrate deploy` via child process? Might be okay but tests need DB. In many repos, integration tests use testcontainers or assume DATABASE_URL. Conventions: environment config from env only. Tests can require `DATABASE_URL`. But if test environment absent, fail. That's acceptable? Need tests. Could write tests using `PrismaClient` and `$queryRaw` to seed. Need not overcomplicate.

But "Vitest. Test behaviour, not implementation. Never assert only that a call happened." We can test service methods against real DB. For concurrency, use Promise.all to apply status changes to same company and assert exact totals. For drift repair, create drift then repair. For read-your-own-writes, approve and query dashboard. Use transactional tests? If real DB, each test cleanup.

Need maybe use Vitest workspace. Provide `vitest.config.ts`, `tsconfig.json`, `package.json`, `nest-cli.json`? Could include. Need complete solution; maybe not necessary but useful. Need include `test/support/test-db.ts`? The layout convention says `test/<feature>.spec.ts`. Could create `test/operations.spec.ts`, `test/read-model.spec.ts`, `test/drift-repair.spec.ts`. But user asks tests for three things. Could put in `test/operations-read-model.spec.ts` with multiple describe. But convention test/<feature>.spec.ts. We'll have `test/operations-dashboard.spec.ts`, `test/operations-maintenance.spec.ts`, `test/operations-drift-repair.spec.ts`? Maybe one file per feature.

Need ensure no file appears twice.

Let's design schema.

Prisma:
```
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql", url = env("DATABASE_URL") }

enum OrderStatus {
  PENDING
  APPROVED
  REJECTED
  REFUNDED
}

model Company {
  id String @id @default(uuid()) @db.Uuid
  name String
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  orders PaymentOrder[]
  workers Worker[]
  totals CompanyFinancialTotal @unique? Actually one row.
  @@map("companies")
}

model Worker {
  id String @id @default(uuid()) @db.Uuid
  companyId String @map("company_id") @db.Uuid
  email String @unique
  name String
  createdAt ...
  updatedAt ...
  company Company @relation(fields: [companyId], references: [id])
  orders PaymentOrder[]
  @@map("workers")
}

model PaymentOrder {
  id String @id @default(uuid()) @db.Uuid
  companyId String @map("company_id") @db.Uuid
  workerId String? @map("worker_id") @db.Uuid
  amountCents Int @map("amount_cents")
  currency String @default("USD") @db.Text
  status OrderStatus @default(PENDING)
  version Int @default(0)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz
  company Company @relation(fields: [companyId], references: [id])
  worker Worker? @relation(fields: [workerId], references: [id])
  events OrderEvent[]
  @@index([companyId, status, updatedAt, id])? source maybe not needed but for rederive: @@index([updatedAt])
  @@map("payment_orders")
}

model OrderEvent {
  id String @id @default(uuid()) @db.Uuid
  orderId String @map("order_id") @db.Uuid
  type String
  payload Json?
  occurredAt DateTime @default(now()) @map("occurred_at") @db.Timestamptz
  order PaymentOrder @relation(fields: [orderId], references: [id], onDelete: Cascade)
  @@index([orderId, occurredAt])
  @@index([occurredAt])
  @@map("order_events")
}

model OperationReadModel {
  operationId String @id @map("operation_id") @db.Uuid // same as order id
  companyId String @map("company_id") @db.Uuid
  workerId String? @map("worker_id") @db.Uuid
  workerName String? @map("worker_name")
  status OrderStatus
  amountCents Int @map("amount_cents")
  currency String @default("USD") @db.Text
  lastEventType String? @map("last_event_type")
  occurredAt DateTime @map("occurred_at") @db.Timestamptz
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @default(now()) @map("updated_at") @db.Timestamptz
  @@index([companyId, status, occurredAt, id?]) // need id? id is operationId not named id? In Postgres can index operation_id. Prisma index fields: [companyId, status, occurredAt, operationId]? But operationId is @id. Can index. For status optional: @@index([companyId, occurredAt, operationId])
  @@index([workerId])
  @@index([occurredAt])
  @@map("operation_read_model")
}

model CompanyFinancialTotal {
  companyId String @id @map("company_id") @db.Uuid
  pendingCents BigInt? Int? Amounts maybe Int but totals 3M*amount can exceed Int (2^31) if cents large. Use BigInt for exact and safe. Prisma BigInt. In JSON, BigInt serialized? Node JSON.stringify BigInt throws unless toJSON. Could use string? Use `bigint` with `@db.BigInt`, and service convert to string. But tests compare. Prisma BigInt returns bigint. We can map to string in DTO. Use BigInt to avoid overflow. Columns: pendingCents BigInt @default(0) @map("pending_cents") @db.BigInt, etc. netCents maybe BigInt. `version` Int.
  @@map("company_financial_totals")
}
```

Need Prisma BigInt in increment? Prisma supports `increment` for BigInt? Yes for `BigInt`? I think update input can use `{ increment: 1n }`? Prisma supports BigInt in filters and create? For increment, maybe type is `number | { increment: number }`? Actually for BigInt fields, update takes `BigintNullableFilter`? Need check. Prisma BigInt field update accepts `BigInt | { increment: BigInt, ... }`? I think yes? Might be `number`? To be safe, use `Decimal`? But exact cents as `Decimal` supports arbitrary. However Prisma Decimal returns `Prisma.Decimal`, JSON stringify okay? It has toString. Arithmetic increments? Could use `increment: new Prisma.Decimal(amount)`. But exact currency cents maybe Decimal with precision. Use `Decimal` with `@db.Decimal(38, 0)` to represent cents, avoiding BigInt JS issues. But financial exact and p95? Integers preferred. BigInt is okay but JSON. We can use `String` to store cents? No arithmetic.

Prisma supports `BigInt` with `increment`? Let's recall: Prisma field type `BigInt` in update accepts `BigintFieldUpdateOperationsInput` with `increment?: BigInt`? I think yes. In JavaScript, can use `1n`. Prisma validates. We'll use BigInt. But tests using `expect(total.pendingCents).toBe(100n)`. For API DTO, convert to string. Need package.json maybe no issues. Node 20 supports BigInt.

But JSON response with BigInt not serializable. We'll map to string in controller/service.

Potential issue: Prisma `@default(0)` for BigInt? Can use `@default(0)`? I think yes. For migration: `BIGINT DEFAULT 0`.

Status in projection: enum. Query status filter: string to enum.

DDL migration:
- enums `OrderStatus` type.
- tables with columns matching.
- indexes.

But if we include Prisma schema, migration must be valid. Need ensure relations. For projection table maybe no relation to avoid FK overhead? Could have no FKs for performance. But schema can be standalone. For migration, we can create without FKs. But Prisma schema if no fields, okay. Could omit relations for read model. For source tables need relations.

If read model no FK, Prisma model no fields. Fine.

Need DDL indexes appropriate:
operation_read_model:
- UNIQUE operation_id (PK)
- Index for dashboard with status: `(company_id, status, occurred_at DESC, operation_id DESC)`. But if status optional, Postgres index with status can still be used? For query without status, index on (company_id, status, occurred_at) may be used but less efficient; better separate index `(company_id, occurred_at DESC, operation_id DESC)`. But if status filter, use status index. We'll create two.
- Index worker_id for worker name updates.
- Index occurred_at for drift repair/backfill maybe.
- Maybe partial index for active statuses? Not needed.

Financial totals PK company_id.

Source payment_orders: index `(company_id, status, updated_at)` for drift? and `(updated_at)` for rederive. workers: `(company_id)`, maybe `(id)`. events: `(order_id, occurred_at)`, `(occurred_at)` for window.

Need DDL to include these.

Now code design.

Package.json:
```
{
  "name": "fieldtest-03-variant-a",
  "type": "module",
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@prisma/client": "^5.0.0",
    "class-validator": "^0.14.1",
    "class-transformer": "^0.5.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "prisma": "^5.0.0"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.0.0",
    "@types/node": "^20",
    "typescript": "^5.3",
    "vitest": "^1.6",
    "@vitest/coverage-v8": "^1.6"
  }
}
```
Need `dotenv`? Environment variables only; Nest config? Could use process.env. No secrets. We can include `@nestjs/config`? Not necessary. Prisma reads DATABASE_URL. But maybe need `.env.example`? Could include but no secrets. Task says configuration from env only. `.env.example` okay? Not required. Could omit.

tsconfig:
```
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "declaration": false,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*", "test/**/*"]
}
```
ESM with decorators: NestJS requires `module: commonjs`? With type module and NodeNext, can be tricky. Convention says ESM, type module. Nest supports ESM but requires .js imports? We are not actually running? Need code with extensionless imports? TypeScript NodeNext requires file extensions for ESM. NestJS can work with ESM but imports need `.js`? In TS with NodeNext and type: module, relative imports need `.js` extension. That complicates. Many NestJS use CommonJS. But convention says ESM `"type": "module"`. Need satisfy. We can use `module: "NodeNext"` and add `.js` to imports. But user may not execute. Need choose defensible. Could set `"type": "module"` and use ESM imports with `.js` extensions. But Prisma client? Ok. However Vitest can handle. But writing many files with `.js` extensions is fine. Need ensure all imports include extension. But layout maybe no package exports. We'll do `.js` for local imports. For Nest decorators, `import '@nestjs/common'` no extension. Good.

But Prisma and Nest with ESM: `import { PrismaClient } from '@prisma/client'` works? Probably. `reflect-metadata` side effect `import 'reflect-metadata';`.

Need main.ts:
```
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}
bootstrap();
```

AppModule:
Need PrismaModule? We can create custom `PrismaService` extending PrismaClient, in `src/prisma/prisma.service.ts` and `src/prisma/prisma.module.ts` global. But layout convention no? We can. Service? It touches DB? It is infrastructure. But layers: repositories only touch DB. PrismaService is just client, can be provider. It doesn't contain logic. Repository injects it.
```
@Injectable() export class PrismaService extends PrismaClient { onModuleInit... onModuleDestroy... }
@Global() @Module({ providers: [PrismaService], exports: [PrismaService] }) export class PrismaModule {}
```

Need error handling: one envelope. Implement exception filters? Maybe `NotFoundFilter` etc. But controllers can throw custom exceptions. Need error code. We can create `src/common/errors.ts` with `AppException` extends HttpException? and `mapHttpStatus`. But maybe not necessary. However endpoints should return envelope for errors. We can implement a global exception filter mapping known errors. But task focuses read model. Still conventions errors one envelope. Need include `src/common/app-exception.filter.ts` and maybe `HttpCode` mapping. But keep minimal.

Controllers:
- PaymentOrderController: POST /payment-orders, PATCH /payment-orders/:id/approve, /reject, /refund? Need DTOs. It validates input. Calls service. Returns 201/200 with DTO.
- OperationsController: GET /operations?companyId=...&status=...&from=...&to=...&limit=...&cursor=... returns list and totals. Maybe GET /operations/totals? The dashboard query includes totals? We can include totals in same response: `items`, `nextCursor`, `totals`. Financial totals exact. But if filter by status? Totals per company all statuses? It says financial totals per company must be exact. Dashboard can show totals for company regardless filter. We'll return totals for company.
Need DTO validation with class-validator.

Service layer:
`PaymentOrderService`:
- `createOrder(input)`: validates? Controller does. It checks allowed company? It calls `paymentOrderRepository.createWithReadModel(input)`. Returns DTO.
- `setStatus(orderId, status)`: business transition rules: pending -> approved/rejected/refunded? approved -> refunded maybe. rejected no? We can define. It calls repository `changeStatusWithReadModel`. Need immediate projection.
- Worker update? `WorkerService` maybe for worker name update. We need worker name in projection. Could create `WorkerService` with `updateName` calling repository. But maybe not needed for tests? Could include.
Need source worker write service? Simulate write path. We'll include `WorkerService` and controller PATCH /workers/:id.

`PaymentOrderRepository` (source + read model? Better separate read-model maintenance). To keep zero raw in service, repository can coordinate. Let's create:
- `PaymentOrderRepository`: methods `create(input)`, `changeStatus(orderId, newStatus)`, `findById`, `findForReDerivation`.
- `ReadModelRepository`: methods `upsertOrderProjection(order)`, `applyStatusChangeProjection(orderId, oldStatus, newStatus)`, `applyWorkerName(workerId, name)`, `upsertCompanyTotalDelta(companyId, oldStatus, newStatus, amount)`, etc.
- `FinancialTotalsRepository`? Could combine in ReadModelRepository. For clarity separate `FinancialTotalsRepository` with `applyStatusDelta`, `getForCompany`, `rebuildWindow`.
But too many. We can combine projection and totals in `ReadModelRepository`; it touches both tables.

Need transaction: `PaymentOrderRepository.create` can use `this.prisma.$transaction(async (tx) => { ... })` but if ReadModelRepository uses `this.prisma` not tx, not same transaction. Need pass tx or use repository methods that take an optional PrismaClient-like. Since TypeScript strict. We can define `type PrismaTx = Prisma.TransactionClient`. But `ReadModelRepository` methods accept `tx: PrismaService | Prisma.TransactionClient`? Could use `Prisma.TransactionClient` (an interface) but constructing? In repository, use `prisma.$transaction(async tx => ...)`. Then call `readModelRepository.upsertOrderProjection(order, tx)`. For non-transactional operations, call with `this.prisma`. Define methods param `client: PrismaService | Prisma.TransactionClient = this.prisma`. But `Prisma.TransactionClient` may not include all? It is type of client in interactive transaction, supports model delegates. Need import `Prisma` from `@prisma/client`.

But layer: service zero Prisma calls; repository can use Prisma. Good.

Potential issue: Prisma `$transaction` with callbacks using nested interactive client. We'll write.

`PaymentOrderRepository.create`:
```
return this.prisma.$transaction(async (tx) => {
  const order = await tx.paymentOrder.create({ data: {...} });
  const event = await tx.orderEvent.create({ data: { orderId: order.id, type: 'ORDER_CREATED' } });
  await this.readModelRepository.upsertOrderProjection({ ... order, lastEventType: event.type, occurredAt: event.occurredAt }, tx);
  await this.readModelRepository.applyStatusChange(order.companyId, null, order.status, order.amountCents, tx); // old null => add
  return order;
});
```
But if old status null, totals delta only new.

`changeStatus`:
```
return this.prisma.$transaction(async (tx) => {
  const existing = await tx.paymentOrder.findUnique({ where: { id: orderId }, include: { worker: true } });
  if (!existing) throw ...? Service handles? Better repository can throw `ResourceNotFoundException`. But service should? We can create exceptions in common. Repository can throw? It can, but service maybe validates. To avoid service calling Prisma, repository can return null and service throws. But inside transaction, if null, abort. We can throw a custom `ResourceNotFoundException` from repository? It touches DB and can throw. But layer? okay. Or service first fetch via repository `findById` then call `changeStatus`; but concurrency? If status changed between read and change, need atomic check. Use transaction read and validate allowed transition. Service transition rules need old status. Could repository fetch old and service? Not inside same tx? Could use repository method `prepareStatusChange` returning old? But then transaction. Simpler: repository `changeStatus(orderId, requestedStatus)` uses service-provided transition validation? It can read old, check transition by calling a pure function? But business logic in service. Service can't call Prisma but can pass old status? If service reads old separately, then change transaction re-reads and validates. We can define `AllowedTransition` in service and pass to repository? Hmm.

Service can validate against current status if repository method returns current order before mutating? But no Prisma. `PaymentOrderRepository.findById` can be called. Then service checks transition. Then `changeStatus` atomically rechecks. Good.

In `changeStatus` transaction:
```
const existing = await tx.paymentOrder.findUnique...
if (!existing) throw new ResourceNotFoundException
if (!isTransitionAllowed(existing.status, newStatus, allowed)) throw new InvalidTransitionException
await tx.paymentOrder.update({ where: { id: orderId }, data: { status: newStatus, version: { increment: 1 } } })
await tx.orderEvent.create...
const projection = await buildProjectionFromOrder(tx, existing, newStatus)
await readModelRepository.applyStatusChange(...)
```
Need `isTransitionAllowed` pure in common? Service can define. But repository needs it too? Could pass `allowRefundFromApproved`? Better business logic in service: before transaction, read current status and validate. Then repository assumes allowed; but for concurrency, if status changed, re-validate in transaction. Could duplicate transition map in repository? Business logic in service only? Convention service holds logic, repository no business logic. But revalidation in repository would be business logic. Maybe acceptable as data integrity? Hmm. To keep logic in service, we can have service call `paymentOrderRepository.changeStatusIfCurrent(orderId, expectedStatus, newStatus)`. The repository treats `expectedStatus` as guard, not business. Service computes expectedStatus from previous read. If concurrent changed, repository throws `StaleStatusException`. Service maps to 409. That keeps transition rules in service. For allowed transition from pending to approved, service checks; guard expected. Good.

`changeStatusIfCurrent(orderId, expectedStatus, newStatus)`:
```
const existing = await tx.paymentOrder.findUnique...
if (!existing) throw NotFound
if (existing.status !== expectedStatus) throw StaleStatusException
... update where id AND status expected? To be fully atomic, `updateMany({ where: { id, status: expectedStatus }})` count 1. Then if count 0 throw stale. Use `update` with `where: { id: { equals... }, status: { equals: expected } }`? Unique where can include status? Prisma `findFirst`? Use `updateMany` to claim. Then update projection. This prevents concurrent. Good.
```
But if `updateMany` count 1, then proceed. Need source status transition atomic. For create no.

Read-your-own-writes: After service creates/approves, next dashboard query sees projection. Because same transaction commit before response. Good.

Concurrency tests: multiple `changeStatusIfCurrent` with same expected? If concurrent updates from same old status, only one succeeds? But requirement concurrent updates to one company's totals: multiple different orders status changes concurrently; totals exact via increment. Or same order? We'll test multiple orders updated concurrently. Also test same order stale.

Need financial totals exact: For each status change, delta = amount from old to new. For create: old null new pending add pending. For cancel? No. For approved -> refunded: approved -= amount, refunded += amount. Net = approved - refunded maybe updated or computed.

`ReadModelRepository.applyStatusDelta(companyId, oldStatus, newStatus, amountCents)`:
Need upsert with increments. Since BigInt, we can do:
```
await client.companyFinancialTotal.upsert({
 where: { companyId },
 update: { pendingCents: { increment: pendingDelta }, ... },
 create: { companyId, pendingCents: pendingDelta, ... }
});
```
But if deltas negative, `increment` can be negative BigInt. For old status null, no decrement. For status same, no.
Compute delta map:
```
function statusDeltas(old, new, amount) { pending=0n; if new===PENDING pending += amount; if old && old!==new && old===PENDING pending -= amount; ... }
```
Need net: can store `netCents = approvedCents - refundedCents`. With increments: net delta = new approved? amount : 0 - old approved? amount : 0 - new refunded? amount? Wait net = approved - refunded. If transition to approved: net += amount; from approved: net -= amount; to refunded: net -= amount; from refunded: net += amount. Rejected/pending no. Or compute `netCents` as column updated by same delta. Or don't store net, compute in query `approvedCents - refundedCents`. To reduce maintenance, store pending/approved/rejected/refunded only; service computes net. But "financial totals per company" may want net. We can include `netCents` stored for exact. But can compute exact from stored. For p95, one row. We'll store net too and update delta.

But if using Prisma upsert with `increment` for BigInt, create cannot use increment; create sets absolute delta (which may negative? Should not be negative for initial? Could be if drift repair creates? For normal create, deltas non-negative for new status, zero for others. For status change, if row exists, increments can be negative. If row missing and concurrent? upsert create with negative could happen if row not created but a status change? Should not if create hook creates row. But drift repair may rebuild. For safety, upsert create values should be deltas; if delta negative and row missing, could create negative, but shouldn't. Better use raw SQL `INSERT ... ON CONFLICT DO UPDATE` to apply deltas even if negative and create zeros. But repository raw? Let's consider.

Using Prisma upsert with `update: { increment }` and `create: { pendingCents: pendingDelta ... }`. If two concurrent creates for same company: first inserts, second? Prisma upsert is not guaranteed to handle race? In PostgreSQL, upsert uses `ON CONFLICT DO UPDATE` under the hood? I think Prisma implements upsert as raw? Actually for unique constraints, Prisma upsert in interactive? It may do update then create? If concurrent, one may get P2002 unique violation. To be robust, use raw SQL with `ON CONFLICT` for totals. Since repository allowed raw? It says repository is only layer that touches the database. It doesn't forbid raw SQL in repository. It says service zero raw SQL. We can use raw SQL in repository for exact atomic upsert. That also avoids Prisma BigInt increment uncertainty. But Prisma as ORM? We can still use Prisma for most. Use `$executeRaw` in repository for totals delta and maybe projection updates. But tests? Raw SQL easier for concurrency exact.

Need consider layers: repository can use Prisma client and raw. Good.

`FinancialTotalsRepository.applyStatusDelta` raw:
```
await client.$executeRaw`
  INSERT INTO company_financial_totals (company_id, pending_cents, approved_cents, rejected_cents, refunded_cents, net_cents, updated_at, version)
  VALUES (${companyId}, ${pendingDelta}, ${approvedDelta}, ${rejectedDelta}, ${refundedDelta}, ${netDelta}, now(), 1)
  ON CONFLICT (company_id) DO UPDATE SET
    pending_cents = pending_cents + EXCLUDED.pending_cents,
    ...
    version = company_financial_totals.version + 1,
    updated_at = now();
`;
```
But `$executeRaw` with BigInt? Prisma raw parameters need supported types. BigInt? Template literal tag may not support BigInt? It might. Safer use `$executeRawUnsafe` with placeholders? But injection risk if values are strings? companyId uuid string. Deltas bigint as string? SQL numeric. Could use `BigInt` maybe not supported. Prisma raw supports `number`, `string`, `Date`, `boolean`, `null`, etc. BigInt maybe not. We can convert deltas to `BigInt`? If not, use `Number` if small? But exact large. Could use `String(delta)` and SQL cast? `VALUES (${String(pendingDelta)}::bigint)`. Raw unsafe with numbers as strings okay because numeric literal; but if using template, injection? Since values are numeric strings generated from BigInt, safe if only digits/sign. Could implement `sqlNumeric(value: bigint)` returning string. But `$executeRawUnsafe` uses ? placeholders, can pass number but not BigInt. If pass `Number(delta)`, may overflow. Could use `$executeRaw` with `Prisma.sql` fragments and cast? Hmm.

Alternative use Prisma update/increment with BigInt, likely supports. Let's verify mentally: Prisma field `BigInt` update operations: `BigintFieldUpdateOperationsInput { set?: BigInt; increment?: BigInt; decrement?: BigInt; multiply?: BigInt; divide?: BigInt; }`. Yes likely. For upsert, `update` can use increments. For create, set to deltas (bigint). If concurrent upsert unique violation, could retry? In same transaction, if row missing, create. If race with another create, one fails. But normal flow create order creates totals row? `applyStatusDelta` on order create upsert. Multiple concurrent order creates for same company: both upsert; if both see no row, one inserts, other unique violation. Prisma upsert may handle by reattempt? Not sure. To ensure, we can use raw `INSERT ... ON CONFLICT` with parameters. Need support BigInt.

Could store totals as `Decimal` and use Prisma `increment` with Decimal, which likely supports concurrency. Decimal can be large exact. Use `@db.Decimal(38, 0)` cents. Prisma Decimal supports `increment`? For Decimal fields, update operations include `increment?: Prisma.Decimal | number`? I think yes. It is atomic in DB? Prisma translates to `SET pending_cents = pending_cents + (increment)`? Actually for update with increment, it does arithmetic in SQL, atomic. Upsert race? Prisma upsert maybe still. But row exists after first create. If missing and concurrent create, could race. We can ensure totals row created when company created? But companies may not have orders; we can pre-create total row on company creation. But company creation maybe not simulated. Could upsert. Or use raw ON CONFLICT.

Maybe use `Decimal` and raw ON CONFLICT with numeric string? Decimal exact. But JSON serialization of Prisma.Decimal okay (string). Tests can use `new Prisma.Decimal('100')`. However p95? Fine.

But cents as Decimal(38,0) avoids BigInt JSON issues. Use `Decimal` for totals and amounts? Payment order amount could be Int cents. Totals Decimal. But delta from Int to Decimal. In raw, pass numbers maybe safe for Int amount but totals can exceed. For update increment with Decimal, Prisma supports. Let's use Decimal for totals columns. In schema:
```
pendingCents Decimal @default(0) @map("pending_cents") @db.Decimal(38, 0)
```
Migration: `DECIMAL(38,0) DEFAULT 0`.
For `amountCents` in order/projection use `Int`? 3M orders * 10_000_000 cents? Total may exceed 2^53? Decimal. Order amount Int enough for single order (<2^31 cents = $21M) maybe okay. Could use `Decimal(18,0)` for amount to be safe. But arithmetic and JSON? Use `Decimal(18,0)`. Projection amount Decimal. Dashboard returns string cents. For filters? no. Use Decimal for money everywhere to avoid overflow. But index? amount not indexed.

Prisma Decimal in TypeScript: `Prisma.Decimal`. Need import. For input DTO, amountCents as string? Use string to avoid float. Controller DTO `amountCents: string` then service converts to `Prisma.Decimal`? Or `number`? Exact, use string. But class-validator `IsString`. We can define `amountCents: string`. Service `new Prisma.Decimal(input.amountCents)`.

Prisma update increment for Decimal with `new Prisma.Decimal(...)` should work. Upsert race still. We can use raw ON CONFLICT with Decimal? Maybe pass `Prisma.sql`? Let's see raw tag supports `Prisma.sql` and values: number, string, Date, boolean, null, object? Decimal may not be recognized. But we can use `String(decimal.toFixed(0))` with cast. For exact, decimal has no scale. Use `$executeRawUnsafe` with `?` and pass strings. But unsafe can inject if string not numeric. We can sanitize numeric string. For company_id uuid string. Values are controlled by code. Could be okay. But `executeRawUnsafe` doesn't quote, we include cast. Example:
```
await client.$executeRawUnsafe(
 `INSERT ... VALUES (${companyId}, ${sqlInt(pendingDelta)}, ... ) ON CONFLICT ...`,
 // no params? unsafe requires params? Actually $executeRawUnsafe(query, ...values)
)
```
If no values, just string. But companyId from input; need ensure no injection. Use template `$executeRaw` with `Prisma.sql`? For string, use `${companyId}` as value. For numeric decimal, maybe use `${sqlDecimal(delta)}` where sqlDecimal returns `Prisma.sql`${delta.toFixed(0)}::numeric``? But raw composition. Could be:
```
const pending = Prisma.sql`${delta.toFixed(0)}::decimal(38,0)`;
await client.$executeRaw(
 Prisma.sql`INSERT ... VALUES (${companyId}, ${pending}, ...) ON CONFLICT ...`
)
```
Does `Prisma.sql` accept nested SQL? yes. But `delta.toFixed(0)` inside backticks is a string, not value; it's safe if decimal from code. But if user input malicious decimal? `Prisma.Decimal` `toFixed` returns digits. Could still if Decimal is Infinity? We validate positive finite. Good. But using `Prisma.sql` with string interpolation is raw but controlled. Acceptable in repository? maybe.

But maybe overkill. Use Prisma's `upsert` with Decimal increments and assume race handled? Let's research from memory: Prisma upsert on PostgreSQL: for unique constraint, it first tries `UPDATE` then if affected rows = 0, tries `INSERT`; if unique violation, retries? In Prisma 4.16? It uses raw upsert? I think it uses `INSERT ... ON CONFLICT` in many cases? Not certain. For concurrency, ON CONFLICT best.

We can implement totals delta using raw ON CONFLICT. Projection update can use Prisma `upsert` with set absolute values. For concurrent updates to same projection row? Status change uses unique operationId; if two updates same order concurrent, source status guard updateMany ensures one. Projection update can be `upsert` set. For worker name update, raw update.

Re-derivation and drift repair need raw SQL for efficient batch and exact rebuild.

Let's design read model maintenance:
`ReadModelRepository` methods:
- `upsertOrderProjection(order: OrderProjectionInput, client = prisma)`:
```
await client.operationReadModel.upsert({
 where: { operationId: order.operationId },
 update: { companyId: order.companyId, workerId: order.workerId, workerName: order.workerName, status: order.status, amountCents: order.amountCents, currency: order.currency, lastEventType: order.lastEventType, occurredAt: order.occurredAt, updatedAt: new Date() },
 create: { ... }
});
```
But for status change, upsert set absolute status. If row missing (drift), creates. For concurrent updates to same row, upsert update set may lose updates if two different status changes? But source guard ensures only one status transition for order. Worker name update concurrent with status update: worker name update sets workerName, status update sets workerName from old worker? Could race. Need avoid overwriting worker name. Status update projection should not set workerName? If worker name changed concurrently, status update could restore stale workerName. To avoid, projection status update should update only status/amount/lastEvent/occurredAt, not workerName/workerId? But on create set workerName. For status change, don't touch worker fields. Good. For re-derive set all. For worker name update, update workerName where workerId and maybe worker_id null? If worker id changed? Worker update maybe name only; if worker company changes? Could require rederive. We'll support name only.

`applyStatusChangeProjection(orderId, newStatus, occurredAt, lastEventType)`: `updateMany` where operationId; if none upsert create with minimal? Need amount/company? For create, upsertOrderProjection. For status change after create, update. If row missing due to drift, maybe upsert create from source? Could call rederive for order? Simpler: status change `upsert` with update status, create using source data. Need create require amount, company, worker. We have existing order. We'll pass full projection but update only fields? Prisma upsert `update` can omit workerName, `create` includes. Good.

But if row exists and update uses set status, if occurredAt etc.

`applyWorkerName(workerId, workerName)`: raw `UPDATE operation_read_model SET worker_name = ?, updated_at=now() WHERE worker_id = ?` But if workerId null? No. If worker name changed, all operations. Need index worker_id. Could also if workerId changed (assignment) not support.

`applyStatusDelta` as raw ON CONFLICT.

Need `OrderProjectionInput` type.

`FinancialTotalsRepository` maybe separate:
- `getForCompany(companyId)` returns CompanyFinancialTotal or null.
- `applyStatusDelta(companyId, oldStatus, newStatus, amount)` raw.
- `rebuildForWindow(from,to)`? Could be in drift repair.

But read-your-own-writes totals: apply delta in same transaction.

Dashboard query:
`OperationsRepository.list(params)`:
Use Prisma findMany on `operationReadModel`:
```
where: {
  companyId: params.companyId,
  ...(params.status ? { status: params.status } : {}),
  occurredAt: { gte: params.from, ...(params.to ? { lte: params.to } : {}) },
  ...(cursor ? { OR: [ { occurredAt: { lt: cursor.occurredAt } }, { occurredAt: cursor.occurredAt, operationId: { lt: cursor.id } } ] } : {})
},
orderBy: [{ occurredAt: 'desc' }, { operationId: 'desc' }],
take: limit + 1
```
Need keyset cursor with status? For stable pagination with status filter, using occurredAt and id works. But index includes status; where status filter and OR for cursor. Cursor condition with same occurredAt and operationId less. Since status filter same page, okay.
Need ensure index matches. For status present: index (company_id, status, occurred_at DESC, operation_id DESC). For status absent: index (company_id, occurred_at DESC, operation_id DESC). Cursor OR may cause index scan. Good.
Return items slice 0 limit, nextCursor if extra. Map to DTO with strings.

`FinancialTotalsRepository.getForCompany` returns exact.
`OperationsService.list`: validate company exists? Controller? Service can fetch totals; if no totals, zeros. Return.

Re-derivation routine for arbitrary date window:
`BackfillService` / `DriftRepairService` with methods:
- `rederiveWindow(from, to, companyId?)`: Rebuild operation projection and totals for window. Need idempotent and exact.

How to implement efficiently and exactly:
Option 1: Use staging tables.
- Create temporary/staging tables `operation_read_model_staging`, `company_financial_totals_staging` in migration? Or use `CREATE TEMPORARY TABLE` in transaction? Repository can raw. For window, delete from projection rows where occurred_at in window, then insert selected from source. But totals rebuild for companies affected.
Need arbitrary date window by `occurred_at`? Since projection occurredAt is last event/updated. Re-derive should correct rows whose recency in window.
SQL:
```
DELETE FROM operation_read_model WHERE occurred_at >= ${from} AND occurred_at < ${to};
INSERT INTO operation_read_model (...)
SELECT po.id, po.company_id, po.worker_id, w.name, po.status, po.amount_cents, po.currency,
  (SELECT oee.type FROM order_events oee WHERE oee.order_id = po.id ORDER BY oee.occurred_at DESC, oee.id DESC LIMIT 1),
  COALESCE((SELECT MAX(oee.occurred_at) ...), po.created_at),
  now(), now()
FROM payment_orders po LEFT JOIN workers w ON w.id = po.worker_id
WHERE COALESCE((SELECT MAX...), po.created_at) >= from AND < to;
```
But subquery per order expensive. For 3M, but backfill not p95. Could be okay with indexes. Better: compute latest event per order in window? Use CTE `latest_events` from order_events where occurred_at between from/to? But if latest event before window, row not in window. For rederive window of projection occurredAt, we need orders whose projection occurredAt in window. That is `COALESCE(max_event, created_at)`. Could select orders where updated_at? Since source `payment_orders.updated_at` maintained with status changes and events? We can set projection occurredAt = payment_orders.updated_at, not event. Then rederive window uses `payment_orders.updated_at between`. Simpler and efficient. But variant mentions events; we can still store lastEventType from latest event but occurredAt = order.updated_at. Recency = updated_at. "sorted by recency" likely order updated. Let's define projection `occurred_at` as `payment_orders.updated_at`, source of truth. Event `last_event_type` from latest event but not used for sort. Maintenance sets occurredAt to order.updatedAt. Then rederive window on `payment_orders.updated_at`. Good.

Re-derive totals for window: financial totals are global per company, not windowed. If we rebuild totals for a window, how to exact? We can't just sum window; totals are all-time. For drift repair, need recompute totals from all source orders for affected companies, not just window, unless we store delta? If re-derive window only corrects projection rows; totals should be recomputed for companies affected by the window (or all companies) from entire source to be exact. Requirement: financial totals per company exact. Drift repair should repair totals exactly. We can have `rebuildCompanyTotals(companyIds)` sum all orders by status. For rederive window, after rebuilding projection rows, collect affected company ids and rebuild totals for those companies exactly. That is safe but can be heavy. For arbitrary date window, affected companies can be many; but drift repair scheduled maybe windows. Could also rebuild all totals for a company if any drift. Exact not approximate.

Drift repair job: scheduled; detects drift by comparing projection and source? Need efficient. For 3M, full compare expensive. Could periodically rebuild small windows and totals. Task: scheduled drift-repair job; tests for drift repair. We can implement `DriftRepairService.runSince(lag = e.g. 24h)` that repairs a recent window: re-derives projection rows for orders updated in window and rebuilds totals for affected companies. Also maybe full repair command. Scheduled job via `@nestjs/schedule`? Need add dependency `@nestjs/schedule`. Or use `Cron`? Could implement a `DriftRepairJob` processor with `@Cron` from `@nestjs/schedule`. Need module. Add to package.json. But Nest schedule requires `ScheduleModule.forRoot()`.

Alternatively use Node `setInterval` in module? Better `@nestjs/schedule`.

Scheduled drift-repair job: `DriftRepairJob` with `@Cron('0 * * * *')` calls `driftRepairService.repairWindow(now - 24h, now)`. But tests need call service.

Need detect actual drift? Could just periodically rebuild last window. But "drift-repair" implies corrects drift. We can implement detection: compare counts/checksums for companies? Use exact aggregate: source sum by company/status vs totals table. For a window, compute expected totals from source for companies whose rows updated in window and compare to stored; if mismatch, rebuild. But even if no mismatch, projection rows may drift (status/name). We can rederive projection for window unconditionally. That repairs drift. For totals, after rederive, rebuild affected companies exactly. Good.

Need re-derivation routine for arbitrary date window exposed as service maybe `BackfillService.rederiveWindow(from, to, companyId?)`.

Implementation of rederive in repository using raw SQL. Need stage? We can do delete+insert in one transaction. But if window large, transaction huge; okay. To make safe, use staging and swap? Delete/insert. Need ensure no readers see missing? In transaction, readers may see old until commit. Fine.

SQL for rederive projection:
```
DELETE FROM operation_read_model o
WHERE o.occurred_at >= ${from} AND o.occurred_at < ${to}
  AND (?::uuid IS NULL OR o.company_id = ?)
;
INSERT INTO operation_read_model (operation_id, company_id, worker_id, worker_name, status, amount_cents, currency, last_event_type, occurred_at, created_at, updated_at)
SELECT po.id, po.company_id, po.worker_id, w.name, po.status::text? , po.amount_cents, po.currency,
  (SELECT oe.type FROM order_events oe WHERE oe.order_id = po.id ORDER BY oe.occurred_at DESC, oe.id DESC LIMIT 1),
  po.updated_at,
  now(), now()
FROM payment_orders po
LEFT JOIN workers w ON w.id = po.worker_id
WHERE po.updated_at >= ${from} AND po.updated_at < ${to}
  AND (?::uuid IS NULL OR po.company_id = ?)
  AND NOT EXISTS? To avoid duplicate? INSERT ... ON CONFLICT (operation_id) DO UPDATE SET ...
```
Use `ON CONFLICT DO UPDATE` to be idempotent even if delete didn't cover? Since operation unique, if row with occurredAt outside window but order updated? Delete condition by projection occurredAt; insert source updated window. If projection occurredAt stale, may not delete. Better delete by operation_id for selected source rows before insert: `DELETE FROM operation_read_model WHERE operation_id IN (SELECT id FROM payment_orders WHERE updated_at in window ...)`. Then insert. That ensures row replaced with new occurredAt. For large window, CTE.
```
WITH affected AS (
  SELECT id FROM payment_orders WHERE updated_at >= from AND updated_at < to AND company filter
)
DELETE FROM operation_read_model o USING affected a WHERE o.operation_id = a.id;
INSERT ... SELECT ... FROM payment_orders po ... WHERE po.id IN (SELECT id FROM affected)
ON CONFLICT (operation_id) DO UPDATE SET ...
```
But CTE with DELETE and INSERT? Postgres CTE shared? We can use `CREATE TEMP TABLE affected ON COMMIT DROP AS SELECT ...;` then delete/insert. In transaction. Or use `DELETE ... WHERE operation_id IN (subquery)` and `INSERT ... WHERE id IN (subquery)`. Fine.

Need `last_event_type`: latest event. For 3M, correlated subquery maybe okay for backfill. Could use LATERAL:
```
SELECT po.*, w.name, le.type FROM payment_orders po LEFT JOIN workers w ... LEFT JOIN LATERAL (SELECT type FROM order_events WHERE order_id=po.id ORDER BY occurred_at DESC, id DESC LIMIT 1) le ON true
```
Good.

Totals rebuild:
```
DELETE FROM company_financial_totals WHERE company_id IN (SELECT DISTINCT company_id FROM payment_orders WHERE updated_at in window OR company_id in affected projection companies)
INSERT INTO company_financial_totals (company_id, pending_cents, approved_cents, rejected_cents, refunded_cents, net_cents)
SELECT company_id,
 COALESCE(SUM(amount_cents) FILTER (WHERE status='PENDING'), 0), ...
 FROM payment_orders
 WHERE company_id IN (SELECT DISTINCT company_id FROM affected orders)
 GROUP BY company_id;
```
Need status enum in SQL: values uppercase matching enum type. In migration enum type `OrderStatus` with values `'PENDING'` etc. In Prisma schema enum values uppercase. Source status stored as `OrderStatus`. SQL cast? `status` is `OrderStatus`. Filter `status = 'PENDING'`.

If using Decimal cents, SUM(amount_cents) returns numeric.

Need `rebuildCompanyTotals(companyIds)`.

Drift repair detection: Could select companies with mismatch between totals and source for recent window:
```
SELECT t.company_id
FROM company_financial_totals t
WHERE t.company_id IN (affected)
AND (
  t.pending_cents <> COALESCE((SELECT SUM(amount_cents) FILTER (WHERE status='PENDING') FROM payment_orders WHERE company_id=t.company_id),0)
  OR ...
)
```
Then rebuild those. But we can just rebuild affected. For test drift: manually update totals table or projection to wrong; call repair; assert corrected.

Scheduled job: `@Cron(CronExpression.EVERY_HOUR)` or interval. Need environment for cron? `DRIFT_REPAIR_CRON`? Config from env. Use `@nestjs/schedule`. In job:
```
@Cron(process.env.DRIFT_REPAIR_CRON ?? '0 * * * *', { name: 'drift-repair' })
```
But decorator needs expression at class definition; process.env may be undefined in tests? Could use `@Cron(CronExpression.EVERY_HOUR)` and service uses env for window. Simpler.

Need module for backfill: `DriftRepairModule` with job. Could include in AppModule.

Now write services "simulate the write path". We can have controllers/services for payment orders and workers.

Potential issue: NestJS + Prisma + ESM imports with `.js`. Need all local imports extension. For class-validator, need `@IsString`, etc.

Need custom exceptions and filter.

Let's define common files:
- `src/common/errors/app-exception.ts`:
```
export class AppException extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode: number = 500, public readonly details: Record<string, unknown> = {}) { super(message); }
}
```
But HttpException? We can create specific classes: `ResourceNotFoundException`, `ValidationException`, `ConflictException` maybe with codes. Or one `AppException`.
- `src/common/exceptions-filter.ts`: ExceptionFilter mapping AppException and Prisma known errors to envelope.
Prisma errors: import { Prisma } from '@prisma/client'. Map P2002 unique violation to conflict? P2025 not found to resource_not_found. Validation? For unknown, 500. Need one envelope.
Filter:
```
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
 catch(exception, host) {
  const ctx = host.switchToHttp(); res = ctx.getResponse();
  let status=500, code='internal_error', message='Internal error', details={};
  if (exception instanceof AppException) ...
  else if (exception instanceof HttpException) ...
  else if (exception instanceof Prisma.PrismaClientKnownRequestError) ...
  else ...
  res.status(status).json({ error: { code, message, details } });
 }
}
```
Need import `Prisma` in common? okay.

Custom AppException classes:
```
export class ResourceNotFoundException extends AppException { constructor(message='Resource not found', details={}) { super('resource_not_found', message, 404, details); } }
export class ConflictException extends AppException { constructor(message='Conflict', details={}) { super('conflict', message, 409, details); } }
export class ValidationException extends AppException { constructor(message='Validation failed', details={}) { super('validation_error', message, 422, details); } }
```
Need maybe `StaleStatusException` code `status_stale` 409.

But controllers throw? Service throws. Filter maps.

Need DTOs:
- `CreatePaymentOrderDto`: companyId string uuid, workerId? string uuid, amountCents string, currency? string default USD.
- `ChangeStatusDto`: status string enum.
- `UpdateWorkerDto`: name string.
- `QueryOperationsDto`: companyId required, status? enum, from? ISO date, to? ISO date, cursor? string, limit? number default 20 max 100.
Need parse dates. Cursor encode: base64 of `occurredAtISO|operationId`. Service decodes. Use `@IsString`. Validate.

Controllers zero business logic; just parse and call service. They can validate via pipes.

Services:
`PaymentOrderService`:
```
async createOrder(dto) {
 const input = { companyId: dto.companyId, workerId: dto.workerId ?? null, amountCents: new Prisma.Decimal(dto.amountCents), currency: dto.currency ?? 'USD' };
 const order = await this.paymentOrderRepository.createWithReadModel(input);
 return this.toDto(order);
}
async changeStatus(id, status) {
 const current = await this.paymentOrderRepository.findById(id);
 if (!current) throw ResourceNotFound;
 if (!this.isAllowed(current.status, status)) throw ValidationException or Conflict?
 return await this.paymentOrderRepository.changeStatusIfCurrent(id, current.status, status);
}
```
Need status from DTO string to enum. Use helper `parseStatus`.

`PaymentOrderRepository`:
- `createWithReadModel(input)` transaction.
- `changeStatusIfCurrent(orderId, expectedStatus, newStatus)` transaction.
- `findById(id)` include worker? For DTO.
Need create event `ORDER_CREATED`; status event `ORDER_APPROVED` etc.

Need ensure `payment_orders.updated_at` updates. Prisma `@updatedAt` automatically updates on update. In transaction, `tx.paymentOrder.update` will set updated_at. For projection occurredAt, use `new Date()`? If we need consistent with DB now, use `new Date()`. Source updatedAt set by Prisma maybe. After update, get updated order to use updatedAt. In transaction:
```
const updated = await tx.paymentOrder.update({ where: { id: orderId, ...? }, data: { status: newStatus, version: { increment: 1 } }, include: { worker: true } });
const event = await tx.orderEvent.create({ data: { orderId: updated.id, type: `ORDER_${newStatus}` } });
await readModel.applyStatusChangeProjection(updated.id, newStatus, updated.updatedAt, event.type, updated.amountCents, updated.currency, updated.companyId, updated.workerId, workerName? no)
await totals.applyStatusDelta(updated.companyId, expectedStatus, newStatus, updated.amountCents)
return updated
```
But need atomic status claim. We can use `tx.paymentOrder.updateMany({ where: { id: orderId, status: expectedStatus }, data: { status: newStatus, version: { increment: 1 } } })`. If count 0 throw Stale. Then fetch updated `findUnique` to get updated_at/worker. But updateMany won't return updated_at? We can then findUnique. `updated_at` may be set. Good.
Need if expectedStatus equals newStatus? no-op.

For create: after order create, `updated` has `updatedAt`. event create. readModel upsert full. totals apply delta null -> PENDING.

But if worker name changes after create, projection workerName updated separately.

`WorkerService` updateName:
```
const worker = await workerRepository.updateWithReadModel(id, { name });
```
Need source worker name update and projection update in same transaction.
`WorkerRepository.updateWithReadModel` transaction:
```
const worker = await tx.worker.update({ where: { id }, data: { name } }); // if not found throw
await readModel.applyWorkerName(worker.id, worker.name, tx)
return worker;
```
If worker has orders with worker_id; projection update raw.

Need `WorkerRepository.findById` maybe.

ReadModelRepository details:
- `upsertOrderProjection(order: ProjectionInput, client)`:
```
await client.operationReadModel.upsert({
 where: { operationId: order.operationId },
 update: {
   companyId: order.companyId,
   workerId: order.workerId,
   workerName: order.workerName,
   status: order.status,
   amountCents: order.amountCents,
   currency: order.currency,
   lastEventType: order.lastEventType,
   occurredAt: order.occurredAt,
   updatedAt: new Date()
 },
 create: { ... order, updatedAt: new Date() }
});
```
Use Decimal amount.

- `applyStatusChangeProjection(order: { id, status, occurredAt, lastEventType, amountCents, currency, companyId, workerId? })`:
```
const result = await client.operationReadModel.updateMany({ where: { operationId: order.id }, data: { status: order.status, amountCents: order.amountCents, currency: order.currency, lastEventType: order.lastEventType, occurredAt: order.occurredAt, updatedAt: new Date() } });
if (result.count === 0) {
 await client.operationReadModel.create({ data: { ... order, workerId: order.workerId, workerName: null, createdAt: new Date() } });
}
```
But if row missing, create with workerName null, maybe drift. Could include workerName? We have worker? To avoid, create full with worker name? For status change, we can include worker? In transaction, we can fetch worker? We have `worker` relation? In `changeStatusIfCurrent`, after update, `findUnique({ include: { worker: true } })`. Then pass workerName for create fallback. But update doesn't set workerName. Create fallback includes workerName.
Need `updateMany` data cannot include operationId. Fine.
Concurrent status and worker name: status update doesn't set workerName; worker name update doesn't set status. Good.
But `updateMany` with status may be overwritten by another status? Source guard prevents.

- `applyWorkerName(workerId, workerName, client)`:
```
await client.$executeRaw`UPDATE operation_read_model SET worker_name = ${workerName}, updated_at = now() WHERE worker_id = ${workerId}`;
```
If workerId null? no.

- `applyStatusDelta(companyId, oldStatus, newStatus, amount, client)`: raw ON CONFLICT with Decimal. Need generate SQL with numeric strings. Since amount Decimal, deltas Decimal. Use helper `decimalToSql(decimal)` returns `Prisma.sql`${decimal.toFixed(0)}::numeric``. But `Prisma.sql` tag can't interpolate a `Prisma.sql`? It can. Example:
```
const pending = Prisma.sql`${deltas.pending.toFixed(0)}::numeric`;
await client.$executeRaw(
  Prisma.sql`INSERT INTO company_financial_totals (company_id, pending_cents, approved_cents, rejected_cents, refunded_cents, net_cents, updated_at, version)
  VALUES (${companyId}, ${pending}, ${approved}, ${rejected}, ${refunded}, ${net}, now(), 1)
  ON CONFLICT (company_id) DO UPDATE SET
   pending_cents = company_financial_totals.pending_cents + ${pending}
   ...`
);
```
But in ON CONFLICT, `${pending}` is a SQL fragment representing a literal, can be used. Good.
Need ensure `Prisma.sql` with nested sql is allowed. Yes.
But `companyId` is string parameter, safe.
Potential problem: `Prisma.sql` nested with `::numeric` and `ON CONFLICT DO UPDATE SET pending_cents = company_financial_totals.pending_cents + ${pending}` will render literal each time. Good.
Need `version = version + 1`. `updated_at = now()`.

Alternatively use Prisma's `$queryRaw` for insert? okay.

Need types for client: `PrismaService | Prisma.TransactionClient`. In methods, default `this.prisma`. But if called with tx, use. For raw `$executeRaw`, both support. For model delegates, `Prisma.TransactionClient` supports.

But `PrismaService` extends PrismaClient. `Prisma.TransactionClient` type is an interface. We can define:
```
type DbClient = PrismaService | Prisma.TransactionClient;
```
But TypeScript strict: `Prisma.TransactionClient` includes all model delegates and `$executeRaw`? yes. `PrismaService` includes. Good.

Need be careful: In Prisma v5, `Prisma.TransactionClient` is a type, not value. Import `Prisma` from '@prisma/client'.

Now DDL migration. Need create enum, tables, indexes. Since Prisma schema includes relations, migration SQL must match. Let's write carefully.

Enum:
```
CREATE TYPE "OrderStatus" AS ENUM ('PENDING','APPROVED','REJECTED','REFUNDED');
```
Companies:
```
CREATE TABLE "companies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL,
  PRIMARY KEY ("id")
);
```
Workers:
```
CREATE TABLE "workers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "workers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workers_email_key" UNIQUE ("email"),
  CONSTRAINT "workers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "workers_company_id_idx" ON "workers"("company_id");
```
PaymentOrders:
```
CREATE TABLE "payment_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "worker_id" UUID,
  "amount_cents" DECIMAL(18,0) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "payment_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_orders_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "payment_orders_company_id_status_updated_at_idx" ON "payment_orders"("company_id","status","updated_at");
CREATE INDEX "payment_orders_updated_at_idx" ON "payment_orders"("updated_at");
CREATE INDEX "payment_orders_worker_id_idx" ON "payment_orders"("worker_id");
```
OrderEvents:
```
CREATE TABLE "order_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB,
  "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "order_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "order_events_order_id_occurred_at_idx" ON "order_events"("order_id","occurred_at" DESC);
CREATE INDEX "order_events_occurred_at_idx" ON "order_events"("occurred_at");
```
OperationReadModel:
```
CREATE TABLE "operation_read_model" (
  "operation_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "worker_id" UUID,
  "worker_name" TEXT,
  "status" "OrderStatus" NOT NULL,
  "amount_cents" DECIMAL(18,0) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "last_event_type" TEXT,
  "occurred_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "operation_read_model_pkey" PRIMARY KEY ("operation_id")
);
CREATE INDEX "operation_read_model_company_status_occurred_idx" ON "operation_read_model"("company_id","status","occurred_at" DESC, "operation_id" DESC);
CREATE INDEX "operation_read_model_company_occurred_idx" ON "operation_read_model"("company_id","occurred_at" DESC, "operation_id" DESC);
CREATE INDEX "operation_read_model_worker_id_idx" ON "operation_read_model"("worker_id");
CREATE INDEX "operation_read_model_occurred_at_idx" ON "operation_read_model"("occurred_at");
```
CompanyFinancialTotal:
```
CREATE TABLE "company_financial_totals" (
  "company_id" UUID NOT NULL,
  "pending_cents" DECIMAL(38,0) NOT NULL DEFAULT 0,
  "approved_cents" DECIMAL(38,0) NOT NULL DEFAULT 0,
  "rejected_cents" DECIMAL(38,0) NOT NULL DEFAULT 0,
  "refunded_cents" DECIMAL(38,0) NOT NULL DEFAULT 0,
  "net_cents" DECIMAL(38,0) NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "company_financial_totals_pkey" PRIMARY KEY ("company_id")
);
```
Need `updated_at` default now? In migration can default now.

Prisma schema must match. For `OperationReadModel`, no FK, fields. For `CompanyFinancialTotal`, no relation? Could add company relation? If add, need migration FK. For performance maybe no FK. But Prisma can have no relation. If no FK, schema field `companyId` only. For source Company has `totals CompanyFinancialTotal?`? If no relation in totals, can't. We can omit relation. But schema Company may have `orders` and `workers`; no totals. That's okay. CompanyFinancialTotal standalone. Migration no FK.

Need `PaymentOrder.amountCents Decimal @db.Decimal(18,0)`. Prisma `Decimal` in migration. `OperationReadModel.amountCents Decimal @default(0)`? Prisma Decimal default must be `@default(0)`? I think yes. For `Decimal` with `@db.Decimal(18,0)`, default 0. `currency String @default("USD")`. `status OrderStatus @default(PENDING)`.

`lastEventType String?`.
`workerName String?`.
`operationId String @id @default(uuid()) @db.Uuid`? But operationId is same as order id; Prisma default not used when set. It can be `@id`. In migration PK. But if `@default(uuid())`, create fallback? We always set. Could omit default? Prisma requires id can be no default? It can be `String @id @db.Uuid` without default? In Prisma, id can be without default if required? I think yes? For client, create must provide. Better `@default(uuid())` but then conflict with order id? We set. In migration, DEFAULT gen_random_uuid. Fine.

But `OperationReadModel` `updatedAt DateTime @default(now()) @map("updated_at")`.
`createdAt DateTime @default(now())`.

`CompanyFinancialTotal.companyId String @id @map("company_id") @db.Uuid`.
`pendingCents Decimal @default(0) @map("pending_cents") @db.Decimal(38,0)`.
...
`updatedAt DateTime @default(now()) @map("updated_at")`.

Need `OrderEvent.payload Json?` Prisma Json. Migration JSONB.

Need `Worker.email @unique`.
Need `Company.name`.

Potential issue: Prisma `@default(0)` for Decimal? It accepts. For `@db.Decimal(38,0)`, default 0. Good.

Now raw SQL for totals with Decimal. Need use `numeric(38,0)`. Since column type decimal(38,0). Deltas from Decimal. `decimal.toFixed(0)` might produce scientific? For integer, no. For large > 2^53, toFixed works. For negative, `-123`. Good.

Need `Prisma.sql` nested. But in TypeScript, `Prisma.sql` tag with nested `Prisma.sql` returns `Sql`. However `client.$executeRaw(Prisma.sql`...`)` returns number. In transaction client, ok.

`applyStatusDelta` code:
```
private statusDelta(old: OrderStatus | null, next: OrderStatus, amount: Decimal): StatusDeltas {
 const pending = new Decimal(0); ...
 const set = (s: OrderStatus | null) => (s === next ? amount : Decimal(0));
 const clear = (s: OrderStatus | null) => (s === old ? amount : Decimal(0));
 if (old === next) return zeros;
 pending = Decimal(0);
 if (next === OrderStatus.PENDING) pending = pending.plus(amount);
 if (old === OrderStatus.PENDING) pending = pending.minus(amount);
 ...
 net: if next APPROVED plus, if old APPROVED minus, if next REFUNDED minus, if old REFUNDED plus.
}
```
Need import Decimal from `@prisma/client/runtime/library`? Prisma exports `Decimal`? In v5, `Prisma.Decimal` exists. Use `import { Prisma } from '@prisma/client'; const Decimal = Prisma.Decimal;`. But static typing? `Prisma.Decimal` is a constructor. We can `type Decimal = Prisma.Decimal`. For new: `new Prisma.Decimal(value)`.
But `Prisma.Decimal` might not be typed in generated client before generate? In code, assume. Need no import from `@prisma/client/runtime/library` because generated? The `Prisma` namespace includes Decimal. We'll use `Prisma.Decimal`.

For amounts in DTO: `new Prisma.Decimal(dto.amountCents)`; if invalid throws.

Need `Decimal` serialization in DTO: `amountCents: amount.toFixed(0)`.

Now drift repair and backfill implementation.

`BackfillService` (or `ReadModelBackfillService`) methods:
- `rederiveWindow(from: Date, to: Date, companyId?: string)`: calls `readModelRepository.rederiveWindow(from,to,companyId)` transaction. Returns `{ operations: number, companies: number }`? Repository raw returns affected rows.
- `repairWindow(from,to,companyId?)`: calls rederive + rebuild totals for affected companies. Could be same. Drift repair uses `repairWindow`.

`ReadModelRepository.rederiveWindow`:
Use `prisma.$transaction(async tx => { ... })`.
Need collect affected company ids before delete? We can use raw SQL to get distinct company ids from payment_orders updated in window (and optional company). Then delete+insert projection, rebuild totals for those companies.
Return counts.

SQL steps in transaction:
1. Select affected company ids:
```
const affectedCompanies = await tx.$queryRaw<Array<{ company_id: string }>>`
 SELECT DISTINCT company_id FROM payment_orders
 WHERE updated_at >= ${from} AND updated_at < ${to}
 ${companyId ? Prisma.sql`AND company_id = ${companyId}` : Prisma.sql``}
`;
```
2. Delete projection for affected orders (by source updated window):
```
await tx.$executeRaw`
 DELETE FROM operation_read_model o
 USING (
   SELECT id FROM payment_orders
   WHERE updated_at >= ${from} AND updated_at < ${to}
   ${companyId ? Prisma.sql`AND company_id = ${companyId}` : Prisma.sql``}
 ) src
 WHERE o.operation_id = src.id;
`;
```
But `$executeRaw` with CTE? Can use subquery in USING. `DELETE FROM operation_read_model o USING (SELECT ...) src WHERE ...` valid.
3. Insert/replace projection:
```
await tx.$executeRaw`
 INSERT INTO operation_read_model (operation_id, company_id, worker_id, worker_name, status, amount_cents, currency, last_event_type, occurred_at, created_at, updated_at)
 SELECT
   po.id,
   po.company_id,
   po.worker_id,
   w.name,
   po.status,
   po.amount_cents,
   po.currency,
   le.type,
   po.updated_at,
   now(),
   now()
 FROM payment_orders po
 LEFT JOIN workers w ON w.id = po.worker_id
 LEFT JOIN LATERAL (
   SELECT type FROM order_events WHERE order_id = po.id ORDER BY occurred_at DESC, id DESC LIMIT 1
 ) le ON true
 WHERE po.updated_at >= ${from} AND po.updated_at < ${to}
 ${companyId ? Prisma.sql`AND po.company_id = ${companyId}` : Prisma.sql``}
 ON CONFLICT (operation_id) DO UPDATE SET
   company_id = EXCLUDED.company_id,
   worker_id = EXCLUDED.worker_id,
   worker_name = EXCLUDED.worker_name,
   status = EXCLUDED.status,
   amount_cents = EXCLUDED.amount_cents,
   currency = EXCLUDED.currency,
   last_event_type = EXCLUDED.last_event_type,
   occurred_at = EXCLUDED.occurred_at,
   created_at = EXCLUDED.created_at,
   updated_at = EXCLUDED.updated_at;
`;
```
Need status column type enum; selecting `po.status` type `"OrderStatus"` ok.
4. Rebuild totals for affected companies:
```
if (affectedCompanies.length > 0) {
  // use array param? Prisma raw supports arrays? Could use `Prisma.sql` with `IN (${ids})`? If pass array, Prisma maps to `IN (?)`? For raw template, `${array}` may produce `?` with array? Not sure.
```
Safer: Use SQL with subquery instead of array:
```
DELETE FROM company_financial_totals
WHERE company_id IN (
  SELECT DISTINCT company_id FROM payment_orders
  WHERE updated_at >= ${from} AND updated_at < ${to}
  ${companyId ? ...}
);
INSERT INTO company_financial_totals (company_id, pending_cents, approved_cents, rejected_cents, refunded_cents, net_cents, version, updated_at)
SELECT company_id,
 COALESCE(SUM(amount_cents) FILTER (WHERE status = 'PENDING'), 0),
 ...
 FROM payment_orders
 WHERE company_id IN (SELECT DISTINCT company_id FROM payment_orders WHERE updated_at >= from AND updated_at < to ...? This restricts sum to window, wrong all-time totals.
```
Need all-time totals for affected companies, not just window. So:
```
DELETE FROM company_financial_totals WHERE company_id IN (SELECT DISTINCT company_id FROM payment_orders WHERE updated window ...);
INSERT INTO company_financial_totals (...)
SELECT company_id, SUM... FROM payment_orders WHERE company_id IN (SELECT DISTINCT company_id FROM payment_orders WHERE updated window ...) GROUP BY company_id;
```
This sums all orders for affected companies, exact. Good.
If a company existed with totals row and no orders in window but totals drift? Not affected. Could drift repair all? We'll also have `repairAll` maybe.
5. Return count of operations inserted? Could `SELECT COUNT(*)` from projection where occurred_at in window? But after insert, occurred_at = source updated_at window. Use count.
```
const ops = await tx.$queryRaw<{count: string|number}>`SELECT COUNT(*)::int as count FROM operation_read_model WHERE occurred_at >= ...`;
```
But if window optional company. Good.

Need raw SQL with conditional company: Using `Prisma.sql` conditional inside template works? Example:
```
const companyFilter = companyId ? Prisma.sql`AND company_id = ${companyId}` : Prisma.sql``;
await tx.$queryRaw`... ${companyFilter}`;
```
Yes.

But for delete using subquery, if no affected, still okay.

Rebuild totals SQL: Need handle Decimal sum. `SUM(amount_cents)` returns numeric. Use `COALESCE(..., 0)`. Net: `COALESCE(SUM(amount_cents) FILTER (WHERE status = 'APPROVED'),0) - COALESCE(SUM(amount_cents) FILTER (WHERE status = 'REFUNDED'),0)`.
Set version = 1? Rebuild maybe set version = version + 1? If delete/insert, version 1. Fine.

`rebuildCompanyTotals(companyIds?)` for drift repair maybe all companies:
```
await tx.$executeRaw`DELETE FROM company_financial_totals ${companyIds? IN : all}; INSERT ... SELECT ... FROM payment_orders GROUP BY company_id;`
```
But array parameter issue. We can accept optional companyId only, not array. For affected companies, subquery. For full, no filter. For specific list, we can use `Prisma.sql` join? Could generate `IN (${Prisma.join(ids, ',')})` unsafe? ids uuid controlled from DB. Could use `IN (${Prisma.join(ids.map(id => Prisma.sql`${id}`))})`? `Prisma.join` exists. But maybe not needed.

Drift repair test: Create company, orders, totals; manually corrupt totals with raw SQL; call `driftRepairService.repairWindow(from before, to now)`; assert totals corrected. Also corrupt projection status; repair asserts dashboard correct.

Need `DriftRepairService`:
```
@Injectable()
export class DriftRepairService {
  async repairWindow(from, to, companyId?) { return readModelRepository.rederiveWindow...; }
  async repairAll() { return readModelRepository.rederiveAll? }
}
```
Maybe re-derivation routine separate `BackfillService` and drift repair uses it. To avoid duplication:
- `ReadModelBackfillService` with `rederiveWindow`.
- `DriftRepairService` calls `backfillService.rederiveWindow` for recent window. But repository does rederive+totals.
Could just have `ReadModelBackfillService` and `DriftRepairJob`. The task asks re-derivation routine and scheduled drift-repair job. We can implement both in `backfill` feature. `BackfillService.rederiveWindow` and `BackfillService.repairRecentWindow(lagMs)`. Job calls `repairRecentWindow`.

Name: `src/backfill/backfill.service.ts`, `backfill.repository.ts`, `backfill.module.ts`, `backfill.job.ts`.

But read model repository used by payment orders. Backfill repository can be same? We can have `ReadModelRepository` with rederive methods. Backfill service calls repository. Module exports repository? We'll have `OperationsReadModelModule`? Need wiring.

Simplify modules:
- `PrismaModule` global.
- `PaymentOrdersModule`: providers PaymentOrderRepository, ReadModelRepository, WorkerRepository, WorkerService, PaymentOrderService, PaymentOrderController, WorkerController; exports ReadModelRepository, PaymentOrderRepository? 
- `OperationsModule`: providers OperationsService, OperationsController, FinancialTotalsRepository? It imports PaymentOrdersModule to get ReadModelRepository? But read model repository also does maintenance. For dashboard query, maybe `OperationsRepository` separate. It can use PrismaService directly. It doesn't need PaymentOrdersModule. FinancialTotalsRepository separate. To avoid circular, create `ReadModelModule` providers ReadModelRepository, FinancialTotalsRepository, exports both. PaymentOrdersModule imports ReadModelModule. OperationsModule imports ReadModelModule. BackfillModule imports ReadModelModule. AppModule imports all.

Layout:
```
src/
  main.ts
  app.module.ts
  prisma/prisma.module.ts
  prisma/prisma.service.ts
  common/app-exception.ts
  common/exception-filter.ts
  read-model/read-model.module.ts
  read-model/read-model.repository.ts
  read-model/financial-totals.repository.ts? (could combine)
  read-model/backfill.service.ts? maybe
  payment-orders/...
  workers/...
  operations/...
  backfill/...
```
Need avoid too many files but okay.

Maybe combine financial totals into read-model repository to reduce files. But separation nice.

Let's design `ReadModelRepository` contains projection and totals? Then no separate FinancialTotalsRepository. But dashboard needs totals query. It can use same. Backfill uses same. Good. One repository for read model tables (operation_read_model, company_financial_totals). Simpler wiring.

`ReadModelRepository`:
- projection upsert/status/worker name
- totals delta, get totals
- rederive window, repair window? It will contain SQL. It is the only DB layer for read model.
Service `BackfillService` uses it.
`OperationsService` uses it for list and totals.

But list query on operation_read_model in same repository. Good.

Module `ReadModelModule` providers [ReadModelRepository], exports [ReadModelRepository].

`PaymentOrdersModule` imports ReadModelModule. Providers [PaymentOrderRepository, WorkerRepository, PaymentOrderService, WorkerService, controllers]. It uses ReadModelRepository for write hooks.
`OperationsModule` imports ReadModelModule. Providers [OperationsService, OperationsController].
`BackfillModule` imports ReadModelModule. Providers [BackfillService, BackfillJob]. Exports? Job needs ScheduleModule.
AppModule imports ReadModelModule? Not necessary but can. PaymentOrders, Operations, Backfill.

Need `ScheduleModule.forRoot()` in BackfillModule or App. We'll import in BackfillModule.

Now code details.

PrismaService:
```
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```
In ESM, generated client? ok.

PrismaModule global.

Exception filter: Need import `ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus` from @nestjs/common. `Prisma` from @prisma/client. `AppException` from common.
```
const response = ctx.getResponse();
const status = ...;
response.status(status).json({ error: { code, message, details } });
```
If exception is `HttpException`, use status, code maybe `validation_error` if 400? But one envelope code contract. We can map by status: 404 resource_not_found, 409 conflict, 422 validation_error, 400 validation_error, else internal_error. But AppException has code.
For Prisma known: P2025 -> 404 resource_not_found; P2002 -> 409 conflict; else 500.
Need `details` object never null. Use `{}`.

Custom AppException:
```
export class AppException extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode: number = 500, public readonly details: Record<string, unknown> = {}) { super(message); this.name = new.target.name; }
}
export class ResourceNotFoundException extends AppException { constructor(message = 'Resource not found', details = {}) { super('resource_not_found', message, HttpStatus.NOT_FOUND, details); } }
...
```
Need import HttpStatus? Could use numbers. Use `HttpStatus` from common. But AppException in common can import.

`ValidationException` code `validation_error`, status 422.
`StaleStatusException` code `status_stale`, 409.
`InvalidTransitionException` maybe `invalid_transition`, 409 or 422. Use 409.

DTO validation: If class-validator fails, Nest throws `BadRequestException` (HttpException). Filter maps to `validation_error` 400? Could be 422? Conventions maybe 422. We'll map 400 to 422? But status code? Error envelope code contract, status can be 422. If pipe throws 400, filter could set 422 for validation? Maybe better custom ValidationException 422. But ValidationPipe throws BadRequestException. We can map HttpException status 400 to code `validation_error`, status 400. Fine.

Now DTOs.

`CreatePaymentOrderDto`:
```
export class CreatePaymentOrderDto {
  @IsString() @IsUUID() companyId!: string;
  @IsOptional() @IsUUID() workerId?: string;
  @IsString() @Matches(/^\d+$/) amountCents!: string; // exact cents positive
  @IsOptional() @IsString() @Length(3,3) currency?: string;
}
```
Need `class-validator` `IsUUID`, `Matches`, `IsOptional`, `IsString`, `Length`. Import.
Maybe amount can be negative? No, positive. Use regex `^\d+$` and maybe not 0? Could allow 0? Financial exact; order amount >0. Use `@MinValue`? For string, use custom. Keep `@Matches(/^(0|[1-9]\d*)$/)`.

`ChangeOrderStatusDto`:
```
@IsString() @IsIn(['PENDING','APPROVED','REJECTED','REFUNDED']) status!: string;
```
But change from status maybe not need. Could use `status`.

`UpdateWorkerDto`: `@IsString() @Length(1, 200) name!: string;`

`QueryOperationsDto`:
```
@IsString() @IsUUID() companyId!: string;
@IsOptional() @IsIn([...]) status?: string;
@IsOptional() @IsDateString() from?: string;
@IsOptional() @IsDateString() to?: string;
@IsOptional() @IsString() cursor?: string;
@IsOptional() @IsInt() @Min(1) @Max(100) limit?: number; // if optional and number. Use `@Type(() => Number)`.
```
Need class-transformer `Type`. Import.
If limit omitted default 20.

Date validation: `@IsDateString()`.
Service parse to Date. Validate from < to.

`parseStatus`: 
```
const values = [PENDING, APPROVED, REJECTED, REFUNDED];
if (!values.includes(status as OrderStatus)) throw new ValidationException('Invalid status', { status });
return status as OrderStatus;
```

`parseCursor`:
```
const buffer = Buffer.from(cursor, 'base64url'); const [occurredAt, id] = buffer.toString().split('|'); if (!id) throw; return { occurredAt: new Date(occurredAt), operationId: id };
```
Need validate ISO and UUID? Could. If invalid throw ValidationException.
`buildCursor(item)`: `Buffer.from(`${item.occurredAt.toISOString()}|${item.operationId}`).toString('base64url')`.

Dashboard query with keyset: If cursor provided and status filter? We use cursor condition regardless. Need ensure `operationId` type string.
Where:
```
const where: Prisma.OperationReadModelWhereInput = {
 companyId: params.companyId,
 ...
 occurredAt: { ... },
 ...
};
if (params.status) where.status = params.status;
if (params.from) where.occurredAt = { ... where.occurredAt, gte: params.from };
if (params.to) where.occurredAt = { ... where.occurredAt, lte: params.to };
if (cursor) where.occurredAt? Can't combine lt with range? Need `AND` conditions: `occurredAt` range and cursor OR. If we set `where.occurredAt` range, and add `OR: [{ occurredAt: { lt: cursor.occurredAt } }, { occurredAt: cursor.occurredAt, operationId: { lt: cursor.operationId } }]`, the OR applies to entire where? In Prisma, top-level `OR` is ANDed with other fields. But if range and cursor OR, condition becomes range AND (cursor OR ...). For first condition `occurredAt < cursor`, combined with range gte/lte okay. For second `occurredAt = cursor.occurredAt AND operationId < cursor.id`, combined with range. Good.
```
Need if range lte and cursor equals? okay.
`take: limit + 1`.
Map DTO.

If no cursor, no OR. Good.

Potential issue: Index for status filter and cursor OR may not perfectly use, but okay.

Financial totals DTO:
```
{ pendingCents: string, approvedCents: string, rejectedCents: string, refundedCents: string, netCents: string, version: number, updatedAt: string }
```
If no row, zeros.

Operations response:
```
{ items: [...], nextCursor: string | null, totals: ... }
```
Operators see list and exact totals.

Now write path tests.

Testing with real DB: Need global setup to create schema. Since we provide migration SQL, tests could run `prisma migrate deploy`? In Vitest global setup, we can use `child_process.execSync('prisma migrate deploy')` but no shell? In test environment, maybe. But no tools. We can instead use `prisma db push`? But tests need schema. We can write test setup that runs `prisma migrate deploy` if `DATABASE_URL` set. But if test DB no migrations, fail. Could use `prisma db push` via exec. But user may not run. Need deliver tests that assume schema. Include `test/support/test-setup.ts` global setup that ensures schema with `prisma db push`? But `db push` doesn't apply migration. Could use `prisma migrate deploy` requiring migration. Use `execSync('npx prisma migrate deploy', { env: process.env })`. But in tests, `DATABASE_URL` required. Could throw helpful if missing. However Vitest global setup cannot import prisma? okay.

But tests using `PrismaClient` and real DB. For cleanup, each test transaction? If we wrap tests in transaction and rollback, raw SQL in repositories uses `prisma` not tx? Tests call services which use `prisma.$transaction`. If test setup uses a savepoint? Hard to roll back service transactions. Could just cleanup tables after each test with `TRUNCATE ... CASCADE`. Use Vitest `afterAll` or `beforeEach` cleanup. Since tests may run parallel? Use single thread? Vitest default parallel files. We can configure `pool: 'forks', poolOptions.forks.singleFork: true`? Or `fileParallelism: false` (Vitest 1: `threads: false`? `singleThread`?). To avoid DB conflicts, set `test: { fileParallelism: false }` in vitest config. Or use separate DB? Simpler config `fileParallelism: false`.

Need `vitest.config.ts`:
```
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    globalSetup: ['test/support/global-setup.ts']
  }
});
```
But ESM? `import { defineConfig } from 'vitest/config';`
Global setup file:
```
import { execSync } from 'node:child_process';
export default async function setup() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be set for tests');
  try {
    execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
  } catch (e) { console.error(e); throw e; }
}
```
But `prisma migrate deploy` requires migrations committed and generated? okay. Could use `npx prisma db push` to avoid migration? But schema changes ship with migration. Use migrate deploy.
Need ensure Prisma client generated? In test environment, maybe. Could `npx prisma generate`. Global setup can run generate then migrate. But `@prisma/client` import before generate? If not generated, import fails. Could assume generated via postinstall. Maybe global setup not enough. We can include package.json `postinstall: "prisma generate"`. Good.

Tests use `PrismaService`? Could directly instantiate `PrismaClient`. Need maybe use `PrismaService` to reuse. In tests, import `PrismaService` from `../../src/prisma/prisma.service.js`. Or use `PrismaClient`. For cleanup and seeding, use PrismaClient raw.

Need test helper `test/support/prisma.ts` exporting a singleton? But Vitest ESM. Could create per test file.
```
export function createTestPrisma() { const prisma = new PrismaService(); return prisma; }
```
But `PrismaService` extends PrismaClient, uses env. Good.
Cleanup:
```
export async function resetDatabase(prisma) {
 await prisma.$executeRaw`TRUNCATE TABLE operation_read_model, company_financial_totals, order_events, payment_orders, workers, companies RESTART IDENTITY CASCADE`;
}
```
Need table names. Good.

In each spec, before/after each test reset. But if tests use services that create their own PrismaService? If we create one PrismaService and inject into repositories, all use same. Good.

Test file `test/operations-read-model.spec.ts`? Need tests for read-your-own-writes, concurrent updates, drift repair. Could be one spec with three describes. Layout `test/<feature>.spec.ts`. We'll name `test/operations.spec.ts`. It imports modules? Instead of Nest testing module, we can instantiate repositories/services manually for behavior. Since services don't depend on module if we manually construct. That's simpler and tests behavior. But concurrency and read-your-own-writes need real DB. We can instantiate `ReadModelRepository`, `PaymentOrderRepository`, `WorkerRepository`, `PaymentOrderService`, `OperationsService`, `BackfillService` with a shared `PrismaService`.

Need `PaymentOrderRepository` constructor inject `PrismaService`, `ReadModelRepository`. `WorkerRepository` similar. `PaymentOrderService` inject repositories. `OperationsService` inject `ReadModelRepository`. `BackfillService` inject `ReadModelRepository`.

We can manually:
```
const prisma = new PrismaService();
const readModel = new ReadModelRepository(prisma);
const paymentOrderRepo = new PaymentOrderRepository(prisma, readModel);
const workerRepo = new WorkerRepository(prisma, readModel);
const paymentOrderService = new PaymentOrderService(paymentOrderRepo);
const operationsService = new OperationsService(readModel);
const backfillService = new BackfillService(readModel);
```
Need constructors match.

But if services are `@Injectable()` with constructor params, can call `new`. Good.

Need seed company/worker/order in tests using repositories or PrismaClient directly. For read-your-own-writes, seed company and worker via `prisma.company.create`, `prisma.worker.create`. Then use service create order, query dashboard.

Concurrency test: seed company and multiple workers/orders. Use `paymentOrderService.changeStatus` for multiple orders concurrently. Need initial orders created. Then Promise.all status changes. Assert totals exact. Could also test concurrent updates to same order stale: two approve same order, one 200 one 409. But requirement concurrent updates to one company's totals. We'll do multiple orders.

But service `changeStatus` first reads current then repository claims. For multiple orders, okay. For same order concurrent, one stale. Need exceptions: service throws AppException. In test, `expect(...).rejects.toMatchObject({ code: 'status_stale' })`? AppException has code property. If Nest filter not involved. Good.

Need create multiple orders with different amounts. Then change all to approved concurrently. Totals pending decreases by sum, approved increases. Exact via raw increments. Since each status delta uses `ON CONFLICT` atomic. Even if multiple updates same company, increments in DB atomic. Good.

Potential issue: `changeStatusIfCurrent` transaction uses `updateMany` to source status, then totals increment, then projection update. If two transactions on same company totals, raw increments row-level lock. Good. If same order, source updateMany ensures one. If two different orders, both update source rows, totals increments serialized. Good.

Read-your-own-writes test:
- seed company, worker.
- create order via service.
- query dashboard with company -> item status PENDING, amount.
- approve via service.
- query dashboard -> status APPROVED, totals approved amount.
This ensures projection updated in same transaction.

Drift repair test:
- seed company, worker, create orders via service (projection and totals correct).
- introduce drift: raw update `operation_read_model` set status='REJECTED' for an order and raw update totals wrong (e.g. approved=0). Need from/to window covering order updated_at. Since projection occurredAt = order.updatedAt, and source updated_at? For drift, if we only update projection, source unchanged. Backfill rederive window based on source updated_at. If source updated_at within window (it is now), it will replace projection and rebuild totals. Good.
- call `backfillService.repairWindow(from, to)` with wide window (e.g. new Date(Date.now()-1h), new Date(Date.now()+1h)). Assert dashboard/projection and totals correct.
Need if projection occurredAt after to? Use now + 1 day.

But rederive window deletes projection rows for source updated in window and inserts from source. If source updated_at is actual creation time, okay. Use from = new Date(0), to = new Date(Date.now() + 3600e3). Wide.

Need raw drift SQL in test: `await prisma.$executeRaw`UPDATE operation_read_model SET status='REJECTED' WHERE operation_id=${id}`;` and totals. Then repair.

Need test totals exact: `operationsService.list` returns totals. Or read `readModel.getFinancialTotals(companyId)`.

Potential issue: In test, after service create, totals row exists. Drift repair rebuilds totals for affected companies. Good.

Need test concurrent updates: maybe use `prisma` seed and service. Need ensure database has enough. Use small 5 orders. Promise.all. Then get totals. Also maybe test concurrent status changes on same order to assert one succeeds, totals delta applied once. Could add.

Need `PaymentOrderService.changeStatus` signature maybe takes `(orderId, status)`. For test, use status strings.

Now implementation details for repositories with Prisma and raw.

Type definitions:
`src/read-model/dto.ts`? Could define in files.

`ReadModelRepository` uses `OrderStatus` from `@prisma/client`. Need import `Prisma, OrderStatus, Decimal?` `OrderStatus` enum value. In generated client, enum available. We can import `OrderStatus` directly. But if using `Prisma` namespace? `import { OrderStatus, Prisma } from '@prisma/client';`

Need `Prisma.Decimal` typing. Use `const Decimal = Prisma.Decimal;` and `type Decimal = Prisma.Decimal;`. But `Prisma.Decimal` is a class? In generated client, yes. For type, `Prisma.Decimal` may be a type? Actually `Prisma.Decimal` is a constructor and type? In Prisma v5, `Prisma.Decimal` is a class `Decimal` from `decimal.js`. The namespace might export value, but type? Could use `import { Decimal } from '@prisma/client/runtime/library'`? That path may not be public. Better use `Prisma.Decimal` as value and for type `InstanceType<typeof Prisma.Decimal>`? Hmm. In TypeScript, `Prisma.Decimal` may be both value and type? I think `Prisma.Decimal` is a class, so can use as type? Example: `let d: Prisma.Decimal = new Prisma.Decimal(1);` I think yes because generated client exports `Decimal` type? Actually `Prisma.Decimal` is a class from `@prisma/client/runtime/library`. In TS, class name is type and value. Namespace exports class. So `Prisma.Decimal` usable as type. Good.

But before generate, type unknown? We assume.

`ReadModelRepository` code:
```
import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ValidationException } from '../common/app-exception.js';

type Decimal = Prisma.Decimal;
type DbClient = PrismaService | Prisma.TransactionClient;

export interface OperationProjectionInput { ... amountCents: Decimal; }
export interface FinancialTotalsDto { ... }

@Injectable()
export class ReadModelRepository {
 constructor(private readonly prisma: PrismaService) {}
 ...
}
```

Methods with `client: DbClient = this.prisma`.
But default parameter with `this.prisma` in TypeScript? yes.

`upsertOrderProjection`:
```
async upsertOrderProjection(data: OperationProjectionInput, client: DbClient = this.prisma) {
  const now = new Date();
  await client.operationReadModel.upsert({
    where: { operationId: data.operationId },
    update: {
      companyId: data.companyId,
      workerId: data.workerId,
      workerName: data.workerName,
      status: data.status,
      amountCents: data.amountCents,
      currency: data.currency,
      lastEventType: data.lastEventType,
      occurredAt: data.occurredAt,
      updatedAt: now,
    },
    create: { ...data, createdAt: now, updatedAt: now },
  });
}
```
Need `data` includes createdAt? We can separate. Define `OperationProjectionData` with fields and `OperationProjectionInput` maybe includes. For upsert create, need `createdAt`. We'll pass.

`applyStatusChangeProjection`:
```
async applyStatusChangeProjection(data: { operationId: string; status: OrderStatus; occurredAt: Date; lastEventType: string | null; amountCents: Decimal; currency: string; companyId: string; workerId: string | null; workerName: string | null }, client: DbClient = this.prisma) {
  const now = new Date();
  const res = await client.operationReadModel.updateMany({
    where: { operationId: data.operationId },
    data: { status: data.status, occurredAt: data.occurredAt, lastEventType: data.lastEventType, amountCents: data.amountCents, currency: data.currency, updatedAt: now }
  });
  if (res.count === 0) {
    await client.operationReadModel.create({ data: { operationId: data.operationId, companyId: data.companyId, workerId: data.workerId, workerName: data.workerName, status: data.status, amountCents: data.amountCents, currency: data.currency, lastEventType: data.lastEventType, occurredAt: data.occurredAt, createdAt: now, updatedAt: now } });
  }
}
```
But if row exists and worker name should not change. Good.

`applyWorkerName`:
```
async applyWorkerName(workerId: string, workerName: string, client: DbClient = this.prisma) {
  await client.$executeRaw`UPDATE operation_read_model SET worker_name = ${workerName}, updated_at = now() WHERE worker_id = ${workerId}`;
}
```
If worker has no projection rows, no issue.

`applyStatusDelta`:
```
async applyStatusDelta(companyId: string, oldStatus: OrderStatus | null, nextStatus: OrderStatus, amount: Decimal, client: DbClient = this.prisma) {
  const deltas = this.statusDeltas(oldStatus, nextStatus, amount);
  if (deltas.pending.isZero() && ...) maybe still update version? If no change, skip? If same status, skip. If all zero, return.
  const pending = Prisma.sql`${deltas.pending.toFixed(0)}::numeric`;
  ...
  await client.$executeRaw(Prisma.sql`INSERT INTO company_financial_totals (...) VALUES (${companyId}, ${pending}, ...) ON CONFLICT ...`);
}
```
Need check if all zero: Use `isZero()` maybe Decimal method. `Decimal` from decimal.js has `isZero()`. Good.
But if old===next, skip.
Need `Prisma.sql` with nested sql. For `companyId`, `${companyId}` parameter. For numeric fragments, use nested sql.
Potential issue: In ON CONFLICT DO UPDATE SET, if we use `${pending}` multiple times, okay.
SQL:
```
INSERT INTO company_financial_totals (company_id, pending_cents, approved_cents, rejected_cents, refunded_cents, net_cents, version, updated_at)
VALUES (${companyId}, ${pending}, ${approved}, ${rejected}, ${refunded}, ${net}, 1, now())
ON CONFLICT (company_id) DO UPDATE SET
  pending_cents = company_financial_totals.pending_cents + ${pending},
  approved_cents = company_financial_totals.approved_cents + ${approved},
  rejected_cents = company_financial_totals.rejected_cents + ${rejected},
  refunded_cents = company_financial_totals.refunded_cents + ${refunded},
  net_cents = company_financial_totals.net_cents + ${net},
  version = company_financial_totals.version + 1,
  updated_at = now();
```
Need `pending` fragment includes `::numeric`. Good.

But if create with negative delta due to unexpected missing row, could create negative totals. But normal no. For safety, in create branch maybe use `GREATEST(0, ...)`? But if row missing and negative delta, exact all-time totals can't be derived from one delta. Better assume row exists after create hook. For status change, create hook should have created. Drift repair rebuilds. Fine.

`getFinancialTotals(companyId)`:
```
const row = await this.prisma.companyFinancialTotal.findUnique({ where: { companyId } });
if (!row) return zeros;
return { pendingCents: row.pendingCents.toFixed(0), ... netCents: row.netCents.toFixed(0), version: row.version, updatedAt: row.updatedAt.toISOString() };
```
But `row.netCents` maybe maintained. Good.

`listOperations(params)`:
Need return `OperationReadModel[]`? Service maps. We can return raw prisma rows + nextCursor. But service should map? Could repository map? Repository can map to interface? It can, but business? It's okay. Service maybe builds DTO. Let's have repository return `OperationReadModel[]` and cursor.
```
export interface ListOperationsInput { companyId: string; status?: OrderStatus; from?: Date; to?: Date; cursor?: { occurredAt: Date; operationId: string }; limit: number; }
export interface ListOperationsResult { items: OperationReadModel[]; nextCursor: string | null; }
```
But `OperationReadModel` includes Decimal; service maps.
Cursor encode in repository? It's presentation? Could service encode. Repository returns `nextItem` and service builds cursor. Simpler: repository returns `items: OperationReadModel[]; hasMore: boolean`. Service slices and builds cursor from last item. But repository needs `take limit+1`. We'll return `{ items: raw, hasMore }` where raw includes extra? Let's:
```
const rows = await client.operationReadModel.findMany({ ... take: limit + 1 });
const hasMore = rows.length > limit;
const items = rows.slice(0, limit);
return { items, hasMore };
```
Service maps and builds cursor if hasMore.
Need import `Prisma.OperationReadModel` type? Could use `import type { OperationReadModel } from '@prisma/client';`. But with ESM? type import. Good.

Where construction:
```
const where: Prisma.OperationReadModelWhereInput = { companyId };
if (input.status) where.status = input.status;
const occurred: Prisma.OperationReadModelScalarFieldEnum? Actually `Prisma.OperationReadModelWhereInput['occurredAt']` is `DateTimeFilter | Date | ...`.
let occurredAt: Prisma.OperationReadModelWhereInput['occurredAt'] | undefined = {};
if (input.from) occurredAt = { ...occurredAt, gte: input.from };
if (input.to) occurredAt = { ...occurredAt, lte: input.to };
if (input.cursor) {
  occurredAt = { ...occurredAt, lt: input.cursor.occurredAt }; // But need OR with equal id. Can't express OR inside occurredAt? Could use top-level OR as above.
}
if (Object.keys(occurredAt).length) where.occurredAt = occurredAt;
if (input.cursor) {
  where.OR = [
    { occurredAt: { lt: input.cursor.occurredAt } },
    { occurredAt: input.cursor.occurredAt, operationId: { lt: input.cursor.operationId } }
  ];
}
```
But if `where.occurredAt` set range and top-level OR, Prisma ANDs. However if cursor OR includes `occurredAt: { lt }` and range `gte/lte`, okay. If no range, only OR. But if we also set `where.occurredAt` range, the second cursor condition `occurredAt: cursor.occurredAt` (equals) will be ANDed with range? Wait top-level OR conditions are each combined with other where fields. For second: other where includes `occurredAt: { gte, lte }` AND `occurredAt: cursor.occurredAt`? Actually if a condition has `occurredAt` and top-level other where has `occurredAt` range, Prisma ANDs them, so equals must also satisfy range. Good. For first: lt plus range. Good.
But if range lte and cursor.occurredAt equals lte? second includes operationId lt. okay.
Need if from > to service throws.

`orderBy` as above.

`rederiveWindow(from, to, companyId?)`:
Need return `{ operations: number; companies: number; }`. Use `prisma.$transaction`.
Implementation with raw SQL.
Need conditional filters:
```
const companyFilter = (alias: string) => companyId ? Prisma.sql`AND ${Prisma.sql`${alias}`}.company_id = ${companyId}` : Prisma.sql``;
```
But in SQL, alias maybe `po`. Need avoid SQL injection in alias (code constant). `Prisma.sql` with string interpolation okay.
For `payment_orders` no alias: `Prisma.sql`AND company_id = ${companyId}``.
For `po.company_id`.

Select affected companies:
```
const affected = await tx.$queryRaw<{ company_id: string }[]>`
 SELECT DISTINCT company_id FROM payment_orders
 WHERE updated_at >= ${from} AND updated_at < ${to}
 ${companyId ? Prisma.sql`AND company_id = ${companyId}` : Prisma.sql``}
`;
```
But `from`/`to` Date supported.

Delete projection:
```
await tx.$executeRaw`
 DELETE FROM operation_read_model o
 WHERE o.operation_id IN (
   SELECT id FROM payment_orders
   WHERE updated_at >= ${from} AND updated_at < ${to}
   ${companyId ? Prisma.sql`AND company_id = ${companyId}` : Prisma.sql``}
 );
`;
```
Simpler than USING.

Insert projection:
```
await tx.$executeRaw`
 INSERT INTO operation_read_model (...)
 SELECT ...
 FROM payment_orders po
 LEFT JOIN workers w ON w.id = po.worker_id
 LEFT JOIN LATERAL (...) le ON true
 WHERE po.updated_at >= ${from} AND po.updated_at < ${to}
 ${companyId ? Prisma.sql`AND po.company_id = ${companyId}` : Prisma.sql``}
 ON CONFLICT (operation_id) DO UPDATE SET ...
`;
```
Need if no rows, okay.

Rebuild totals for affected companies:
```
const affectedCompanyFilter = companyId ? Prisma.sql`AND company_id = ${companyId}` : Prisma.sql``;
const affectedCompanySubquery = Prisma.sql`SELECT DISTINCT company_id FROM payment_orders WHERE updated_at >= ${from} AND updated_at < ${to} ${affectedCompanyFilter}`;
await tx.$executeRaw`DELETE FROM company_financial_totals WHERE company_id IN (${affectedCompanySubquery})`;
await tx.$executeRaw`
 INSERT INTO company_financial_totals (company_id, pending_cents, approved_cents, rejected_cents, refunded_cents, net_cents, version, updated_at)
 SELECT
   company_id,
   COALESCE(SUM(amount_cents) FILTER (WHERE status = 'PENDING'), 0),
   ...
   COALESCE(SUM(amount_cents) FILTER (WHERE status = 'APPROVED'), 0) - COALESCE(SUM(amount_cents) FILTER (WHERE status = 'REFUNDED'), 0),
   1,
   now()
 FROM payment_orders
 WHERE company_id IN (${affectedCompanySubquery})
 GROUP BY company_id;
`;
```
Can `${affectedCompanySubquery}` nested sql be used in IN? Yes.
But `Prisma.sql` subquery returns a SQL chunk; `IN (${affectedCompanySubquery})` okay.

Need status enum literal in SQL: `status = 'PENDING'`. Since column type enum, string literal okay? In Postgres, comparing enum column to string may require cast? It works? `status = 'PENDING'` where status is enum type: Postgres will try to cast literal to enum? I think yes if enum type has value. To be safe: `status = 'PENDING'::"OrderStatus"`. Use cast.
`WHERE status = 'PENDING'::"OrderStatus"`.

Count operations:
```
const ops = await tx.$queryRaw<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM operation_read_model WHERE occurred_at >= ${from} AND occurred_at < ${to} ${companyId ? ... on company_id}`;
const operations = ops[0]?.count ?? 0;
```
Need `::int`.

But after rederive, projection occurredAt = source updated_at, so window matches. Good.
Return `{ operations, companies: affected.length }`.

Potential issue: `rederiveWindow` rebuilds totals for affected companies by summing all orders. If window huge and many companies, heavy. But required exact. Could optimize by only rebuild companies whose totals mismatch; but exact. For scheduled repair, recent window small. Good.

`rederiveAll` maybe not needed. But drift repair full? Could add `repairAll()` for manual. Not required. But maybe scheduled drift repair for arbitrary window. We'll implement `repairWindow` in BackfillService calling repository. Could also `repairAll` in BackfillService calling repository `rederiveAll`? Not necessary. But task: scheduled drift-repair job. Job can call `repairWindow(now - lag, now)`. Lags from env `DRIFT_REPAIR_LOOKBACK_MS` default 24h. Use process.env.

BackfillService:
```
@Injectable()
export class BackfillService {
 constructor(private readonly readModel: ReadModelRepository) {}
 async rederiveWindow(from: Date, to: Date, companyId?: string) { validate from<to; return readModel.rederiveWindow(from,to,companyId); }
 async repairRecentWindow(lookbackMs = Number(process.env.DRIFT_REPAIR_LOOKBACK_MS ?? 24*60*60*1000), companyId?: string) {
   const to = new Date(); const from = new Date(to.getTime() - lookbackMs);
   return this.rederiveWindow(from,to,companyId);
 }
}
```
Need if env invalid? Use safe number.

`BackfillJob`:
```
@Injectable()
export class BackfillJob {
 private readonly logger = new Logger(BackfillJob.name);
 constructor(private readonly backfill: BackfillService) {}
 @Cron(CronExpression.EVERY_HOUR, { name: 'operations-drift-repair' })
 async handleCron() {
   try { const result = await this.backfill.repairRecentWindow(); this.logger.log(...); } catch (e) { this.logger.error(...); }
 }
}
```
Need import `@nestjs/schedule` `Cron, CronExpression`. Module:
```
@Module({ imports: [ScheduleModule.forRoot(), ReadModelModule], providers: [BackfillService, BackfillJob], exports: [BackfillService] })
```
If `ScheduleModule.forRoot()` in BackfillModule, ok.

Now `PaymentOrderRepository` details.

Need input type:
```
export interface CreatePaymentOrderInput { companyId: string; workerId: string | null; amountCents: Decimal; currency: string; }
```
`changeStatusIfCurrent(orderId: string, expectedStatus: OrderStatus, nextStatus: OrderStatus)`.

`createWithReadModel`:
```
return this.prisma.$transaction(async (tx) => {
  const order = await tx.paymentOrder.create({ data: input });
  const event = await tx.orderEvent.create({ data: { orderId: order.id, type: 'ORDER_CREATED' } });
  const worker = order.workerId ? await tx.worker.findUnique({ where: { id: order.workerId }, select: { name: true } }) : null;
  await this.readModel.upsertOrderProjection({ operationId: order.id, companyId: order.companyId, workerId: order.workerId, workerName: worker?.name ?? null, status: order.status, amountCents: order.amountCents, currency: order.currency, lastEventType: event.type, occurredAt: order.updatedAt, createdAt: order.createdAt, updatedAt: new Date() }, tx);
  await this.readModel.applyStatusDelta(order.companyId, null, order.status, order.amountCents, tx);
  return order;
});
```
Need `worker` relation not included in create; we can include or separate. To avoid extra query, `include: { worker: true }` on create? Prisma create can include. Use `const order = await tx.paymentOrder.create({ data: input, include: { worker: true } });` Then `order.worker?.name`. Return order maybe includes worker; DTO maps.
But return type includes worker; okay.
`applyStatusDelta` uses amount Decimal.

But if `workerId` invalid, Prisma FK throws P2003? Filter maps? Service could pre-check? Controller validates UUID but not existence. Should throw 404? For company/worker not found, maybe repository create FK violation. Filter maps P2003 to? We can map FK constraint to `resource_not_found`? Prisma known error code P2003? Actually foreign key violation. Could precheck in service? Controller zero logic. Service can call repository `assertCompanyExists`? But not necessary? Better service validates entity existence? It can call `paymentOrderRepository.exists(companyId, workerId)`? But zero logic? We can have repository `createWithReadModel` throw `ResourceNotFoundException` if company/worker missing by checking? That's business. Simpler: service can call `paymentOrderRepository.findCompany?` but no repository for company. Could add `CompanyRepository`? Too much.
We can let Prisma FK error map to 422? But user sees. Not critical for tests (valid).
Maybe in `PaymentOrderService.createOrder`, call `await this.paymentOrderRepository.ensureCompanyExists(dto.companyId)` and worker optional. But adds source repository. We can include methods in `PaymentOrderRepository`: `assertCompanyExists`, `assertWorkerExists` using `this.prisma.company.findUnique`. But repository touching companies. Fine. Service zero raw. But if not exists, throw ResourceNotFound. This is business validation. We'll add to be robust.
`PaymentOrderRepository` can use `this.prisma.company.findUnique` and `worker.findUnique`.
But `PaymentOrderRepository` currently source orders. It can. In create, service calls `await this.paymentOrderRepository.assertReferencesExist(input.companyId, input.workerId)` before transaction. But TOCTOU? Then transaction create FK. Fine.

`changeStatusIfCurrent` transaction:
```
const claim = await tx.paymentOrder.updateMany({ where: { id: orderId, status: expectedStatus }, data: { status: nextStatus, version: { increment: 1 } } });
if (claim.count === 0) {
  const exists = await tx.paymentOrder.findUnique({ where: { id: orderId }, select: { status: true } });
  if (!exists) throw new ResourceNotFoundException('Payment order not found');
  throw new StaleStatusException('Payment order status changed', { orderId, expected: expectedStatus, actual: exists.status });
}
const order = await tx.paymentOrder.findUnique({ where: { id: orderId }, include: { worker: true } });
if (!order) throw ... // impossible
const event = await tx.orderEvent.create({ data: { orderId: order.id, type: this.eventTypeForStatus(nextStatus) } });
await this.readModel.applyStatusChangeProjection({ operationId: order.id, status: order.status, occurredAt: order.updatedAt, lastEventType: event.type, amountCents: order.amountCents, currency: order.currency, companyId: order.companyId, workerId: order.workerId, workerName: order.worker?.name ?? null }, tx);
await this.readModel.applyStatusDelta(order.companyId, expectedStatus, nextStatus, order.amountCents, tx);
return order;
```
Need if `updateMany` sets status but then transaction abort? If later throws, rollback. Good.
But `updateMany` `where` with `status` not unique; `id` unique, count 0 if status mismatch. Good.
Need `expectedStatus` and `nextStatus` same? Service prevents. If same, no event? Could no-op.

`findById`:
```
return this.prisma.paymentOrder.findUnique({ where: { id }, include: { worker: true, events? maybe not } });
```
For service read current. Include worker? not needed. Return.

`event type`: `ORDER_APPROVED`, etc. For PENDING? no.

`PaymentOrderService` transition map:
```
private canTransition(from: OrderStatus, to: OrderStatus) {
 switch(from) {
  case PENDING: return [APPROVED, REJECTED, REFUNDED?].includes(to)? Maybe refund from pending? No, refund usually from approved. But marketplace order status could refund pending? We'll define: PENDING -> APPROVED | REJECTED; APPROVED -> REFUNDED; REJECTED/REFUNDED no transitions. If to===from false.
 }
}
```
Need if order PENDING can be REFUNDED? Maybe not. For tests, create pending, approve, refund. Good.
But if want reject from approved? no.

`changeStatus` service:
```
const current = await repo.findById(orderId);
if (!current) throw ResourceNotFound;
if (current.status === status) throw ValidationException('Order is already ...'); // or return? Use 409? Use validation.
if (!this.canTransition(current.status, status)) throw InvalidTransitionException(...);
return await repo.changeStatusIfCurrent(orderId, current.status, status);
```
If concurrent changed after read, repo throws stale.

Need DTO mapping. `toDto` returns `{ id, companyId, workerId, workerName?, amountCents: order.amountCents.toFixed(0), currency, status, version, createdAt, updatedAt }`.

`WorkerRepository`:
- `updateWithReadModel(id, name)` transaction:
```
const worker = await tx.worker.update({ where: { id }, data: { name } }); // throws if not found
await this.readModel.applyWorkerName(worker.id, worker.name, tx);
return worker;
```
But if worker not found, Prisma P2025; filter maps. Could service catch? Repository can catch? It may throw Prisma. Filter handles. But service can check `findById` first to throw custom. We'll do service:
```
const worker = await this.workerRepository.findById(id);
if (!worker) throw ResourceNotFound;
return this.workerRepository.updateWithReadModel(id, name);
```
But TOCTOU; okay.
`findById` returns worker.

`WorkerService.updateName` as above.

Controllers:
`PaymentOrderController`:
```
@Controller('payment-orders')
export class PaymentOrderController {
 constructor(private readonly service: PaymentOrderService) {}
 @Post() create(@Body() dto: CreatePaymentOrderDto) { return this.service.createOrder(dto); }
 @Patch(':id/approve') approve(@Param('id') id: string, @Body() dto? maybe no body) { return this.service.changeStatus(id, OrderStatus.APPROVED); }
 @Patch(':id/reject') ...
 @Patch(':id/refund') ...
 @Get(':id') get...
}
```
Need param UUID validation? Use `@IsUUID`? For param, can use `ParseUUIDPipe` from common. But if invalid, filter. Use `@Param('id', ParseUUIDPipe)`. Need import `ParseUUIDPipe`.
For status endpoints, no body. Or single `@Patch(':id/status')` with DTO. We can do both? Kebab-case endpoints plural? Convention endpoint kebab-case plural. For actions, maybe `/payment-orders/:id/status`? But specific approve is okay? Endpoint naming maybe kebab-case plural: `/payment-orders` and `/payment-orders/:id/approve` is not plural? It's subresource. Fine. Could use `/payment-orders/:id/status` with body. But approve is explicit. We'll use `@Patch(':id/approve')`, `:id/reject`, `:id/refund`. Kebab? single word.
Return DTO.

`WorkerController`: `@Controller('workers')`, `@Patch(':id')` update name.

`OperationsController`:
```
@Controller('operations')
export class OperationsController {
 constructor(private readonly service: OperationsService) {}
 @Get()
 list(@Query() query: QueryOperationsDto) { return this.service.list(query); }
}
```
Endpoint plural `operations`. Good.

Need `ValidationPipe` with `transform: true, whitelist: true` in main. But `@Type` for limit. Good.

Now module files.

`PrismaModule` global:
```
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```
Since global, no need import in every module? Nest still needs module imported for providers? Global module providers available without import? In Nest, if a module is global, its providers are available in all modules without import? I think yes? Actually global module must be imported? In v10, if `@Global()` and registered in AppModule, its providers are available in all modules. We'll import in AppModule? It says global. We can not import in feature modules. But to be safe, feature modules import `PrismaModule`? Conventions: provider used by another module is exports and module imported. For global, can skip. But maybe strict. We'll import `PrismaModule` in AppModule only and rely global. However if not imported in feature, Nest might not inject? Global module from AppModule is visible. Good.

`ReadModelModule`:
```
@Module({ providers: [ReadModelRepository], exports: [ReadModelRepository] })
export class ReadModelModule {}
```
It doesn't import PrismaModule because global? If global not imported? It is in AppModule. But for standalone tests, not using module. For Nest app, global. If we don't import PrismaModule, and global not set? We set @Global. Good.
But if `PrismaModule` is global but not imported in ReadModelModule, provider injection works only if AppModule imports global. Yes.

`PaymentOrdersModule`:
```
@Module({
 imports: [ReadModelModule],
 controllers: [PaymentOrderController, WorkerController],
 providers: [PaymentOrderService, PaymentOrderRepository
```

## reply

(empty)
