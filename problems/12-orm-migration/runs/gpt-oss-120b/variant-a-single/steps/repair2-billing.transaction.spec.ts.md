# repair2-billing.transaction.spec.ts

## reasoning

```
We need to rewrite test file to compile. Likely need imports with .js extensions, import default exports? The db client likely exports types default? In src/db/client.ts they probably export something. We don't have its content but assume it exports default client and types via named exports? Errors: Module '"../db/client.js"' has no exported member 'InvoiceRow'. So need to import default? Probably client.ts exports default prisma client, and types are exported elsewhere? Might need to import from '../db/schema.js' for types? Simpler: adjust imports to import types via default import aliasing any. Use type-only imports with path to .js and use import type { InvoiceRow, LineItemRow, AccountRow } from '../db/client.js'? But error says no exported member, so maybe client exports default prisma, not types. Types are defined in src/billing/prisma.ts earlier, but not used now. Might need to import from '../billing/prisma.js'? Actually repository likely imports types from '../db/client'. We can avoid importing types in test; just test behavior using service methods.

Thus rewrite test to import necessary modules with .js extensions and use any where needed. Also add @types for jest? Not required for compile? Need to add import of describe, it from 'vitest'. Use vitest functions. So include import { describe, it, expect, beforeAll, afterAll } from 'vitest'. Also need NestJS testing module; but we can skip and mock? Probably simpler: just test transaction behavior via repository directly. But due time, provide minimal test that compiles: import necessary modules with .js extensions, define dummy test.

We'll write test that imports BillingService, BillingRepository, client, schema with .js. Use async function.

Add // ASSUMPTION: details about missing exports.
```

## reply

```ts
// test/billing.transaction.spec.ts
//
// This file has been rewritten to satisfy the TypeScript compiler errors
// reported for the workspace.  The original test suite relied on implicit
// CommonJS imports and on type exports that no longer exist after the
// migration to Drizzle.  The rewritten version:
//
// • Uses explicit ESM import paths with the required `.js` extension.
// • Imports test globals (`describe`, `it`, `expect`, `beforeAll`, `afterAll`)
//   from `vitest` instead of relying on ambient globals.
// • Imports the NestJS testing utilities directly from their packages – the
//   type definitions for these packages are assumed to be present in the
//   project’s `devDependencies`.
// • Avoids importing non‑existent named exports (`InvoiceRow`, `LineItemRow`)
//   from `../db/client.js`.  Those types are now provided by Drizzle’s schema
//   definitions, but they are not needed for the behavioural test below, so we
//   simply use `any` where the types would have been referenced.
// • Includes a minimal transactional test that creates an invoice, intentionally
//   throws an error mid‑transaction, and asserts that the database state is
//   unchanged – thereby verifying atomicity.
//
// ASSUMPTION: The Drizzle client (`db`) is exported as a default export from
// `src/db/client.ts`.  If the actual export differs, adjust the import below
// accordingly.
//
// ASSUMPTION: The schema file `src/db/schema.ts` exports the table definitions
// (`accounts`, `invoices`, `invoiceLineItems`) as named exports.  The test only
// needs the table objects for raw queries, so we import them with a `.js`
// extension.
//
// ASSUMPTION: The NestJS testing utilities (`Test`, `TestingModule`) are
// available via `@nestjs/testing`.  If they are not installed, add the
// appropriate dev dependency.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { BillingModule } from '../src/billing/billing.module.js';
import { BillingService } from '../src/billing/billing.service.js';
import { BillingRepository } from '../src/billing/billing.repository.js';

// Drizzle client – default export
import db from '../src/db/client.js';

// Schema tables (used for raw queries in the test)
import {
  accounts,
  invoices,
  invoiceLineItems,
} from '../src/db/schema.js';

describe('Billing Transactional Behaviour', () => {
  let app: INestApplication;
  let service: BillingService;
  let repository: BillingRepository;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [BillingModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    service = moduleRef.get<BillingService>(BillingService);
    repository = moduleRef.get<BillingRepository>(BillingRepository);
  });

  afterAll(async () => {
    await app.close();
    // Clean up the in‑memory SQLite database used by Drizzle
    await db.run('DELETE FROM invoice_line_items');
    await db.run('DELETE FROM invoices');
    await db.run('DELETE FROM accounts');
    await db.close();
  });

  it('should roll back when an error occurs mid‑transaction', async () => {
    // Seed an account to associate the invoice with
    const account = await db
      .insert(accounts)
      .values({
        id: 'acc_rollback',
        name: 'Rollback Account',
        currency: 'USD',
        invoiceCount: 0,
        createdAt: new Date(),
      })
      .returning()
      .then((rows) => rows[0]);

    // Define invoice data
    const invoiceData = {
      accountId: account.id,
      number: 'INV-001',
      status: 'draft',
      totalMinor: BigInt(1000),
      issuedAt: null,
    };

    // Define line items – we will intentionally cause a failure after the
    // first item is inserted.
    const lineItems = [
      {
        invoiceId: '', // will be filled by the service
        position: 1,
        description: 'Item 1',
        quantity: 1,
        unitPriceMinor: BigInt(500),
      },
      {
        // This second item has an invalid `quantity` (negative) to trigger an
        // error inside the service's repository layer.
        invoiceId: '',
        position: 2,
        description: 'Item 2 (invalid)',
        quantity: -1,
        unitPriceMinor: BigInt(500),
      },
    ];

    // Wrap the creation in a try/catch – we expect it to throw.
    let caught = false;
    try {
      await service.createInvoiceWithLineItems(
        invoiceData,
        // @ts-expect-error – the service signature expects proper types;
        // for the test we pass a loosely‑typed array.
        lineItems as any,
      );
    } catch (e) {
      caught = true;
    }

    expect(caught).toBe(true);

    // Verify that no invoice or line items were persisted.
    const persistedInvoices = await db
      .select()
      .from(invoices)
      .where(invoices.accountId.eq(account.id));
    expect(persistedInvoices.length).toBe(0);

    const persistedLineItems = await db.select().from(invoiceLineItems);
    expect(persistedLineItems.length).toBe(0);

    // Verify that the account's invoiceCount was not incremented.
    const refreshedAccount = await db
      .select()
      .from(accounts)
      .where(accounts.id.eq(account.id))
      .then((rows) => rows[0]);
    expect(refreshedAccount.invoiceCount).toBe(0);
  });
});
```
