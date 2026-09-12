import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DocumentAnchor } from '@prisma/client';
import { AnchorRepository, type AnchorState } from './anchor.repository.js';
import { CHAIN_CLIENT, type ChainClient, type TxReceipt } from './chain-client.js';
import { DOCUMENT_CONTENT_SOURCE, type DocumentContentSource } from './document-content-source.js';
import { computeAnchorHash } from './canonicalization.js';
import { AnchorAlreadyExistsError, AnchorConflictError, AnchorNotFoundError } from './anchor.errors.js';

const DEFAULT_PASS_LIMIT = 100;

export interface AnchorView {
  id: string;
  documentId: string;
  version: string;
  state: AnchorState;
  anchorHash: string;
  txId: string;
  blockNumber: number | null;
  confirmedAt: Date | null;
  lastError: string | null;
  broadcastAttempts: number;
}

export interface ConfirmationSummary {
  checked: number;
  confirmed: number;
  failed: number;
}

export interface RecoverySummary extends ConfirmationSummary {
  reBroadcast: number;
  stillLimbo: number;
}

export type VerificationResult =
  | {
      status: 'anchored';
      documentId: string;
      version: string;
      anchorHash: string;
      txId: string;
      blockNumber: number;
      confirmedAt: Date | null;
    }
  | {
      status: 'unconfirmed';
      documentId: string;
      version: string;
      anchorHash: string;
      txId: string;
      state: AnchorState;
      blockNumber: null;
    }
  | { status: 'failed'; documentId: string; version: string; anchorHash: string; txId: string; lastError: string | null }
  | {
      status: 'mismatch';
      documentId: string;
      version: string;
      expectedHash: string;
      computedHash: string;
      txId: string;
    };

@Injectable()
export class AnchorService {
  private readonly logger = new Logger(AnchorService.name);

  constructor(
    private readonly anchors: AnchorRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(DOCUMENT_CONTENT_SOURCE) private readonly documents: DocumentContentSource,
  ) {}

  /**
   * Anchors one published (document, version) on the L2.
   *
   * The ordering is load-bearing:
   *   1. read the structured content and compute the canonical anchor hash
   *   2. prepare the tx locally (deterministic txId)
   *   3. persist the intent (hash + txId, PENDING_BROADCAST) — BEFORE broadcast
   *   4. broadcast
   *   5. advance the state to BROADCAST, or to LIMBO when the outcome is unknown
   *
   * A crash after step 3 leaves a durable row that the recovery sweep can
   * reconcile against the chain. A "broadcast first, persist later" design
   * loses the record in that window and ends up with a second anchor on
   * retry — the schema's unique constraint cannot save it because no row
   * ever existed.
   */
  async anchorDocument(documentId: string, version: string): Promise<AnchorView> {
    const content = await this.documents.get(documentId, version);
    const anchorHash = computeAnchorHash(documentId, version, content);
    const { txId, signedTx } = await this.chain.prepare({ data: anchorHash });

    let record: DocumentAnchor;
    try {
      record = await this.anchors.create({ documentId, version, anchorHash, txId });
    } catch (err) {
      if (err instanceof AnchorAlreadyExistsError) {
        const existing = await this.anchors.findByDocumentVersion(documentId, version);
        if (!existing) throw err;
        if (existing.anchorHash !== anchorHash) {
          throw new AnchorConflictError(documentId, version, anchorHash, existing.anchorHash);
        }
        // Exactly one anchor per (document, version): a repeat request is a
        // no-op that returns the existing anchor.
        return this.toView(existing);
      }
      throw err;
    }

    try {
      await this.chain.broadcast(signedTx);
      record = await this.anchors.markBroadcast(record.id);
    } catch (err) {
      // broadcast timed out or was rejected: the chain outcome is unknown.
      // The intent is already durable; the recovery sweep queries the chain
      // first and resolves it.
      this.logger.warn(`broadcast for ${documentId}@${version} ended with unknown outcome: ${describeError(err)}`);
      record = await this.anchors.markLimbo(record.id, describeError(err));
    }
    return this.toView(record);
  }

