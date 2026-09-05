## 1. Assumptions

- Drizzle dialect is `drizzle-orm/pg-core` (PostgreSQL, matching the existing Prisma target).
- Drizzle client is created in a shared `DatabaseModule` (`src/database/database.module.ts`) and exported to feature modules.
- Schema file lives at `drizzle/schema.ts`; migrations are generated via `drizzle-kit generate` into `drizzle/` and committed.
- Amount columns stay Postgres `bigint` (Drizzle `pgInteger(8)`); the repository returns them as JS strings so the service serialises them byte-identically to today's `BigInt → String()`.
- `package.json` gains `drizzle-orm`, `postgres` (driver), and `drizzle-kit` (dev); loses `@prisma/client`, `prisma`.
- `DATABASE_URL` env var is unchanged; the Drizzle client reads it at bootstrap.
- The `prisma/` directory is deleted entirely (schema, seeds moved to a SQL seed script at `drizzle/seed.sql`).
- Line items live inside the `invoice` feature (no separate module), matching the current layout.
- All endpoint routes, HTTP verbs, and response shapes are unchanged; only the data-access layer is rewritten.

## 2. Data model

Three tables, all `snake_case`. Column types mirror the Prisma schema one-to-one.

### accounts

| column | type | constraints |
|---|---|---|
| id | uuid | PK, default `gen_random_uuid()` |
| name | text | NOT NULL |
| balance_cents | bigint | NOT NULL, default 0 |
| total_invoiced_cents | bigint | NOT NULL, default 0 |
| created_at | timestamptz | NOT NULL, default `now()` |
| updated_at | timestamptz | NOT NULL, default `now()` |

Table name: `accounts` (via `@@map`).

### invoices

| column | type | constraints |
|---|---|---|
| id | uuid | PK, default `gen_random_uuid()` |
| account_id | uuid | NOT NULL, FK → accounts.id (ON DELETE RESTRICT) |
| amount_cents | bigint | NOT NULL |
| status | text | NOT NULL, default `'pending'` |
| created_at | timestamptz | NOT NULL, default `now()` |
| updated_at | timestamptz | NOT NULL, default `now()` |

Indexes: `(account_id)`, `(status)`. Table name: `invoices`.

### line_items

| column | type | constraints |
|---|---|---|
| id | uuid | PK, default `gen_random_uuid()` |
| invoice_id | uuid | NOT NULL, FK → invoices.id (ON DELETE CASCADE) |
| description | text | NOT NULL |
| amount_cents | bigint | NOT NULL |
| created_at | timestamptz | NOT NULL, default `now()` |

Index: `(invoice_id)`. Table name: `line_items`.

## 3. Types and signatures

### Shared (src/database/)

```ts
// database.provider.ts
export class DatabaseModule {}   // exports DrizzleDb token
export const DRIZZLE = Symbol('drizzle');  // injection token, type: PostgresJsDatabase
```

### Account feature (src/account/)

```ts
// account.repository.ts
export class AccountRepository {
  constructor(drizzle: PostgresJsDatabase);
  findById(id: string): Promise<AccountRow | null>;
  create(data: { name: string }): Promise<AccountRow>;
  updateCounters(id: string, deltaBalance: bigint, deltaInvoiced: bigint): Promise<AccountRow | null>;
}
// AccountRow: { id, name, balance_cents: string, total_invoiced_cents: string, created_at: Date, updated_at: Date }
```

### Invoice feature (src/invoice/)

```ts
// invoice.repository.ts
export class InvoiceRepository {
  constructor(drizzle: PostgresJsDatabase);
  findById(id: string): Promise<InvoiceRow | null>;
  findByAccount(accountId: string, page?: number, pageSize?: number): Promise<InvoiceRow[]>;
  createWithLineItems(tx: Tx, data: CreateInvoiceData): Promise<InvoiceRow>;
  getLineItems(invoiceId: string): Promise<LineItemRow[]>;
}

export interface CreateInvoiceData {
  accountId: string;
  amountCents: bigint;
  lineItems: { description: string; amountCents: bigint }[];
}

// InvoiceRow: { id, account_id, amount_cents: string, status, created_at: Date, updated_at: Date }
// LineItemRow: { id, invoice_id, description, amount_cents: string, created_at: Date }
```

