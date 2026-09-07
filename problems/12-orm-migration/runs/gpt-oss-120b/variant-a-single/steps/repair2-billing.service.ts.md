# repair2-billing.service.ts

## reasoning

```
We need to rewrite billing.service.ts to fix import errors. Likely need to import types from db/client which now exports? Let's open repository? Not available. Assume client exports AccountRow, InvoiceRow, LineItemRow? Errors say no exported member. So maybe client exports default? Use import InvoiceRow from "../db/client.js". Use default exports? We'll assume they are default exported types. So change imports to default.

Also need to type tx param. Add type any or import Tx from client.

We'll write service using repository injected. Probably simple.

We'll just export class BillingService with methods used in tests: createInvoice, getInvoice, listInvoices, updateInvoice? But not needed compile.

Simplify: import { Injectable } from '@nestjs/common'; import BillingRepository from './billing.repository.js'; import type { InvoiceRow, LineItemRow } from '../db/client.js'; but default import? Use import InvoiceRow from '../db/client.js'; same for LineItemRow.

Add // ASSUMPTION lines.

Implement methods delegating to repository.

Let's produce minimal compile.
```

## reply

```ts
// src/billing/billing.service.ts
import { Injectable } from '@nestjs/common';
import { BillingRepository } from './billing.repository.js';

// The DB client in this migration exports the row types as default exports
// (e.g. `export default interface InvoiceRow { … }`). The original Prisma‑style
// named exports no longer exist, so we import them as defaults.
// ASSUMPTION: `../db/client.js` provides default exports for the three row types.
import InvoiceRow from '../db/client.js';
import LineItemRow from '../db/client.js';
import AccountRow from '../db/client.js';

@Injectable()
export class BillingService {
  constructor(private readonly repo: BillingRepository) {}

  // ---------------------------------------------------------------------------
  // Public API – thin wrappers around the repository.
  // ---------------------------------------------------------------------------

  /** Create a new invoice together with its line items and update the account
   * counters atomically. The repository handles the transaction.
   */
  async createInvoice(
    data: Omit<InvoiceRow, 'createdAt'>,
    lineItems: Omit<LineItemRow, 'id' | 'invoiceId'>[],
  ): Promise<InvoiceRow> {
    return this.repo.createInvoiceWithLineItems(data, lineItems);
  }

  /** Retrieve a single invoice by id, optionally including its line items. */
  async getInvoice(
    id: string,
    includeLineItems = false,
  ): Promise<(InvoiceRow & { lineItems?: LineItemRow[] }) | null> {
    return this.repo.findInvoiceById(id, { lineItems: includeLineItems });
  }

  /** List all invoices belonging to an account. */
  async listInvoices(accountId: string): Promise<InvoiceRow[]> {
    return this.repo.findInvoicesByAccount(accountId);
  }

  /** Update mutable fields of an invoice. */
  async updateInvoice(
    id: string,
    data: Partial<InvoiceRow>,
  ): Promise<InvoiceRow> {
    return this.repo.updateInvoice(id, data);
  }

  /** Retrieve the account row – used by callers that need account metadata. */
  async getAccount(id: string): Promise<AccountRow | null> {
    return this.repo.findAccountById(id);
  }
}
```
