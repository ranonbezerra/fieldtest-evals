import { Injectable, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { ChainClient } from './chain-client.interface.js';
import { computeCanonicalHash } from './canonical.js';
import { AnchorState } from './anchor-state.enum.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class AnchorService {
  constructor(
    private readonly repository: AnchorRepository,
    @Inject('ChainClient') private readonly chainClient: ChainClient,
  ) {}

  /**
   * Anchors a document version on-chain.
   * Returns the transaction identifier.
   */
  async anchorDocument(documentId: string, version: number, content: any): Promise<{ txId: string }> {
    const hash = computeCanonicalHash(content);
    const { txId, signedTx } = await this.chainClient.prepare({ documentId, version, hash });

    // Persist the intent (state PREPARED) before broadcasting
    let anchor;
    try {
      anchor = await this.repository.createPreparedAnchor({
        documentId,
        version,
        hash,
        txId,
        signedTx,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Unique constraint violation
        throw new HttpException(
          {
            error: {
              code: 'anchor_exists',
              message: `Anchor already exists for document ${documentId} version ${version}`,
              details: {},
            },
          },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    // Broadcast the signed transaction
    try {
      await this.chainClient.broadcast(signedTx);
      await this.repository.updateState(anchor.id, AnchorState.BROADCASTED);
    } catch (e) {
      // Broadcast timed out or outcome unknown
      await this.repository.updateState(anchor.id, AnchorState.BROADCAST_UNKNOWN);
    }

    return { txId };
  }

  /**
   * Verifies that the supplied content matches the anchored hash.
   * Returns the anchoring proof (txId and block number) if matching,
   * otherwise throws a hash mismatch error.
   */
  async verify(documentId: string, version: number, content: any) {
    const anchor = await this.repository.findByDocumentAndVersion(documentId, version);
    if (!anchor) {
      throw new HttpException(
        {
          error: {
            code: 'resource_not_found',
            message: `No anchor found for document ${documentId} version ${version}`,
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const hash = computeCanonicalHash(content);
    if (hash !== anchor.hash) {
      throw new HttpException(
        {
          error: {
            code: 'hash_mismatch',
            message: 'Provided content does not match anchored content',
            details: {
              expected: anchor.hash,
              provided: hash,
            },
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      txId: anchor.txId,
      blockNumber: anchor.blockNumber ?? null,
    };
  }
}
