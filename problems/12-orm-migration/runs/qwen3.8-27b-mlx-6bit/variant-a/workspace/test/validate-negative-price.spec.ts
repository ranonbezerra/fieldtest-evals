import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('POST /invoices – negative unit price', () => {
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

  it('rejects negative unit_price_cents with validation_error', async () => {
    // Arrange – create an account so the FK is satisfied
    const unique = Date.now().toString(36);
    const accountRes = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Neg Price Acct', email: `neg-price-${unique}@example.com` });
    expect(accountRes.status).toBe(201);
    const accountId: string = accountRes.body.id;

    // Act – attempt to create an invoice with a negative unit price
    const res = await request(app.getHttpServer())
      .post('/invoices')
      .send({
        accountId,
        lineItems: [
          { description: 'Bad item', unitPriceCents: -1, quantity: 1 },
        ],
      });

    // Assert – single error envelope with the validation_error code
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details).toEqual({});
  });
});
