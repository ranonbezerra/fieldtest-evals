import { Inject, Injectable } from '@nestjs/common';
import { ANCHORING_CONFIG, type AnchoringConfig } from './anchoring.config.js';
import { CHAIN_CLIENT, type ChainClient } from './chain-client.js';
import { AnchoringRepository, type StoredAnchor, type StoredVersion } from './anchoring.repository.js';
import { attemptBroadcast } from './broadcast.js';
import { diffJson, type ContentDifference } from './content-diff.js';
import { canonicalHash } from './canonicalize.js';
import { anchorNotFoundError, documentVersionNotFoundError, invalidAnchorContentError } from '../common/domain-exception.js';

export interface AnchorProof {
  txId: string;
  blockNumber: number;
  blockHash: string;
}

export interface VerificationReport {
  documentId: string;
  version: number;
  storedContentHash: string;
  suppliedContentHash: string;
  match: boolean;
  /** The anchor's lifecycle state: prepared | broadcast_sent | broadcast_unknown | confirmed | failed. */
  anchorState: StoredAnchor['status'];
  /** Present only when the supplied content matches AND the anchor is confirmed. */
  proof: AnchorProof | null;
  /** Populated only when the content does not match. */
  differences: ContentDifference[];
}

@Injectable()
export class AnchoringService {
  constructor(
    private readonly repo: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig,
  ) {}

  /** Issue a new report version. The structured JSON is the source of truth. */
  async createVersion(documentId: string, version: number, content: Record<string, unknown>): Promise<StoredVersion> {
    this.canonicalHashOrThrow(content);
    return this.repo.createVersion(documentId, version, content);
  }

  /**
   * Anchor a published report version on the L2.
   *
   * The order is the incident fix:
   *   1. canonical hash of the structured content
   *   2. prepare() — the tx identity exists now, before any broadcast
   *   3. persist the anchor intent (including the tx identity) and commit
   *   4. only then broadcast
   * If the process dies at any point after step 3, recovery has the txId and
   * can ask the chain what happened.
   *
   * broadcast() returning does NOT confirm the anchor: confirmation comes
   * from a receipt, via the confirmation worker and the recovery sweep.
   */
  async anchorDocument(documentId: string, version: number): Promise<StoredAnchor> {
    const versionRow = await this.repo.findVersion(documentId, version);
    if (!versionRow) throw documentVersionNotFoundError(documentId, version);

    const contentHash = this.canonicalHashOrThrow(versionRow.content);

    const prepared = this.chain.prepare({ documentId, version, contentHash });

    // Write-ahead: this commit happens before broadcast, with the tx identity.
    const anchor = await this.repo.createAnchor({
      documentId,
      version,
      contentHash,
      txId: prepared.txId,
      signedTx: prepared.signedTx,
    });

    const outcome = await attemptBroadcast(this.chain, anchor.signedTx, this.config.broadcastTimeoutMs);
    await this.repo.transition(anchor.id, ['prepared'], outcome === 'sent' ? 'broadcast_sent' : 'broadcast_unknown', {
      incrementBroadcastAttempts: true,
    });

    return (await this.repo.findById(anchor.id)) ?? anchor;
  }

  /**
   * Recompute the hash from the supplied content and return either the
   * anchoring proof (txId, block) or a mismatch report that says what differs.
   */
  async verify(documentId: string, version: number, suppliedContent: unknown): Promise<VerificationReport> {
    const versionRow = await this.repo.findVersion(documentId, version);
    if (!versionRow) throw documentVersionNotFoundError(documentId, version);

    const suppliedHash = this.canonicalHashOrThrow(suppliedContent);

    const anchor = await this.repo.findAnchor(documentId, version);
    if (!anchor) throw anchorNotFoundError(documentId, version);

    const match = suppliedHash === anchor.contentHash;

    let proof: AnchorProof | null = null;
    if (match && anchor.status === 'confirmed' && anchor.blockNumber !== null && anchor.receipt !== null) {
      proof = { txId: anchor.txId, blockNumber: anchor.blockNumber, blockHash: anchor.receipt.blockHash };
    }

    return {
      documentId,
      version,
      storedContentHash: anchor.contentHash,
      suppliedContentHash: suppliedHash,
      match,
      anchorState: anchor.status,
      proof,
      differences: match ? [] : diffJson(versionRow.content, suppliedContent),
    };
  }

  private canonicalHashOrThrow(content: unknown): string {
    try {
      return canonicalHash(content);
    } catch (error) {
      throw invalidAnchorContentError(error instanceof Error ? error.message : String(error));
    }
  }
}
