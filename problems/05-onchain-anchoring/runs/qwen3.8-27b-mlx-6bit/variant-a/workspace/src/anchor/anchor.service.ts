import type { AnchorRecord, AnchorState, NewAnchor } from './anchor.repository';
import { DuplicateAnchorError } from './anchor.repository';
import type { AnchorTx, ChainClient, Receipt } from './chain';
import { hashContent } from './canonical';
import { CanonicalizationError } from './canonical';

export type AnchorState = 'pending' | 'broadcasting' | 'confirmed' | 'failed';

export interface AnchorProof {
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  blockNumber: number;
}

export interface MismatchReport {
  documentId: string;
  version: number;
  expectedHash: string;
  providedHash: string;
}

export type VerifyResult = { ok: true; proof: AnchorProof } | { ok: false; mismatch: MismatchReport };

export class ResourceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResourceNotFoundError';
  }
}

export class AnchorService {
  constructor(
    private readonly repo: import('./anchor.repository').AnchorRepository,
    private readonly chain: ChainClient,
  ) {}

  async anchorDocument(documentId: string, version: number, content: unknown): Promise<AnchorProof> {
    const contentHash = hashContent(content);
    const contentJson = JSON.stringify(content);

    let anchor: AnchorRecord;
    try {
      const newAnchor: NewAnchor = {
        documentId,
        version,
        contentHash,
        content: contentJson,
        txId: null,
        state: 'pending',
      };
      anchor = await this.repo.create(newAnchor);
    } catch (error) {
      if (error instanceof DuplicateAnchorError) {
        throw error;
      }
      throw error;
    }

    const tx: AnchorTx = { documentId, version, contentHash };
    const { txId, signedTx } = this.chain.prepare(tx);

    anchor = await this.repo.updateState(anchor.id, { txId, state: 'broadcasting' });

    try {
      await this.chain.broadcast(signedTx);
    } catch (error) {
      // Broadcast failed with unknown outcome; leave in broadcasting for recovery.
    }

    const confirmed = await this.repo.findUnique(documentId, version);
    if (confirmed && confirmed.state === 'confirmed' && confirmed.blockNumber !== null && confirmed.txId) {
      return {
        documentId,
        version,
        contentHash: confirmed.contentHash,
        txId: confirmed.txId,
        blockNumber: confirmed.blockNumber,
      };
    }

    if (anchor.txId) {
      return {
        documentId,
        version,
        contentHash: anchor.contentHash,
        txId: anchor.txId,
        blockNumber: 0,
      };
    }

    throw new ResourceNotFoundError('Anchor could not be prepared');
  }

  async verify(documentId: string, version: number, content: unknown): Promise<VerifyResult> {
    const providedHash = hashContent(content);
    const anchor = await this.repo.findUnique(documentId, version);

    if (!anchor) {
      throw new ResourceNotFoundError(`No anchor found for document ${documentId} version ${version}`);
    }

    if (anchor.contentHash === providedHash) {
      if (!anchor.txId) {
        throw new ResourceNotFoundError('Anchor has no transaction identity');
      }
      const proof: AnchorProof = {
        documentId,
        version,
        contentHash: anchor.contentHash,
        txId: anchor.txId,
        blockNumber: anchor.blockNumber ?? 0,
      };
      return { ok: true, proof };
    }

    const mismatch: MismatchReport = {
      documentId,
      version,
      expectedHash: anchor.contentHash,
      providedHash,
    };
    return { ok: false, mismatch };
  }

  async runConfirmationPass(): Promise<number> {
    const broadcasting = await this.repo.findByState('broadcasting');
    let confirmedCount = 0;

    for (const anchor of broadcasting) {
      if (!anchor.txId) continue;
      const receipt: Receipt = await this.chain.getReceipt(anchor.txId);
      if (receipt.found && receipt.blockNumber !== null) {
        await this.repo.updateState(anchor.id, { state: 'confirmed', blockNumber: receipt.blockNumber });
        confirmedCount++;
      }
    }

    return confirmedCount;
  }

  async runRecoverySweep(): Promise<number> {
    const broadcasting = await this.repo.findByState('broadcasting');
    let resolvedCount = 0;

    for (const anchor of broadcasting) {
      const tx: AnchorTx = {
        documentId: anchor.documentId,
        version: anchor.version,
        contentHash: anchor.contentHash,
      };
      const { txId, signedTx } = this.chain.prepare(tx);

      if (anchor.txId && anchor.txId !== txId) {
        continue;
      }

      const receipt: Receipt = await this.chain.getReceipt(txId);

      if (receipt.found && receipt.blockNumber !== null) {
        await this.repo.updateState(anchor.id, { txId, state: 'confirmed', blockNumber: receipt.blockNumber });
        resolvedCount++;
      } else if (receipt.found && receipt.blockNumber === null) {
        // Found but not yet mined; leave broadcasting.
      } else {
        try {
          await this.chain.broadcast(signedTx);
          resolvedCount++;
        } catch (error) {
          await this.repo.updateState(anchor.id, { state: 'failed' });
        }
      }
    }

    return resolvedCount;
  }
}
