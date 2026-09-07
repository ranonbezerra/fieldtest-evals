import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('BigInt wire format', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('zero-amount invoice serialises as "0"', async () => {
    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Zero Co', email: `zero-${Date.now()}@test.com` })
      .expect(201);
    const accountId: string = accountRes.body.id;

    const invoiceRes = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Free tier', unit_price_cents: 0, quantity: 1 }],
      })
      .expect(201);

    expect(invoiceRes.body.total_cents).toBe('0');
    expect(typeof invoiceRes.body.total_cents).toBe('string');
  });

  it('negative balance serialises with minus sign', async () => {
    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Neg Co', email: `neg-${Date.now()}@test.com` })
      .expect(201);
    const accountId: string = accountRes.body.id;

    await request(app.getHttpServer())
      .post('/invoices')
      .send({
        account_id: accountId,
        line_items: [{ description: 'Charge', unit_price_cents: 50, quantity: 1 }],
      })
      .expect(201);

    const getRes = await request(app.getHttpServer())
      .get(`/accounts/${accountId}`)
      .expect(200);

    expect(getRes.body.balance_cents).toBe('-50');
    expect(typeof getRes.body.balance_cents).toBe('string');
  });
});
