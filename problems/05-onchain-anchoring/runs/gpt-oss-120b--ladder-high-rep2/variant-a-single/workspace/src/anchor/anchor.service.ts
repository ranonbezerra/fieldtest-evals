import { Injectable, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { PrismaService } from '../prisma.service.js';
import {
  BlockchainClient,
  BroadcastTimeoutError,
} from '../blockchain/blockchain.client.js';
import { AnchorStatus, DocumentVersion } from '@prisma/client';
import { createHash } from 'crypto';

@Injectable()
export class AnchorService {
  constructor(
    private readonly anchorRepo: AnchorRepository,
    private readonly prisma: PrismaService,
    @Inject('BlockchainClient') private readonly blockchainClient: BlockchainClient,
  ) {}

  private canonicalizeAndHash(obj: any): string {
    const sortKeys = (value: any): any => {
      if (Array.isArray(value)) {
        return value.map(sortKeys);
      } else if (value && typeof value === 'object') {
        const sorted: any = {};
        Object.keys(value)
          .sort()
          .forEach((key) => {
            sorted[key] = sortKeys(value[key]);
          });
        return sorted;
      }
      return value;
    };
    const canonical = sortKeys(obj);
    const json = JSON.stringify(canonical);
    const hash = createHash('sha256');
    hash.update(json, 'utf8');
    return hash.digest('hex');
  }

  private async getDocumentVersion(documentId: string, version: number): Promise<DocumentVersion> {
    const docVersion = await this.prisma.documentVersion.findFirst({
      where: { document_id: documentId, version },
    });
    if (!docVersion) {
      throw new HttpException(
        {
          error: {
            code: 'resource_not_found',
            message: 'Document version not found',
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return docVersion;
  }

  async anchorDocument(documentId: string, version: number): Promise<{ anchorId: string }> {
    const docVersion = await this.getDocumentVersion(documentId, version);
    const contentHash = this.canonicalizeAndHash(docVersion.content);

    const txData = { documentId, version, contentHash };
    const { txId, signedTx } = await this.blockchainClient.prepare(txData);

    let anchor;
    try {
      anchor = await this.anchorRepo.createAnchorIntent(
        docVersion.id,
        contentHash,
        txId,
        signedTx,
      );
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new HttpException(
          {
            error: {
              code: 'resource_already_exists',
              message: 'Anchor already exists for this document version',
              details: {},
            },
          },
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }

    try {
      await this.blockchainClient.broadcast(signedTx);
      await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.SENT);
    } catch (err) {
      if (err instanceof BroadcastTimeoutError) {
        await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.SENT);
      } else {
        await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.FAILED);
        throw err;
      }
    }

    return { anchorId: anchor.id };
  }

  async processPendingAnchors(): Promise<void> {
    const pending = await this.anchorRepo.findPendingAnchors();
    for (const anchor of pending) {
      const receipt = await this.blockchainClient.getReceipt(anchor.tx_id);
      if (receipt) {
        if (receipt.status === 'success') {
          await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.CONFIRMED, receipt.blockNumber);
        } else {
          await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.FAILED);
        }
      }
    }
  }

  async recoverAnchors(): Promise<void> {
    const toRecover = await this.anchorRepo.findAnchorsInPrepOrSent();
    for (const anchor of toRecover) {
      const receipt = await this.blockchainClient.getReceipt(anchor.tx_id);
      if (receipt) {
        if (receipt.status === 'success') {
          await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.CONFIRMED, receipt.blockNumber);
        } else {
          await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.FAILED);
        }
        continue;
      }

      try {
        await this.blockchainClient.broadcast(anchor.signed_tx);
        await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.SENT);
      } catch (err) {
        if (err instanceof BroadcastTimeoutError) {
          await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.SENT);
        } else {
          await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.FAILED);
        }
      }
    }
  }

  async verify(
    documentId: string,
    version: number,
    content: any,
  ): Promise<
    | { proof: { txId: string; blockNumber: number } }
    | { mismatch: { expectedHash: string; actualHash: string } }
  > {
    const docVersion = await this.getDocumentVersion(documentId, version);
    const anchor = await this.anchorRepo.findAnchorByDocumentVersionId(docVersion.id);
    if (!anchor) {
      throw new HttpException(
        {
          error: {
            code: 'resource_not_found',
            message: 'No anchor for given document version',
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const actualHash = this.canonicalizeAndHash(content);
    if (actualHash !== anchor.content_hash) {
      return {
        mismatch: {
          expectedHash: anchor.content_hash,
          actualHash,
        },
      };
    }

    if (anchor.status !== AnchorStatus.CONFIRMED) {
      throw new HttpException(
        {
          error: {
            code: 'anchor_not_confirmed',
            message: 'Anchor exists but not yet confirmed on chain',
            details: { txId: anchor.tx_id },
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      proof: {
        txId: anchor.tx_id,
        blockNumber: anchor.block_number!,
      },
    };
  }
}
