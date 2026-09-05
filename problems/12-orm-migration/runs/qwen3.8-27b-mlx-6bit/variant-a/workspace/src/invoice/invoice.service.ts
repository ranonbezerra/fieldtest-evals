// ASSUMPTION: All compiler errors listed pertain to test/invoice.spec.ts, not to
// src/invoice/invoice.service.ts. No change to this file is required by those
// messages. The file below is reconstructed from PLAN.md as the canonical form.

// ASSUMPTION: AccountRepository.updateCounters accepts an optional transaction
// handle (PgTx) as a second-arg group, mirroring the pattern used by
// InvoiceRepository.createWithLineItems. The plan's signature omits it, but the
// control-flow section mandates it run inside the same transaction.

import { Inject, Injectable } from '@nestjs/common';
import { PostgresJsDatabase, PgTx } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../database/database.module';
import { InvoiceRepository, CreateInvoiceData } from './invoice.repository';
import { AccountRepository } from '../account/account.repository';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface CreateInvoiceBody {
  account_id: string;
  line_items: { description: string; amount_cents: string }[];
}

export interface LineItemResponse {
  id: string;
  description: string;
  amount_cents: string;
}

export interface InvoiceResponse {
  id: string;
  account_id: string;
  amount_cents: string;
  status: string;
  line_items: LineItemResponse[];
  created_at: string;
  updated_at: string;
}

export interface InvoiceListResponse {
  data: InvoiceResponse[];
  page: number;
  page_size: number;
}

// ─── Error types (service-level, mapped to envelope by controller/filter) ────

export class ResourceNotFoundError extends Error {
  constructor(message: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class InvoiceService {
  constructor(
    private readonly invoiceRepo: InvoiceRepository,
    private readonly accountRepo: AccountRepository,
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase,
  ) {}

  /**
   * POST /invoices
   * Creates an invoice with its line items and updates the owning account's
   * counters, all atomically.
   */
  async create(body: CreateInvoiceBody): Promise<InvoiceResponse> {
    // ── Validation (before any DB work) ──────────────────────────────────────
    if (!body.account_id || typeof body.account_id !== 'string') {
      throw new ValidationError('account_id is required and must be a string', {
        field: 'account_id',
      });
    }
    if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
      throw new ValidationError('line_items must be a non-empty array', {
        field: 'line_items',
      });
    }
    for (let i = 0; i < body.line_items.length; i++) {
      const item = body.line_items[i];
      if (!item.description || typeof item.description !== 'string') {
        throw new ValidationError(`line_items[${i}].description is required`, {
          field: `line_items[${i}].description`,
        });
      }
      if (item.amount_cents === undefined || item.amount_cents === null) {
        throw new ValidationError(`line_items[${i}].amount_cents is required`, {
          field: `line_items[${i}].amount_cents`,
        });
      }
    }

    // ── Transactional write ──────────────────────────────────────────────────
    const created = await this.db.transaction(async (tx) => {
      // a. Load account (fail fast if missing)
      const account = await this.accountRepo.findById(body.account_id);
      if (!account) {
        throw new ResourceNotFoundError(`Account ${body.account_id} not found`, {
          account_id: body.account_id,
        });
      }

      // b. Compute total from line items
      const totalCents = body.line_items.reduce(
        (sum, item) => sum + BigInt(item.amount_cents),
        0n,
      );

      // c+d. Insert invoice row and its line items
      const data: CreateInvoiceData = {
        accountId: body.account_id,
        amountCents: totalCents,
        lineItems: body.line_items.map((li) => ({
          description: li.description,
          amountCents: BigInt(li.amount_cents),
        })),
      };
      const invoice = await this.invoiceRepo.createWithLineItems(tx, data);

      // e. Update account counters (balance decreases, total_invoiced increases)
      await this.accountRepo.updateCounters(body.account_id, -totalCents, totalCents, tx);

      return invoice;
    });

    // ── Assemble response (outside the transaction) ──────────────────────────
    const lineItems = await this.invoiceRepo.getLineItems(created.id);

    return {
      id: created.id,
      account_id: created.account_id,
      amount_cents: created.amount_cents,
      status: created.status,
      line_items: lineItems.map((li) => ({
        id: li.id,
        description: li.description,
        amount_cents: li.amount_cents,
      })),
      created_at: created.created_at.toISOString(),
      updated_at: created.updated_at.toISOString(),
    };
  }

  /**
   * GET /invoices/:id
   */
  async getById(id: string): Promise<InvoiceResponse> {
    const invoice = await this.invoiceRepo.findById(id);
    if (!invoice) {
      throw new ResourceNotFoundError(`Invoice ${id} not found`, { invoice_id: id });
    }

    const lineItems = await this.invoiceRepo.getLineItems(id);

    return {
      id: invoice.id,
      account_id: invoice.account_id,
      amount_cents: invoice.amount_cents,
      status: invoice.status,
      line_items: lineItems.map((li) => ({
        id: li.id,
        description: li.description,
        amount_cents: li.amount_cents,
      })),
      created_at: invoice.created_at.toISOString(),
      updated_at: invoice.updated_at.toISOString(),
    };
  }

  /**
   * GET /invoices?account_id=…&page=…&page_size=…
   */
  async listByAccount(
    accountId: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<InvoiceListResponse> {
    const rows = await this.invoiceRepo.findByAccount(accountId, page, pageSize);

    const data: InvoiceResponse[] = await Promise.all(
      rows.map(async (inv) => {
        const lineItems = await this.invoiceRepo.getLineItems(inv.id);
        return {
          id: inv.id,
          account_id: inv.account_id,
          amount_cents: inv.amount_cents,
          status: inv.status,
          line_items: lineItems.map((li) => ({
            id: li.id,
            description: li.description,
            amount_cents: li.amount_cents,
          })),
          created_at: inv.created_at.toISOString(),
          updated_at: inv.updated_at.toISOString(),
        };
      }),
    );

    return { data, page, page_size: pageSize };
  }
}
