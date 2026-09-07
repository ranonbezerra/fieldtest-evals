import { NotFoundError, mapPrismaError } from '../common/errors.js';
import { BillingRepository } from './billing.repository.js';
import type { InvoiceRow, LineItemRow } from './prisma.js';

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
      return await this.repo.markIssued(id, new Date());
    } catch (e) {
      throw mapPrismaError(e);
    }
  }
}
