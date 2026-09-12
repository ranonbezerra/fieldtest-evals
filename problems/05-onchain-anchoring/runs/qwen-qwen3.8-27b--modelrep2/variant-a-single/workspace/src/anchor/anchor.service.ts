import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, type Anchor } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { hashContent } from './canonical';
import { CHAIN_CLIENT, type ChainClient, buildAnchorTxInput } from './chain.client';
import { REPORT_SOURCE, type ReportSource } from './report.source';
import { AnchorRepository } from './anchor.repository';

export interface AnchorDto {
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  state: 'PENDING' | 'BROADCASTING' | 'CONFIRMED';
  blockNumber: number | null;
  blockHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnchorProof {
  txId: string;
  blockNumber: number;
  blockHash: string;
}

export type VerifyStatus = 'verified' | 'mismatch' | 'pending' | 'not_anchored';

export interface VerifyResult {
  status: VerifyStatus;
  documentId: string;
  version: number;
  /** Hash stored in the anchor (what was anchored); null when never anchored. */
  expectedHash: string | null;
  /** Hash recomputed from the content supplied to this call. */
  actualHash: string;
  proof: AnchorProof | null;
}

@Injectable()
export class AnchorService {
  private readonly logger = new Logger(AnchorService.name);

  constructor(
    @Inject(AnchorRepository) private readonly anchors: AnchorRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(REPORT_SOURCE) private readonly reports: ReportSource,
  ) {}

  /**
   * Anchors one report version to the L2.
   *
   * Ordering invariant: the intent row — including the prepared tx identity —
   * is durable BEFORE broadcast is called. A process crash anywhere after
   * that point cannot lose the tx identity; the recovery sweep resolves the
   * outcome. There is deliberately no persist-after-broadcast step.
   */
  async anchorDocument(documentId: string, version: number): Promise<AnchorDto> {
    const content = await this.reports.fetch(documentId, version);
    if (content === null) {
      throw new ApiError(
        404,
        'resource_not_found',
        `no report content for document '${documentId}' version ${version}`,
        { documentId, version },
      );
    }

    const contentHash = hashContent(content);

    // Exactly one anchor per (document, version): an existing anchor, in any
    // state, is the answer; a second one is never minted.
    const existing = await this.anchors.findByDocumentVersion(documentId, version);
    if (existing) return this.toDto(existing);

    // prepare is local and deterministic: the tx identity exists before the
    // tx is sent, so it can be persisted first.
    const { txId, signedTx } = await this.chain.prepare(buildAnchorTxInput(documentId, version, contentHash));

    let anchorId: string;
    try {
      anchorId = (await this.anchors.create({ id: randomUUID(), documentId, version, contentHash, txId })).id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // A concurrent anchorDocument won the race; return the winner.
        const raced = await this.anchors.findByDocumentVersion(documentId, version);
        if (raced) return this.toDto(raced);
      }
      throw err;
    }

    // From here the tx identity is durable. Whatever happens to the process,
    // the anchor is traceable.
    try {
      await this.chain.broadcast(signedTx);
    } catch (err) {
      // Unknown outcome. The row stays PENDING; the recovery sweep asks the
      // chain first and only re-broadcasts the same signed tx if the chain
      // does not have it.
      this.logger.warn(
        `broadcast for ${documentId}@v${version} ended with unknown outcome; leaving PENDING for the recovery sweep (${
          err instanceof Error ? err.message : String(err)
        })`,
      );
      throw new ApiError(
        503,
        'broadcast_unknown',
        'the broadcast did not complete; the anchor is being tracked and will be resolved by the recovery sweep',
        { documentId, version, txId },
      );
    }

    await this.anchors.markBroadcasting(anchorId);
    const saved = await this.anchors.findById(anchorId);
    if (!saved) throw new ApiError(500, 'internal_error', 'anchor row vanished after broadcast', { id: anchorId });
    return this.toDto(saved);
  }

  /**
   * Recomputes the canonical hash of the supplied content and compares it
   * with the anchor for (document, version). Returns the anchoring proof
   * (txId, block) when confirmed, or a mismatch/pending/not-anchored report.
   */
  async verify(documentId: string, version: number, content: unknown): Promise<VerifyResult> {
    const actualHash = hashContent(content);
    const anchor = await this.anchors.findByDocumentVersion(documentId, version);

    const base = { documentId, version, actualHash };
    if (!anchor) {
      return { ...base, status: 'not_anchored', expectedHash: null, proof: null };
    }
    if (anchor.state !== 'CONFIRMED' || anchor.blockNumber === null || anchor.blockHash === null) {
      return { ...base, status: 'pending', expectedHash: anchor.contentHash, proof: null };
    }

    const proof: AnchorProof = { txId: anchor.txId, blockNumber: anchor.blockNumber, blockHash: anchor.blockHash };
    const status: VerifyStatus = anchor.contentHash === actualHash ? 'verified' : 'mismatch';
    return { ...base, status, expectedHash: anchor.contentHash, proof };
  }

  private toDto(anchor: Anchor): AnchorDto {
    return {
      documentId: anchor.documentId,
      version: anchor.version,
      contentHash: anchor.contentHash,
      txId: anchor.txId,
      state: anchor.state,
      blockNumber: anchor.blockNumber,
      blockHash: anchor.blockHash,
      createdAt: anchor.createdAt.toISOString(),
      updatedAt: anchor.updatedAt.toISOString(),
    };
  }
}
