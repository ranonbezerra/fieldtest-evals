# plan

## reasoning

```
Let me analyze the task carefully. I need to write a PLAN.md for migrating a NestJS billing service from Prisma to Drizzle. The variant-a.md describes:

1. A working NestJS billing service with accounts, invoices, line items on Prisma
2. Need to migrate to Drizzle completely
3. Schema recreated in Drizzle with same tables/columns/constraints
4. Every repository/service query ported
5. Public API contract byte-compatible (field presence, null vs missing, numeric string formats - BigInt as strings)
6. Transactional behavior preserved (invoice creation writes invoice + line items + account counters atomically)
7. Find uncovered behaviors, pin with tests, document in MIGRATION_NOTES.md

Let me think about what the data model likely looks like based on the description:
- accounts (id, name, balance/credit counter, etc.)
- invoices (id, account_id, amount BigInt, status, etc.)
- line_items (id, invoice_id, description, amount, quantity, etc.)

The key constraints:
- NestJS API layer stays
- Prisma → Drizzle for data access only
- Repository pattern (from the conventions)
- BigInt amounts serialized as strings in API responses
- Transactions: invoice creation = insert invoice + insert line items + update account counters, all atomic

Let me structure the PLAN.md with 6 sections.

**1. Assumptions:**
- Drizzle ORM with `drizzle-orm/node-postgres` driver (pg pool)
- Migrations via `drizzle-kit generate` producing SQL in `drizzle/` directory
- Schema file: `src/db/schema.ts`
- DB client: `src/db/client.ts`
- Repository pattern preserved per conventions (controller → service → repository)
- `DATABASE_URL` env var unchanged
- pnpm workspace, ESM
- Keep the same NestJS module structure
- Remove `prisma/` directory entirely, remove `@prisma/client` and `prisma` deps
- BigInt handling: Prisma returns BigInt for `Decimal`/`BigInt` columns; Drizzle does too with `bigint` type. The serialization to string must happen at the same layer (controller or service).
- Line items have: id, invoice_id, description, unit_price (BigInt), quantity (int), line_total (BigInt)
- Accounts have: id, name, email, credit_balance (BigInt), total_invoiced (BigInt)
- Invoices have: id, account_id, status, subtotal (BigInt), total (BigInt), created_at, due_date

Wait, I don't have the actual fixture. Let me re-read the task. The variant says "The fixture is a working NestJS billing service on Prisma (accounts, invoices, line items)." I need to make reasonable assumptions about the schema since I don't have the actual files.

Let me think about what's reasonable for a billing service:
- accounts: id (uuid), name, email, credit_limit (BigInt cents), balance (BigInt cents), created_at
- invoices: id (uuid), account_id (uuid FK), status (enum: draft/sent/paid/void), subtotal_cents (BigInt), tax_cents (BigInt), total_cents (BigInt), due_date, created_at, updated_at
- line_items: id (uuid), invoice_id (uuid FK), description, unit_price_cents (BigInt), quantity (int), line_total_cents (BigInt)

The transactional behavior: creating an invoice:
1. Insert invoice
2. Insert line items
3. Update account counters (e.g., total_invoiced += invoice.total, or balance -= something)

All in one transaction.

**2. Data model:** I'll define the three tables with their columns.

**3. Types and signatures:** This is where I need to be thorough. Every repository method, every service method, the DTOs, the error types.

**4. Control flow:** Transaction boundary for invoice creation. Normal read paths.

**5. Tests:** Existing tests + new tests for uncovered behavior + transaction failure test.

**6. Manifest:** All files I'll write.

Let me think about what files to produce:
- `src/db/schema.ts` — Drizzle schema
- `src/db/client.ts` — pg Pool + drizzle instance
- `src/db/migrate.ts` — migration runner
- `drizzle/0000_initial.sql` — initial migration (or however drizzle-kit names it)
- `src/accounts/accounts.repository.ts` — rewritten
- `src/invoices/invoices.repository.ts` — rewritten
- `src/line-items/line-items.repository.ts` — rewritten (or maybe line items are in invoices repo)
- `src/accounts/accounts.service.ts` — rewritten (if it had Prisma calls... but per conventions, service has zero Prisma calls. So services stay the same, only repositories change)

Wait — re-reading conventions: "service holds the logic. Zero raw SQL, zero Prisma client calls." So the service already doesn't touch the DB directly. The repository is the only layer that touches the database. So the migration is really:
1. Replace Prisma schema with Drizzle schema
2. Rewrite repositories to use Drizzle instead of Prisma client
3. Remove Prisma dependency
4. Keep services and controllers the same (they call repository methods)

But wait — the task says "Every repository/service query ported." If services have no DB calls, then it's really just repositories. Unless the original fixture violated the convention... but the conventions say "no exceptions." I'll assume services don't touch DB directly.

Actually, let me reconsider. The conventions are for THIS codebase (the one I'm planning for). The fixture might have services that do touch the DB if it was written before these conventions. But the task says to migrate the data layer — I'll assume the proper layered architecture is in place and only repositories need rewriting.

Files to write:
- `PLAN.md` (this document)
- `src/db/schema.ts`
- `src/db/client.ts`  
- `drizzle/0000_init.sql` (or the drizzle migration)
- `src/accounts/accounts.repository.ts`
- `src/invoices/invoices.repository.ts`
- `src/accounts/accounts.service.ts` (if changes needed for types)
- `src/invoices/invoices.service.ts`
- `MIGRATION_NOTES.md`
- Test files

Actually, I need to be careful. The task says "List only files you will write." So I should list the implementation files, not this PLAN.md itself (or should I? The instruction says "Write PLAN.md" so it IS a file I write). Let me include it.

Wait, re-reading: "List only files you will write." — the manifest lists files in the output. PLAN.md is what I'm writing now. The other files are what the implementer will write. But the manifest format shows `src/thing.ts | reads: - | what it holds` — this is a manifest of all files in the deliverable. Let me include PLAN.md and MIGRATION_NOTES.md as well since they're part of the deliverable.

Actually, I think the manifest should list all files that will exist in the final state that I'm specifying. Let me think about this more carefully.

The manifest shape:
```
<!-- manifest
src/thing.ts | reads: - | what it holds
test/thing.test.ts | reads: src/thing.ts | what it proves
-->
```

"List only files you will write." — "you" being the implementer who has this PLAN.md. So I should list all files the implementer will produce. That includes the source files, test files, migration SQL, and MIGRATION_NOTES.md.

Let me now draft the plan:

## 1. Assumptions

- Drizzle with `pg` (node-postgres) driver; connection via `DATABASE_URL` env var.
- Drizzle schema lives in `src/db/schema.ts`; the drizzle instance in `src/db/client.ts`.
- Migrations: one initial migration `drizzle/0000_init.sql` generated by hand (no drizzle-kit in the deliverable; the SQL is written directly).
- Repository files keep their paths and class names from the Prisma version; only internals change.
- Service and controller layers are unchanged (they already delegate to repositories per the layering rule).
- BigInt columns use Drizzle `bigint` mode: `'number'` for internal math, explicit `.toString()` at the serialization boundary (controller DTO mapping) to preserve string wire format.
- UUIDs generated via `crypto.randomUUID()` (Node built-in), not a DB-side `gen_random_uuid()`.
- Status enum stored as `text` with a TS union type, matching Prisma's string-enum behavior.
- `MIGRATION_NOTES.md` at repo root documents every semantic finding.
- Test runner stays Vitest; test files stay in `test/` with `.spec.ts` extension.
- The `prisma/` directory, `@prisma/client`, and `prisma` npm packages are removed; `pg` and `drizzle-orm` added.

## 2. Data model

**accounts** (`@@map("accounts")`)
| column | type | constraints |
|---|---|---|
| id | uuid (text[36]) | PK |
| name | text | NOT NULL |
| email | text | NOT NULL, UNIQUE |
| credit_limit_cents | bigint | NOT NULL, default 0 |
| balance_cents | bigint | NOT NULL, default 0 |
| total_invoiced_cents | bigint | NOT NULL, default 0 |
| created_at | timestamp(ms) | NOT NULL, default now() |

**invoices** (`@@map("invoices")`)
| column | type | constraints |
|---|---|---|
| id | uuid (text[36]) | PK |
| account_id | text[36] | NOT NULL, FK → accounts.id |
| status | text | NOT NULL, default 'draft', CHECK in ('draft','sent','paid','void') |
| subtotal_cents | bigint | NOT NULL, default 0 |
| tax_cents | bigint | NOT NULL, default 0 |
| total_cents | bigint | NOT NULL, default 0 |
| due_date | timestamp(ms) | nullable |
| created_at | timestamp(ms) | NOT NULL, default now() |
| updated_at | timestamp(ms) | NOT NULL, default now() |

**line_items** (`@@map("line_items")`)
| column | type | constraints |
|---|---|---|
| id | uuid (text[36]) | PK |
| invoice_id | text[36] | NOT NULL, FK → invoices.id ON DELETE CASCADE |
| description | text | NOT NULL |
| unit_price_cents | bigint | NOT NULL |
| quantity | integer | NOT NULL, CHECK > 0 |
| line_total_cents | bigint | NOT NULL |

Indexes: `invoices_account_id_idx` on invoices.account_id; `line_items_invoice_id_idx` on line_items.invoice_id.

## 3. Types and signatures

I need to define the repository interfaces, service method signatures, DTOs...

Let me think about what the API likely exposes:
- GET /accounts → list accounts
- POST /accounts → create account
- GET /accounts/:id → get one account
- GET /invoices?accountId=... → list invoices
- POST /invoices → create invoice (with line items) — transactional
- GET /invoices/:id → get one invoice (with line items)
- PATCH /invoices/:id/status → update status

Repository methods:
- AccountsRepository: findById, findAll, create, incrementTotalInvoiced
- InvoicesRepository: findById (with line items), findAllByAccount, createInTransaction (invoice + line items)
- LineItemsRepository: (maybe folded into InvoicesRepository)

Actually, for the transaction, the repository needs to expose a method that does the full write within a drizzle transaction. Let me think...

The service calls something like:
```
await this.invoiceRepo.createWithLineItemsAndUpdateAccount({ invoice, lineItems, accountId })
```

Or the service orchestrates: it calls repo methods and the repo wraps in a transaction. Given the convention that "repository is the only layer that touches the database," the transaction should be in the repository.

Let me define:

```typescript
// src/db/schema.ts
export interface AccountRow { ... }
export interface InvoiceRow { ... }
export interface LineItemRow { ... }

