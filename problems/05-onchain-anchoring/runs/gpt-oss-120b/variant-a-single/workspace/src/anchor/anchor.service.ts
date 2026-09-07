import { Injectable, ConflictException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository';
import { ChainClient } from './chain-client.interface';
import { Anchor } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class AnchorService {
  constructor(
    private readonly repo: AnchorRepository,
    private readonly chain: ChainClient,
  ) {}

  /** Canonical JSON hash: stable ordering of object keys */
  private computeCanonicalHash(content: any): string {
    const stableStringify = (obj: any): string => {
      if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
      }
      if (Array.isArray(obj)) {
        return '[' + obj.map(stableStringify).join(',') + ']';
      }
      const keys = Object.keys(obj).sort();
      return '{' + keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',') + '}';
    };
    const canonical = stableStringify(content);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Anchor a document version.
   * Steps:
   * 1. Compute canonical hash.
   * 2. Prepare tx (gets txId, signedTx).
   * 3. Persist intent with txId BEFORE broadcasting.
   * 4. Broadcast.
   */
  async anchorDocument(documentId: string, version: number, content: any): Promise<Anchor> {
    const hash = this.computeCanonicalHash(content);

    // Ensure uniqueness at DB level – try to create, catch unique violation.
    const prepared = await this.chain.prepare({ hash });

    try {
      const anchor = await this.repo.create({
        documentId,
        version,
        txId: prepared.txId,
        contentHash: hash,
      });
      // Broadcast after persisting.
      await this.chain.broadcast(prepared.signedTx);
      await this.repo.updateStatus(anchor.id, 'broadcasted');
      return anchor;
    } catch (err: any) {
      // Prisma throws a known code for unique constraint violation.
      if (err.code === 'P2002') {
        throw new ConflictException({
          error: {
            code: 'conflict',
            message: `Anchor already exists for document ${documentId} version ${version}`,
            details: {},
          },
        });
      }
      throw new InternalServerErrorException({
        error: {
          code: 'internal_error',
          message: err.message,
          details: {},
        },
      });
    }
  }

  /**
   * Worker routine: poll pending anchors and update status if receipt is available.
   */
  async processPendingAnchors(): Promise<void> {
    const pending = await this.repo.findPending();
    for (const anchor of pending) {
      const receipt = await this.chain.getReceipt(anchor.txId);
      if (receipt) {
        await this.repo.updateStatus(anchor.id, 'confirmed', receipt.blockNumber);
      }
    }
  }

  /**
   * Verify content against stored anchor.
   * Returns proof if match, otherwise throws mismatch error.
   */
  async verify(documentId: string, version: number, content: any): Promise<{ txId: string; blockNumber: number | null }> {
    const anchor = await this.repo.findByDocumentAndVersion(documentId, version);
    if (!anchor) {
      throw new NotFoundException({
        error: {
          code: 'resource_not_found',
          message: `No anchor found for document ${documentId} version ${version}`,
          details: {},
        },
      });
    }

    const hash = this.computeCanonicalHash(content);
    if (hash !== anchor.contentHash) {
      throw new ConflictException({
        error: {
          code: 'mismatch',
          message: 'Provided content does not match anchored hash',
          details: {},
        },
      });
    }

    return { txId: anchor.txId, blockNumber: anchor.blockNumber ?? null };
  }
}
