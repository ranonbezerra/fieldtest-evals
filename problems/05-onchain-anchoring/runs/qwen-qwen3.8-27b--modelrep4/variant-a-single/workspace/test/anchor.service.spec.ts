import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { Prisma, type DocumentAnchor } from '@prisma/client';
import { AnchorService } from '../src/anchor/anchor.service.js';
import type { AnchorRepository } from '../src/anchor/anchor.repository.js';
import type { AnchorTx, ChainClient, PreparedTx, TxReceipt } from '../src/anchor/chain-client.js';
import type { DocumentContentSource } from '../src/anchor/document-content-source.js';
import { AnchorNotFoundError, DocumentNotFoundError } from '../src/anchor/anchor.errors.js';
import { CanonicalizationError, canonicalize, computeAnchorHash } from '../src/anchor/canonicalization.js';
import { AnchorController } from '../src/anchor/anchor.controller.js';
import { ExceptionFilter } from '../src/common/exception.filter.js';

const CONTENT = {
  documentType: 'clinical-report',
  patient: 'anon-001',
  findings: [{ code: 'Q00.9' }, { code: 'Z10' }],
  issuedBy: 'dr-01',
};

/** Scripted in-memory chain client. */
class ScriptedChainClient implements ChainClient {
  readonly prepared: { data: string; txId: string }[] = [];
  readonly broadcastAttempts: string[] = [];
  private readonly receipts = new Map<string, TxReceipt>();
  private readonly txIdBySigned = new Map<string, string>();
  broadcastError: unknown = undefined;
  receiptError: unknown = undefined;
  onBroadcast?: (txId: string) => Promise<void> | void;

  async prepare(tx: AnchorTx): Promise<PreparedTx> {
    const txId = `0x${createHash('sha256').update(JSON.stringify(tx)).digest('hex')}`;
    const signedTx = `sig:${txId}`;
    this.txIdBySigned.set(signedTx, txId);
    this.prepared.push({ data: tx.data, txId });
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    this.broadcastAttempts.push(signedTx);
    await this.onBroadcast?.(this.txIdBySigned.get(signedTx) ?? '');
    if (this.broadcastError !== undefined) throw this.broadcastError;
  }

  async getReceipt(txId: string): Promise<TxReceipt | null> {
    if (this.receiptError !== undefined) throw this.receiptError;
    return this.receipts.get(txId) ?? null;
  }

  setReceipt(txId: string, receipt: TxReceipt): void {
    this.receipts.set(txId, receipt);
  }
}

/** In-memory twin of AnchorRepository (same behaviour, same conflict error). */
class FakeAnchorRepository {
  rows: DocumentAnchor[] = [];
  private seq = 0;
  private now = () => new Date();

  async create(input: {
    documentId: string;
    version: string;
    anchorHash: string;
    txId: string;
  }): Promise<DocumentAnchor> {
    if (this.rows.some((r) => r.documentId === input.documentId && r.version === input.version)) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      });
    }
    const row: DocumentAnchor = {
      id: `row-${++this.seq}`,
      documentId: input.documentId,
      version: input.version,
      anchorHash: input.anchorHash,
      txId: input.txId,
      state: 'PENDING_BROADCAST',
      blockNumber: null,
      chainStatus: null,
      lastError: null,
      broadcastAttempts: 0,
      createdAt: this.now(),
      updatedAt: this.now(),
      confirmedAt: null,
    };
    this.rows.push(row);
    return { ...row };
  }

  async findByDocumentVersion(documentId: string, version: string): Promise<DocumentAnchor | null> {
    const row = this.rows.find((r) => r.documentId === documentId && r.version === version);
    return row ? { ...row } : null;
  }

  async findInStates(states: readonly string[], limit: number): Promise<DocumentAnchor[]> {
    return this.rows.filter((r) => states.includes(r.state)).slice(0, limit).map((r) => ({ ...r }));
  }

  private mutate(id: string, data: Partial<DocumentAnchor>): DocumentAnchor {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`no anchor row ${id}`);
    Object.assign(row, data, { updatedAt: this.now() });
    return { ...row };
  }

  async markBroadcast(id: string): Promise<DocumentAnchor> {
    const row = this.rows.find((r) => r.id === id);
    return this.mutate(id, { state: 'BROADCAST', broadcastAttempts: (row?.broadcastAttempts ?? 0) + 1 });
  }

  async markLimbo(id: string, lastError: string): Promise<DocumentAnchor> {
    const row = this.rows.find((r) => r.id === id);
    return this.mutate(id, { state: 'LIMBO', lastError, broadcastAttempts: (row?.broadcastAttempts ?? 0) + 1 });
  }

  async markConfirmed(id: string, blockNumber: number): Promise<DocumentAnchor> {
    return this.mutate(id, {
      state: 'CONFIRMED',
      blockNumber,
      chainStatus: 'success',
      confirmedAt: new Date(),
      lastError: null,
    });
  }

  async markFailed(id: string, lastError: string): Promise<DocumentAnchor> {
    return this.mutate(id, { state: 'FAILED', lastError });
  }
}