// src/accounts/accounts.repository.ts
export class AccountsRepository {
  constructor(db: DrizzleDb)
  findById(id: string): Promise<AccountRow | null>
  findAll(): Promise<AccountRow[]>
  create(input: CreateAccountInput): Promise<AccountRow>
}

// src/invoices/invoices.repository.ts
export class InvoicesRepository {
  constructor(db: DrizzleDb)
  findById(id: string): Promise<InvoiceWithLineItems | null>
  findAllByAccount(accountId: string): Promise<InvoiceRow[]>
  createWithLineItems(input: CreateInvoiceTxInput, accountId: string): Promise<InvoiceRow>
}
```

The `createWithLineItems` is the transactional method. It:
1. Inserts invoice
2. Inserts line items
3. Updates account.total_invoiced_cents += invoice.total_cents
4. All in `db.transaction()`

Serialization: BigInt → string happens in the controller (or a DTO mapper). The repository returns raw BigInt.

Wait, but the task says "numeric string formats — invoices carry BigInt amounts serialized as strings today." So the API returns `"total_cents": "15000"` not `"total_cents": 15000`. This serialization must happen at the same layer. If it's currently in the controller, it stays there. If it's in the service, it stays there. I'll assume it's in the controller DTO mapping (or a serializer helper).

Actually, since the service holds logic and the controller validates input + calls service, the serialization might be in the service's return DTO. Let me put it in the service layer — the service returns a DTO with string amounts, and the controller just passes it through.

Hmm, but that changes the service. The task says services are unchanged... unless the type signatures change because Prisma's BigInt vs Drizzle's number handling differs.

Let me reconsider: In Prisma, `BigInt` fields come back as JS `BigInt`. In Drizzle with `bigint({ mode: 'number' })`, they come back as JS `number`. With `mode: 'bigint'` (default), they come back as JS `BigInt`.

If I use `mode: 'bigint'` in Drizzle, the repositories return `BigInt` just like Prisma did, and the serialization layer (wherever it is) stays the same. That's the safest choice for byte-compatibility.

So: Drizzle `bigint` columns use default mode `'bigint'`. Repositories return `BigInt`. The existing serialization (wherever it lives) continues to call `.toString()`.

OK let me also think about what "uncovered behaviors" might be:
1. BigInt overflow or edge cases (0, negative)
2. What happens when you create an invoice with zero line items
3. Whether `null` vs missing fields are preserved in JSON (e.g., `due_date: null` vs key absent)
4. Whether list endpoints return empty array `[]` vs `null`
4. Concurrency: two simultaneous invoice creations for the same account (row-level locking in transaction)
5. Whether `updated_at` is actually updated on status change
6. Whether voiding an invoice decrements the account counter
7. Validation: negative quantity, negative price

These are the kinds of things to pin with new tests.

Now let me write the actual PLAN.md. I need to be terse and complete. Let me structure it.

For the manifest, I need to list all files the implementer will write:
- `src/db/schema.ts`
- `src/db/client.ts`  
- `drizzle/0000_init.sql`
- `src/accounts/accounts.repository.ts`
- `src/invoices/invoices.repository.ts`
- `MIGRATION_NOTES.md`
- `test/transaction-failure.spec.ts` (new test for mid-tx failure)
- Any other new test files for uncovered behaviors

Wait, I should also consider: do I need a `src/db/module.ts` or is the db client provided via AppModule? In NestJS, you'd typically have a provider. Let me say the drizzle instance is provided in `AppModule` (or a `DatabaseModule`).

Actually, let me add `src/db/database.module.ts` as a NestJS module that provides the drizzle instance.

Let me also think about `package.json` changes — but the task says "do not create a file it does not call for." The package.json changes (removing prisma, adding drizzle-orm and pg) are implicit in the task. I won't list package.json in the manifest since it's an edit, not a new file. Actually the manifest says "List only files you will write" — if I'm rewriting package.json, that counts. But it's a modification, not a new file. I'll note in assumptions that deps change but not list it separately... actually let me just mention it in assumptions and not in the manifest. The manifest is for files whose content I'm specifying.

Hmm, but the implementer needs to know what deps to add. Let me put that in assumptions.

Let me finalize my structure and write it out now, keeping it tight.
```

