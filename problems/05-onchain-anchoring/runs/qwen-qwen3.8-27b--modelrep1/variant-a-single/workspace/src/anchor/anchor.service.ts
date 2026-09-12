import { Inject, Injectable } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import type { AnchorRecord } from './anchor.repository.js';
import { CHAIN_CLIENT } from './chain-client.interface.js';
import type { ChainClient, PreparedTx } from './chain-client.interface.js';
import { hashContent } from './anchor-canonicalizer.js';
import { AnchorConflictError, ChainError, UniqueViolationError } from '../errors.js';

export interface AnchorView {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  state: 'pending' | 'confirmed';
  blockNumber: number | null;
  createdAt: string;
  broadcastAt: string | null;
  confirmedAt: string | null;
}

export type VerificationStatus = 'verified' | 'pending' | 'mismatch' | 'not_anchored';

export interface VerificationProof {
  txId: string;
  blockNumber: number;
  confirmedAt: string | null;
}

export interface VerificationReport {
  documentId: string;
  version: number;
  status: VerificationStatus;
  storedHash: string | null;
  computedHash: string;
  txId: string | null;
  proof: VerificationProof | null;
}

export interface AnchorResult {
  view: AnchorView;
  created: boolean;
}

@Injectable()
export class AnchorService {
  constructor(
    @Inject(AnchorRepository) private readonly anchors: AnchorRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
  ) {}

  /**
   * Anchors a (document, version) on the L2.
   *
   * The ordering is the core of the crash safety: the tx is prepared locally,
   * the anchor intent (with the tx identity and the signed payload) is
   * persisted, and only then is it broadcast. If the process dies at any point
   * after that persist, the row alone is enough to recover: the recovery sweep
   * queries the chain by txId and re-broadcasts the stored signed payload only
   * if the chain does not already have the tx. The schema-level unique
   * constraint keeps anchors per (document, version) at exactly one.
   */
  async anchor(documentId: string, version: number, content: Record<string, unknown>): Promise<AnchorResult> {
    const contentHash = hashContent(content);

    const existing = await this.anchors.findByDocumentAndVersion(documentId, version);
    if (existing !== null) {
      if (existing.contentHash === contentHash) {
        return { view: toView(existing), created: false };
      }
      throw this.conflictError(documentId, version, existing.contentHash, contentHash);
    }

    let prepared: PreparedTx;
    try {
      prepared = await this.chain.prepare({ documentId, version, contentHash });
    } catch (err) {
      throw new ChainError({ documentId, version }, err instanceof Error ? err.message : 'Chain prepare failed');
    }

    let anchor: AnchorRecord;
    try {
      // PERSIST BEFORE BROADCAST: the intent with the tx identity becomes
      // durable before anything is sent.
      anchor = await this.anchors.create({
        documentId,
        version,
        contentHash,
        txId: prepared.txId,
        signedTx: prepared.signedTx,
      });
    } catch (err) {
      if (err instanceof UniqueViolationError) {
        // Lost an insert race for the same (document, version).
        const winner = await this.anchors.findByDocumentAndVersion(documentId, version);
        if (winner !== null && winner.contentHash === contentHash) {
          return { view: toView(winner), created: false };
        }
        throw this.conflictError(documentId, version, winner?.contentHash ?? null, contentHash);
      }
      throw err;
    }

    let viewAnchor: AnchorRecord = anchor;
    try {
      await this.chain.broadcast(prepared.signedTx);
      viewAnchor = await this.anchors.markBroadcast(anchor.id);
    } catch (err) {
      // Broadcast timed out with an unknown outcome. The row stays 'pending';
      // the recovery sweep resolves it (chain-first).
      console.warn(
        `[anchor] broadcast failed for ${documentId}#${version} (txId ${prepared.txId}); leaving pending for recovery`,
        err,
      );
    }

    return { view: toView(viewAnchor), created: true };
  }

  /**
   * Recomputes the canonical hash of the supplied content and reports against
   * the stored anchor: the anchoring proof (txId, block) when confirmed, a
   * mismatch report when the content no longer matches.
   */
  async verify(documentId: string, version: number, content: Record<string, unknown>): Promise<VerificationReport> {
    const computedHash = hashContent(content);
    const anchor = await this.anchors.findByDocumentAndVersion(documentId, version);
    const base = {
      documentId,
      version,
      computedHash,
      storedHash: anchor?.contentHash ?? null,
      txId: anchor?.txId ?? null,
    };

    if (anchor === null) {
      return { ...base, status: 'not_anchored', proof: null };
    }
    if (anchor.contentHash !== computedHash) {
      return { ...base, status: 'mismatch', proof: null };
    }
    if (anchor.state === 'confirmed' && anchor.blockNumber !== null) {
      return {
        ...base,
        status: 'verified',
        proof: {
          txId: anchor.txId,
          blockNumber: anchor.blockNumber,
          confirmedAt: anchor.confirmedAt?.toISOString() ?? null,
        },
      };
    }
    // ASSUMPTION: a matching anchor that is not yet confirmed is reported as
    // 'pending' — at that point neither a proof nor a mismatch is true.
    return { ...base, status: 'pending', proof: null };
  }

  private conflictError(
    documentId: string,
    version: number,
    existingHash: string | null,
    requestedHash: string,
  ): AnchorConflictError {
    return new AnchorConflictError(
      { documentId, version, existingHash, requestedHash },
      `An anchor for document "${documentId}" version ${version} already exists with different content`,
    );
  }
}

function toView(anchor: AnchorRecord): AnchorView {
  return {
    id: anchor.id,
    documentId: anchor.documentId,
    version: anchor.version,
    contentHash: anchor.contentHash,
    txId: anchor.txId,
    state: anchor.state,
    blockNumber: anchor.blockNumber,
    createdAt: anchor.createdAt.toISOString(),
    broadcastAt: anchor.broadcastAt?.toISOString() ?? null,
    confirmedAt: anchor.confirmedAt?.toISOString() ?? null,
  };
}
