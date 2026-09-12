import { Inject, Injectable } from '@nestjs/common';
import { AnchorStatus, DocumentAnchor } from '@prisma/client';
import { ApiError } from '../common/api-error.js';
import { canonicalHash } from '../common/canonicalize.js';
import { CHAIN_CLIENT, ChainClient, ChainRejectionError } from '../chain/chain.client.js';
import { DocumentsRepository } from '../documents/documents.repository.js';
import { AnchorsRepository } from './anchors.repository.js';

export interface AnchorView {
  documentId: string;
  version: number;
  status: AnchorStatus;
  contentHash: string;
  txId: string;
  attempt: number;
  blockNumber: number | null;
  blockHash: string | null;
  confirmedAt: string | null;
  failureReason: string | null;
}

export type VerifyReason = 'not_anchored' | 'anchor_pending' | 'anchor_failed' | 'hash_mismatch';

export interface VerifyResult {
  verified: boolean;
  reason: VerifyReason | null;
  /** Hash of the content submitted for verification. */
  contentHash: string;
  /** Hash stored when the document was anchored (null when never anchored). */
  anchoredHash: string | null;
  /** Anchoring proof: the tx identity and the block it is included in. */
  proof: { txId: string; blockNumber: number; blockHash: string } | null;
  anchorStatus: AnchorStatus | null;
}

function toView(row: DocumentAnchor): AnchorView {
  return {
    documentId: row.documentId,
    version: row.version,
    status: row.status,
    contentHash: row.contentHash,
    txId: row.txId,
    attempt: row.attempt,
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    failureReason: row.failureReason,
  };
}

function failedError(documentId: string, version: number, txId: string, failureReason: string | null): ApiError {
  return new ApiError('anchor_failed', 409, `the anchor for ${documentId} v${version} failed and is terminal`, {
    txId,
    failureReason,
  });
}

@Injectable()
export class AnchorsService {
  constructor(
    private readonly anchors: AnchorsRepository,
    private readonly documents: DocumentsRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
  ) {}

  /**
   * Anchor the stored structured content of a report version:
   * canonical hash → prepare tx → persist the intent with the tx identity →
   * broadcast. The pre-broadcast persist is what makes a crash between
   * broadcast and any later write recoverable by the recovery sweep.
   */
  async anchorDocument(documentId: string, version: number): Promise<AnchorView> {
    // ASSUMPTION: anchorDocument(documentId, version) carries no content, so the
    // structured source of truth for a version must live in the platform's own
    // store (report_versions); the PDF is a rendering, never the input.
    const reportVersion = await this.documents.findVersion(documentId, version);
    if (!reportVersion) {
      throw new ApiError('version_not_found', 404, `version ${version} of document ${documentId} does not exist`, {
        documentId,
        version,
      });
    }

    const existing = await this.anchors.findAnchor(documentId, version);
    if (existing) {
      if (existing.status === AnchorStatus.FAILED) {
        throw failedError(documentId, version, existing.txId, existing.failureReason);
      }
      return toView(existing); // CONFIRMED → idempotent; PREPARED/BROADCAST → in progress
    }

    const contentHash = canonicalHash(reportVersion.content);
    const prepared = await this.chain.prepare({ op: 'anchor-document', documentId, version, contentHash });

    // Persist the anchor intent with the tx identity BEFORE broadcasting.
    const row = await this.anchors.createAnchor({
      documentId,
      version,
      contentHash,
      txId: prepared.txId,
      signedTx: prepared.signedTx,
    });
    if (!row) {
      // Lost a race: another call anchored the same (document, version) first.
      const winner = await this.anchors.findAnchor(documentId, version);
      if (!winner) throw new ApiError('internal_error', 500, 'anchor row disappeared after a unique-constraint conflict');
      if (winner.status === AnchorStatus.FAILED) {
        throw failedError(documentId, version, winner.txId, winner.failureReason);
      }
      return toView(winner);
    }

    try {
      await this.chain.broadcast(prepared.signedTx);
    } catch (err) {
      if (err instanceof ChainRejectionError) {
        await this.anchors.markFailed(row.id, `chain rejected the transaction: ${err.message}`);
        throw new ApiError('anchor_failed', 409, 'the chain rejected the anchor transaction', {
          txId: prepared.txId,
          failureReason: err.message,
        });
      }
      // Unknown broadcast outcome (timeout, crash, ...): the intent is already
      // persisted; the recovery sweep queries the chain first and reconciles.
      await this.anchors.markBroadcast(row.id, 1);
      throw new ApiError(
        'broadcast_unknown',
        503,
        'broadcast outcome unknown; the anchor is being reconciled by the recovery sweep',
        { txId: prepared.txId, status: AnchorStatus.BROADCAST },
      );
    }

    const updated = await this.anchors.markBroadcast(row.id, 1);
    return toView(updated);
  }

  async get(documentId: string, version: number): Promise<AnchorView> {
    const row = await this.anchors.findAnchor(documentId, version);
    if (!row) {
      throw new ApiError('resource_not_found', 404, `no anchor for ${documentId} v${version}`, {
        documentId,
        version,
      });
    }
    return toView(row);
  }

  /**
   * Recompute the canonical hash of the provided content and compare it with
   * the anchored hash. Returns the anchoring proof (txId, block) or a
   * mismatch report.
   */
  async verify(documentId: string, version: number, content: unknown): Promise<VerifyResult> {
    const contentHash = canonicalHash(content);
    const anchor = await this.anchors.findAnchor(documentId, version);
    const anchorStatus: AnchorStatus | null = anchor ? anchor.status : null;

    if (!anchor) {
      return { verified: false, reason: 'not_anchored', contentHash, anchoredHash: null, proof: null, anchorStatus };
    }
    if (
      anchor.status === AnchorStatus.CONFIRMED &&
      anchor.contentHash === contentHash &&
      anchor.blockNumber !== null &&
      anchor.blockHash !== null
    ) {
      return {
        verified: true,
        reason: null,
        contentHash,
        anchoredHash: anchor.contentHash,
        proof: { txId: anchor.txId, blockNumber: anchor.blockNumber, blockHash: anchor.blockHash },
        anchorStatus,
      };
    }
    const reason: VerifyReason =
      anchor.status === AnchorStatus.FAILED
        ? 'anchor_failed'
        : anchor.status === AnchorStatus.CONFIRMED
          ? 'hash_mismatch'
          : 'anchor_pending';
    return { verified: false, reason, contentHash, anchoredHash: anchor.contentHash, proof: null, anchorStatus };
  }
}
