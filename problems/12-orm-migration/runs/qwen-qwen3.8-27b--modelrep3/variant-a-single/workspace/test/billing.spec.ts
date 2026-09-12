import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { BillingRepository } from '../src/billing/billing.repository.js';
import { BillingService } from '../src/billing/billing.service.js';
import { ConflictError, NotFoundError } from '../src/common/errors.js';
import { serialize } from '../src/common/serializer.js';
import { invoices, invoiceLineItems } from '../src/db/db.schema.js';
import { openTestDb, resetAndSeed, type TestDb } from './db.js';

const NORTHWIND = '11111111-1111-4111-8111-111111111111';
const CONTOSO = '22222222-2222-4222-8222-222222222222';
const INVOICE_ISSUED = 'aaaaaaaa-0000-4000-8000-000000000001';
const INVOICE_DRAFT = 'aaaaaaaa-0000-4000-8000-000000000002';
// A syntactically valid UUID that no row uses. A malformed id is a different
// case: Postgres rejects it before the lookup (pinned below).
const MISSING = 'ffffffff-0000-4000-8000-0000000000ff';

let ctx: TestDb;

beforeAll(async () => {
  ctx = await openTestDb();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await resetAndSeed(ctx.db);
});

function repo(): BillingRepository {
  return new BillingRepository(ctx.db);
}

function service(): BillingService {
  return new BillingService(repo());
}

describe('BillingService', () => {
  it('returns an invoice with its line items', async () => {
    const inv = await service().getInvoice(INVOICE_ISSUED);
    expect(inv.number).toBe('INV-2024-0001');
    expect(inv.lineItems.length).toBe(3);
  });

  it('throws when the invoice does not exist', async () => {
    await expect(service().getInvoice(MISSING)).rejects.toThrow(NotFoundError);
  });

  it('rejects a malformed invoice id with a database error, not a 404', async () => {
    // The id must be a valid UUID for Postgres to look it up; garbage input
    // is a server-side error, the same under Prisma and Drizzle.
    await expect(service().getInvoice('not-a-uuid')).rejects.not.toBeInstanceOf(NotFoundError);
  });

  it('lists invoices for an account', async () => {
    const list = await service().listForAccount(NORTHWIND);
    expect(list.length).toBe(2);
  });

  it('lists invoices in insertion order (no ORDER BY in the port, as before)', async () => {
    const list = await service().listForAccount(NORTHWIND);
    expect(list.map((i) => i.number)).toEqual(['INV-2024-0001', 'INV-2024-0002']);
  });

  it('returns an empty list for an account with no invoices', async () => {
    const list = await service().listForAccount(CONTOSO);
    expect(list.length).toBe(0);
  });

  it('returns an empty list, not a 404, for an account that does not exist', async () => {
    // The dashboard calls listForAccount before the account row exists.
    expect(await service().listForAccount(MISSING)).toEqual([]);
  });

  it('returns line items in insertion order, not positional order', async () => {
    // The seed inserts positions 3, 1, 2. The Prisma repository issued no
    // ORDER BY, so callers received physical (insertion) order; the port
    // preserves that byte-compatible output.
    const inv = await service().getInvoice(INVOICE_ISSUED);
    expect(inv.lineItems.map((li) => li.description)).toEqual([
      'Support retainer',
      'Implementation',
      'Training day',
    ]);
  });

  it('marks an invoice issued', async () => {
    const inv = await service().issue(INVOICE_DRAFT);
    expect(inv.status).toBe('issued');
    expect(inv.issuedAt).toBeInstanceOf(Date);
  });

  it('throws invoice_not_found when issuing an invoice that does not exist', async () => {
    // Prisma raised P2025 for a 0-row update; the port throws the same error
    // from the service when the update returns no row.
    await expect(service().issue(MISSING)).rejects.toMatchObject({ code: 'invoice_not_found' });
  });

  it('re-issuing an already issued invoice succeeds and refreshes issuedAt', async () => {
    // No guard in Prisma, none in the port: the update is unconditional.
    const inv = await service().issue(INVOICE_ISSUED);
    expect(inv.status).toBe('issued');
    expect(inv.issuedAt).toBeInstanceOf(Date);
  });

  it('serializes money fields as exact decimal strings (no precision loss)', async () => {
    // 9007199254740993 is deliberately past Number.MAX_SAFE_INTEGER.
    const inv = serialize(await service().getInvoice(INVOICE_ISSUED)) as Record<string, unknown>;
    expect(inv.totalMinor).toBe('9007199254740993');
  });

  it('keeps null fields present and dates as ISO strings in the wire format', async () => {
    const draft = serialize(await service().getInvoice(INVOICE_DRAFT)) as Record<string, unknown>;
    expect('issuedAt' in draft).toBe(true);
    expect(draft.issuedAt).toBe(null);

    const issued = serialize(await service().getInvoice(INVOICE_ISSUED)) as Record<string, unknown>;
    expect(issued.issuedAt).toBe('2024-04-01T09:00:00.000Z');
  });

  it('serializes invoice list rows with string amounts', async () => {
    const list = serialize(await service().listForAccount(NORTHWIND)) as Array<Record<string, unknown>>;
    expect(list.map((row) => row.totalMinor)).toEqual(['9007199254740993', '125000']);
  });
});

