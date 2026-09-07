import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

// ASSUMPTION: CreateInvoiceDto uses snake_case field names in the request body,
// consistent with the snake_case wire format of all output fields (due_date, line_items, etc.).
// The compiler messages do not expose the DTO shape; this is inferred from the output contract.

describe('null vs missing', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('due_date null is present-key-null', async () => {
    const acctRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Null Test Acct', email: 'null-test@example.com' });
    expect(acctRes.status).toBe(201);
    const accountId: string = acctRes.body.id;

    const invRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Test item', unit_price_cents: 100, quantity: 1 }],
      });

    expect(invRes.status).toBe(201);
    // Key must be present in the JSON with a null value, not absent from the object.
    expect(invRes.body).toHaveProperty('due_date');
    expect(invRes.body.due_date).toBeNull();
  });

  it('empty line_items is empty array', async () => {
    const acctRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Empty Items Acct', email: 'empty-items@example.com' });
    expect(acctRes.status).toBe(201);
    const accountId: string = acctRes.body.id;

    const invRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [],
      });

    expect(invRes.status).toBe(201);
    // Key must be present as an empty array, not absent or null.
    expect(invRes.body).toHaveProperty('line_items');
    expect(Array.isArray(invRes.body.line_items)).toBe(true);
    expect((invRes.body.line_items as unknown[]).length).toBe(0);
  });
});
