import { describe, expect, it } from 'vitest';
import { BillingRepository } from '../src/billing/billing.repository.js';
import { makeFakeClient } from './fakes.js';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

function makeInput() {
  return {
    invoice: {
      id: 'cccccccc-0000-4000-8000-000000000001',
      accountId: ACCOUNT_ID,
      number: 'INV-2024-0003',
      status: 'draft',
      totalMinor: 75000n,
      issuedAt: null,
    },
    lineItems: [
      {
        id: 'dddddddd-0000-4000-8000-000000000001',
        invoiceId: 'cccccccc-0000-4000-8000-000000000001',
        position: 1,
        description: 'Consulting',
        quantity: 3,
        unitPriceMinor: 25000n,
      },
    ],
  };
}

describe('createInvoice atomicity', () => {
  it('commits the invoice, the line items and the counter together on success', async () => {
    const client = makeFakeClient();
    const repo = new BillingRepository(client);
    const input = makeInput();

    const saved = await repo.createInvoice(input);

    expect(saved.id).toBe(input.invoice.id);
    expect(saved.totalMinor).toBe(75000n);
    expect(saved.createdAt).toBeInstanceOf(Date);
    expect(client.invoices).toHaveLength(3);
    expect(client.lineItems).toHaveLength(4);
    // Northwind starts at 2 in the seed.
    expect(client.accounts.find((a) => a.id === ACCOUNT_ID)!.invoiceCount).toBe(3);
  });

  it('writes nothing when the line-item insert fails mid-transaction', async () => {
    const client = makeFakeClient({ failAt: 'lineItems' });
    const repo = new BillingRepository(client);
    const input = makeInput();

    await expect(repo.createInvoice(input)).rejects.toThrow('simulated failure: line-item insert');

    // The invoice insert had already executed inside the transaction; only a
    // rollback explains it being absent here.
    expect(client.invoices.some((i) => i.id === input.invoice.id)).toBe(false);
    expect(client.lineItems).toHaveLength(3);
    expect(client.accounts.find((a) => a.id === ACCOUNT_ID)!.invoiceCount).toBe(2);
  });

  it('writes nothing when the counter update fails mid-transaction', async () => {
    const client = makeFakeClient({ failAt: 'account' });
    const repo = new BillingRepository(client);
    const input = makeInput();

    await expect(repo.createInvoice(input)).rejects.toThrow('simulated failure: account counter update');

    expect(client.invoices.some((i) => i.id === input.invoice.id)).toBe(false);
    expect(client.lineItems.some((li) => li.id === input.lineItems[0].id)).toBe(false);
    expect(client.accounts.find((a) => a.id === ACCOUNT_ID)!.invoiceCount).toBe(2);
  });
});