  /**
   * Confirmation worker pass: poll receipts for BROADCAST rows and advance
   * them to CONFIRMED (or FAILED when the chain reports a failed tx).
   */
  async confirmAnchors(limit: number = DEFAULT_PASS_LIMIT): Promise<ConfirmationSummary> {
    const rows = await this.anchors.findInStates(['BROADCAST'], limit);
    const summary: ConfirmationSummary = { checked: rows.length, confirmed: 0, failed: 0 };
    for (const row of rows) {
      let receipt: TxReceipt | null;
      try {
        receipt = await this.chain.getReceipt(row.txId);
      } catch (err) {
        // A transient chain read error must not fail the anchor; the next pass retries.
        this.logger.warn(`confirmation pass: could not fetch receipt for tx ${row.txId}: ${describeError(err)}`);
        continue;
      }
      if (receipt === null) continue; // not mined yet
      if (receipt.status === 'success') {
        await this.anchors.markConfirmed(row.id, receipt.blockNumber);
        summary.confirmed += 1;
      } else {
        await this.anchors.markFailed(row.id, `chain reported failure for tx ${row.txId}`);
        summary.failed += 1;
      }
    }
    return summary;
  }

  /**
   * Recovery sweep for anchors stuck in broadcast-limbo (PENDING_BROADCAST
   * or LIMBO). It queries the chain FIRST: if the tx is already on the chain
   * the sweep just advances state. Only when the chain has no record of the
   * tx is the (deterministically re-prepared, identical) signed tx broadcast
   * again, so a retry can never create a second anchor.
   */
  async recoverStuckAnchors(limit: number = DEFAULT_PASS_LIMIT): Promise<RecoverySummary> {
    const rows = await this.anchors.findInStates(['PENDING_BROADCAST', 'LIMBO'], limit);
    const summary: RecoverySummary = { checked: rows.length, confirmed: 0, failed: 0, reBroadcast: 0, stillLimbo: 0 };
    for (const row of rows) {
      let receipt: TxReceipt | null;
      try {
        receipt = await this.chain.getReceipt(row.txId);
      } catch (err) {
        this.logger.warn(`recovery sweep: could not fetch receipt for tx ${row.txId}: ${describeError(err)}`);
        continue;
      }
      if (receipt) {
        if (receipt.status === 'success') {
          await this.anchors.markConfirmed(row.id, receipt.blockNumber);
          summary.confirmed += 1;
        } else {
          await this.anchors.markFailed(row.id, `chain reported failure for tx ${row.txId}`);
          summary.failed += 1;
        }
        continue;
      }

      // The chain has no record of this tx: recover the identical tx identity.
      const prepared = await this.chain.prepare({ data: row.anchorHash });
      if (prepared.txId !== row.txId) {
        await this.anchors.markFailed(
          row.id,
          're-prepare produced a different txId; refusing to broadcast a second tx identity',
        );
        summary.failed += 1;
        continue;
      }
      try {
        await this.chain.broadcast(prepared.signedTx);
        await this.anchors.markBroadcast(row.id);
        summary.reBroadcast += 1;
      } catch (err) {
        await this.anchors.markLimbo(row.id, describeError(err));
        summary.stillLimbo += 1;
      }
    }
    return summary;
  }

  /**
   * Recomputes the anchor hash for the provided content and returns either
   * the anchoring proof (txId + block), the current (unconfirmed) state, a
   * failed-anchor report, or a mismatch report when the content no longer
   * hashes to the anchored value.
   */
  async verify(documentId: string, version: string, content: unknown): Promise<VerificationResult> {
    const record = await this.anchors.findByDocumentVersion(documentId, version);
    if (!record) throw new AnchorNotFoundError(documentId, version);

    const computedHash = computeAnchorHash(documentId, version, content);
    if (computedHash !== record.anchorHash) {
      return {
        status: 'mismatch',
        documentId,
        version,
        expectedHash: record.anchorHash,
        computedHash,
        txId: record.txId,
      };
    }

    switch (record.state) {
      case 'CONFIRMED':
        return {
          status: 'anchored',
          documentId,
          version,
          anchorHash: record.anchorHash,
          txId: record.txId,
          blockNumber: record.blockNumber ?? 0,
          confirmedAt: record.confirmedAt,
        };
      case 'FAILED':
        return {
          status: 'failed',
          documentId,
          version,
          anchorHash: record.anchorHash,
          txId: record.txId,
          lastError: record.lastError,
        };
      default:
        return {
          status: 'unconfirmed',
          documentId,
          version,
          anchorHash: record.anchorHash,
          txId: record.txId,
          state: record.state as AnchorState,
          blockNumber: null,
        };
    }
  }

  private toView(record: DocumentAnchor): AnchorView {
    return {
      id: record.id,
      documentId: record.documentId,
      version: record.version,
      state: record.state as AnchorState,
      anchorHash: record.anchorHash,
      txId: record.txId,
      blockNumber: record.blockNumber,
      confirmedAt: record.confirmedAt,
      lastError: record.lastError,
      broadcastAttempts: record.broadcastAttempts,
    };
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