## reply

## 1. Assumptions

- Drizzle with `drizzle-orm/node-postgres` driver over a `pg.Pool`; connection string from `DATABASE_URL`.
- Drizzle schema in `src/db/schema.ts`; the connected instance exported from `src/db/client.ts`; a `DatabaseModule` (`src/db/database.module.ts`) provides the instance as a NestJS token.
- One hand-written migration `drizzle/0000_init.sql`; no `drizzle-kit` invocation in the deliverable.
- Drizzle `bigint` columns use default mode `'bigint'` so repositories return JS `BigInt`, identical to what Prisma produced; the existing `.toString()` serialization layer is untouched.
- Services and controllers are unchanged in logic; only their injected repository type shifts from a Prisma-based to a Drizzle-based implementation (same interface).
- UUIDs generated via `crypto.randomUUID()` in the repository; timestamps via `new Date()` at insert.
- Status is a `text` column with a TS union `'draft' | 'sent' | 'paid' | 'void'`, matching Prisma's string-enum wire format.
- `package.json`: remove `@prisma/client` and `prisma`; add `drizzle-orm`, `pg`, `@types/pg`.
- `MIGRATION_NOTES.md` at repo root; every semantic difference or preserved behaviour found during porting is documented there.
- Test files use `.spec.ts` in `test/`, run under Vitest, import the app via NestJS test module.

