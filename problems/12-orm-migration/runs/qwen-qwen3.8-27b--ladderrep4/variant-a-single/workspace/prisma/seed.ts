// Seed data the test suite and manual checks run against.
export const seed = {
  accounts: [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Northwind', currency: 'EUR', invoiceCount: 2 },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Contoso', currency: 'USD', invoiceCount: 0 },
  ],
  invoices: [
    {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      accountId: '11111111-1111-4111-8111-111111111111',
      number: 'INV-2024-0001',
      status: 'issued',
      totalMinor: 9007199254740993n, // deliberately past Number.MAX_SAFE_INTEGER
      issuedAt: new Date('2024-04-01T09:00:00Z'),
    },
    {
      id: 'aaaaaaaa-0000-4000-8000-000000000002',
      accountId: '11111111-1111-4111-8111-111111111111',
      number: 'INV-2024-0002',
      status: 'draft',
      totalMinor: 125000n,
      issuedAt: null,
    },
  ],
  // Inserted out of positional order on purpose: rows 3, 1, 2.
  lineItems: [
    { id: 'bbbbbbbb-0000-4000-8000-000000000003', invoiceId: 'aaaaaaaa-0000-4000-8000-000000000001', position: 3, description: 'Support retainer', quantity: 1, unitPriceMinor: 50000n },
    { id: 'bbbbbbbb-0000-4000-8000-000000000001', invoiceId: 'aaaaaaaa-0000-4000-8000-000000000001', position: 1, description: 'Implementation', quantity: 2, unitPriceMinor: 250000n },
    { id: 'bbbbbbbb-0000-4000-8000-000000000002', invoiceId: 'aaaaaaaa-0000-4000-8000-000000000001', position: 2, description: 'Training day', quantity: 1, unitPriceMinor: 120000n },
  ],
};
