import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';

// Requires a running Postgres reachable via DATABASE_URL with migrations applied.
const prisma = new PrismaService();
let app: INestApplication;

beforeAll(async () => {
  await prisma.$connect();
  app = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.reportVersion.deleteMany({ where: { documentId: 'doc-env' } });
});

describe('error envelope', () => {
  it('404 responses use the single envelope with an object details field', async () => {
    const res = await request(app.getHttpServer()).get('/anchors/ghost/versions/1').expect(404);
    expect(res.body).toEqual({
      error: {
        code: 'resource_not_found',
        message: expect.any(String),
        details: { documentId: 'ghost', version: 1 },
      },
    });
    expect(res.body.error.details).not.toBeNull();
    expect(typeof res.body.error.details).toBe('object');
  });

  it('validation failures use the single envelope', async () => {
    const res = await request(app.getHttpServer()).post('/anchors').send({ documentId: '', version: 'one' }).expect(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.message).toEqual(expect.any(String));
    expect(res.body.error.details).toEqual(expect.objectContaining({ field: 'documentId' }));
  });

  it('conflicts use the single envelope', async () => {
    await request(app.getHttpServer())
      .post('/documents/doc-env/versions')
      .send({ version: 1, content: { a: 1 } })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post('/documents/doc-env/versions')
      .send({ version: 1, content: { a: 1 } })
      .expect(409);
    expect(res.body.error.code).toBe('document_version_exists');
    expect(res.body.error.details).toEqual(expect.objectContaining({ documentId: 'doc-env', version: 1 }));
  });
});
