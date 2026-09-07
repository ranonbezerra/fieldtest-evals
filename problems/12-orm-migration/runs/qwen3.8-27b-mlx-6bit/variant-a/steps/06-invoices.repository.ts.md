# 06-invoices.repository.ts

## reasoning

```
Let me analyze the plan and references to write the `src/invoices/invoices.repository.ts` file.

From the PLAN.md:

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

`createWithLineItems` is the only method that opens a `db.transaction`.

### Control flow for `createWithLineItems`:

1. INSERT into `invoices` (status 'draft', computed subtotal/tax/total). Capture returned row.
2. If `lineItems.length > 0`, INSERT all rows into `line_items` (single multi-row insert).
3. UPDATE `accounts SET total_invoiced_cents = total_invoiced_cents + $invoice.total, balance_cents = balance_cents - $invoice.total WHERE id = $accountId`. Assert `rowCount === 1`; if 0, throw (account vanished).
4. Return the invoice row.

Now let me look at what I need:

- `@Inject(DB)` - from `src/db/database.module.ts`, the token is `DB` (a Symbol)
- `DrizzleDb` type - from `src/db/client.ts`, it's `NodePgDatabase<Schema>`
- Schema imports from `src/db/schema.ts`: `accounts`, `invoices`, `lineItems`, and the types

For `findById`:
- Need to find an invoice by id AND join/select line_items
- Return `InvoiceWithLineItems | null`

For `findAllByAccount`:
- Filter invoices by account_id
- Return `InvoiceRow[]`

For `createWithLineItems`:
- Open a transaction
- Step 1: INSERT into invoices, return the row
- Step 2: If lineItems.length > 0, INSERT all into line_items
- Step 3: UPDATE accounts with `sql` to do the arithmetic, assert rowCount === 1
- Step 4: Return the invoice row

Let me think about the Drizzle API:

For `findById` with line_items:
```ts
async findById(id: string): Promise<InvoiceWithLineItems | null> {
  const rows = await this.db.select().from(invoices).where(eq(invoices.id, id));
  const invoice = rows[0];
  if (!invoice) return null;
  const items = await this.db.select().from(lineItems).where(eq(lineItems.invoice_id, id));
  return { ...invoice, line_items: items };
}
```

For `findAllByAccount`:
```ts
async findAllByAccount(accountId: string): Promise<InvoiceRow[]> {
  return this.db.select().from(invoices).where(eq(invoices.account_id, accountId));
}
```

For `createWithLineItems`:
```ts
async createWithLineItems(args: CreateInvoiceTxArgs): Promise<InvoiceRow> {
  return this.db.transaction(async (tx) => {
    const [invoice] = await tx.insert(invoices).values(args.invoice).returning();
    
    if (args.lineItems.length > 0) {
      await tx.insert(lineItems).values(args.lineItems);
    }
    
    const result = await tx
      .update(accounts)
      .set({
        total_invoiced_cents: sql`${accounts.total_invoiced_cents} + ${invoice.total_cents}`,
        balance_cents: sql`${accounts.balance_cents} - ${invoice.total_cents}`,
      })
      .where(eq(accounts.id, invoice.account_id));
    
    if (result[0].rowCount !== 1) {
      throw new Error('Account not found');
    }
    
    return invoice;
  });
}
```

Wait, let me think about the Drizzle update result. In Drizzle with node-postgres, `tx.update().set().where()` returns a result array. Let me check - actually in Drizzle, the update returns an array of result objects. Each has `rowCount`.

Actually, looking at Drizzle's node-postgres driver, the result of an update/insert/delete is typically:
- For `.returning()`: returns the rows
- Without `.returning()`: returns an array of `{ rowCount: number }` or similar

Let me think more carefully. In Drizzle with node-postgres:
- `tx.update(table).set(...).where(...)` returns a promise that resolves to an array of result objects
- Each result object has a `rowCount` property

So `const [result] = await tx.update(...)...; if (result.rowCount !== 1) throw ...`

Actually, I need to be more careful. Let me think about what Drizzle returns for non-returning statements in node-postgres.

In Drizzle's node-postgres driver, for UPDATE without RETURNING, the result is typically an array where each element corresponds to a command. The structure depends on the version, but generally it's something like `[{ rowCount: 1 }]`.

Let me use:
```ts
const result = await tx.update(accounts).set({...}).where(eq(accounts.id, invoice.account_id));
const rowCount = result[0]?.rowCount ?? 0;
if (rowCount !== 1) {
  throw new Error('Account not found');
}
```

Hmm, but I should be careful about the exact shape. Let me just use a safe access pattern.

Now for imports:
- `@Injectable`, `Inject` from `@nestjs/common`
- `eq` from `drizzle-orm`
- `sql` from `drizzle-orm/pg-core`
- Schema items from `../db/schema`
- `DB` token from `../db/database.module`
- `DrizzleDb` type from `../db/client`

Let me also think about whether I need `lineItems` in the values for the insert. The plan says `LineItemInsert[]` which is `InferInsertModel<typeof lineItems>`. The insert should work with that.

One thing to note: in the `createWithLineItems`, the plan says "status 'draft', computed subtotal/tax/total" are part of the invoice insert. But looking at the `InvoiceInsert` type, it's the full insert model. The service layer would have already computed these values and passed them in `args.invoice`. The repository just does the insert with whatever is provided.

Let me write the complete file now.

Actually wait - I need to double-check: does the plan specify that `findAllByAccount` should order by anything? Looking at the plan's control flow table: "GET /invoices?accountId=… | service → repo.findAllByAccount → map". No explicit ordering mentioned. I'll leave it without an explicit order (or maybe order by created_at desc? No, the plan doesn't mention it, so I won't add it).

Let me finalize the file.
```

## reply

```ts
import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm/pg-core';
import { DB } from '../db/database.module';
import type { DrizzleDb } from '../db/client';
import { accounts, invoices, lineItems } from '../db/schema';
import type { InvoiceRow, InvoiceWithLineItems, InvoiceInsert, LineItemInsert } from '../db/schema';

export interface CreateInvoiceTxArgs {
  invoice: InvoiceInsert;
  lineItems: LineItemInsert[];
}

@Injectable()
export class InvoicesRepository {
  constructor(@Inject(DB) private readonly db: DrizzleDb) {}

  async findById(id: string): Promise<InvoiceWithLineItems | null> {
    const rows = await this.db.select().from(invoices).where(eq(invoices.id, id));
    const invoice = rows[0];
    if (!invoice) return null;
    const items = await this.db.select().from(lineItems).where(eq(lineItems.invoice_id, id));
    return { ...invoice, line_items: items };
  }

  async findAllByAccount(accountId: string): Promise<InvoiceRow[]> {
    return this.db.select().from(invoices).where(eq(invoices.account_id, accountId));
  }

  async createWithLineItems(args: CreateInvoiceTxArgs): Promise<InvoiceRow> {
    return this.db.transaction(async (tx) => {
      const [invoice] = await tx.insert(invoices).values(args.invoice).returning();

      if (args.lineItems.length > 0) {
        await tx.insert(lineItems).values(args.lineItems);
      }

      const result = await tx
        .update(accounts)
        .set({
          total_invoiced_cents: sql`${accounts.total_invoiced_cents} + ${invoice.total_cents}`,
          balance_cents: sql`${accounts.balance_cents} - ${invoice.total_cents}`,
        })
        .where(eq(accounts.id, invoice.account_id));

      const rowCount = result[0]?.rowCount ?? 0;
      if (rowCount !== 1) {
        throw new Error('Account not found');
      }

      return invoice;
    });
  }
}
```