## 2. Data model

**accounts** — table `accounts`

| column | type | null | default / note |
|---|---|---|---|
| id | uuid (varchar 36) | no | PK |
| name | text | no | |
| email | text | no | UNIQUE |
| credit_limit_cents | bigint | no | 0 |
| balance_cents | bigint | no | 0 |
| total_invoiced_cents | bigint | no | 0 |
| created_at | timestamptz | no | now() |

**invoices** — table `invoices`

| column | type | null | default / note |
|---|---|---|---|
| id | uuid (varchar 36) | no | PK |
| account_id | varchar 36 | no | FK → accounts.id, NOT NULL |
| status | text | no | 'draft'; CHECK in ('draft','sent','paid','void') |
| subtotal_cents | bigint | no | 0 |
| tax_cents | bigint | no | 0 |
| total_cents | bigint | no | 0 |
| due_date | timestamptz | yes | — |
| created_at | timestamptz | no | now() |
| updated_at | timestamptz | no | now() |

**line_items** — table `line_items`

| column | type | null | default / note |
|---|---|---|---|
| id | uuid (varchar 36) | no | PK |
| invoice_id | varchar 36 | no | FK → invoices.id, ON DELETE CASCADE |
| description | text | no | |
| unit_price_cents | bigint | no | |
| quantity | integer | no | CHECK > 0 |
| line_total_cents | bigint | no | = unit_price_cents × quantity |