### Service layer

```ts
// invoice.service.ts
export class InvoiceService {
  constructor(repo: InvoiceRepository, accountRepo: AccountRepository, db: PostgresJsDatabase);

  // Returns the full invoice with nested line_items array.
  create(body: CreateInvoiceBody): Promise<InvoiceResponse>;

  // Returns single invoice or throws RESOURCE_NOT_FOUND.
  getById(id: string): Promise<InvoiceResponse>;

  listByAccount(accountId: string, page?: number, pageSize?: number): Promise<InvoiceListResponse>;
}

// DTOs (co-located or in a types.ts within the feature)
interface CreateInvoiceBody {
  account_id: string;
  line_items: { description: string; amount_cents: string }[];
}

interface InvoiceResponse {
  id: string;
  account_id: string;
  amount_cents: string;       // always a string, never a number
  status: string;
  line_items: LineItemResponse[];  // present even when empty (never omitted)
  created_at: string;         // ISO 8601
  updated_at: string;
}

interface LineItemResponse {
  id: string;
  description: string;
  amount_cents: string;       // always a string
}

interface InvoiceListResponse {
  data: InvoiceResponse[];
  page: number;
  page_size: number;
}
```

### Errors

| code (snake_case) | raised when |
|---|---|
| `resource_not_found` | account or invoice id does not exist |
| `validation_error` | request body missing required fields, bad type, or line_items empty |
| `invalid_account_state` | account balance insufficient for the invoice amount (if that check exists in the fixture) |

All errors use the single envelope `{ error: { code, message, details } }`. HTTP status: 404 for not-found, 400/422 for validation.

### Ordering rules

- `accountRepo.updateCounters` must run **inside** the same transaction as `invoiceRepo.createWithLineItems`. It is not a separate HTTP call or event.
- Line items are inserted **after** the invoice row (FK dependency).
- If any step in the transaction throws, all writes roll back; no partial state is visible to a concurrent read.

## 4. Control flow

### Invoice creation (POST /invoices)

1. Controller validates body shape (account_id present, line_items non-empty array, each item has description + amount_cents). Calls `InvoiceService.create`.
2. Service opens a Drizzle transaction (`db.transaction(async (tx) => { ... })`).
3. Inside the transaction:
   a. Load the account by `account_id` via `tx`. If missing → throw `resource_not_found` (rolled back automatically).
   b. Sum line-item amounts; compare to `amount_cents` field if the service enforces it (fixture may validate that total line items equals the invoice amount). If mismatch → throw `validation_error`.
   c. Insert the invoice row (status `'pending'`, amount = sum or provided value).
   d. Insert all line-item rows referencing the new invoice id.
   e. Call `accountRepo.updateCounters(accountId, -amount, +amount)` via `tx` (balance decreases by amount, total_invoiced increases by amount).
4. Transaction commits. Service assembles `InvoiceResponse` (amount_cents and each line-item amount_cents are already strings from the repository; dates converted to ISO 8601).
5. Controller returns 201 with the response body.

**Must NOT be inside the transaction:** logging, HTTP response serialization, any I/O that is not a write/read on these three tables.

### All other reads

- No transaction needed (single-table read or join). Repository method issues one Drizzle query; service maps to response DTO.
- `line_items` are loaded eagerly for any invoice read (not a separate endpoint).

## 5. Tests

