import { describe, expect, it } from 'vitest';
import { BillingService } from '../src/billing/billing.service.js';
import { BillingRepository } from '../src/billing/billing.repository.js';
import { NotFoundError } from '../src/common/errors.js';
import { serialize } from '../src/common/serializer.js';
import { makeFakeClient } from './fakes.js';

const ACCOUNT_WITH_INVOICES = '11111111-1111-4111-8111-111111111111';
const INVOICE_WITH_ITEMS = 'aaaaaaaa-0000-4000-8000-000000000001';
const INVOICE_WITHOUT_ITEMS = 'aaaaaaaa-0000-4000-8000-000000000002';
const MISSING_ID = '99999999-9999-4999-8999-999999999999';

function service(): BillingService {
  return new BillingService(new BillingRepository(makeFakeClient()));
}

function asJson<T>(value: unknown): T {
  // Same round-trip the wire layer does: serialize() then JSON.
  return JSON.parse(JSON.stringify(serialize(value))) as T;
}

describe('ordering (never asserted by the original suite)', () => {
  it('returns line items in storage order, not position order', async () => {
    // The seed inserts positions 3, 1, 2 on purpose. Old and new query both
    // lack an ORDER BY, so the wire order is the storage order.
    const inv = await service().getInvoice(INVOICE_WITH_ITEMS);
    expect(inv.lineItems.map((li: any) => li.position)).toEqual([3, 1, 2]);
  });

  it('returns invoices for an account in storage order', async () => {
    const list = await service().listForAccount(ACCOUNT_WITH_INVOICES);
    expect(list.map((i) => i.number)).toEqual(['INV-2024-0001', 'INV-2024-0002']);
  });
});

describe('nulls, empties and missing accounts', () => {
  it('keeps issuedAt present-but-null and lineItems present-but-empty for an unissued invoice', async () => {
    const inv = await service().getInvoice(INVOICE_WITHOUT_ITEMS);
    expect(inv.issuedAt).toBeNull();
    expect(inv.lineItems).toEqual([]);

    const body = asJson<{ issuedAt: unknown; lineItems: unknown }>(inv);
    expect('issuedAt' in body).toBe(true);
    expect(body.issuedAt).toBe(null);
    expect(body.lineItems).toEqual([]);
  });

  it('returns an empty list, not a not-found error, for a non-existent account', async () => {
    const list = await service().listForAccount(MISSING_ID);
    expect(list).toEqual([]);
  });
});

describe('error paths', () => {
  it('issue() on a missing invoice raises invoice_not_found (the old 404 path)', async () => {
    const err = await service().issue(MISSING_ID).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).code).toBe('invoice_not_found');
  });
});

describe('wire format: BigInt money and field presence', () => {
  it('serializes invoice totals as exact decimal strings', async () => {
    const inv = await service().getInvoice(INVOICE_WITH_ITEMS);
    const body = asJson<{ totalMinor: unknown; lineItems: Array<{ unitPriceMinor: unknown }> }>(inv);

    expect(typeof body.totalMinor).toBe('string');
    // The seed value is past Number.MAX_SAFE_INTEGER; a Number round-trip
    // would read 9007199254740992.
    expect(body.totalMinor).toBe('9007199254740993');
    expect(body.lineItems.map((li) => li.unitPriceMinor)).toEqual(['50000', '250000', '120000']);
  });

  it('serializes account listings with string totals and every field present', async () => {
    const list = await service().listForAccount(ACCOUNT_WITH_INVOICES);
    const body = asJson<Array<Record<string, unknown>>>(list);

    expect(body.map((i) => i.totalMinor)).toEqual(['9007199254740993', '125000']);
    for (const i of body) {
      expect(Object.keys(i).sort()).toEqual([
        'accountId',
        'createdAt',
        'id',
        'issuedAt',
        'number',
        'status',
        'totalMinor',
      ]);
    }
  });
});