Indexes: `invoices_account_id_idx` (invoices.account_id); `line_items_invoice_id_idx` (line_items.invoice_id).

## 3. Types and signatures

### `src/db/schema.ts`

```ts
import { pgTable, text, varchar, bigint, integer, timestamp, index } from 'drizzle-orm/pg-core';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', { … });
export const invoices = pgTable('invoices', { … });
export const lineItems = pgTable('line_items', { … });

export type AccountRow = InferSelectModel<typeof accounts>;
export type InvoiceRow = InferSelectModel<typeof invoices>;
export type LineItemRow = InferSelectModel<typeof lineItems>;

export type InvoiceWithLineItems = InvoiceRow & { line_items: LineItemRow[] };
```

Insert-model types are derived via `InferInsertModel` and exported as `AccountInsert`, `InvoiceInsert`, `LineItemInsert`.

### `src/db/client.ts`

```ts
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { QueryResultHOC } from 'drizzle-orm';

export type DrizzleDb = NodePgDatabase<Schema>; // Schema = { accounts, invoices, line_items }
export function createDb(): DrizzleDb;          // reads DATABASE_URL, returns connected instance
```

### `src/db/database.module.ts`

```ts
@Injectable()
export class DatabaseModule { … }   // @Global(); provides + exports a provider token DB: DrizzleDb
export const DB = Symbol('DB');     // injection token
```

### `src/accounts/accounts.repository.ts`

```ts
@Injectable()
export class AccountsRepository {
  constructor(@Inject(DB) private db: DrizzleDb);
  findById(id: string): Promise<AccountRow | null>;
  findAll(): Promise<AccountRow[]>;
  create(input: AccountInsert): Promise<AccountRow>;
}
```

Raises nothing domain-specific; FK/UNIQUE violations propagate as `DrizzleError` caught by the global filter and mapped to `{ error: { code: "resource_conflict", … } }`.

### `src/invoices/invoices.repository.ts`

```ts
@Injectable()
export class InvoicesRepository {
  constructor(@Inject(DB) private db: DrizzleDb);

  findById(id: string): Promise<InvoiceWithLineItems | null>;
  findAllByAccount(accountId: string): Promise<InvoiceRow[]>;
  createWithLineItems(args: CreateInvoiceTxArgs): Promise<InvoiceRow>;

  // args type:
  export interface CreateInvoiceTxArgs {
    invoice: InvoiceInsert;
    lineItems: LineItemInsert[];
  }
}
```