class MutableContentSource implements DocumentContentSource {
  content: unknown;
  constructor(content: unknown) {
    this.content = content;
  }
  async get(): Promise<unknown> {
    return this.content;
  }
}

function makeService(contentSource: DocumentContentSource = new MutableContentSource(CONTENT)) {
  const chain = new ScriptedChainClient();
  const repo = new FakeAnchorRepository();
  const service = new AnchorService(repo as AnchorRepository, chain, contentSource);
  return { chain, repo, service };
}

describe('anchorDocument', () => {
  it('persists the anchor intent with the tx identity before broadcasting', async () => {
    const { chain, repo, service } = makeService();
    let rowAtBroadcast: DocumentAnchor | null = null;
    chain.onBroadcast = async () => {
      rowAtBroadcast = await repo.findByDocumentVersion('doc-1', '1');
    };

    const view = await service.anchorDocument('doc-1', '1');

    expect(rowAtBroadcast).not.toBeNull();
    expect(rowAtBroadcast!.txId).toBe(view.txId);
    expect(rowAtBroadcast!.anchorHash).toBe(computeAnchorHash('doc-1', '1', CONTENT));
    expect(rowAtBroadcast!.state).toBe('PENDING_BROADCAST');
    expect(view.state).toBe('BROADCAST');
    expect(view.blockNumber).toBeNull();
    expect(chain.broadcastAttempts).toHaveLength(1);
  });

  it('returns the existing anchor and does not re-broadcast for a repeat request', async () => {
    const { chain, repo, service } = makeService();
    const first = await service.anchorDocument('doc-1', '1');
    const second = await service.anchorDocument('doc-1', '1');

    expect(second.id).toBe(first.id);
    expect(second.txId).toBe(first.txId);
    expect(repo.rows).toHaveLength(1);
    expect(chain.broadcastAttempts).toHaveLength(1);
  });

  it('rejects anchoring different content under an already anchored (document, version)', async () => {
    const docs = new MutableContentSource(CONTENT);
    const { repo, service } = makeService(docs);
    await service.anchorDocument('doc-1', '1');
    docs.content = { ...CONTENT, findings: [{ code: 'Q00.9' }, { code: 'Z00' }] };

    await expect(service.anchorDocument('doc-1', '1')).rejects.toMatchObject({
      code: 'anchor_conflict',
      status: 409,
    });
    expect(repo.rows).toHaveLength(1);
  });

  it('keeps the record in LIMBO when the broadcast times out', async () => {
    const { chain, repo, service } = makeService();
    chain.broadcastError = new Error('broadcast timed out (unknown outcome)');

    const view = await service.anchorDocument('doc-1', '1');

    expect(view.state).toBe('LIMBO');
    expect(view.lastError).toMatch(/timed out/);
    const row = await repo.findByDocumentVersion('doc-1', '1');
    expect(row).not.toBeNull();
    expect(row!.txId).toBe(view.txId);
  });

  it('fails fast with document_not_found and creates no anchor row when the content is missing', async () => {
    const { repo, service } = makeService({
      get: () => Promise.reject(new DocumentNotFoundError('doc-1', '1')),
    });

    await expect(service.anchorDocument('doc-1', '1')).rejects.toMatchObject({
      code: 'document_not_found',
      status: 404,
    });
    expect(repo.rows).toHaveLength(0);
  });
});

