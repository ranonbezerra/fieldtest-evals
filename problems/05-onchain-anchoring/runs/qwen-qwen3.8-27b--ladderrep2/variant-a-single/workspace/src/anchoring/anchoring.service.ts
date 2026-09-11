import { Inject, Injectable } from '@nestjs/common';
import { CHAIN_CLIENT, BroadcastTimeoutError, type ChainClient } from './chain-client.js';
import { canonicalHash } from './canonical-json.js';
import { AlreadyAnchoredError, DuplicateAnchorError } from './errors.js';
import { AnchoringRepository, type AnchorRecord } from './anchoring.repository.js';
import type { AnchorProof, VerifyReport } from './types.js';

@Injectable()
export class AnchoringService {
  constructor(
    private readonly anchors: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
  ) {}

  /**
   * Anchors one published report version on-chain.
   *
   * Write-ahead protocol (the fix for issue #143):
   *   1. canonical hash of the structured content
   *   2. chain.prepare() — local and deterministic: the tx identity exists now
   *   3. persist the intent (hash + txId + signedTx) and commit  ← BEFORE broadcast
   *   4. broadcast
   *
   * A process death at any point after step 3 leaves a complete, recoverable
   * record: the recovery sweep can ask the chain for the txId and learn what
   * happened. Confirmation always comes from a receipt, never from
   * broadcast() returning.
   */
  async anchorDocument(documentId: string, version: number, content: unknown): Promise<AnchorRecord> {
    const contentHash = canonicalHash(content);

    const existing = await this.anchors.findByDocumentAndVersion(documentId, version);
    if (existing) {
      // One anchor per (document, version); the unique constraint is the
      // backstop for the race this check cannot cover.
      throw new AlreadyAnchoredError(documentId, version, existing);
    }

    const prepared = this.chain.prepare({ documentId, version, contentHash });

    let anchor: AnchorRecord;
    try {
      anchor = await this.anchors.create({
        documentId,
        version,
        contentHash,
        txId: prepared.txId,
        signedTx: prepared.signedTx,
      });
    } catch (err) {
      if (err instanceof DuplicateAnchorError) {
        const current = await this.anchors.findByDocumentAndVersion(documentId, version);
        throw new AlreadyAnchoredError(documentId, version, current);
      }
      throw err;
    }

    // The intent is durable. Only now do we talk to the chain.
    try {
      await this.chain.broadcast(prepared.signedTx);
    } catch (err) {
      if (err instanceof BroadcastTimeoutError) {
        // Broadcast attempted, outcome unknown — a state of its own, neither
        // "sent" nor "failed".
        await this.anchors.transition(anchor.id, 'PREPARED', {
          status: 'BROADCAST_UNKNOWN',
          lastError: 'broadcast timed out; outcome unknown',
        });
        return { ...anchor, status: 'BROADCAST_UNKNOWN', lastError: 'broadcast timed out; outcome unknown' };
      }
      // Anything else is unexpected and propagates (the request fails). The
      // committed intent stays in PREPARED and remains recoverable: the sweep
      // asks the chain first and re-broadcasts the same signed tx only if the
      // chain has no trace of it.
      throw err;
    }

    const now = new Date();
    const sent = await this.anchors.transition(anchor.id, 'PREPARED', { status: 'BROADCAST_SENT', broadcastAt: now });
    if (!sent) {
      // A concurrent sweep already advanced this row; report its true state.
      return (await this.anchors.findById(anchor.id)) ?? anchor;
    }
    return { ...anchor, status: 'BROADCAST_SENT', broadcastAt: now };
  }

  /**
   * Recomputes the canonical hash of the supplied content and compares it
   * with the anchored one. Returns the anchoring proof (txId + block) for
   * matching, confirmed content; a mismatch report otherwise.
   */
  async verify(documentId: string, version: number, content: unknown): Promise<VerifyReport> {
    const suppliedContentHash = canonicalHash(content);
    const anchor = await this.anchors.findByDocumentAndVersion(documentId, version);

    const base = { documentId, version, suppliedContentHash };

    if (!anchor) {
      return { ...base, result: 'no_anchor', anchor: null };
    }
    if (anchor.contentHash !== suppliedContentHash) {
      return {
        ...base,
        result: 'hash_mismatch',
        anchor: toProof(anchor),
        detail: `supplied content hashes to ${suppliedContentHash}; the anchored content hashes to ${anchor.contentHash}`,
      };
    }
    if (anchor.status !== 'CONFIRMED') {
      // The content matches, but the anchor is not confirmed on-chain yet.
      return { ...base, result: 'pending_confirmation', anchor: toProof(anchor) };
    }
    return { ...base, result: 'verified', anchor: toProof(anchor) };
  }
}

function toProof(a: AnchorRecord): AnchorProof {
  return {
    txId: a.txId,
    status: a.status,
    contentHash: a.contentHash,
    blockNumber: a.blockNumber,
    blockHash: a.blockHash,
    confirmedAt: a.confirmedAt ? a.confirmedAt.toISOString() : null,
  };
}