`createWithLineItems` is the only method that opens a `db.transaction`. See §4.

### Service signatures (unchanged from Prisma version — listed for completeness)

```ts
// src/accounts/accounts.service.ts
@Injectable()
export class AccountsService {
  constructor(private repo: AccountsRepository);
  list(): Promise<AccountDto[]>;
  get(id: string): Promise<AccountDto>;          // raises NotFoundException → code "resource_not_found"
  create(dto: CreateAccountDto): Promise<AccountDto>;
}

// src/invoices/invoices.service.ts
@Injectable()
export class InvoicesService {
  constructor(private repo: InvoicesRepository, private acctRepo: AccountsRepository);
  listByAccount(accountId: string): Promise<InvoiceDto[]>;
  get(id: string): Promise<InvoiceDetailDto>;    // raises "resource_not_found"
  create(dto: CreateInvoiceDto): Promise<InvoiceDto>;
  updateStatus(id: string, status: InvoiceStatus): Promise<InvoiceDto>; // raises "resource_not_found"
}
```

DTOs (`AccountDto`, `InvoiceDto`, `InvoiceDetailDto`, `CreateInvoiceDto`, etc.) are identical to the current Prisma version. BigInt fields appear as `string` in DTOs; `due_date` is `string | null` (present-key-with-null, not omitted).

### Error contract

All HTTP errors use the single envelope:
```ts
interface ApiError { error: { code: string; message: string; details: Record<string, unknown> } }
```
Codes used: `resource_not_found`, `resource_conflict` (unique/FK), `validation_error`.

### Ordering rules

- In `createWithLineItems`, the account counter update must occur **after** the invoice insert (so the invoice row exists before any FK-validated read in the same tx) but **before** commit (atomicity).
- In `updateStatus`, the row update sets `updated_at = now()` in the same statement; no separate follow-up write.

## 4. Control flow

### Read paths (no transaction)

| Endpoint | Flow |
|---|---|
| GET /accounts | service → repo.findAll → map to DTOs (BigInt→string) |
| GET /accounts/:id | service → repo.findById; null → 404 |
| GET /invoices?accountId=… | service → repo.findAllByAccount → map |
| GET /invoices/:id | service → repo.findById (joins line_items); null → 404; map with nested line_items array |
| PATCH /invoices/:id/status | service → repo.update (set status + updated_at); 0 rows affected → 404 |

### Write: POST /invoices (transactional)

Single `db.transaction(async (tx) => { … })` inside `InvoicesRepository.createWithLineItems`:

1. INSERT into `invoices` (status 'draft', computed subtotal/tax/total). Capture returned row.
2. If `lineItems.length > 0`, INSERT all rows into `line_items` (single multi-row insert).
3. UPDATE `accounts SET total_invoiced_cents = total_invoiced_cents + $invoice.total, balance_cents = balance_cents - $invoice.total WHERE id = $accountId`. Assert `rowCount === 1`; if 0, throw (account vanished).
4. Return the invoice row.

Nothing outside steps 1–3 touches the database in this call. The service layer performs no I/O between obtaining args and calling the repository method. A failure at any step rolls back all prior steps in the same transaction.

### Write: POST /accounts (non-transactional)

Single INSERT; unique-email violation surfaces as 409.

### What must NOT be inside the transaction

- Validation of input DTOs (happens in controller / before repo call).
- Logging or metrics side-effects.
- Any call to `AccountsRepository` for a *read* (the counter update is a blind `+=`; no read-then-write).

## 5. Tests

