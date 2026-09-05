import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';

import { AccountController } from '../src/account/account.controller';
import { AccountService } from '../src/account/account.service';
import { AccountRepository, AccountRow } from '../src/account/account.repository';

const sampleAccount: AccountRow = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  name: 'Test Account',
  balance_cents: '150000',
  total_invoiced_cents: '50000',
  created_at: new Date('2024-01-15T10:30:00.000Z'),
  updated_at: new Date('2024-01-15T10:30:00.000Z'),
};

describe('Account endpoints', () => {
  let app: INestApplication;
  let mockRepo: {
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    updateCounters: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockRepo = {
      findById: vi.fn(),
      create: vi.fn(),
      updateCounters: vi.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [
        AccountService,
        { provide: AccountRepository, useValue: mockRepo },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── GET /accounts/:id ───────────────────────────────────────────────────────

  it('GET /accounts/:id returns 200 with all six fields present', async () => {
    mockRepo.findById.mockResolvedValue(sampleAccount);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${sampleAccount.id}`)
      .expect(200);

    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('balance_cents');
    expect(res.body).toHaveProperty('total_invoiced_cents');
    expect(res.body).toHaveProperty('created_at');
    expect(res.body).toHaveProperty('updated_at');
  });

  it('GET /accounts/:id — balance_cents and total_invoiced_cents are typeof string', async () => {
    mockRepo.findById.mockResolvedValue(sampleAccount);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${sampleAccount.id}`)
      .expect(200);

    expect(typeof res.body.balance_cents).toBe('string');
    expect(typeof res.body.total_invoiced_cents).toBe('string');
  });

  it('GET /accounts/:id — created_at and updated_at are ISO-8601 date strings', async () => {
    mockRepo.findById.mockResolvedValue(sampleAccount);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${sampleAccount.id}`)
      .expect(200);

    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(res.body.created_at).toMatch(isoPattern);
    expect(res.body.updated_at).toMatch(isoPattern);
  });

  it('GET /accounts/:id for a non-existent UUID returns 404 with resource_not_found', async () => {
    const absentId = '00000000-0000-0000-0000-000000000000';
    mockRepo.findById.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${absentId}`)
      .expect(404);

    expect(res.body.error.code).toBe('resource_not_found');
  });

  it('GET /accounts/:id for a non-existent UUID — error body has details as empty object', async () => {
    const absentId = '00000000-0000-0000-0000-000000000000';
    mockRepo.findById.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${absentId}`)
      .expect(404);

    expect(res.body.error.details).toEqual({});
  });

  it('GET /accounts/:id with a malformed id returns 404, not 500', async () => {
    mockRepo.findById.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get('/accounts/not-a-uuid')
      .expect(404);

    expect(res.body.error.code).toBe('resource_not_found');
  });

  it('GET /accounts/:id for an account with balance exceeding Number.MAX_SAFE_INTEGER returns exact decimal string', async () => {
    const largeAccount: AccountRow = {
      ...sampleAccount,
      balance_cents: '9007199254740993',
    };
    mockRepo.findById.mockResolvedValue(largeAccount);

    const res = await request(app.getHttpServer())
      .get(`/accounts/${largeAccount.id}`)
      .expect(200);

    expect(res.body.balance_cents).toBe('9007199254740993');
    expect(typeof res.body.balance_cents).toBe('string');
  });

  // ─── POST /accounts ──────────────────────────────────────────────────────────

  it('POST /accounts with a valid name returns 201 with balance_cents "0" and total_invoiced_cents "0"', async () => {
    const newAccount: AccountRow = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      name: 'New Account',
      balance_cents: '0',
      total_invoiced_cents: '0',
      created_at: new Date('2024-06-01T12:00:00.000Z'),
      updated_at: new Date('2024-06-01T12:00:00.000Z'),
    };
    mockRepo.create.mockResolvedValue(newAccount);

    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'New Account' })
      .expect(201);

    expect(res.body.balance_cents).toBe('0');
    expect(res.body.total_invoiced_cents).toBe('0');
  });

  it('POST /accounts — returned id is a valid UUID v4 and created_at equals updated_at', async () => {
    const newAccount: AccountRow = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      name: 'Another Account',
      balance_cents: '0',
      total_invoiced_cents: '0',
      created_at: new Date('2024-06-01T12:00:00.000Z'),
      updated_at: new Date('2024-06-01T12:00:00.000Z'),
    };
    mockRepo.create.mockResolvedValue(newAccount);

    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Another Account' })
      .expect(201);

    const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(res.body.id).toMatch(uuidV4Pattern);
    expect(res.body.created_at).toBe(res.body.updated_at);
  });

  it('POST /accounts with name missing returns 400 validation_error', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({})
      .expect(400);

    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST /accounts with empty string name returns 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: '' })
      .expect(400);

    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST /accounts with whitespace-only name returns 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: '   ' })
      .expect(400);

    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST /accounts with non-string name returns 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 42 })
      .expect(400);

    expect(res.body.error.code).toBe('validation_error');
  });

  it('POST /accounts with null body returns 400, not 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .set('Content-Type', 'application/json')
      .send('null')
      .expect(400);

    expect(res.body.error.code).toBe('validation_error');
  });
});