| # | File / test name | Proves |
|---|---|---|
| 1 | `test/account.spec.ts` – GET /accounts/:id returns 200 with all fields | Account read shape, string amounts, ISO dates |
| 2 | `test/account.spec.ts` – GET /accounts/:id returns 404 for missing id | `resource_not_found` envelope, not 500 |
| 3 | `test/invoice.spec.ts` – POST /invoices creates invoice with line items (201) | Full create happy path, amount_cents is string, line_items array present |
| 4 | `test/invoice.spec.ts` – POST /invoices with empty line_items returns 400 | `validation_error` raised before any DB write |
| 5 | `test/invoice.spec.ts` – GET /invoices/:id returns invoice with nested line_items | Read shape, nested array not omitted when empty |
| 6 | `test/invoice.spec.ts` – GET /invoices?account_id=… paginates | `data`, `page`, `page_size` present; correct slice |
| 7 | `test/invoice.spec.ts` – GET /invoices/:id with bad id → 404 | `resource_not_found` |
| 8 | `test/invoice-transaction.spec.ts` – injected failure during line-item insert rolls back invoice AND account counters | Atomicity: no orphan invoice, account balance unchanged |
| 9 | `test/invoice-transaction.spec.ts` – injected failure during account counter update rolls back invoice and line items | Atomicity from the other end |
| 10 | `test/invoice.spec.ts` – POST /invoices for non-existent account → 404 | FK check surfaced as `resource_not_found`, not a DB constraint error |
| 11 | `test/invoice.spec.ts` – response `amount_cents` is a string type (`typeof === 'string'`) even for large values | Byte-compat: no number coercion, no floating-point |
| 12 | `test/invoice.spec.ts` – line item with zero amount serialises as `"0"` not `0` or omitted | Null-vs-missing and zero-amount edge |
| 13 | `test/account.spec.ts` – account with zero balance still shows `"0"` for both counters | Default/zero serialisation as string |
| 14 | `test/invoice.spec.ts` – `line_items: []` in response when invoice has no items (if allowed by validation) | Field present but empty array, not missing key |

## 6. Manifest

<!-- manifest
drizzle.config.ts | reads: - | Drizzle-kit config (schema path, out dir, dialect)
drizzle/schema.ts | reads: - | Drizzle table definitions (accounts, invoices, line_items) with all columns, PKs, FKs, indexes
drizzle/migrations/0000_initial.sql | reads: drizzle/schema.ts | Initial migration (CREATE TABLE × 3, indexes, FK constraints)
drizzle/migrations/meta/_journal.json | reads: - | Drizzle migration journal metadata
src/database/database.module.ts | reads: - | DatabaseModule + DRIZZLE provider (creates PostgresJsDatabase from DATABASE_URL)
src/account/account.repository.ts | reads: src/database/database.module.ts, drizzle/schema.ts | Account CRUD + updateCounters using Drizzle queries
src/account/account.service.ts | reads: src/account/account.repository.ts | Business logic (findById, create) mapping rows to response DTOs
src/account/account.controller.ts | reads: src/account/account.service.ts | HTTP layer, input validation, error envelope
src/invoice/invoice.repository.ts | reads: src/database/database.module.ts, drizzle/schema.ts | Invoice + line-item queries, createWithLineItems accepting a tx handle
src/invoice/invoice.service.ts | reads: src/invoice/invoice.repository.ts, src/account/account.repository.ts, src/database/database.module.ts | create (transactional), getById, listByAccount; DTO assembly
src/invoice/invoice.controller.ts | reads: src/invoice/invoice.service.ts | HTTP layer, body validation, pagination params
MIGRATION_NOTES.md | reads: - | Document of every semantic behaviour found in call sites, the Drizzle equivalent, and any edge-case tests added
test/account.spec.ts | reads: src/account/account.controller.ts, src/account/account.service.ts, src/account/account.repository.ts | Tests 1, 2, 13
test/invoice.spec.ts | reads: src/invoice/invoice.controller.ts, src/invoice/invoice.service.ts, src/invoice/invoice.repository.ts | Tests 3, 4, 5, 6, 7, 10, 11, 12, 14
test/invoice-transaction.spec.ts | reads: src/invoice/invoice.service.ts, src/invoice/invoice.repository.ts, src/database/database.module.ts | Tests 8, 9 – fault-injection mid-transaction proves atomic rollback
-->
