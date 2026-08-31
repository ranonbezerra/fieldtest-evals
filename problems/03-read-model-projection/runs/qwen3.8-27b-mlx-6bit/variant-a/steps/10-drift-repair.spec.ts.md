# 10-drift-repair.spec.ts

## reply

Let me analyze what's needed here.

Task: Write exactly one file: `test/drift-repair.spec.ts`. According to the plan, this file tests "drift repair recovers divergence and is idempotent."

Plan section 5 (tests) related to drift repair:
- **Drift repair recovers divergence:** Manually corrupt a projection row (wrong status/amount), run `repairDrift` for the window covering it, and assert that the row is restored to match the source.
- **Drift repair idempotency:** Running `repairDrift` twice over the same window yields identical projection contents and row counts.

Also, from the manifest:
```
test/drift-repair.spec.ts | reads: src/operations/drift-repair.processor.ts, src/operations/operation-read-model.service.ts, src/operations/operation-read-model.types.ts | drift repair recovers divergence and is idempotent
```

So this test file should read (import) from:
- `src/operations/drift-repair.processor.ts` → `DriftRepairProcessor`
- `src/operations/operation-read-model.service.ts` → `OperationReadModelService`
- `src/operations/operation-read-model.types.ts` → types and errors

Wait, but the test needs to interact with the database. The repository is the only layer that touches the DB. But the manifest says this test file reads the processor, service, and types — not the repository. Hmm. But to corrupt a projection row, we'd need to touch the DB somehow…

Let me think about how the tests are set up. The other test file `test/operation-read-model.spec.ts` reads the service, repository, and types. So there, the tests use the repository directly (to corrupt rows, to seed data, etc.).

For `drift-repair.spec.ts`, the manifest says it reads the processor, service, and types. So how do we corrupt a projection row without importing the repository?

Options:
1. Use PrismaClient directly in the test to corrupt the row (seed data, corrupt rows). The repository internally uses PrismaClient, and tests often use the raw Prisma client for setup/teardown. But the manifest says "reads" — that's about imports, presumably. The manifest lists what each file reads (imports). If the test imports PrismaClient from '@prisma/client', that's a package, not a file in the manifest. The manifest only lists project files. So importing `@prisma/client` is fine and doesn't violate the manifest.

Actually wait — let me think about what "reads" means in the manifest. It lists project files that the file depends on. `test/drift-repair.spec.ts` reads the processor, service, and types files. It doesn't list the repository. So the test shouldn't import the repository. But it can use PrismaClient directly for seeding/corruption since that's a package import.

Hmm, but is that the "most defensible reading"? Let me think about how the test would work:

1. Set up a NestJS testing module (or instantiate classes manually).
2. Seed source data: `payment_orders`, `events`, `workers`, `companies` rows via PrismaClient.
3. Seed/corrupt projection rows: directly insert/corrupt `operation_read_models` rows via PrismaClient.
4. Call `processor.repairDrift()` — but wait, `repairDrift` uses `Date.now()` internally to compute the window. For a deterministic test, we need to control the window.

Hmm, this is a problem. `repairDrift()` computes the window from `Date.now()`, `DRIFT_REPAIR_LAG_MS` (default 1h), and `DRIFT_REPAIR_SAFETY_MARGIN_MS` (default 5min). So the window is `[now - 1h, now - 5min]`.

For a deterministic test of "drift repair recovers divergence," we need the corrupted row's `occurred_at` to fall within `[now - 1h, now - 5min]`. We can set `occurred_at` to e.g. `now - 30min`, which is within the default window. That works without mocking time.

Alternatively, we could use vi.useFakeTimers() to mock Date.now. But that's more complex. Actually, using fake timers is a clean approach: `vi.useFakeTimers().setSystemTime(fixedDate)`. Then the window is deterministic.

But wait — the test also needs to verify "run `repairDrift` for the window covering it." Since `repairDrift`'s window is internally computed, we just need to make sure the data falls within it.

Also, the plan says: "Re-derivation for an arbitrary window: `rederiveWindow` over a custom `[from,to)` replaces exactly the projection rows in that window and leaves rows outside it untouched." — but that's listed under tests in general, not specifically assigned to drift-repair.spec.ts. The manifest says drift-repair.spec.ts covers "drift repair recovers divergence and is idempotent." So this file should focus on those two behaviors. Should we include the arbitrary-window test? The plan's test section lists it as a separate bullet, and the manifest assigns only two bullets to this file. The other spec file (operation-read-model.spec.ts) covers "read-your-own-writes, concurrent totals, exact totals, invalid params" per the manifest — hmm, that doesn't obviously cover "re-derivation for an arbitrary window" either. But my task is only this file. I should implement exactly what the plan specifies for this file: "drift repair recovers divergence and is idempotent."

So two test scenarios:
1. Drift repair recovers divergence: corrupt a projection row, run `repairDrift()`, assert the row is restored to match the source.
2. Drift repair idempotency: run `repairDrift()` twice over the same window, assert identical projection contents and row counts.

Now, how do we construct the processor? `DriftRepairProcessor` takes `(service: OperationReadModelService, config: ConfigService)`. The service takes `(repo: OperationReadModelRepository, prisma: PrismaClient)`.

For testing, the cleanest approach with NestJS is `Test.createTestingModule` from `@nestjs/testing`. But that requires the repository to be provided. The manifest says this test file reads only the processor, service, and types — not the repository. Hmm, but to build the module we'd need to import the repository class to provide it… unless we use `useValue` with a mock.

Wait, actually — should the test mock the repository? The plan says "test behavior, not implementation. Never assert that a call merely happened." If we mock the repository, testing "drift repair recovers divergence" becomes impossible — because recovery is a DB behavior (re-derivation from source). So the test must run against a real database.

So how do we seed/corrupt without importing the repository? Use PrismaClient directly. The test file imports `PrismaClient` from `@prisma/client`. That's a package, not a project file, so the manifest (which lists project files) is still satisfied.

But then, how do we instantiate `OperationReadModelService`? It needs a `OperationReadModelRepository`. We'd have to import the repository to construct it… which violates the manifest's "reads" list.

Hmm, wait. Let me re-read the manifest:

```
test/drift-repair.spec.ts | reads: src/operations/drift-repair.processor.ts, src/operations/operation-read-model.service.ts, src/operations/operation-read-model.types.ts | drift repair recovers divergence and is idempotent
```

Hmm. So the test imports:
- `DriftRepairProcessor` from the processor file
- `OperationReadModelService` from the service file
- Types from the types file

But to construct the service, we need a repository. Unless… we use NestJS's testing module with `useValue`/`useFactory`? Even with a factory we'd need to reference the repository type.

Alternatively, maybe the test constructs the service with a real repository created inside a factory… but that requires importing the repository.

Hmm, wait. Maybe I'm overthinking this. Let me reconsider: maybe "reads" in the manifest is just loose guidance, and the instruction says "implement exactly what the plan specifies for this file." The plan's test section says:

- **Drift repair recovers divergence:** Manually corrupt a projection row (wrong status/amount), run `repairDrift` for the window covering it, and assert that the row is restored to match the source.
- **Drift repair idempotency:** Running `repairDrift` twice over the same window yields identical projection contents and row counts.

To do this against a real DB, we need:
1. A PrismaClient (for seeding source + projection data, corruption, and assertions).
2. The processor (to call `repairDrift`).
3. The service + repository (to construct the processor).