describe('confirmation worker pass', () => {
  it('advances a BROADCAST anchor to CONFIRMED when the receipt exists', async () => {
    const { chain, repo, service } = makeService();
    const view = await service.anchorDocument('doc-1', '1');
    chain.setReceipt(view.txId, { txId: view.txId, blockNumber: 4321, status: 'success' });

    const summary = await service.confirmAnchors();

    expect(summary).toEqual({ checked: 1, confirmed: 1, failed: 0 });
    const row = await repo.findByDocumentVersion('doc-1', '1');
    expect(row!.state).toBe('CONFIRMED');
    expect(row!.blockNumber).toBe(4321);
    expect(row!.confirmedAt).toBeInstanceOf(Date);
  });

  it('leaves the anchor alone when the receipt is not available yet', async () => {
    const { chain, repo, service } = makeService();
    await service.anchorDocument('doc-1', '1');

    const summary = await service.confirmAnchors();

    expect(summary).toEqual({ checked: 1, confirmed: 0, failed: 0 });
    expect((await repo.findByDocumentVersion('doc-1', '1'))!.state).toBe('BROADCAST');
    void chain;
  });

  it('marks the anchor FAILED when the chain reports a failed tx', async () => {
    const { chain, repo, service } = makeService();
    const view = await service.anchorDocument('doc-1', '1');
    chain.setReceipt(view.txId, { txId: view.txId, blockNumber: 7, status: 'failure' });

    const summary = await service.confirmAnchors();

    expect(summary.failed).toBe(1);
    const row = await repo.findByDocumentVersion('doc-1', '1');
    expect(row!.state).toBe('FAILED');
    expect(row!.lastError).toMatch(/failure/);
  });

  it('does not fail the anchor on a transient receipt read error', async () => {
    const { chain, repo, service } = makeService();
    const view = await service.anchorDocument('doc-1', '1');
    chain.receiptError = new Error('rpc timeout');

    const first = await service.confirmAnchors();
    expect(first).toEqual({ checked: 1, confirmed: 0, failed: 0 });
    expect((await repo.findByDocumentVersion('doc-1', '1'))!.state).toBe('BROADCAST');

    chain.receiptError = undefined;
    chain.setReceipt(view.txId, { txId: view.txId, blockNumber: 99, status: 'success' });
    await service.confirmAnchors();
    expect((await repo.findByDocumentVersion('doc-1', '1'))!.state).toBe('CONFIRMED');
  });
});

