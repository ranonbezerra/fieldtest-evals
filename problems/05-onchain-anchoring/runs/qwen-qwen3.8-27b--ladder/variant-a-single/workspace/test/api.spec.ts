import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ConfirmationWorkerService } from '../src/anchors/anchors.worker.js';
import { CHAIN_CLIENT } from '../src/chain/chain-client.js';
import { FakeChainClient } from '../src/chain/fake-chain-client.js';
import { DOCUMENT_CONTENT, InMemoryDocumentContentProvider } from '../src/content/document-content-provider.js';
import { configureApi } from '../src/main.js';

// The tests drive the workers directly; keep the background loops off.
process.env.CONFIRMATION_POLL_MS = '0';
process.env.RECOVERY_SWEEP_MS = '0';

const SAMPLE = { reportType: 'clinical-summary', vitals: { heartRate: 72, spo2: 0.98 } };

describe('HTTP API', () => {
  let app: INestApplication;
  let baseUrl: string;
  const chain = new FakeChainClient();
  const content = new InMemoryDocumentContentProvider();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CHAIN_CLIENT)
      .useValue(chain)
      .overrideProvider(DOCUMENT_CONTENT)
      .useValue(content)
      .compile();
    app = moduleRef.createNestApplication();
    configureApi(app);
    await app.init();
    const server = app.getHttpServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  it('POST /anchors returns 202 with the anchor intent and its tx identity', async () => {
    const documentId = `doc-${randomUUID()}`;
    content.publish(documentId, 1, SAMPLE);

    const { status, body } = await post('/anchors', { documentId, version: 1 });

    expect(status).toBe(202);
    expect(body.documentId).toBe(documentId);
    expect(body.version).toBe(1);
    expect(body.txId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.status).toBe('BROADCAST_SENT');
    expect(typeof body.contentHash).toBe('string');
  });

  it('POST /anchors on an already-anchored version returns the 409 already_anchored envelope', async () => {
    const documentId = `doc-${randomUUID()}`;
    content.publish(documentId, 1, SAMPLE);

    await post('/anchors', { documentId, version: 1 });
    const { status, body } = await post('/anchors', { documentId, version: 1 });

    expect(status).toBe(409);
    expect(body.error.code).toBe('already_anchored');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.details).toBeTypeOf('object');
    expect(body.error.details.existingStatus).toBe('BROADCAST_SENT');
  });

  it('POST /anchors without published content returns the 404 resource_not_found envelope', async () => {
    const { status, body } = await post('/anchors', {
      documentId: `doc-${randomUUID()}`,
      version: 3,
    });

    expect(status).toBe(404);
    expect(body.error.code).toBe('resource_not_found');
    expect(body.error.details).toEqual(expect.objectContaining({ version: 3 }));
  });

  it('POST /anchors with an invalid version returns the 400 invalid_request envelope', async () => {
    const { status, body } = await post('/anchors', {
      documentId: `doc-${randomUUID()}`,
      version: 'not-an-int',
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe('invalid_request');
    expect(Array.isArray(body.error.details.message)).toBe(true);
  });

  it('POST /anchors/verify returns the proof with a string block number for matching content', async () => {
    const documentId = `doc-${randomUUID()}`;
    content.publish(documentId, 1, SAMPLE);

    const anchored = await post('/anchors', { documentId, version: 1 });
    chain.confirmTx(anchored.body.txId, 777n);
    // Drive the confirmation worker directly (background loops are off in tests).
    await app.get(ConfirmationWorkerService).pollOnce();

    const { status, body } = await post('/anchors/verify', {
      documentId,
      version: 1,
      content: SAMPLE,
    });

    expect(status).toBe(200);
    expect(body.result).toBe('verified');
    expect(body.proof.txId).toBe(anchored.body.txId);
    expect(body.proof.blockNumber).toBe('777');
    expect(typeof body.proof.blockHash).toBe('string');
  });

  it('POST /anchors/verify returns a mismatch report naming both hashes for differing content', async () => {
    const documentId = `doc-${randomUUID()}`;
    content.publish(documentId, 1, SAMPLE);
    await post('/anchors', { documentId, version: 1 });

    const tampered = { ...SAMPLE, vitals: { ...SAMPLE.vitals, heartRate: 99 } };
    const { status, body } = await post('/anchors/verify', {
      documentId,
      version: 1,
      content: tampered,
    });

    expect(status).toBe(200);
    expect(body.result).toBe('content_mismatch');
    expect(body.expectedHash).not.toBe(body.actualHash);
  });

  it('POST /anchors/verify reports not_anchored for a version that was never anchored', async () => {
    const { status, body } = await post('/anchors/verify', {
      documentId: `doc-${randomUUID()}`,
      version: 1,
      content: SAMPLE,
    });

    expect(status).toBe(200);
    expect(body.result).toBe('not_anchored');
    expect(body.expectedHash).toBeNull();
    expect(body.proof).toBeNull();
  });

  it('POST /anchors/verify requires the content field', async () => {
    const { status, body } = await post('/anchors/verify', {
      documentId: `doc-${randomUUID()}`,
      version: 1,
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe('invalid_request');
  });
});