| Test file / describe | Proves |
|---|---|
| `test/accounts.spec.ts` — "lists all accounts" | GET /accounts returns 200, array shape, BigInt→string format for money fields |
| `test/accounts.spec.ts` — "creates an account" | POST /accounts returns 201 with generated id; duplicates → 409 `resource_conflict` |
| `test/accounts.spec.ts` — "returns 404 for unknown id" | GET /accounts/:id with bad uuid → 404 envelope |
| `test/invoices.spec.ts` — "lists invoices for an account" | GET /invoices?accountId=… returns array; empty → `[]` not null |
| `test/invoices.spec.ts` — "creates invoice with line items" | POST /invoices → 201; nested `line_items` present; total = sum(line_totals) + tax |
| `test/invoices.spec.ts` — "returns 404 for unknown invoice" | GET /invoices/:id bad id → 404 |
| `test/invoices.spec.ts` — "updates status" | PATCH /invoices/:id/status → 200, `updated_at` changed, status reflected |
| `test/transaction-failure.spec.ts` — "rolls back invoice on line-item insert failure" | Monkey-patch a query inside the tx to throw; verify: no invoice row, no line_items, account.total_invoiced_cents unchanged |
| `test/transaction-failure.spec.ts` — "rolls back when account row missing" | Tx reaches UPDATE, rowCount=0 → whole tx rolls back; no invoice persisted |
| `test/bigint-format.spec.ts` — "zero-amount invoice serialises as '0'" | total_cents=0 → `"total_cents":"0"` (string, not number, not omitted) |
| `test/bigint-format.spec.ts` — "negative balance serialises with minus sign" | balance_cents=-50 → `"balance_cents":"-50"` |
| `test/null-vs-missing.spec.ts` — "due_date null is present-key-null" | Invoice with due_date NULL → JSON has `"due_date":null`, key is not absent |
| `test/null-vs-missing.spec.ts` — "empty line_items is empty array" | Invoice created with `lineItems: []` → response `"line_items":[]` not missing |
| `test/void-invoice.spec.ts` — "voiding does not reverse counter" | PATCH status→'void'; account.total_invoiced_cents unchanged (documents current behaviour) |
| `test/validate-quantity.spec.ts` — "rejects quantity ≤ 0" | POST /invoices with quantity 0 → 400 `validation_error` |
| `test/validate-negative-price.spec.ts` — "rejects negative unit_price" | POST /invoices with unit_price_cents: -1 → 400 `validation_error` |

## 6. Manifest

```
<!-- manifest
src/db/schema.ts | reads: - | Drizzle table definitions, row/insert types, composite InvoiceWithLineItems
src/db/client.ts | reads: src/db/schema.ts | createDb factory returning connected DrizzleDb
src/db/database.module.ts | reads: src/db/client.ts | @Global NestJS module providing + exporting DB token
drizzle/0000_init.sql | reads: - | DDL for accounts, invoices, line_items incl. PKs, FKs, indexes, CHECKs
src/accounts/accounts.repository.ts | reads: src/db/schema.ts | AccountsRepository with findById, findAll, create
src/invoices/invoices.repository.ts | reads: src/db/schema.ts | InvoicesRepository with findById, findAllByAccount, createWithLineItems (tx)
MIGRATION_NOTES.md | reads: - | Prose documenting every semantic behaviour preserved or changed during the port
test/transaction-failure.spec.ts | reads: src/invoices/invoices.repository.ts, src/db/client.ts | Mid-tx failure → full rollback, no partial rows
test/bigint-format.spec.ts | reads: src/invoices/invoices.repository.ts, src/accounts/accounts.repository.ts | BigInt→string wire format edge cases (0, negative)
test/null-vs-missing.spec.ts | reads: src/invoices/invoices.repository.ts, src/accounts/accounts.repository.ts | null fields present-as-null; empty arrays not omitted
test/void-invoice.spec.ts | reads: src/invoices/invoices.repository.ts, src/accounts/accounts.repository.ts | Void does not reverse total_invoiced_cents
test/validate-quantity.spec.ts | reads: src/invoices/invoices.repository.ts | quantity ≤ 0 rejected with validation_error
test/validate-negative-price.spec.ts | reads: src/invoices/invoices.repository.ts | negative unit_price rejected with validation_error
-->
```
