import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AnchorsRepository, AnchorRecord, DuplicateAnchorError } from './anchors.repository.js';
import { AnchorStatusValue } from './anchor-status.js';
import { ChainClient } from '../chain/chain-client.js';

export interface AnchorResult {
  anchorId: number;
  txId: string;
  status: AnchorStatusValue;
  blockNumber: number | null;
}

export interface VerifyResult {
  anchored: boolean;
  match: boolean;
  contentHash: string;
  expectedHash: string | null;
  txId: string | null;
  blockNumber: number | null;
  status: AnchorStatusValue | null;
}

@Injectable()
export class AnchorsService {
  private readonly logger = new Logger(AnchorsService.name);

  constructor(
    private readonly anchors: AnchorsRepository,
    private readonly chain: ChainClient,
  ) {}

  /**
   * Canonical JSON: recursively sort object keys (arrays keep order),
   * no insignificant whitespace. The structured JSON is the source of truth;
   * the PDF is merely a rendering.
   */
  canonicalize(content: unknown): string {
    const canonical = JSON.stringify(content, (_key, value) => {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const source = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(source).sort()) {
          sorted[k] = source[k];
        }
        return sorted;
      }
      return value;
    });
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  async anchorDocument(
    documentId: string,
    version: number,
    content: unknown,
  ): Promise<AnchorResult> {
    const contentHash = this.canonicalize(content);

    // Prepare transaction locally (deterministic, no network call)
    const { txId, signedTx } = await this.chain.prepare(contentHash);

    // Persist anchor intent with tx identity BEFORE broadcasting.
    // This guarantees that even if the process crashes after broadcast,
    // the txId is recoverable for the recovery sweep.
    let record: AnchorRecord;
    try {
      record = await this.anchors.createIntent(documentId, version, contentHash, txId, signedTx);
    } catch (error: unknown) {
      if (error instanceof DuplicateAnchorError) {
        throw error;
      }
      throw error;
    }

    // Broadcast to the chain
    try {
      await this.chain.broadcast(signedTx);
      await this.anchors.markBroadcastSent(record.id);
      return { anchorId: record.id, txId, status: 'BROADCAST_SENT', blockNumber: null };
    } catch (error: unknown) {
      if (this.isDefinitiveBroadcastFailure(error)) {
        await this.anchors.markFailed(record.id);
        return { anchorId: record.id, txId, status: 'FAILED', blockNumber: null };
      }
      // Timeout or network error: we cannot determine whether the tx landed.
      await this.anchors.markOutcomeUnknown(record.id);
      return { anchorId: record.id, txId, status: 'OUTCOME_UNKNOWN', blockNumber: null };
    }
  }

  async verify(
    documentId: string,
    version: number,
    content: unknown,
  ): Promise<VerifyResult> {
    const anchor = await this.anchors.findByDocumentAndVersion(documentId, version);

    if (!anchor) {
      return {
        anchored: false,
        match: false,
        contentHash: this.canonicalize(content),
        expectedHash: null,
        txId: null,
        blockNumber: null,
        status: null,
      };
    }

    const contentHash = this.canonicalize(content);
    const match = contentHash === anchor.contentHash;

    return {
      anchored: true,
      match,
      contentHash,
      expectedHash: anchor.contentHash,
      txId: anchor.txId,
      blockNumber: anchor.blockNumber,
      status: anchor.status,
    };
  }

  private isDefinitiveBroadcastFailure(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('rejected') ||
        msg.includes('invalid') ||
        msg.includes('insufficient')
      );
    }
    return false;
  }
}
