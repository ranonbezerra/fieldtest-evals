import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { CHAIN_CLIENT } from '../src/anchor/chain-client.interface.js';
import { AnchorProcessor } from '../src/anchor/anchor.processor.js';
import { hashContent } from '../src/anchor/anchor-canonicalizer.js';
import { FakeChainClient } from './fakes/chain-client.fake.js';
import { ensureDatabaseSchema } from './setup.js';

const prisma = new PrismaClient();

const content: Record<string, unknown> = {
  reportId: 'R-77',
  patient: 'p-9',
  sections: [{ name: 'summary', body: 'stable' }],
};

let app: INestApplication;
let baseUrl = '';
let fake: FakeChainClient;

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

beforeAll(async () => {
  ensureDatabaseSchema();
  // Background workers are off in the API tests; the processor is driven
  // explicitly so outcomes are deterministic.
  process.env.ANCHOR_WORKER_ENABLED = 'false';
  fake = new FakeChainClient();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CHAIN_CLIENT)
    .useValue(fake)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);
  const address = app.getHttpServer().address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  await prisma.anchor.deleteMany();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('POST /document-anchors', () => {
  it('anchors and returns the anchor view', async () => {
    const res = await post('/document-anchors', { documentId: 'doc-api', version: 1, content });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.documentId).toBe('doc-api');
    expect(body.version).toBe(1);
    expect(body.contentHash).toBe(hashContent(content));
    expect(body.txId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.state).toBe('pending');
    expect(body.broadcastAt).not.toBeNull();
    expect(body.blockNumber).toBeNull();
  });

  it('is idempotent for identical content (200, same anchor)', async () => {
    const first = await post('/document-anchors', { documentId: 'doc-idem', version: 2, content });
    const second = await post('/document-anchors', { documentId: 'doc-idem', version: 2, content });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const a = (await first.json()) as { id: string };
    const b = (await second.json()) as { id: string };
    expect(b.id).toBe(a.id);
    expect(await prisma.anchor.count()).toBe(1);
  });

  it('rejects different content for an anchored (document, version) with the 409 envelope', async () => {
    await post('/document-anchors', { documentId: 'doc-conf', version: 1, content });
    const res = await post('/document-anchors', {
      documentId: 'doc-conf',
      version: 1,
      content: { reportId: 'R-77', changed: true },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('anchor_conflict');
    expect(typeof body.error.message).toBe('string');
    expect(typeof body.error.details).toBe('object');
    expect(body.error.details).not.toBeNull();
  });

  it('rejects invalid input with the 400 envelope', async () => {
    const invalidBodies: unknown[] = [
      { documentId: '', version: 1, content },
      { documentId: 'd', version: 1.5, content },
      { documentId: 'd', version: 1, content: [1, 2] },
      { documentId: 'd', version: 1 },
    ];
    for (const bad of invalidBodies) {
      const res = await post('/document-anchors', bad);
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrorEnvelope;
      expect(body.error.code).toBe('invalid_input');
      expect(typeof body.error.details).toBe('object');
      expect(body.error.details).not.toBeNull();
      expect(body.error.details).toHaveProperty('field');
    }
  });
});

describe('POST /document-anchors/verify', () => {
  it('reports pending before confirmation and returns the proof after', async () => {
    const created = await post('/document-anchors', { documentId: 'doc-ver', version: 1, content });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { txId: string };

    let res = await post('/document-anchors/verify', { documentId: 'doc-ver', version: 1, content });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('pending');

    const processor = app.get(AnchorProcessor);
    expect((await processor.runConfirmationTick()).confirmed).toBe(1);

    res = await post('/document-anchors/verify', { documentId: 'doc-ver', version: 1, content });
    const body = (await res.json()) as { status: string; proof: { txId: string; blockNumber: number } };
    expect(body.status).toBe('verified');
    expect(body.proof.txId).toBe(createdBody.txId);
    expect(body.proof.blockNumber).toBe(100);
  });

  it('returns a mismatch report for changed content', async () => {
    await post('/document-anchors', { documentId: 'doc-mm', version: 1, content });
    const changed: Record<string, unknown> = { reportId: 'CHANGED' };
    const res = await post('/document-anchors/verify', { documentId: 'doc-mm', version: 1, content: changed });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; storedHash: string; computedHash: string };
    expect(body.status).toBe('mismatch');
    expect(body.storedHash).toBe(hashContent(content));
    expect(body.computedHash).toBe(hashContent(changed));
  });

  it('returns not_anchored for an unknown (document, version)', async () => {
    const res = await post('/document-anchors/verify', { documentId: 'doc-none', version: 1, content });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('not_anchored');
  });
});

describe('error envelope', () => {
  it('wraps unknown routes in the 404 envelope', async () => {
    const res = await fetch(`${baseUrl}/definitely-not-a-route`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('resource_not_found');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.details).toEqual({});
  });
});