describe('recovery sweep', () => {
  it('confirms a limbo anchor the chain already has, without re-broadcasting', async () => {
    const { chain, repo, service } = makeService();
    chain.broadcastError = new Error('timeout');
    const view = await service.anchorDocument('doc-1', '1');
    expect(view.state).toBe('LIMBO');

    // The tx actually reached the chain despite the timeout.
    chain.setReceipt(view.txId, { txId: view.txId, blockNumber: 55, status: 'success' });

    const summary = await service.recoverStuckAnchors();

    expect(summary).toEqual({ checked: 1, confirmed: 1, failed: 0, reBroadcast: 0, stillLimbo: 0 });
    expect(chain.broadcastAttempts).toHaveLength(1); // queried the chain first; no re-broadcast
    const row = await repo.findByDocumentVersion('doc-1', '1');
    expect(row!.state).toBe('CONFIRMED');
    expect(row!.blockNumber).toBe(55);
  });

  it('re-broadcasts a limbo anchor the chain never saw, with the same tx identity', async () => {
    const { chain, repo, service } = makeService();
    chain.broadcastError = new Error('timeout');
    const view = await service.anchorDocument('doc-1', '1');
    chain.broadcastError = undefined; // the node is healthy again

    const summary = await service.recoverStuckAnchors();

    expect(summary.reBroadcast).toBe(1);
    expect(chain.broadcastAttempts).toHaveLength(2);
    expect(chain.broadcastAttempts[1]).toBe(chain.broadcastAttempts[0]); // same signed tx
    expect((await repo.findByDocumentVersion('doc-1', '1'))!.state).toBe('BROADCAST');

    chain.setReceipt(view.txId, { txId: view.txId, blockNumber: 12, status: 'success' });
    await service.confirmAnchors();
    expect((await repo.findByDocumentVersion('doc-1', '1'))!.state).toBe('CONFIRMED');
  });

  it('confirms a PENDING_BROADCAST row left behind by a crash, from the chain receipt', async () => {
    const { chain, repo, service } = makeService();
    const hash = computeAnchorHash('doc-1', '1', CONTENT);
    const prepared = await chain.prepare({ data: hash });

    // The process died after persisting the intent and after the chain
    // accepted the tx: the row is still PENDING_BROADCAST.
    const row = await repo.create({ documentId: 'doc-1', version: '1', anchorHash: hash, txId: prepared.txId });
    expect(row.state).toBe('PENDING_BROADCAST');
    chain.setReceipt(prepared.txId, { txId: prepared.txId, blockNumber: 8, status: 'success' });

    const summary = await service.recoverStuckAnchors();

    expect(summary.confirmed).toBe(1);
    expect(summary.reBroadcast).toBe(0);
    const after = await repo.findByDocumentVersion('doc-1', '1');
    expect(after!.state).toBe('CONFIRMED');
    expect(after!.blockNumber).toBe(8);
  });

  it('leaves terminal rows untouched', async () => {
    const { chain, repo, service } = makeService();
    const view = await service.anchorDocument('doc-1', '1');
    chain.setReceipt(view.txId, { txId: view.txId, blockNumber: 3, status: 'success' });
    await service.recoverStuckAnchors();
    expect((await repo.findByDocumentVersion('doc-1', '1'))!.state).toBe('CONFIRMED');

    const second = await service.recoverStuckAnchors();
    expect(second.checked).toBe(0);
    const third = await service.confirmAnchors();
    expect(third.checked).toBe(0);
  });
});

describe('verify', () => {
  it('returns the anchoring proof (txId + block) for matching, confirmed content', async () => {
    const { chain, service } = makeService();
    const view = await service.anchorDocument('doc-1', '1');
    chain.setReceipt(view.txId, { txId: view.txId, blockNumber: 4321, status: 'success' });
    await service.confirmAnchors();

    const proof = await service.verify('doc-1', '1', CONTENT);

    expect(proof).toEqual({
      status: 'anchored',
      documentId: 'doc-1',
      version: '1',
      anchorHash: computeAnchorHash('doc-1', '1', CONTENT),
      txId: view.txId,
      blockNumber: 4321,
      confirmedAt: expect.any(Date),
    });
  });

  it('returns a mismatch report with both hashes for tampered content', async () => {
    const { service } = makeService();
    await service.anchorDocument('doc-1', '1');
    const tampered = { ...CONTENT, findings: [{ code: 'Q00.9' }, { code: 'Z99' }] };

    const result = await service.verify('doc-1', '1', tampered);

    expect(result.status).toBe('mismatch');
    if (result.status !== 'mismatch') throw new Error('unreachable');
    expect(result.expectedHash).toBe(computeAnchorHash('doc-1', '1', CONTENT));
    expect(result.computedHash).toBe(computeAnchorHash('doc-1', '1', tampered));
    expect(result.computedHash).not.toBe(result.expectedHash);
  });

  it('reports an unconfirmed anchor with its txId and no block', async () => {
    const { service } = makeService();
    const view = await service.anchorDocument('doc-1', '1');

    const result = await service.verify('doc-1', '1', CONTENT);

    expect(result).toMatchObject({
      status: 'unconfirmed',
      txId: view.txId,
      blockNumber: null,
      state: 'BROADCAST',
    });
  });

  it('throws anchor_not_found when the (document, version) was never anchored', async () => {
    const { service } = makeService();

    await expect(service.verify('ghost', '1', CONTENT)).rejects.toBeInstanceOf(AnchorNotFoundError);
    await expect(service.verify('ghost', '1', CONTENT)).rejects.toMatchObject({
      code: 'anchor_not_found',
      status: 404,
    });
  });
});

