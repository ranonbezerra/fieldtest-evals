import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import request from 'supertest';

let seq = 0;
function uniqueEmail(): string {
  seq += 1;
  return `void-test-${seq}-${Date.now()}@example.com`;
}

describe('void invoice', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('voiding does not reverse total_invoiced_cents', async () => {
    // Create an account
    const createAccountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Void Co', email: uniqueEmail() });
    expect(createAccountRes.status).toBe(201);
    const account = createAccountRes.body as Record<string, unknown>;
    const accountId = account['id'] as string;

    // Create an invoice with known line items (total = 150*3 + 75*2 = 600)
    const createInvoiceRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [
          { description: 'Consulting', unit_price_cents: 150, quantity: 3 },
          { description: 'Travel', unit_price_cents: 75, quantity: 2 },
        ],
      });
    expect(createInvoiceRes.status).toBe(201);
    const created = createInvoiceRes.body as Record<string, unknown>;
    const invoiceId = created['id'] as string;
    expect(created['total_cents']).toBe('600');

    // Verify account counter was updated
    const beforeRes = await request(app.getHttpServer()).get(`/accounts/${accountId}`);
    expect(beforeRes.status).toBe(200);
    const before = beforeRes.body as Record<string, unknown>;
    expect(before['total_invoiced_cents']).toBe('600');

    // Void the invoice
    const voidRes = await request(app.getHttpServer())
      .patch(`/invoices/${invoiceId}/status`)
      .send({ status: 'void' });
    expect(voidRes.status).toBe(200);
    const voided = voidRes.body as Record<string, unknown>;
    expect(voided['status']).toBe('void');

    // Account counter must remain unchanged
    const afterRes = await request(app.getHttpServer()).get(`/accounts/${accountId}`);
    expect(afterRes.status).toBe(200);
    const after = afterRes.body as Record<string, unknown>;
    expect(after['total_invoiced_cents']).toBe('600');
  });

  it('voiding a sent invoice also does not reverse counter', async () => {
    const createAccountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Sent Void Co', email: uniqueEmail() });
    expect(createAccountRes.status).toBe(201);
    const account = createAccountRes.body as Record<string, unknown>;
    const accountId = account['id'] as string;

    const createInvoiceRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Service', unit_price_cents: 200, quantity: 1 }],
      });
    expect(createInvoiceRes.status).toBe(201);
    const invoice = createInvoiceRes.body as Record<string, unknown>;
    const invoiceId = invoice['id'] as string;

    // Transition to sent first
    const sentRes = await request(app.getHttpServer())
      .patch(`/invoices/${invoiceId}/status`)
      .send({ status: 'sent' });
    expect(sentRes.status).toBe(200);

    // Now void it
    const voidRes = await request(app.getHttpServer())
      .patch(`/invoices/${invoiceId}/status`)
      .send({ status: 'void' });
    expect(voidRes.status).toBe(200);

    const afterRes = await request(app.getHttpServer()).get(`/accounts/${accountId}`);
    expect(afterRes.status).toBe(200);
    const after = afterRes.body as Record<string, unknown>;
    expect(after['total_invoiced_cents']).toBe('200');
  });

  it('line_items remain in invoice detail after void', async () => {
    const createAccountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'LineItems Co', email: uniqueEmail() });
    expect(createAccountRes.status).toBe(201);
    const account = createAccountRes.body as Record<string, unknown>;
    const accountId = account['id'] as string;

    const createInvoiceRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [
          { description: 'Alpha', unit_price_cents: 10, quantity: 1 },
          { description: 'Beta', unit_price_cents: 20, quantity: 2 },
        ],
      });
    expect(createInvoiceRes.status).toBe(201);
    const invoice = createInvoiceRes.body as Record<string, unknown>;
    const invoiceId = invoice['id'] as string;

    // Void it
    const voidRes = await request(app.getHttpServer())
      .patch(`/invoices/${invoiceId}/status`)
      .send({ status: 'void' });
    expect(voidRes.status).toBe(200);

    // Fetch full invoice detail and confirm line_items array is intact
    const detailRes = await request(app.getHttpServer()).get(`/invoices/${invoiceId}`);
    expect(detailRes.status).toBe(200);
    const detail = detailRes.body as Record<string, unknown>;
    expect(detail['status']).toBe('void');

    const lineItems = detail['line_items'] as unknown as Record<string, unknown>[];
    expect(Array.isArray(lineItems)).toBe(true);
    expect(lineItems).toHaveLength(2);
    expect(lineItems[0]['description']).toBe('Alpha');
    expect(lineItems[1]['description']).toBe('Beta');
  });

  it('multiple invoices: voiding one does not affect the other', async () => {
    const createAccountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Multi Co', email: uniqueEmail() });
    expect(createAccountRes.status).toBe(201);
    const account = createAccountRes.body as Record<string, unknown>;
    const accountId = account['id'] as string;

    // Two invoices: 100 and 300
    const inv1Res = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'A', unit_price_cents: 100, quantity: 1 }],
      });
    expect(inv1Res.status).toBe(201);
    const inv1 = inv1Res.body as Record<string, unknown>;

    const inv2Res = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'B', unit_price_cents: 300, quantity: 1 }],
      });
    expect(inv2Res.status).toBe(201);
    const inv2 = inv2Res.body as Record<string, unknown>;

    // Total should be 400
    const midRes = await request(app.getHttpServer()).get(`/accounts/${accountId}`);
    expect(midRes.body['total_invoiced_cents']).toBe('400');

    // Void only the first invoice
    const voidRes = await request(app.getHttpServer())
      .patch(`/invoices/${inv1['id'] as string}/status`)
      .send({ status: 'void' });
    expect(voidRes.status).toBe(200);

    // Counter still 400 — void does not subtract
    const afterRes = await request(app.getHttpServer()).get(`/accounts/${accountId}`);
    expect(afterRes.body['total_invoiced_cents']).toBe('400');

    // The second invoice's line_items are untouched
    const inv2DetailRes = await request(app.getHttpServer()).get(
      `/invoices/${inv2['id'] as string}`,
    );
    expect(inv2DetailRes.status).toBe(200);
    const inv2Detail = inv2DetailRes.body as Record<string, unknown>;
    const lineItems = inv2Detail['line_items'] as unknown as Record<string, unknown>[];
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0]['description']).toBe('B');
  });
});