The most defensible approach: use `Test.createTestingModule` with providers for PrismaService… wait, there's no PrismaService in the plan. The repository takes `PrismaClient` directly (constructor(prisma: PrismaClient)).

Hmm, let me look at the repository signature from the plan:

```ts
export class OperationReadModelRepository {
  constructor(prisma: PrismaClient);
  ...
}
```

And the service:
```ts
export class OperationReadModelService {
  constructor(repo: OperationReadModelRepository, prisma: PrismaClient);
  ...
}
```

And the processor:
```ts
export class DriftRepairProcessor {
  constructor(service: OperationReadModelService, config: ConfigService);
  @Cron(...)
  async repairDrift(): Promise<number>;
}
```

So to build the real processor with a real service + real repository, we need all three classes. The test would import the repository too — deviating from the manifest's reads list.

Alternatively, we can construct everything manually without a NestJS testing module:

```ts
const prisma = new PrismaClient();
const repo = new OperationReadModelRepository(prisma);
const service = new OperationReadModelService(repo, prisma);
const config = new ConfigService({ ... }); // or a stub
const processor = new DriftRepairProcessor(service, config);
```

For ConfigService, we can construct `new ConfigService()` with no args — does it work? `ConfigService` constructor: `constructor(private readonly configObject: Record<string, any> = {})`. Yes, `new ConfigService()` works and `config.get('DRIFT_REPAIR_LAG_MS')` returns undefined, so the processor falls back to defaults (1h lag, 5min safety margin).

But wait — the processor reads `process.env.DRIFT_REPAIR_CRON ?? CronExpression.EVERY_5_MINUTES` at module load for the `@Cron` decorator. In tests, the cron won't fire (NestJS scheduler isn't started), so that's fine.

Hmm, but actually, should we use NestJS testing module? The convention is NestJS for the API. Tests are Vitest. Common pattern:

```ts
import { Test } from '@nestjs/testing';

const moduleRef = await Test.createTestingModule({
  providers: [
    { provide: PrismaClient, useValue: prisma },
    OperationReadModelRepository,
    OperationReadModelService,
    { provide: ConfigService, useValue: configStub },
    DriftRepairProcessor,
  ],
}).compile();
```

But `PrismaClient` as a token — the repository's constructor takes `prisma: PrismaClient`. In NestJS DI, constructor injection is by design-time type (via `emitDecoratorMetadata`), so the token would be the `PrismaClient` class. Providing `{ provide: PrismaClient, useValue: prisma }` would work.

But this requires importing `OperationReadModelRepository` — not in the manifest's reads list.

Hmm, let me weigh: the instructions say "implement exactly what the plan specifies for this file. Do not add exports, features, or files that the plan doesn't name." The manifest is part of the plan. The reads list for this test file omits the repository. But the behavior being tested (recovery from divergence) fundamentally requires a real DB round-trip through the repository.

Wait — actually, can we test recovery without importing the repository? We construct the service with a manually created repository instance… no, we still need to import the repository class.

Unless… the test uses `Test.createTestingModule` with an `imports` of `OperationsModule`? That would import the module file — also not in the reads list.

