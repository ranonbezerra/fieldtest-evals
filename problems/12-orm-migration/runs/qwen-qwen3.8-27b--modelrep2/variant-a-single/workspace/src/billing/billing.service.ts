import { mapDbError, NotFoundError } from '../common/errors.js';
import { BillingRepository } from './billing.repository.js';
import type { InvoiceRow, LineItemRow } from '../db/schema.js';

export interface InvoiceView {
  id: string;
  number: string;
  status: string;
  totalMinor: bigint;
  issuedAt: Date | null;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPriceMinor: bigint;
  }>;
}

export class BillingService {
  constructor(private readonly repo: BillingRepository) {}

  async getInvoice(id: string): Promise<InvoiceView> {
    const invoice = await this.repo.findInvoice(id);
    if (!invoice) throw new NotFoundError('invoice_not_found');

    const lineItems = await this.repo.findLineItems(id);

    return {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      totalMinor: invoice.totalMinor,
      issuedAt: invoice.issuedAt,
      lineItems: lineItems.map((li: LineItemRow) => ({
        description: li.description,
        quantity: li.quantity,
        unitPriceMinor: li.unitPriceMinor,
      })),
    };
  }

  async listForAccount(accountId: string): Promise<InvoiceRow[]> {
    // A missing account is an empty list, not a 404 -- the dashboard calls this
    // before the account row exists for freshly provisioned tenants.
    const account = await this.repo.findAccount(accountId);
    if (account === null) return [];
    return this.repo.listInvoices(accountId);
  }

  async issue(id: string): Promise<InvoiceRow> {
    try {
      // Drizzle resolves an unmatched update with an empty result instead of
      // throwing (Prisma threw P2025); the repository surfaces that as null
      // and we map it to the same 404 as before.
      const invoice = await this.repo.markIssued(id, new Date());
      if (invoice === null) throw new NotFoundError('invoice_not_found');
      return invoice;
    } catch (e) {
      throw mapDbError(e);
    }
  }
}
