import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalHashOf } from '../src/anchors/anchors.service.js';
import { createHarness, disposeHarness, SAMPLE_CONTENT, type Harness } from './harness.js';

describe('verify', () => {
  let h: Harness;
  let documentId: string;

  beforeEach(() => {
    h = createHarness();
    documentId = `doc-${randomUUID()}`;
    h.content.publish(documentId, 1, SAMPLE_CONTENT);
  });

  afterEach(async () => {
    await disposeHarness(h);
  });

  async function anchorAndConfirm(blockNumber = 12_345n) {
    const record = await h.service.anchorDocument(documentId, 1);
    h.chain.confirmTx(record.txId, blockNumber);
    await h.confirmation.pollOnce();
    return record;
  }

  it('returns the anchoring proof (txId, block) for matching content', async () => {
    const record = await anchorAndConfirm(4321n);

    const report = await h.service.verify(documentId, 1, SAMPLE_CONTENT);

    if (report.result !== 'verified') throw new Error(`expected verified, got ${report.result}`);
    expect(report.proof).toEqual({
      txId: record.txId,
      blockNumber: 4321n,
      blockHash: expect.stringMatching(/^0x[0-9a-f]+$/),
    });
    expect(report.expectedHash).toBe(canonicalHashOf(SAMPLE_CONTENT));
    expect(report.actualHash).toBe(report.expectedHash);
  });

  it('reports a content mismatch with both hashes when the supplied content differs', async () => {
    await anchorAndConfirm();
    const tampered = { ...SAMPLE_CONTENT, sections: [...SAMPLE_CONTENT.sections].reverse() };

    const report = await h.service.verify(documentId, 1, tampered);

    if (report.result !== 'content_mismatch') {
      throw new Error(`expected content_mismatch, got ${report.result}`);
    }
    expect(report.expectedHash).toBe(canonicalHashOf(SAMPLE_CONTENT));
    expect(report.actualHash).toBe(canonicalHashOf(tampered));
    expect(report.actualHash).not.toBe(report.expectedHash);
    expect(report.proof).toBeNull();
  });

  it('reports not_anchored when the version has no anchor', async () => {
    const report = await h.service.verify(documentId, 7, SAMPLE_CONTENT);

    if (report.result !== 'not_anchored') throw new Error(`expected not_anchored, got ${report.result}`);
    expect(report.expectedHash).toBeNull();
    expect(report.proof).toBeNull();
  });

  it('reports pending with the tx identity when the anchor is not yet confirmed', async () => {
    const record = await h.service.anchorDocument(documentId, 1);

    const report = await h.service.verify(documentId, 1, SAMPLE_CONTENT);

    if (report.result !== 'pending') throw new Error(`expected pending, got ${report.result}`);
    expect(report.txId).toBe(record.txId);
    expect(report.proof).toBeNull();
  });

  it('prefers the mismatch report over anchor state when the hash differs', async () => {
    await h.service.anchorDocument(documentId, 1); // pending, never confirmed
    const tampered = { ...SAMPLE_CONTENT, vitals: { ...SAMPLE_CONTENT.vitals, heartRate: 99 } };

    const report = await h.service.verify(documentId, 1, tampered);

    expect(report.result).toBe('content_mismatch');
  });

  it('reports anchor_failed with the reason when the anchor failed on chain', async () => {
    h.chain.scriptBroadcast('reject', 'insufficient funds');
    await expect(h.service.anchorDocument(documentId, 1)).rejects.toMatchObject({
      code: 'broadcast_rejected',
    });

    const report = await h.service.verify(documentId, 1, SAMPLE_CONTENT);

    if (report.result !== 'anchor_failed') throw new Error(`expected anchor_failed, got ${report.result}`);
    expect(report.failureReason).toBe('insufficient funds');
    expect(report.proof).toBeNull();
  });
});
