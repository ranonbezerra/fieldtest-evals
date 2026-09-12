import {
  Injectable,
  ConflictException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { ChainClient } from './chain-client.interface.js';
import { AnchorState } from './anchor.model.js';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AnchorService {
  constructor(
    private readonly anchorRepository: AnchorRepository,
    @Inject('CHAIN_CLIENT') private readonly chainClient: ChainClient,
  ) {}

  /**
   * Canonicalizes JSON by sorting object keys recursively, removing whitespace,
   * and then hashing the UTF-8 bytes with SHA-256.
   *
   * Canonicalization rules (as required for auditors):
   * - Objects: keys sorted lexicographically.
   * - Arrays: order preserved.
   * - Primitive values: represented using JSON.stringify.
   * - No additional whitespace or indentation.
   */
  private canonicalize(value: any): string {
    if (Array.isArray(value)) {
      return '[' + value.map((v) => this.canonicalize(v)).join(',') + ']';
    }
    if (value && typeof value === 'object') {
      const keys = Object.keys(value).sort();
      return (
        '{' +
        keys
          .map((k) => JSON.stringify(k) + ':' + this.canonicalize(value[k]))
          .join(',') +
        '}'
      );
    }
    return JSON.stringify(value);
  }

  private computeHash(content: any): string {
    const canonical = this.canonicalize(content);
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /**
   * Anchors a document version on-chain.
   * Ensures the transaction identity is persisted before broadcasting.
   */
  async anchorDocument(documentId: string, version: number, content: any) {
    const contentHash = this.computeHash(content);
    // Prepare transaction
    const { txId, signedTx } = await this.chainClient.prepare({ hash: contentHash });

    // Persist intent
    let anchor;
    try {
      anchor = await this.anchorRepository.create({
        documentId,
        version,
        contentHash,
        txId,
        signedTx,
        state: AnchorState.PREPARED,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Unique constraint violation
        throw new ConflictException('Anchor already exists for this document and version');
      }
      throw new InternalServerErrorException('Failed to persist anchor intent');
    }

    // Broadcast
    try {
      await this.chainClient.broadcast(signedTx);
      await this.anchorRepository.updateState(txId, AnchorState.BROADCASTED);
    } catch (e) {
      // Timeout or unknown outcome
      await this.anchorRepository.updateState(txId, AnchorState.UNKNOWN);
    }

    return {
      documentId,
      version,
      txId,
      state: anchor.state,
    };
  }

  /**
   * Verifies provided content against the anchored hash.
   * Returns an anchoring proof if content matches and anchor is confirmed,
   * otherwise returns a mismatch report or error envelope.
   */
  async verify(documentId: string, version: number, content: any) {
    const anchor = await this.anchorRepository.find(documentId, version);
    if (!anchor) {
      throw new HttpException(
        {
          error: {
            code: 'resource_not_found',
            message: `Anchor not found for document ${documentId} version ${version}`,
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const suppliedHash = this.computeHash(content);
    if (suppliedHash !== anchor.contentHash) {
      return {
        mismatch: {
          expectedHash: anchor.contentHash,
          actualHash: suppliedHash,
        },
      };
    }

    if (anchor.state !== AnchorState.CONFIRMED) {
      throw new HttpException(
        {
          error: {
            code: 'anchor_not_confirmed',
            message: `Anchor exists but not yet confirmed (state: ${anchor.state})`,
            details: {},
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      proof: {
        txId: anchor.txId,
        blockNumber: anchor.blockNumber,
      },
    };
  }
}