Hmm, let me think about this from another angle. Maybe the intended design is: the test file uses PrismaClient directly for all DB operations (seeding, corruption, assertions), and the only production code under test is `DriftRepairProcessor.repairDrift()` (which delegates to the service's `rederiveWindow`). To construct the processor, we need the service; to construct the service, we need the repository.

I think importing the repository is unavoidable and defensible. The manifest's "reads" list might just be incomplete, or the intent is that the test doesn't *use* the repository as a subject under test (the other spec file covers service + repository behavior). The instruction says: "If a symbol you truly need is missing from both the plan and references, don't silently guess… write the file with the most defensible reading, and mark it at the point where it matters with a single `// ASSUMPTION:` comment."

Is `OperationReadModelRepository` "missing from both the plan and references"? No — it's in the plan (section 3 has the full signature). So we can import it without an assumption comment. The manifest's reads list is guidance, but the plan's test requirements (real DB behavior) take precedence. Actually wait — let me re-read: "The PLAN.md above is your own spec and governs." The plan includes both the test bullets and the manifest. There's tension.

Let me think about which is more defensible:

Option A: Import the repository, construct the real chain (repo → service → processor), use PrismaClient directly for seeding/corruption/assertions. This tests real behavior end-to-end. Slight deviation from manifest's reads list (adds a repository import).

Option B: Mock the repository with `useValue` and assert that `repairDrift` calls `rederiveWindow` with the right window. But this violates "test behavior, not implementation. Never assert that a call merely happened." Recovery from divergence is a DB behavior; with a mocked repo, we can only test window computation. The plan explicitly says "manually corrupt a projection row… assert the row is restored to match the source" — that requires a real DB. So Option B is wrong per the plan's own test description.

So Option A it is. The manifest reads list is best read as "primary dependencies," and the repository import is a necessary consequence of the behavior being tested. Actually, hmm, wait. Let me reconsider — maybe we can avoid importing the repository by using a NestJS testing module that imports `OperationsModule`? No — that's also not in the reads list, and it would pull in the controller too.

Or… construct the service with a minimal hand-rolled repository-like object? No — that would be testing against a fake, not real behavior.

OK, another thought: maybe the test is intended to use `Test.createTestingModule` with providers including `OperationReadModelRepository`. In that case, the reads list would include the repository… it doesn't. So the manifest author probably intended direct instantiation or a module that doesn't require naming the repository…

Hmm, actually, wait. What if we use `Test.createTestingModule({ imports: [OperationsModule] })`? Then the reads list would include the module. It doesn't.

What if the test only imports the processor and types, and gets the service from… no, that doesn't work.

Let me just go with Option A: direct instantiation (no NestJS testing module needed — simpler and more explicit), importing:
- `PrismaClient` from `@prisma/client`
- `ConfigService` from `@nestjs/config`
- `DriftRepairProcessor` from `../src/operations/drift-repair.processor`
- `OperationReadModelService` from `../src/operations/operation-read-model.service`
- `OperationReadModelRepository` from `../src/operations/operation-read-model.repository` (necessary to construct the real service)
- Types from `../src/operations/operation-read-model.types` (maybe `DateWindow`)

Hmm wait, do we even need to import types in this spec? Maybe for `DateWindow`… but if we only call `processor.repairDrift()`, we don't construct a window. The manifest says the test reads the types file — perhaps for typing fixtures. We can import a type like `OperationReadModel` for typing seed data, or not import anything from types. The manifest says it reads the types file, so importing something is more consistent. Maybe import `DateWindow`… but we don't use it if we only call repairDrift.

Hmm, actually — should the idempotency test use `rederiveWindow` with an explicit window? The plan says: "Drift repair idempotency: running `repairDrift` twice over the same window yields identical projection contents and row counts." — "running repairDrift twice over the same window" — so `repairDrift` (the processor's method), twice. Since `repairDrift` computes the window from `now`, "the same window" means two consecutive calls (with fake timers, or just back-to-back calls where the window is effectively the same relative to our fixed data).

To make "the same window" precise and deterministic, we should pin time. `vi.useFakeTimers()` + `setSystemTime` makes `Date.now()` deterministic, so both calls compute identical windows. That's clean and defensible.

But wait — does `vi.useFakeTimers()` interfere with Prisma/DB calls? Vitest's fake timers by default mock `setTimeout`, `setInterval`, `Date`, etc. Prisma uses `setTimeout` internally (e.g., for connection timeouts). If we keep fake timers active during DB calls, Prisma's internal timers won't fire… actually, `vi.useFakeTimers()` replaces `Date` and timer functions. Prisma's client initialization uses `setTimeout` for things like query engine startup timeouts. With fake timers, those timeouts won't fire until we advance time, which could hang or delay tests.

Safer approach: use fake timers only around the `repairDrift` call, or don't use fake timers at all and instead choose data timestamps that fall within the default window `[now - 1h, now - 5min]`.

Approach without fake timers:
- Set `occurred_at` of the corrupted row to `now - 30min` (comfortably within `[now-1h, now-5min]`).
- Call `repairDrift()` — the window is `[now1 - 1h, now1 - 5min]`. Our row at `now0 - 30min` (where `now0 ≈ now1`) is inside.
- Second call for idempotency: the window is `[now2 - 1h, now2 - 5min]`, slightly shifted but still covers our row. "The same window" — well, not literally the same milliseconds, but effectively the same for our data. Hmm, the plan says "the same window." With real time, two calls ~100ms apart produce windows shifted by ~100ms. Our data at now-30min is in both. The assertion "identical projection contents and row counts" holds.

But to be strict about "the same window," fake timers are better. The risk with fake timers + Prisma: if we enable fake timers before creating PrismaClient or making DB calls, internal `setTimeout` usage could be affected. Let me think… Prisma client JS: when you call a query, it communicates with the query engine over a child process/IPC. Timeouts like `engineProcess` startup use `setTimeout`. With fake timers, `setTimeout` callbacks are queued but not executed unless time is advanced or real time passes… actually no — `vi.useFakeTimers()` fully replaces the timer implementation; queued callbacks only run when you call `vi.advanceTimersByTime` or when the fake clock advances. Real elapsed time doesn't advance the fake clock. So a `setTimeout(..., 1000)` inside Prisma would never fire during the test → potential hang.

Hmm, but actually, does Prisma use `setTimeout` in the hot path of a query? The Node client uses `@prisma/client/runtime` which communicates via IPC to the query engine. There are timeouts for engine startup (e.g., `getEngineEndpoint` with retry). During normal query execution, I don't think there's a `setTimeout` in the critical path — the query is a promise resolved by IPC message. But there might be `setTimeout(0)` somewhere for deferral… risky.

Safer: use fake timers narrowly — enable them, set system time, call `repairDrift()`, and… but the DB calls happen inside `repairDrift`. So fake timers would be active during the DB calls. Risky.

Alternative: don't use fake timers. Instead, make the window coverage robust:
- Corrupted row at `now - 30min`.
- Both `repairDrift` calls happen within milliseconds; the window `[now-1h, now-5min]` covers `now-30min` with 29+ minutes of margin on both ends. Deterministic enough.

And for "the same window": we can interpret it as "two consecutive runs of the scheduled job (same effective window for the data under test)." The observable assertion is "identical projection contents and row counts," which holds.

Hmm, but is that "exactly what the plan specifies"? The plan says "running `repairDrift` twice over the same window." Without fake timers, the two windows differ by milliseconds. I think that's acceptable — the intent is "two runs of the job don't change anything." Actually, you know what, let me reconsider fake timers with a twist:

We could pin time by setting the data relative to `Date.now()` at test start, without mocking. That's what I just described. Let's go with that. It's the most robust against Prisma/fake-timer interactions, and it tests real behavior.

Actually wait a moment, let me reconsider using `vi.useFakeTimers` with `{ toFake: ['Date'] }` — faking only `Date`, not the timer functions! That's a clean solution:

```ts
vi.useFakeTimers({ toFake: ['Date'] });
const fixed = new Date('2024-06-01T12:00:00Z');
vi.setSystemTime(fixed);
```

Then `Date.now()` returns the fixed time, but real `setTimeout`/`setInterval` still work, so Prisma is unaffected. Then both `repairDrift` calls compute exactly the same window: `[fixed - 1h, fixed - 5min]`.

Is `toFake: ['Date']` supported by Vitest? Yes — Vitest uses `@sinonjs/fake-timers` and supports the `toFake` option: `vi.useFakeTimers({ toFake: ['Date'] })`. And `vi.setSystemTime(fixed)`. This is well-supported.

This gives us a truly "same window" for both calls. I like this. And it's deterministic: the window is `[2024-06-01T11:00:00Z, 2024-06-01T11:55:00Z]`.

So the data:
- Source order with `occurred_at = 2024-06-01T11:30:00Z` (inside the window).
- Projection row for that order, corrupted: wrong status and wrong amount.
- Maybe a second source order with `occurred_at` outside the window (e.g., `2024-06-01T09:00:00Z`), with a correct projection row — to assert that repair doesn't touch rows outside the window? Hmm, wait — the "re-derivation for an arbitrary window" test (leaves rows outside untouched) is a separate bullet in the plan, not assigned to this file. But for the drift-repair recovery test, having an outside-window row makes the recovery assertion stronger (we can assert it's untouched). Hmm, but "implement exactly what the plan specifies for this file" — the two bullets. Adding an outside-window row to the idempotency test is fine as part of "identical projection contents" (contents include all rows). Let me keep the dataset minimal but meaningful:

For recovery test:
- Company C.
- Source order O1 (occurred_at inside window, status 'approved', amount 5000 cents).
- Projection row for O1 corrupted: status 'pending', amount 1.
- Run `repairDrift()`.
- Assert projection row for O1 now has status 'approved', amount 5000 (matches source).

For idempotency test:
- Company C, source orders O1 (inside window), maybe O2 (also inside window).
- First `repairDrift()` → establishes correct projection rows; capture snapshot (row count + full row contents).
- Second `repairDrift()` → capture again; assert deep equality.

Now, how to seed the source tables? The plan says source tables `payment_orders`, `events`, `workers`, `companies` "already exist and are owned by the write services." Their exact schema is not fully specified beyond the columns mentioned:
- `payment_orders` (`order_id`, `company_id`, `worker_id`, `event_id`, `status`, `amount_cents`, `currency`, `occurred_at`, ...)
- `events` (`event_id`, ...)
- `workers` (`worker_id`, ...)
- `companies` (`company_id`, ...)

Hmm, this is tricky. The plan's assumption: "Source tables payment_orders, events, workers, companies already exist and are owned by the write services; I add only the projection table and don't modify source DDL."

So the Prisma schema in this workspace… wait, what does `prisma/schema.prisma` contain? The manifest says `prisma/schema.prisma | reads: - | Prisma models + indexes for operation_read_models`. Hmm, "Prisma models + indexes for operation_read_models" — suggesting the schema file contains (at least) the projection model. But the service references `this.prisma.paymentOrder.findUnique({ where: { orderId: input.orderId } })` — so the Prisma client has a `paymentOrder` model. So the schema must also define source models (or they're defined elsewhere — Prisma supports multiple schema files now, but the convention here is a single `prisma/schema.prisma`).

Since I can't see the actual schema.prisma, I have to guess the Prisma model names and field names for the source tables. The service uses `this.prisma.paymentOrder` with `where: { orderId: input.orderId }`. So the model is `PaymentOrder` (property `paymentOrder`), and `orderId` is the unique field.

For seeding in tests, I'd use:
```ts
await prisma.paymentOrder.create({ data: { orderId: ..., companyId: ..., ... } });
```

But I don't know the exact required fields. This is a genuine unknown. Options:
1. Use `prisma.$executeRaw` / `$queryRaw` with raw SQL INSERTs into the source tables — using only column names from the plan (`order_id`, `company_id`, `worker_id`, `event_id`, `status`, `amount_cents`, `currency`, `occurred_at`). Raw SQL is allowed in tests (the "zero raw SQL" rule applies to the service layer; tests are not a layer). Actually, the convention says "the repository is the only layer that touches the database" — tests are not a layer; test setup touching the DB directly is standard. And using raw SQL for seeding avoids guessing Prisma model field names beyond what the plan gives us.

Hmm wait, but the projection table is in the Prisma schema (we know its exact shape from the plan: `operation_read_models` with fields id, order_id, company_id, worker_id, event_id, status, amount_cents, currency, occurred_at, created_at, updated_at). For the projection table, we can use the Prisma model `operationReadModel` (property name guess: Prisma's default property for model `OperationReadModel` is `operationReadModel`). Hmm, but I don't know the exact model name either! The plan says `@@map("operation_read_models")` but doesn't give the Prisma model name. By convention, it'd be `OperationReadModel`. The property would be `operationReadModel`.

Ugh, lots of guessing. Let me think about what's most defensible.

Actually — hold on. Let me reconsider. Maybe the tests should seed everything via raw SQL (`$executeRaw`), including the projection table. That way we only rely on column names (which the plan gives us precisely: `order_id`, `company_id`, `worker_id`, `event_id`, `status`, `amount_cents`, `currency`, `occurred_at`, `created_at`, `updated_at` for the projection; and source columns from the plan's assumption list). And we read back via `$queryRaw` too. This completely avoids guessing Prisma model/property names for seeding/assertions, and the only production code path exercised is processor → service → repository (which uses Prisma internally).

But wait — the repository's `rederiveWindow` reads source tables and writes projection rows. If the source tables' actual schema has more required columns than the plan lists (the "..." in the plan), a raw INSERT with only the listed columns might fail on NOT NULL constraints. But we can't know that; the plan's column list is our best knowledge. Using raw SQL with exactly the plan's columns is the most defensible reading, and if there are unknown required columns, we'd mark an assumption.

Hmm, alternatively, use Prisma client for the projection table (whose full schema we know from the plan) and raw SQL for source tables. Mixed approach. For assertions, reading projection rows: we can use `prisma.$queryRaw` or the Prisma model.

Let me think about what a careful engineer would write given only this plan. The plan gives us the exact projection table DDL (columns + types). It gives us source table column lists (with "..." indicating incompleteness). The service code shows `prisma.paymentOrder.findUnique({ where: { orderId } })`, confirming the Prisma model property `paymentOrder` and unique field `orderId`.

For seeding source orders, the most defensible is: raw SQL INSERT with the columns the plan names. Because the Prisma model's full field set is unknown (the "..." means we don't know all fields, and required ones beyond the listed would break `create`). With raw SQL, we control exactly what we insert. But if a NOT NULL column isn't in the plan's list, the INSERT fails — unavoidable unknown; we'd mark an assumption if needed.

Actually, hmm, wait. Let me reconsider: is it possible that the workspace's `schema.prisma` (which I can't see) defines the source models with exactly those fields? The plan's assumption says source tables "already exist" — in the context of this exercise, they might be defined in the schema file as part of the simulated environment. The plan author (me, per "your own spec") wrote the service using `prisma.paymentOrder` — so the schema has a `PaymentOrder` model. Given the plan's data model section lists source columns as `payment_orders (order_id, company_id, worker_id, event_id, status, amount_cents, currency, occurred_at, ...)`, the schema likely has at least those fields. The "..." is a hedge.

Decision: use raw SQL (`$executeRaw`/`$queryRaw`) for all test DB operations (source seeding, projection seeding/corruption, assertions, cleanup). Rationale:
- The plan gives us exact column names for both source (the columns we need) and projection tables.
- Avoids guessing Prisma model property names and required field sets.
- Tests are not subject to the layering rule (that rule governs src/ layers).
- Keeps the test's production imports to exactly: processor, service, types (per manifest) + repository (needed for construction) + PrismaClient + ConfigService.

Wait, but hmm: if we use raw SQL for projection rows, the `updated_at` column — the plan says it's `@updatedAt` in Prisma, but raw INSERT must provide all NOT NULL columns. `created_at` has `@default(now())`, `updated_at` has `@updatedAt` (which in Prisma is… `@updatedAt` means Prisma sets it automatically; the column itself — does it have a DB default? In Prisma, `@updatedAt` doesn't add a DB default; Prisma sets the value on every write. So a raw INSERT must supply `updated_at` (and `created_at` if we want it explicit, though it has a DB default). To be safe, supply both explicitly in raw INSERTs.

Also `id` — surrogate key with `autoincrement()`, so we can omit it (let it auto-increment) or supply it. For determinism of assertions, we don't need to know `id`; we key on `order_id`.

Now, the re-derivation logic in the repository (which I can't see, but per plan): "read source orders in that window joined to event/worker" — joined to events and workers! So the re-derivation query joins `payment_orders` with `events` and `workers`. If a source order references a non-existent event/worker… inner join would drop the row, or left join would keep it with nulls. The plan's projection has `worker_id` and `event_id` as nullable (`BigInt?`). So probably a LEFT JOIN (nullable). To be safe in tests, we should create `events` and `workers` rows that the orders reference. That way, regardless of inner/left join, the order is derivable.

So seeding per test:
1. `companies` row (company_id = X). Do we need this? The re-derivation joins order + event + worker per the plan ("read source orders in that window joined to event/worker" — companies not mentioned). The dashboard filters by company_id, but that's stored on the projection row from the order. So we might not need a `companies` row at all for re-derivation. But the source order has `company_id` — if there's a FK constraint to `companies`, the INSERT would fail without a company row. Unknown. To be safe, create a company row too. Cheap insurance. Hmm, but if the `companies` table has other required columns (name, etc.), my raw INSERT would fail. Ugh.

This is getting into deep unknown territory. Let me step back and think about what the "most defensible reading" is, and where to place ASSUMPTION comments.

The instructions say: "If a symbol you truly need is missing from both the plan and references, don't silently guess or reason around it: write the file with the most defensible reading, and mark it at the point where it matters with a single `// ASSUMPTION: <what was unresolved>` comment."

So I should write the file with my best reading and mark assumptions where things are truly unresolved. Key unresolveds:
1. Source table schemas beyond the plan's column list (FK constraints, other required columns). → Assume the plan's listed columns suffice for a minimal INSERT (no additional NOT NULL columns, no FK enforcement issues, or that we create parent rows).
2. Whether `events`/`workers` rows are required for re-derivation (join type). → Create them to be safe.
3. Prisma model names for raw vs typed access. → Use raw SQL to sidestep.

Hmm wait, actually, let me reconsider using Prisma typed access for the projection table. The plan fully specifies the projection model's fields and says `@@map("operation_read_models")`. The Prisma model name is almost certainly `OperationReadModel` (matching the TS interface and class names in the plan). The property would be `operationReadModel`. If I use `prisma.operationReadModel.findMany(...)`, and the model name is different, the test breaks at runtime (property undefined). With raw SQL, zero such risk. Raw SQL it is — for both read and write in tests.

Actually, one more consideration: bigint handling in raw SQL. `order_id`, `company_id`, `amount_cents` are bigint. In Postgres via `$queryRaw`, bigints come back as strings (node-postgres returns int8 as string). So `amount_cents` from `$queryRaw` would be a string like `"5000"`. We'd need to compare accordingly (e.g., `Number(row.amount_cents)` or compare as strings). In INSERTs, we pass JS numbers/strings — fine.

Alternatively, use `prisma.$queryRaw` with tagged templates and handle strings. Let me plan assertions:

```ts
const rows = await prisma.$queryRaw`SELECT * FROM operation_read_models WHERE order_id = ${orderId}`;
```

Returns array of objects with string keys as column names (snake_case). `amount_cents` is a string.

OK, let me now design the test file concretely.

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import { DriftRepairProcessor } from '../src/operations/drift-repair.processor';
import { OperationReadModelService } from '../src/operations/operation-read-model.service';
import { OperationReadModelRepository } from '../src/operations/operation-read-model.repository';
```

Wait — path: the test file is at `test/drift-repair.spec.ts`, sources at `src/operations/...`. So imports are `../src/operations/drift-repair.processor`. Yes.

Do we need to import anything from the types file? The manifest says this test reads it. Maybe for `DateWindow`… we don't construct a window (repairDrift computes it). Hmm. Maybe not needed. But the manifest lists it. We could import a type for documentation purposes… importing an unused symbol would be a lint issue. Alternatively, we don't import from types — the manifest is a guide, and unused imports are worse. Hmm.

Actually wait — do we use `DateWindow` anywhere? If the idempotency test calls `processor.repairDrift()` twice, no window is constructed. If we also wanted to call `service.rederiveWindow(window)` explicitly… the plan's idempotency bullet says "running `repairDrift` twice" — that's the processor method. So no DateWindow needed.

Let me not import from types (avoiding unused imports). Or… hmm, the manifest explicitly lists it as a read. Tension again. Let me think: is there a natural use? We could type the fixture data:

```ts
import type { OperationReadModel } from '../src/operations/operation-read-model.types';
```

And use it to type a helper that maps raw rows to the shape? That feels forced. Or type the snapshot:

```ts
interface ProjectionRow { order_id: string; ... }
```

No. I think the cleanest is: don't import types if unused. The manifest's reads list is descriptive, not prescriptive to the level of forcing an unused import. Actually wait, let me reconsider — maybe we should use the service's `rederiveWindow` in the idempotency test with an explicit window, making "the same window" literal and importing `DateWindow`. But the plan says "running `repairDrift` twice" — repairDrift is the processor's method name. Using `service.rederiveWindow` would deviate from the named subject. Hmm, but actually — "drift repair" is the feature; `repairDrift` is its entry point. The bullet names `repairDrift`. Let's use `processor.repairDrift()`.

Final call: import only what we use. If types aren't used, skip. Let me double-check if any type is naturally needed… The return of `repairDrift` is `Promise<number>` (rows written). No type import needed. OK, skip types import. Hmm, but the manifest…

You know what, let me reconsider once more. There's a subtle argument for using the types import: error classes? No, this test doesn't expect errors. `DateWindow`? Only if we call rederiveWindow directly.

Alternatively — what if the idempotency test is structured as: run `repairDrift()` (job path), then run `repairDrift()` again, and compare. And the recovery test: corrupt, run `repairDrift()`, assert. Both use only the processor. No types needed.

I'll go without a types import and accept the minor manifest deviation (or, the manifest's "reads" might just reflect that the test conceptually depends on the type contract). Actually hmm, wait — one more idea: we could import `DateWindow` and use it to document/verify the effective window in a comment… no, unused imports are a real code smell and might fail lint. Skip.

Hmm, actually hold on. Let me reconsider whether to construct the service via the repository import or via a NestJS testing module. Direct instantiation:

```ts
const prisma = new PrismaClient();
const repository = new OperationReadModelRepository(prisma);
const service = new OperationReadModelService(repository, prisma);
const config = new ConfigService();
const processor = new DriftRepairProcessor(service, config);
```

`new ConfigService()` — the constructor signature in @nestjs/config: `constructor(private readonly configObject: Record<string, any> = {})`. Yes, no-arg works. `config.get('DRIFT_REPAIR_LAG_MS')` → undefined → processor uses DEFAULT_LAG_MS (1h) and DEFAULT_SAFETY_MARGIN_MS (5min).

But wait — is it OK to rely on the processor's defaults? The processor reads env via ConfigService. In the test environment, `DRIFT_REPAIR_LAG_MS` is presumably unset → defaults: lag 1h, safety 5min. So the window = [now - 1h, now - 5min]. Our fake system time makes this exact: [fixed - 1h, fixed - 5min].

But relying on defaults couples the test to the processor's default constants (which are in the reference file: DEFAULT_LAG_MS = 1h, DEFAULT_SAFETY_MARGIN_MS = 5min — visible in the read-only reference). Since we have the processor source, we know the defaults exactly. Good — no assumption needed there. Alternatively, we could set env vars explicitly to be robust:

```ts
process.env.DRIFT_REPAIR_LAG_MS = String(60 * 60 * 1000);
process.env.DRIFT_REPAIR_SAFETY_MARGIN_MS = String(5 * 60 * 1000);
```

Hmm, but ConfigService with no config object reads from `process.env`? Let me recall: `ConfigService.get(key)` — if no config object was provided… actually, in @nestjs/config, `ConfigService`'s `get` falls back to `process.env`? Let me think. The ConfigService implementation:

```ts
get<T>(propertyPath: string, defaultValue?: T): any {
  const value = this.getFromObject(propertyPath);
  if (value !== undefined) return value;
  const envValue = this.getFromProcessEnv(propertyPath); // hmm, is this right?
  ...
}
```

Actually, I recall that `ConfigService` in @nestjs/config does check `process.env` as a fallback when no config object value is found. Let me recall the source… `ConfigService.get`:

```ts
public get<T>(propertyPath: string, defaultValue?: T): any {
    const value = this.getFromObject(propertyPath);
    if (value !== undefined) {
      return value;
    }
    const envValue = this.getFromProcessEnv(propertyPath);
    if (envValue !== undefined) {
      return envValue;
    }
    ...
}
```

Hmm, I'm not 100% sure about the exact internals across versions. In some versions, `ConfigService` without a config object: `this.configObject = {}`, and `get` checks the config object, then `process.env`. I believe modern @nestjs/config does fall back to process.env. But to be safe, we can pass a config object explicitly:

```ts
const config = new ConfigService({
  DRIFT_REPAIR_LAG_MS: String(60 * 60 * 1000),
  DRIFT_REPAIR_SAFETY_MARGIN_MS: String(5 * 60 * 1000),
});
```

This guarantees the window regardless of env or ConfigService fallback behavior. And it makes the test's window explicit and documented. The processor does `Number(this.config.get('DRIFT_REPAIR_LAG_MS') ?? DEFAULT_LAG_MS)` — with our config object, `get` returns the string, `Number(...)` → 3600000.

But wait — is passing a config object "changing what we're testing"? No — the window bounds are test fixtures; pinning them makes the test deterministic and explicit. The behavior under test is re-derivation recovery + idempotency, not env parsing. Pinning config is good test practice here. But hmm — the plan says "scheduled job runs on a cron interval (configurable via env)" and the processor defaults are known. Using explicit config values equal to the defaults is safest. Let's do that.

Actually, hmm, one concern: `new ConfigService({...})` — the constructor takes a `Record<string, any>`. Yes. And `config.get('DRIFT_REPAIR_LAG_MS')` returns the string we provided. Good.

Now, fake timers for Date:

```ts
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(FIXED_NOW);
```

With `toFake: ['Date']`, only the `Date` constructor/now is faked; real timers remain, so Prisma's internal setTimeout works. `vi.setSystemTime(new Date('2024-06-01T12:00:00.000Z'))`.

Wait, does `vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime` work in Vitest? Yes — setSystemTime works with the Date fake. This is standard.

Then `Date.now()` inside `repairDrift` returns FIXED_NOW. Window: from = FIXED_NOW - 3600000, to = FIXED_NOW - 300000.

Data timestamps:
- Inside window: `2024-06-01T11:30:00Z` (FIXED_NOW - 30min).
- Outside window (before): `2024-06-01T10:00:00Z` (FIXED_NOW - 2h) — outside [11:00, 11:55].
- Outside window (after): `2024-06-01T11:58:00Z` (FIXED_NOW - 2min) — after `to` (11:55).

Should we include outside-window rows? For the recovery test, an outside-window row with a correct projection would let us assert that repair doesn't touch it — strengthening "restored to match source" without collateral damage. But the plan's bullet only says: corrupt a row, repair, assert it's restored. Adding an outside-window row is a reasonable part of "assert the row is restored to match source" (and that others aren't broken). Hmm, "implement exactly what the plan specifies" — I think including a control row is within the spirit of the recovery test (verifying the repair's window targeting). But it also overlaps with the "re-derivation for an arbitrary window" bullet (leaves rows outside untouched), which is a separate test. To keep this file focused on the two assigned bullets, maybe keep the dataset minimal: one company, one or two orders inside the window.

Let me design:

**Test 1: "recovers divergence"**
- Seed: company 1; worker 7; event 9.
- Source order A: order_id=100, company_id=1, worker_id=7, event_id=9, status='approved', amount_cents=5000, currency='USD', occurred_at=2024-06-01T11:30:00Z (inside window).
- Projection row for order 100 exists but is corrupted: status='pending', amount_cents=1 (simulating drift).
- Run `await processor.repairDrift()`.
- Assert: projection row for order 100 now has status='approved', amount_cents=5000, currency='USD', worker_id=7, event_id=9, company_id=1, occurred_at matching source. I.e., "restored to match source."

How do we seed the corrupted projection row? Raw INSERT into operation_read_models with the wrong values. Columns: order_id, company_id, worker_id, event_id, status, amount_cents, currency, occurred_at, created_at, updated_at. (id auto-increments.)

Wait — but the re-derivation does "delete projection rows in window, then bulk insert derived rows." So after repair, the corrupted row is replaced by a fresh derived row. The assertion reads the projection row for order 100 and compares to source values.

Also, should we assert that the return value of `repairDrift` equals the number of rows written (e.g., 1)? The plan says rederiveWindow "returns rows written." Asserting `result === 1` is a behavioral assertion tied to the contract. Hmm — is that "asserting that a call merely happened"? No, it's asserting the documented return contract. I think it's fine to include, but the core assertion is the row contents. Let me include it lightly (expect(result).toBe(1)) — actually, let me be careful: "never assert that a call merely happened" — the return count is a real observable. OK, include.

**Test 2: "idempotent"**
- Seed: company 1; worker/event; two source orders inside the window: order 200 (amount 1000, status 'approved', occurred_at 11:20), order 210 (amount 2500, status 'captured', occurred_at 11:40).
- Projection initially empty (or with stale rows? for a pure idempotency test, start from whatever; run repair once → snapshot; run again → snapshot; compare).
- Run `repairDrift()` → returns n1.
- Snapshot: full contents of operation_read_models (all rows, ordered by order_id).
- Run `repairDrift()` → returns n2.
- Snapshot again.
- Assert: snapshots are deeply equal; row counts equal; and (behaviorally) the rows match source values. Also n1 === n2? The return is "rows written" — both runs write the same 2 rows. Assert n1 === 2 and n2 === 2? Hmm, "identical projection contents and row counts" — the plan's assertion is about contents + row count. Let me assert snapshot equality and that each row matches source (so idempotency isn't trivially "both empty").

Actually, to make the idempotency test meaningful (not vacuous), we should assert that the projection is non-empty and correct after the first run, then identical after the second. Yes.

Should the idempotency test start from a corrupted state? The plan says "running `repairDrift` twice over the same window yields identical projection contents and row counts." Starting from a corrupted state: run 1 fixes, run 2 no change — also valid. But simpler: start clean (or with stale rows). Hmm, starting with one stale/corrupted row makes the first run do real work and the second a true no-op. Let me seed one corrupted row for order 200 (wrong status) to make run 1 non-trivial, and run 2 must produce identical contents. That directly tests "a missed or doubled tick is harmless."

Now — cleanup between tests: each test should start from a clean slate. Use `beforeEach`/`afterEach` to truncate/delete rows in the tables we touch: operation_read_models, payment_orders, events, workers, companies. Raw SQL DELETEs (no FK ordering issues if we delete children first; or TRUNCATE ... CASCADE — but TRUNCATE needs privileges; DELETE is safer).

Order of deletes: operation_read_models, payment_orders, workers, events, companies. If there are FKs from payment_orders to workers/events/companies, deleting children first works.

Now, the seed helper (raw SQL):

```ts
async function seedCompany(companyId: bigint): Promise<void> { ... }
```

Hmm wait, do we really need companies/workers/events rows? Let me think about what the re-derivation query needs. Per plan: "read source orders in that window joined to event/worker." So the query joins payment_orders → events (on event_id) and → workers (on worker_id). If we don't create event/worker rows:
- Inner join: the order is dropped → re-derivation writes 0 rows → the recovery test fails (no row to restore).
- Left join: the order is kept with null event/worker → works.

We don't know the join type (repository implementation isn't shown). To be robust, create event + worker rows. Then both join types yield the order with non-null ids.

Do we need a company row? The re-derivation per plan doesn't join companies ("join of order + event + worker"; the dashboard's company filter uses the stored company_id). If there's an FK payment_orders.company_id → companies.company_id, the INSERT needs a company row. Create one — cheap. But the `companies` table's columns are unknown beyond `company_id`. Raw INSERT with only company_id: fails if there are other NOT NULL columns without defaults. Risk. Same risk exists for events/workers (only `event_id`/`worker_id` known).

Hmm. This is the core unknown. The plan's source table descriptions are minimal: `events (event_id, ...)`, `workers (worker_id, ...)`, `companies (company_id, ...)`. The "..." strongly suggests more columns exist. If those columns are NOT NULL without defaults, minimal INSERTs fail.

What's the most defensible reading? In this simulated exercise, the source tables are likely minimal test fixtures defined in the same schema file — probably just the listed columns (the "..." being a hedge for "and whatever else"). Given the plan's assumption that source tables "already exist and are owned by write services," and that this is a self-contained exercise, the simplest consistent world is: source tables have exactly the listed columns (with reasonable types), no additional NOT NULLs. Let me write minimal INSERTs and mark one ASSUMPTION comment at the seed helper: that source tables accept rows with only the plan-listed columns.

Alternatively — can we avoid creating events/workers/companies entirely by not referencing them? I.e., seed the source order with `worker_id = NULL, event_id = NULL`? The projection allows null worker/event. If the re-derivation is a LEFT JOIN, nulls are fine. If INNER JOIN, the order is dropped → test fails. So we can't rely on nulls. We need real event/worker rows to be safe. And company — the order needs a company_id (the dashboard filters by it; the plan's OperationUpsertInput has non-null companyId). Can company_id be null in payment_orders? The plan lists it as a column without "?", and the projection's company_id is non-null. So the order needs a real company. If there's an FK, we need a company row.

So: seed all four tables minimally, with one ASSUMPTION comment covering the source-table schema.

Hmm wait, actually — let me reconsider. Is it possible that the workspace's Prisma schema defines these source models, and we're expected to use `prisma.paymentOrder.create(...)` etc.? The service reference shows `prisma.paymentOrder.findUnique({ where: { orderId } })`. So `paymentOrder` is a known client property. For events/workers/companies, the client properties would be `event`, `worker`, `company` (guessing model names Event, Worker, Company). Using typed create would fail if required fields are unknown — same risk as raw SQL, plus model-name guessing risk. Raw SQL with known column names is strictly less risky. Going with raw SQL.

Also for reading back: `prisma.$queryRaw` returning snake_case columns with bigint as string. Let me write a helper:

```ts
async function projectionRows(orderIds: number[]): Promise<Array<Record<string, unknown>>> {
  return prisma.$queryRaw`SELECT * FROM operation_read_models WHERE order_id IN (${...})`;
}
```

Hmm, `IN` with a spread in tagged templates: Prisma supports `$queryRaw\`... IN (${Prisma.sql`...`})\`` or spread of values: `WHERE order_id IN (${orderIds})` — Prisma's tagged template supports spreading an array into an `IN` clause: yes, `prisma.$queryRaw\`SELECT * FROM t WHERE id IN (${[1,2,3]})\`` works (Prisma expands arrays in IN). But simpler: just `SELECT * FROM operation_read_models` (whole table) — the tests control all rows, and the snapshot of the whole table is exactly what we want for idempotency comparison. For targeted assertions, filter in JS.

Let me define:

```ts
type DbRow = Record<string, string | number | null>;

async function snapshotProjection(): Promise<DbRow[]> {
  const rows = await prisma.$queryRaw`SELECT * FROM operation_read_models ORDER BY order_id`;
  return rows as DbRow[];
}
```

Wait — `$queryRaw` with a tagged template that has no interpolations: `prisma.$queryRaw\`SELECT ...\`` — allowed (returns unknown[]). Cast to DbRow[].

bigint columns come back as strings: order_id, company_id, worker_id, event_id, amount_cents, id. occurred_at/created_at/updated_at come back as Date (node-pg parses timestamptz to Date). status/currency are strings.

For assertions comparing to source: we know the expected values (we seeded them), so we compare directly:

```ts
expect(row.status).toBe('approved');
expect(row.amount_cents).toBe('5000'); // bigint → string from the driver
```

Hmm, the string-ness of bigint is a driver detail (pg returns int8 as string). That's standard for Postgres + node-pg. But is it "most defensible"? To be robust to driver differences, we could normalize: `Number(row.amount_cents)`. That's safer — works whether the driver returns string or number. Let me normalize numerics in assertions via Number(). For order_id comparisons: `Number(row.order_id) === 100` or filter with `String(row.order_id) === '100'`. Let me write a small helper `rowForOrder(rows, orderId)` that finds by `Number(row.order_id)`.

Actually, cleaner: in the snapshot helper, map rows to a normalized shape:

```ts
interface ProjectionRow {
  order_id: number;
  company_id: number;
  worker_id: number | null;
  event_id: number | null;
  status: string;
  amount_cents: number;
  currency: string;
  occurred_at: Date;
}

function normalize(row: Record<string, unknown>): ProjectionRow {
  return {
    order_id: Number(row.order_id),
    company_id: Number(row.company_id),
    worker_id: row.worker_id === null ? null : Number(row.worker_id),
    event_id: row.event_id === null ? null : Number(row.event_id),
    status: String(row.status),
    amount_cents: Number(row.amount_cents),
    currency: String(row.currency),
    occurred_at: row.occurred_at instanceof Date ? row.occurred_at : new Date(String(row.occurred_at)),
  };
}
```

Hmm, this is getting heavy. Is the normalization over-engineering? The environment is Postgres + Prisma (node-pg under the hood for $queryRaw). node-pg definitely returns int8 as string, timestamptz as Date. So we could assert directly with strings. But Number() normalization is a one-liner per field and makes the test robust. Let me keep it light: use `Number(...)` at assertion sites rather than a full normalizer. Hmm, but for deep-equality of snapshots (idempotency), we compare raw rows — the driver is consistent within the test, so raw deep equality works fine (both snapshots from the same driver). No normalization needed for the equality check.

Plan for assertions:
- Recovery test: fetch the row for order 100; assert status, amount (Number), currency, company_id (Number), worker_id (Number), event_id (Number), occurred_at (Date equality via toISOString or getTime).
- Idempotency test: snapshot1 = raw rows; run; snapshot2 = raw rows; expect(snapshot2).toEqual(snapshot1); plus assert snapshot1 has the expected 2 orders with source values (non-vacuity); plus row count.

Now, seeding via raw SQL:

```ts
await prisma.$executeRaw`
  INSERT INTO companies (company_id) VALUES (${companyId})
`;
```

Wait, `companies` — the plan says the table is `companies`. Column `company_id`. OK.

```ts
await prisma.$executeRaw`INSERT INTO workers (worker_id) VALUES (${workerId})`;
await prisma.$executeRaw`INSERT INTO events (event_id) VALUES (${eventId})`;
await prisma.$executeRaw`
  INSERT INTO payment_orders (order_id, company_id, worker_id, event_id, status, amount_cents, currency, occurred_at)
  VALUES (${orderId}, ${companyId}, ${workerId}, ${eventId}, ${status}, ${amountCents}, ${currency}, ${occurredAt})
`;
```

And the corrupted projection row:

```ts
await prisma.$executeRaw`
  INSERT INTO operation_read_models (order_id, company_id, worker_id, event_id, status, amount_cents, currency, occurred_at, created_at, updated_at)
  VALUES (${orderId}, ${companyId}, ${workerId}, ${eventId}, ${status}, ${amountCents}, ${currency}, ${occurredAt}, ${now}, ${now})
`;
```

Hmm — `created_at` has a DB default, but supplying it explicitly is fine. `updated_at` — no DB default (Prisma's @updatedAt), so we must supply it. Supply both.

Wait, one concern: `occurred_at` — is it `timestamptz`? Prisma DateTime → timestamptz. Passing a JS Date to $executeRaw → parameterized as timestamp. Fine.

Another concern: `order_id` is bigint; passing a JS number 100 → fine (within int8 range).

Now, the cleanup helper:

```ts
async function cleanup(): Promise<void> {
  await prisma.$executeRaw`DELETE FROM operation_read_models`;
  await prisma.$executeRaw`DELETE FROM payment_orders`;
  await prisma.$executeRaw`DELETE FROM workers`;
  await prisma.$executeRaw`DELETE FROM events`;
  await prisma.$executeRaw`DELETE FROM companies`;
}
```

In `afterEach` (or beforeAll + afterEach). Use `beforeAll` for prisma connect? PrismaClient connects lazily; explicit `$connect`/`$disconnect` is cleaner:

```ts
beforeAll(async () => { await prisma.$connect(); });
afterAll(async () => { await prisma.$disconnect(); vi.useRealTimers(); });
```

And fake timers: set in beforeAll or per test. `vi.useFakeTimers({ toFake: ['Date'] })` in beforeAll, `vi.setSystemTime(FIXED_NOW)` in beforeEach (or once). `vi.useRealTimers()` in afterAll.

Wait — do we even need fake timers? Let me reconsider the trade-offs once more. With fake Date:
- Pro: both repairDrift calls compute byte-identical windows → "the same window" is literally true.
- Pro: data timestamps are absolute constants, readable in the test.
- Con: `toFake: ['Date']` must be supported (it is, in Vitest ≥ 0.31 or so; we're on modern Vitest per Node 20+ convention).
- Con: any code that constructs `new Date()` during DB operations… Prisma internally might use `Date` for logging/timestamps — with a faked Date, those would use the fixed time. Harmless (just log timestamps). Actually, hmm — could faking Date break Prisma? Prisma uses `Date.now()` for query metrics/logging. A fixed time is harmless. The risk I was worried about (setTimeout not firing) is avoided by toFake: ['Date'].

I'm fairly confident `toFake: ['Date']` is safe and gives us the strongest determinism. Let's go with it.

Hmm, wait — one more: `vi.setSystemTime` requires the Date fake to be active. Order: `vi.useFakeTimers({ toFake: ['Date'] })` then `vi.setSystemTime(FIXED_NOW)`. Yes.

Now, let me also double-check the processor's `@Cron(DRIFT_REPAIR_CRON)` decorator: at module load, it evaluates `process.env.DRIFT_REPAIR_CRON ?? CronExpression.EVERY_5_MINUTES`. In the test, env is presumably unset → EVERY_5_MINUTES. The decorator just registers metadata; without a running Nest app with the scheduler module, nothing fires. We call `repairDrift()` directly. Fine.

Also — importing the processor file imports `@nestjs/schedule` (Cron, CronExpression) and `@nestjs/config`. Those packages must be installed — they're used in production code, so yes.

Now, the service's `rederiveWindow` → repo's `rederiveWindow` (implementation not shown, but per plan: one transaction: delete rows in [from,to), read source joined, bulk insert). We trust the plan.

One more design question: should the test verify that rows outside the window are untouched (as part of recovery)? The plan's recovery bullet: "assert that the row is restored to match source." Minimal: assert the corrupted row is restored. Let me also seed a second order inside the window that's already correct, and assert it remains correct after repair (i.e., repair doesn't break correct rows — part of "what operators see" stability). Hmm, is that scope creep? It's a natural part of "recovers divergence": the repair fixes the divergent row without corrupting the rest. I think a two-order dataset (one corrupted, one correct) is defensible and makes the test stronger. Actually — for the idempotency test, we also want ≥2 rows so "row count" is meaningful.

Let me finalize the dataset per test:

**describe('drift repair')** — or two describes? The manifest description: "drift repair recovers divergence and is idempotent." Let me structure as:

```ts
describe('drift repair', () => {
  it('recovers a diverged projection row to match the source tables', async () => {...});
  it('is idempotent: running twice over the same window leaves identical contents and row counts', async () => {...});
});
```

Test 1 (recovery):
- FIXED_NOW = 2024-06-01T12:00:00Z. Window = [11:00, 11:55).
- Seed company 1, worker 7, event 9.
- Order A: id 100, occurred_at 2024-06-01T11:30:00Z, status 'approved', amount 5000, currency 'USD'.
- Order B: id 101, occurred_at 2024-06-01T11:15:00Z, status 'captured', amount 250, currency 'USD'. (Correct in projection — control.)
- Projection: row for 100 corrupted (status 'pending', amount 1); row for 101 correct.
- `const written = await processor.repairDrift();`
- Assert written === 2 (both orders in the window are re-derived).
- Read projection rows: row 100 → status 'approved', amount 5000, currency 'USD', company 1, worker 7, event 9, occurred_at 11:30. "Restored to match source."
- Row 101 unchanged: status 'captured', amount 250.

Hmm wait, should we assert `written === 2`? The return contract is "rows written." Re-derivation deletes in-window rows and inserts derived ones. Both orders are in the window → 2 written. This is a real behavioral assertion. But it couples to the implementation's counting semantics ("rows written" = inserted count). The plan says `rederiveWindow(window): Promise<number>; // returns rows written`. So yes, 2 is the contractually expected value. Include it.

Test 2 (idempotency):
- Seed company 1, worker 7, event 9.
- Order C: id 200, occurred_at 11:20, 'approved', 1000.
- Order D: id 210, occurred_at 11:40, 'refunded', 300.
- Projection: start with a stale row for 200 (wrong status 'pending') and no row for 210 — so the first run does real work (fixes 200, adds 210).
- `const first = await processor.repairDrift();`
- `const afterFirst = await projectionSnapshot();`
- Assert afterFirst has 2 rows with correct values (non-vacuity: the first run actually converged).
- `const second = await processor.repairDrift();`
- `const afterSecond = await projectionSnapshot();`
- `expect(afterSecond).toEqual(afterFirst);` — identical contents.
- Row counts equal (implied by toEqual on arrays, but the plan says "contents and row counts" — let me assert `afterSecond.length === afterFirst.length` explicitly too, and maybe `first === second`).

Hmm, "identical projection contents and row counts" — toEqual covers both (same array length + same elements). An explicit `.length` assertion is redundant but harmless and mirrors the plan's wording. Let me include it for clarity.

Wait, one subtlety: the snapshot includes `created_at`/`updated_at` — do those change between runs? Re-derivation deletes and re-inserts rows → new `created_at` (now) and `updated_at`. But wait — with faked Date, `now()` = FIXED_NOW for both runs. But does the re-derivation use Prisma's `@default(now())` (DB-side now) or JS-side? The DB-side `now()` is the real server time, not faked! So `created_at` would differ between run 1 and run 2 (real DB clock advances by milliseconds). Then `afterSecond` rows would have different `created_at`/`updated_at` than `afterFirst` → toEqual fails!

Uh oh. This is a real problem. Let me think.

The projection table: `created_at DateTime @default(now())` — DB default, real time. `updated_at @updatedAt` — set by Prisma on writes (Prisma generates the value in JS… actually, for @updatedAt, Prisma sets the field on update operations; on create, it also sets it. The value comes from JS `new Date()` — which is faked! Hmm, interesting: @updatedAt values are generated client-side by Prisma → use faked Date → FIXED_NOW. But `created_at`'s DB default `now()` is server-side → real time.)

Wait, actually — does Prisma send created_at on create? No: `@default(now())` means Prisma omits the column and the DB fills it. So created_at = real server now. updated_at: Prisma includes it in the INSERT/UPDATE with a JS-generated timestamp (faked → FIXED_NOW).

So between two repairDrift runs:
- Run 1 inserts rows: created_at = real T1, updated_at = FIXED_NOW.
- Run 2 deletes and re-inserts: created_at = real T2 (T2 > T1, milliseconds later), updated_at = FIXED_NOW.

`SELECT *` snapshots would differ in created_at → toEqual fails.

Solutions:
a) Exclude created_at/updated_at from the snapshot — select only the business columns: `SELECT order_id, company_id, worker_id, event_id, status, amount_cents, currency, occurred_at FROM operation_read_models ORDER BY order_id`. "Projection contents" for drift purposes = the derived business fields (re-derivation is "a pure function of source" per plan — the identity of a row is its business content; bookkeeping timestamps are not part of the derived content). This is defensible: drift is about divergence from source, and created_at/updated_at are maintenance metadata, not derived content.

b) Compare per-order business fields after normalizing.

c) Don't fake Date; use real time and accept that windows shift by milliseconds (then created_at differs anyway → same problem for SELECT *).

So (a): snapshot selects explicit business columns. That's clean and principled: "projection contents" = the derived fields. Let me document that in a comment: bookkeeping columns (created_at/updated_at
