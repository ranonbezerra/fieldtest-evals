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
