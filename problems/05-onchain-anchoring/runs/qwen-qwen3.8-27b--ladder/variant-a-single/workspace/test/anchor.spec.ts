import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnchorRecord } from '../src/anchors/anchors.repository.js';
import {
  BroadcastRejectedError,
  InvalidContentError,
} from '../src/common/domain-error.js';
import { DocumentVersionNotFoundError } from '../src/content/document-content-provider.js';
import { createHarness, disposeHarness, SAMPLE_CONTENT, type Harness } from './harness.js';

describe('anchorDocument', () => {
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

  it('persists the intent with the tx identity BEFORE the broadcast, then broadcasts exactly once', async () => {
    let rowAtBroadcastTime: AnchorRecord | null = null;
    h.chain.onBroadcast = async (txId) => {
      // The fake chain has just accepted the transaction: at this instant,
      // what does our database already say?
      rowAtBroadcastTime = await h.repo.findByDocumentVersion(documentId, 1);
      expect(txId).toMatch(/^0x[0-9a-f]{64}$/);
    };

    const record = await h.service.anchorDocument(documentId, 1);

    // Write-ahead: the intent was committed before the chain saw the transaction.
    expect(rowAtBroadcastTime).not.toBeNull();
    expect(rowAtBroadcastTime!.status).toBe('PREPARED');
    expect(rowAtBroadcastTime!.txId).toBe(record.txId);
    expect(rowAtBroadcastTime!.signedTx).toBe(record.signedTx);

    // After the node accepts, the state is BROADCAST_SENT — not CONFIRMED;
    // confirmation comes only from a receipt.
    expect(record.status).toBe('BROADCAST_SENT');
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1);
  });

  it('rejects a second anchor for the same (document, version) — the database constraint, not app logic', async () => {
    const first = await h.service.anchorDocument(documentId, 1);

    await expect(h.service.anchorDocument(documentId, 1)).rejects.toMatchObject({
      code: 'already_anchored',
      httpStatus: 409,
      details: { existingTxId: first.txId, existingStatus: 'BROADCAST_SENT' },
    });

    expect(await h.repo.countByDocumentVersion(documentId, 1)).toBe(1);
  });

  it('lands in OUTCOME_UNKNOWN when the broadcast times out — distinct from sent and from failed', async () => {
    h.chain.scriptBroadcast('timeout');

    const record = await h.service.anchorDocument(documentId, 1);

    expect(record.status).toBe('OUTCOME_UNKNOWN');
    expect(record.txId).toMatch(/^0x[0-9a-f]{64}$/);
    // The chain did accept the transaction; the timeout is only on the response.
    expect(h.chain.broadcastCountFor(record.txId)).toBe(1);
  });

  it('marks the anchor FAILED and surfaces broadcast_rejected when the node definitively rejects', async () => {
    h.chain.scriptBroadcast('reject', 'invalid signature');

    await expect(h.service.anchorDocument(documentId, 1)).rejects.toBeInstanceOf(
      BroadcastRejectedError,
    );
    await expect(h.service.anchorDocument(documentId, 1)).rejects.toMatchObject({
      code: 'broadcast_rejected',
      httpStatus: 502,
    });

    const row = await h.repo.findByDocumentVersion(documentId, 1);
    expect(row!.status).toBe('FAILED');
    expect(row!.failureReason).toBe('invalid signature');
  });

  it('returns resource_not_found when the version has no published content, without creating an anchor', async () => {
    await expect(h.service.anchorDocument(documentId, 42)).rejects.toThrow(
      DocumentVersionNotFoundError,
    );
    expect(await h.repo.countByDocumentVersion(documentId, 42)).toBe(0);
  });

  it('refuses non-canonicalizable content before touching the chain or the database', async () => {
    h.content.publish(documentId, 1, { score: Number.NaN });

    await expect(h.service.anchorDocument(documentId, 1)).rejects.toThrow(InvalidContentError);

    expect(h.chain.broadcastLog).toHaveLength(0);
    expect(await h.repo.countByDocumentVersion(documentId, 1)).toBe(0);
  });
});
