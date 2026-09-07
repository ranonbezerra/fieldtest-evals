import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('validate-quantity', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects quantity ≤ 0', async () => {
    const acctRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Test Acct', email: `qtest-${Date.now()}@example.com` });
    const accountId = acctRes.body.id as string;

    const res = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'test item', unit_price_cents: 100, quantity: 0 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});
