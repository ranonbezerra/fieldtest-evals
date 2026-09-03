import { ChainClient, BroadcastTimeoutError } from './chain-client.interface';
import { AnchoringRepository, AnchorRow } from './anchoring.repository';
import * as crypto from 'node:crypto';

export class AnchoringError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AnchoringError';
  }
}

export interface AnchorResult {
  anchorId: string;
  txId: string;
  status: 'pending' | 'broadcast';
}

export interface VerifyResult {
  match: boolean;
  contentHash: string;
  anchoredHash: string | null;
  txId: string | null;
  blockNumber: bigint | null;
  blockHash: string | null;
}

function canonicalizeObject(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeObject);
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = canonicalizeObject(record[key]);
  }
  return sorted;
}

export function canonicalize(content: Record<string, unknown>): string {
  const normalized = canonicalizeObject(content);
  const json = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(json, 'utf8').digest('hex');
}

export class AnchoringService {
  constructor(
    private readonly repo: AnchoringRepository,
    private readonly chain: ChainClient,
  ) {}

  async anchorDocument(
    documentId: string,
    version: number,
    content: Record<string, unknown>,
  ): Promise<AnchorResult> {
    const contentHash = canonicalize(content);

    // Prepare the transaction (no DB access)
    const prepared = await this.chain.prepare(contentHash);

    // Persist the anchor intent BEFORE broadcasting
    const row = await this.repo.create({
      documentId,
      version,
      contentHash,
      txId: prepared.txId,
      signedTx: prepared.signedTx,
    });

    // Broadcast
    try {
      await this.chain.broadcast(prepared.signedTx);
      await this.repo.markBroadcast(row.id);
      return { anchorId: row.id, txId: prepared.txId, status: 'broadcast' };
    } catch (err) {
      if (err instanceof BroadcastTimeoutError) {
        // Leave as pending; recovery sweep will handle it
        return { anchorId: row.id, txId: prepared.txId, status: 'pending' };
      }
      await this.repo.markFailed(row.id, err instanceof Error ? err.message : String(err));
      throw new AnchoringError('broadcast_failed', 'Broadcast to chain failed');
    }
  }

  async verify(
    documentId: string,
    version: number,
    content: Record<string, unknown>,
  ): Promise<VerifyResult> {
    const anchor = await this.repo.findByDocumentAndVersion(documentId, version);
    if (!anchor) {
      throw new AnchoringError(
        'resource_not_found',
        `No anchor found for document ${documentId} version ${version}`,
      );
    }

    const submittedHash = canonicalize(content);
    return {
      match: submittedHash === anchor.contentHash,
      contentHash: submittedHash,
      anchoredHash: anchor.contentHash,
      txId: anchor.txId,
      blockNumber: anchor.blockNumber,
      blockHash: anchor.blockHash,
    };
  }

  async resolvePending(anchor: AnchorRow): Promise<void> {
    // Query the chain first to check if the tx was already broadcast
    const receipt = await this.chain.getReceipt(anchor.txId);

    if (receipt !== null) {
      if (receipt.status === 'success') {
        await this.repo.markConfirmed(anchor.id, receipt.blockNumber, receipt.blockHash);
      } else {
        await this.repo.markFailed(anchor.id, 'on-chain failure');
      }
      return;
    }

    // No receipt — tx may never have been broadcast. Re-broadcast.
    try {
      await this.chain.broadcast(anchor.signedTx);
      await this.repo.markBroadcast(anchor.id);
    } catch (err) {
      if (err instanceof BroadcastTimeoutError) {
        // Leave as pending; will be retried next tick
        return;
      }
      await this.repo.markFailed(anchor.id, err instanceof Error ? err.message : String(err));
    }
  }

  async confirmBroadcast(anchor: AnchorRow): Promise<void> {
    const receipt = await this.chain.getReceipt(anchor.txId);
    if (receipt === null) {
      // Will be retried next tick
      return;
    }

    if (receipt.status === 'success') {
      await this.repo.markConfirmed(anchor.id, receipt.blockNumber, receipt.blockHash);
    } else {
      await this.repo.markFailed(anchor.id, 'on-chain failure');
    }
  }
}
