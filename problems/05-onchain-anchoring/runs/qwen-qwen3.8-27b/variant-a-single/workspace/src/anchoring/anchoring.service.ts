import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Anchor } from '@prisma/client';
import { BroadcastTimeoutError, CHAIN_CLIENT } from '../chain/chain-client.js';
import type { ChainClient } from '../chain/chain-client.js';
import { DOCUMENT_SOURCE } from './document-source.js';
import type { DocumentSource } from './document-source.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { AnchorFailedError, AnchorNotFoundError, UniqueConstraintViolationError } from '../errors.js';

/**
 * Canonicalization of the structured content for anchoring.
 *
 * The PDF of a report is a rendering, not the source of truth; only the
 * structured JSON content is anchored. The canonical form is the unique JSON
 * text produced by:
 *  - object keys sorted in ascending UTF-16 code unit order (recursively),
 *  - arrays keeping element order,
 *  - scalars serialized by JSON.stringify (compact, no insignificant
 *    whitespace; numbers in canonical JS form, e.g. 1e2 -> 100),
 *  - null / booleans / strings passed through unchanged.
 * `undefined` values and non-finite numbers are rejected rather than
 * silently dropped. The anchored hash is `sha256:` + hex(SHA-256 over the
 * UTF-8 bytes of the canonical text).
 */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value));
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error('canonicalization: non-finite numbers are not allowed');
      }
      return value;
    case 'object':
      break;
    default:
      throw new Error(`canonicalization: unsupported value of type "${typeof value}"`);
  }
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  const object = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(object).sort()) {
    normalized[key] = canonicalizeValue(object[key]);
  }
  return normalized;
}

export function canonicalContentHash(content: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalizeJson(content), 'utf8').digest('hex')}`;
}

export interface AnchorProof {
  txId: string;
  blockNumber: string;
  logIndex: number;
}

export type AnchorStatusText =
  | 'pending_broadcast'
  | 'broadcast_sent'
  | 'broadcast_unknown'
  | 'confirmed'
  | 'failed';

export type AnchorOutcome =
  | { documentId: string; version: number; status: 'confirmed'; contentHash: string; txId: string; proof: AnchorProof }
  | {
      documentId: string;
      version: number;
      status: Exclude<AnchorStatusText, 'confirmed' | 'failed'>;
      contentHash: string;
      txId: string;
    };

export type VerifyReport =
  | {
      documentId: string;
      version: number;
      match: true;
      confirmed: boolean;
      status: AnchorStatusText;
      proof: AnchorProof | null;
    }
  | {
      documentId: string;
      version: number;
      match: false;
      reason: 'content_hash_mismatch';
      status: AnchorStatusText;
      storedContentHash: string;
      computedContentHash: string;
    };

@Injectable()
export class AnchoringService {
  constructor(
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(DOCUMENT_SOURCE) private readonly documents: DocumentSource,
    @Inject(AnchoringRepository) private readonly anchors: AnchoringRepository,
  ) {}

  /**
   * Anchors one (document, version). Exactly one anchor per pair is enforced
   * by the database unique constraint; concurrent or repeated calls resolve
   * to the single existing record.
   *
   * Flow: fetch structured content -> canonical hash -> chain.prepare ->
   * persist the anchor intent WITH its tx identity BEFORE broadcasting ->
   * broadcast. Confirmation happens later via the worker/sweep.
   */
  async anchorDocument(documentId: string, version: number): Promise<AnchorOutcome> {
    const content = await this.documents.get(documentId, version);
    const contentHash = canonicalContentHash(content);

    const existing = await this.anchors.findByDocumentVersion(documentId, version);
    if (existing) return this.outcomeFor(existing);

    const prepared = await this.chain.prepare({ kind: 'anchor', documentId, version, contentHash });

    let record: Anchor;
    try {
      record = await this.anchors.create({
        documentId,
        version,
        contentHash,
        txId: prepared.txId,
        signedTx: prepared.signedTx,
      });
    } catch (error) {
      if (error instanceof UniqueConstraintViolationError) {
        // A concurrent call won the race; return its record instead.
        const raced = await this.anchors.findByDocumentVersion(documentId, version);
        if (raced) return this.outcomeFor(raced);
      }
      throw error;
    }

    try {
      await this.chain.broadcast(record.signedTx);
      await this.anchors.markBroadcastSent(record.id, 1);
      return { documentId, version, status: 'broadcast_sent', contentHash, txId: record.txId };
    } catch (error) {
      if (error instanceof BroadcastTimeoutError) {
        // Broadcast limbo: the tx may or may not be on chain; the recovery
        // sweep will query the chain first.
        await this.anchors.markBroadcastUnknown(record.id, 1);
        return { documentId, version, status: 'broadcast_unknown', contentHash, txId: record.txId };
      }
      const reason = error instanceof Error ? error.message : String(error);
      await this.anchors.markFailed(record.id, `broadcast rejected: ${reason}`);
      throw new AnchorFailedError(documentId, version, reason);
    }
  }

  /**
   * Recomputes the hash for the supplied content and compares it to the
   * anchored one. Returns the on-chain proof (txId, block) when the anchor is
   * confirmed, or a mismatch report when the content does not match.
   */
  async verify(documentId: string, version: number, content: Record<string, unknown>): Promise<VerifyReport> {
    const computedContentHash = canonicalContentHash(content);
    const row = await this.anchors.findByDocumentVersion(documentId, version);
    if (!row) throw new AnchorNotFoundError(documentId, version);

    if (computedContentHash !== row.contentHash) {
      return {
        documentId,
        version,
        match: false,
        reason: 'content_hash_mismatch',
        status: row.status,
        storedContentHash: row.contentHash,
        computedContentHash,
      };
    }

    const confirmed = row.status === 'confirmed';
    return {
      documentId,
      version,
      match: true,
      confirmed,
      status: row.status,
      proof:
        confirmed && row.blockNumber !== null && row.logIndex !== null
          ? { txId: row.txId, blockNumber: row.blockNumber.toString(), logIndex: row.logIndex }
          : null,
    };
  }

  private outcomeFor(row: Anchor): AnchorOutcome {
    if (row.status === 'failed') {
      throw new AnchorFailedError(row.documentId, row.version, row.error ?? 'unknown failure');
    }
    if (row.status === 'confirmed') {
      return {
        documentId: row.documentId,
        version: row.version,
        status: 'confirmed',
        contentHash: row.contentHash,
        txId: row.txId,
        proof: {
          txId: row.txId,
          blockNumber: (row.blockNumber ?? 0n).toString(),
          logIndex: row.logIndex ?? 0,
        },
      };
    }
    return {
      documentId: row.documentId,
      version: row.version,
      status: row.status,
      contentHash: row.contentHash,
      txId: row.txId,
    };
  }
}