describe('canonicalization', () => {
  it('is independent of object key order but sensitive to array order', () => {
    expect(canonicalize({ a: 1, b: { d: 2, c: 3 } })).toBe(canonicalize({ b: { c: 3, d: 2 }, a: 1 }));
    expect(canonicalize({ items: [1, 2, 3] })).not.toBe(canonicalize({ items: [3, 2, 1] }));
  });

  it('encodes -0 as 0 and produces compact, sorted JSON', () => {
    expect(canonicalize({ n: -0 })).toBe(canonicalize({ n: 0 }));
    expect(canonicalize({ ok: true, none: null })).toBe('{"none":null,"ok":true}');
  });

  it('rejects values that are not structured JSON', () => {
    expect(() => canonicalize({ bad: Number.NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ bad: Number.POSITIVE_INFINITY })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ fn: () => 0 })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ when: new Date('2025-06-01T00:00:00Z') })).toThrow(CanonicalizationError);
  });

  it('binds document identity and version into the anchor hash', () => {
    const h1 = computeAnchorHash('doc-1', '1', CONTENT);
    expect(computeAnchorHash('doc-1', '1', CONTENT)).toBe(h1); // deterministic
    expect(computeAnchorHash('doc-1', '2', CONTENT)).not.toBe(h1); // version-bound
    expect(computeAnchorHash('doc-2', '1', CONTENT)).not.toBe(h1); // document-bound
    // Same hash regardless of the key order the content arrives in.
    expect(
      computeAnchorHash('doc-1', '1', {
        issuedBy: 'dr-01',
        patient: 'anon-001',
        documentType: 'clinical-report',
        findings: [{ code: 'Q00.9' }, { code: 'Z10' }],
      }),
    ).toBe(h1);
  });
});

describe('controller input validation', () => {
  const { service } = makeService();
  const controller = new AnchorController(service);

  it('rejects a non-object body', async () => {
    await expect(Promise.resolve().then(() => controller.anchorDocument('garbage'))).rejects.toMatchObject({
      code: 'bad_request',
      status: 400,
    });
  });

  it('reports which field failed', async () => {
    await expect(
      Promise.resolve().then(() => controller.anchorDocument({ documentId: 42, version: '1' })),
    ).rejects.toMatchObject({ code: 'bad_request', details: { field: 'documentId' } });
    await expect(
      Promise.resolve().then(() => controller.verify({ documentId: 'doc-1', version: '', content: {} })),
    ).rejects.toMatchObject({ code: 'bad_request', details: { field: 'version' } });
  });

  it('rejects non-object content on verifications', async () => {
    await expect(
      Promise.resolve().then(() => controller.verify({ documentId: 'doc-1', version: '1', content: [1, 2] })),
    ).rejects.toMatchObject({ code: 'bad_request', details: { field: 'content' } });
  });

  it('forwards a valid anchor request to the service', async () => {
    const view = await controller.anchorDocument({ documentId: 'doc-1', version: '1' });
    expect(view.documentId).toBe('doc-1');
    expect(view.state).toBe('BROADCAST');
  });
});

describe('exception filter (single error envelope)', () => {
  function jsonResponseHarness() {
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
    return { res, host };
  }

  it('maps domain errors to { error: { code, message, details } }', () => {
    const { res, host } = jsonResponseHarness();
    new ExceptionFilter().catch(new AnchorNotFoundError('doc-1', '3'), host);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'anchor_not_found',
        message: expect.any(String),
        details: { documentId: 'doc-1', version: '3' },
      },
    });
  });

  it('maps unexpected errors to a 500 internal_error with object details', () => {
    const { res, host } = jsonResponseHarness();
    new ExceptionFilter().catch(new TypeError('kaboom'), host);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: 'internal_error',
        message: 'unexpected error: kaboom',
        details: { exception: 'TypeError' },
      },
    });
  });

  it('keeps details an object for framework errors', () => {
    const { res, host } = jsonResponseHarness();
    new ExceptionFilter().catch(new HttpException('not here', HttpStatus.NOT_FOUND), host);
    expect(res.body).toEqual({ error: { code: 'not_found', message: 'not here', details: {} } });
  });
});
