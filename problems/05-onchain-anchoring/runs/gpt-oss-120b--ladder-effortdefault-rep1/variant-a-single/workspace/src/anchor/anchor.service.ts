import {
  Injectable,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { ChainClient } from './chain-client.interface.js';
import { canonicalize, sha256 } from './canonicalization.js';
import { AnchorState } from '@prisma/client';

@Injectable()
export class AnchorService {
  constructor(
    private readonly repo: AnchorRepository,
    private readonly chain: ChainClient,
  ) {}

  /**
   * Anchor a document version.
   * Steps:
   * 1. canonicalize content and hash it
   * 2. prepare transaction (deterministic, yields txId & signedTx)
   * 3. persist intent (state PREPARED) with txId, signedTx, hash
   * 4. broadcast signedTx
   *    - on success set state BROADCASTED
   *    - on timeout set state UNKNOWN (outcome unknown)
   */
  async anchorDocument(
    documentId: string,
    version: number,
    content: unknown,
  ): Promise<void> {
    const canonical = canonicalize(content);
    const hash = sha256(canonical);

    const { txId, signedTx } = await this.chain.prepare({
      documentId,
      version,
      hash,
    });

    try {
      await this.repo.createIntent({
        documentId,
        version,
        hash,
        txId,
        signedTx,
      });
    } catch (err: any) {
      // Prisma throws a unique constraint violation (code P2002) when duplicate
      if (err.code === 'P2002') {
        throw new ConflictException({
          error: {
            code: 'anchor_already_exists',
            message: `Anchor for document ${documentId} version ${version} already exists`,
            details: {},
          },
        });
      }
      throw new InternalServerErrorException({
        error: {
          code: 'db_error',
          message: err.message,
          details: {},
        },
      });
    }

    try {
      await this.chain.broadcast(signedTx);
      await this.repo.updateState(txId, AnchorState.BROADCASTED);
    } catch (err: any) {
      // Assume any error here is a timeout / unknown outcome
      await this.repo.updateState(txId, AnchorState.UNKNOWN);
      // rethrow so the controller can report if needed, but we swallow to keep flow
    }
  }

  /**
   * Verify content against stored anchor.
   * Returns proof (txId, blockNumber) if hash matches and anchor is confirmed.
   * Otherwise returns mismatch report.
   */
  async verify(
    documentId: string,
    version: number,
    content: unknown,
  ): Promise<any> {
    const anchor = await this.repo.findByDocumentVersion(documentId, version);
    if (!anchor) {
      return {
        error: {
          code: 'anchor_not_found',
          message: `No anchor for document ${documentId} version ${version}`,
          details: {},
        },
      };
    }

    const canonical = canonicalize(content);
    const hash = sha256(canonical);

    if (hash !== anchor.hash) {
      return {
        error: {
          code: 'hash_mismatch',
          message: 'Provided content does not match anchored hash',
          details: { expected: anchor.hash, actual: hash },
        },
      };
    }

    if (anchor.state !== AnchorState.CONFIRMED) {
      return {
        error: {
          code: 'anchor_not_confirmed',
          message: 'Anchor exists but is not yet confirmed on chain',
          details: { state: anchor.state },
        },
      };
    }

    return {
      proof: {
        txId: anchor.txId,
        blockNumber: anchor.blockNumber,
      },
    };
  }
}
