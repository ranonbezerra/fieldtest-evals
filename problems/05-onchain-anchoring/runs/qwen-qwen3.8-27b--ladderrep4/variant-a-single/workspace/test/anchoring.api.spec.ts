import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AnchoringModule } from '../src/anchoring/anchoring.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> };
}

describe('anchoring HTTP API (error envelope + flow)', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    // Keep the background worker from interfering with these assertions.
    process.env.ANCHORING_CONFIRMATION_POLL_MS = '3600000';
    process.env.ANCHORING_RECOVERY_SWEEP_MS = '3600000';
    process.env.ANCHORING_STUCK_AFTER_MS = '3600000';

    const moduleRef = await Test.createTestingModule({ imports: [AnchoringModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    base = app.getUrl();

    const prisma = app.get(PrismaService);
    await prisma.anchor.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
  }, 60_000);

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    await prisma.anchor.deleteMany();
    await prisma.documentVersion.deleteMany();
    await prisma.document.deleteMany();
    await app.close();
  });

  it('rejects a malformed version with the standard 400 envelope', async () => {
    const res = await fetch(`${base}/documents/doc-x/versions/not-an-int/anchors`, { method: 'POST' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('validation_error');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.details).toEqual(expect.any(Object));
    expect(body.error.details.version).toBe('not-an-int');
  });

  it('reports a document version that was never issued with 404', async () => {
    const res = await fetch(`${base}/documents/ghost-doc/versions/1/anchors`, { method: 'POST' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('document_version_not_found');
    expect(body.error.details).toMatchObject({ documentId: 'ghost-doc', version: 1 });
  });

  it('issues a version, anchors it, verifies a mismatch — all through the API', async () => {
    const content = { patient: 'anon-7', labs: { hgb: 12.5 } };

    const issued = await fetch(`${base}/documents/doc-http/versions/1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, content }),
    });
    expect(issued.status).toBe(201);

    const anchored = await fetch(`${base}/documents/doc-http/versions/1/anchors`, { method: 'POST' });
    expect(anchored.status).toBe(201);
    const anchor = (await anchored.json()) as {
      documentId: string;
      version: number;
      status: string;
      txId: string;
      signedTx?: string;
    };
    expect(anchor.documentId).toBe('doc-http');
    expect(anchor.version).toBe(1);
    expect(anchor.status).toBe('broadcast_sent');
    expect(anchor.txId).toMatch(/^tx_/);
    expect(anchor.signedTx).toBeUndefined(); // the signed tx is never exposed by the API

    const tampered = { patient: 'anon-7', labs: { hgb: 99.9 } };
    const verified = await fetch(`${base}/documents/doc-http/versions/1/anchors/verifications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: tampered }),
    });
    expect(verified.status).toBe(200);
    const report = (await verified.json()) as {
      match: boolean;
      anchorState: string;
      differences: Array<{ path: string }>;
      proof: unknown;
    };
    expect(report.match).toBe(false);
    expect(report.anchorState).toBe('broadcast_sent');
    expect(report.proof).toBeNull();
    expect(report.differences.map((d) => d.path)).toContain('$.labs.hgb');

    const reanchored = await fetch(`${base}/documents/doc-http/versions/1/anchors`, { method: 'POST' });
    expect(reanchored.status).toBe(409);
    const conflict = (await reanchored.json()) as ErrorEnvelope;
    expect(conflict.error.code).toBe('anchor_conflict');
  });
});