describe('BillingRepository', () => {
  it('creates an invoice with its line items and increments the account counter', async () => {
    const r = repo();
    const created = await r.createInvoice({
      invoice: {
        id: 'dddddddd-0000-4000-8000-000000000009',
        accountId: CONTOSO,
        number: 'INV-2024-0100',
        status: 'draft',
        totalMinor: 5000n,
        issuedAt: null,
      },
      lineItems: [
        {
          id: 'eeeeeeee-0000-4000-8000-000000000001',
          invoiceId: 'dddddddd-0000-4000-8000-000000000009',
          position: 1,
          description: 'Setup',
          quantity: 1,
          unitPriceMinor: 5000n,
        },
      ],
    });
    expect(created.id).toBe('dddddddd-0000-4000-8000-000000000009');
    expect(created.status).toBe('draft');
    expect(created.issuedAt).toBeNull();
    expect(created.createdAt).toBeInstanceOf(Date);
    expect((await r.findAccount(CONTOSO))?.invoiceCount).toBe(1);
    expect(await r.findLineItems(created.id)).toHaveLength(1);
  });

  it('increments the counter even when the invoice has no line items', async () => {
    const r = repo();
    await r.createInvoice({
      invoice: {
        id: 'dddddddd-0000-4000-8000-000000000010',
        accountId: CONTOSO,
        number: 'INV-2024-0101',
        status: 'draft',
        totalMinor: 1n,
        issuedAt: null,
      },
      lineItems: [],
    });
    expect((await r.findAccount(CONTOSO))?.invoiceCount).toBe(1);
    expect(await r.findLineItems('dddddddd-0000-4000-8000-000000000010')).toEqual([]);
  });

  it('rolls back invoice, line items and counter when a statement fails mid-transaction', async () => {
    const r = repo();
    // Occupy a line-item primary key so the SECOND statement of the
    // transaction fails: the invoice insert has already succeeded at this
    // point, so only a real rollback explains the assertions below.
    await ctx.db.insert(invoiceLineItems).values({
      id: 'cccccccc-0000-4000-8000-000000000001',
      invoiceId: INVOICE_DRAFT,
      position: 9,
      description: 'blocker',
      quantity: 1,
      unitPriceMinor: 1n,
    });

    const newId = 'dddddddd-0000-4000-8000-000000000011';
    await expect(
      r.createInvoice({
        invoice: {
          id: newId,
          accountId: CONTOSO,
          number: 'INV-2024-0102',
          status: 'draft',
          totalMinor: 1n,
          issuedAt: null,
        },
        lineItems: [
          {
            id: 'cccccccc-0000-4000-8000-000000000001',
            invoiceId: newId,
            position: 1,
            description: 'never stored',
            quantity: 1,
            unitPriceMinor: 1n,
          },
        ],
      }),
    ).rejects.toThrow();

    expect(await r.findInvoice(newId)).toBeNull();
    expect(await r.findLineItems(newId)).toEqual([]);
    expect((await r.findAccount(CONTOSO))?.invoiceCount).toBe(0);
  });

  it('rejects creating an invoice for an unknown account (foreign key)', async () => {
    const r = repo();
    await expect(
      r.createInvoice({
        invoice: {
          id: 'dddddddd-0000-4000-8000-000000000012',
          accountId: MISSING,
          number: 'INV-2024-0103',
          status: 'draft',
          totalMinor: 1n,
          issuedAt: null,
        },
        lineItems: [],
      }),
    ).rejects.toThrow();
    expect(await r.findInvoice('dddddddd-0000-4000-8000-000000000012')).toBeNull();
  });

  it('surfaces the raw database error on a duplicate invoice number at creation time', async () => {
    // The Prisma create path never mapped the unique violation (P2002); a
    // duplicate number was a raw 500-class error, not a 409. The port keeps
    // that error surface instead of "fixing" it.
    const r = repo();
    await expect(
      r.createInvoice({
        invoice: {
          id: 'dddddddd-0000-4000-8000-000000000013',
          accountId: NORTHWIND,
          number: 'INV-2024-0001',
          status: 'draft',
          totalMinor: 1n,
          issuedAt: null,
        },
        lineItems: [],
      }),
    ).rejects.not.toBeInstanceOf(ConflictError);
  });

  it('cascades line-item deletion when an invoice is deleted, without touching the counter', async () => {
    await ctx.db.delete(invoices).where(eq(invoices.id, INVOICE_ISSUED));
    expect(
      await ctx.db.select().from(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, INVOICE_ISSUED)),
    ).toEqual([]);
    // The counter is only ever incremented on creation -- delete never
    // decremented it in Prisma either.
    expect((await repo().findAccount(NORTHWIND))?.invoiceCount).toBe(2);
  });
});
