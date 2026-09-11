import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/all-exceptions.filter.js';
import { CHAIN_CLIENT } from '../src/anchoring/chain-client.js';
import { ANCHORING_CONFIG, loadAnchoringConfig } from '../src/anchoring/anchoring.config.js';
import { ConfirmationWorker } from '../src/anchoring/confirmation-worker.service.js';
import { ensureMigrated } from './db.js';
import { FakeChain } from './fake-chain.js';

describe('anchors HTTP API', () => {
  let app: INestApplication;
  let db: PrismaClient;
  const chain = new FakeChain();

  beforeAll(async () => {
    ensureMigrated();
    db = new PrismaClient();
    await db.$connect();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CHAIN_CLIENT)
      .useValue(chain)
      // Workers stay off in the harness; individual tests drive them via runOnce().
      .overrideProvider(ANCHORING_CONFIG)
      .useValue(loadAnchoringConfig({ ANCHOR_WORKER_ENABLED: 'false' }))
      .compile();

    app = moduleRef.createNestApplication();
    // Mirror the global pipe/filter registered in src/main.ts.
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  beforeEach(async () => {
    chain.reset();
    await db.anchor.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  it('POST /anchors anchors the version and returns 202 with the tx identity', async () => {
    const res = await request(app.getHttpServer())
      .post('/anchors')
      .send({ documentId: 'doc-http', version: 1, content: { kind: 'lab', value: 42 } });

    expect(res.status).toBe(202);
    expect(res.body.documentId).toBe('doc-http');
    expect(res.body.version).toBe(1);
    expect(res.body.txId).toMatch(/^tx_/);
    expect(res.body.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(res.body.status).toBe('broadcast_sent');
  });

  it('POST /anchors rejects a second anchor for the same (document, version) with the 409 envelope', async () => {
    const body = { documentId: 'doc-http-dup', version: 1, content: { a: 1 } };
    const first = await request(app.getHttpServer()).post('/anchors').send(body);
    expect(first.status).toBe(202);

    const second = await request(app.getHttpServer()).post('/anchors').send(body);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({ code: 'already_anchored' });
    expect(typeof second.body.error.message).toBe('string');
    expect(second.body.error.details).toMatchObject({ documentId: 'doc-http-dup', version: 1 });
    expect(second.body.error.details).not.toBeNull();
    expect(typeof second.body.error.details).toBe('object');
  });

  it('POST /anchors validates the request and answers with the 400 envelope', async () => {
    const res = await request(app.getHttpServer())
      .post('/anchors')
      .send({ documentId: '', version: '1', content: 1, extra: true });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect(typeof res.body.error.message).toBe('string');
    expect(Array.isArray(res.body.error.details.validation)).toBe(true);
    expect(res.body.error.details.validation.length).toBeGreaterThan(0);
  });

  it('POST /anchors/verify returns the proof for matching content and a mismatch report otherwise', async () => {
    const body = { documentId: 'doc-http-verify', version: 3, content: { kind: 'imaging', slices: 8 } };
    const created = await request(app.getHttpServer()).post('/anchors').send(body);
    expect(created.status).toBe(202);
    const txId = created.body.txId;

    // The tx landed on broadcast; advance it to confirmed via the worker.
    await app.get(ConfirmationWorker).runOnce();

    const ok = await request(app.getHttpServer()).post('/anchors/verify').send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.result).toBe('verified');
    expect(ok.body.suppliedContentHash).toBe(created.body.contentHash);
    expect(ok.body.anchor).toMatchObject({
      txId,
      status: 'confirmed',
      blockNumber: expect.any(Number),
      contentHash: created.body.contentHash,
    });

    const bad = await request(app.getHttpServer())
      .post('/anchors/verify')
      .send({ ...body, content: { kind: 'imaging', slices: 9 } });
    expect(bad.status).toBe(200);
    expect(bad.body.result).toBe('hash_mismatch');
    expect(bad.body.anchor.contentHash).toBe(created.body.contentHash);
    expect(bad.body.suppliedContentHash).not.toBe(created.body.contentHash);
    expect(typeof bad.body.detail).toBe('string');

    const missing = await request(app.getHttpServer())
      .post('/anchors/verify')
      .send({ documentId: 'doc-http-verify', version: 4, content: { x: 1 } });
    expect(missing.status).toBe(200);
    expect(missing.body.result).toBe('no_anchor');
    expect(missing.body.anchor).toBeNull();
  });
});
