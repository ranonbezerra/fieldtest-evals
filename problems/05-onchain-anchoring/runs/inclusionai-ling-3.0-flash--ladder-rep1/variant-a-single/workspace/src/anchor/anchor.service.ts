import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.ts';
import type { Prisma } from '@prisma/client';
import { ChainClient } from '../../chain/chain.interface.ts';
import { canonicalHash } from '../../canonicalization/canonicalization.ts';
import { AnchorRepository } from './anchor.repository.ts';

export interface AnchorDocumentResult {
  anchorId: string;
  documentId: string;
  version: string;
  canonicalHash: string;
  txId: string;
  state: string;
}

export interface VerificationProof {
  match: true;
  txId: string;
  block: number;
}

export interface VerificationMismatch {
  match: false;
  storedHash?: string;
  computedHash: string;
}

export type VerificationResult = VerificationProof | VerificationMismatch;

@Injectable()
export class AnchorService {
  constructor(
    private readonly repository: AnchorRepository,
    private readonly chainClient: ChainClient,
    private readonly prisma: PrismaService,
  ) {}

  async anchorDocument(documentId: string, version: string): Promise<AnchorDocumentResult> {
    const docVersion = await this.repository.findDocumentVersion(documentId, version);
    if (!docVersion) {
      throw new HttpException(
        {
          error: {
            code: 'document_version_not_found',
            message: `No version ${version} found for document ${documentId}`,
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const existing = await this.repository.findByDocumentAndVersion(documentId, version);
    if (existing) {
      throw new HttpException(
        {
          error: {
            code: 'anchor_already_exists',
            message: `Anchor already exists for document ${documentId} version ${version}`,
            details: { anchorId: existing.id },
          },
        },
        HttpStatus.CONFLICT,
      );
    }

    const hash = canonicalHash(docVersion.content);

    const { txId, signedTx } = this.chainClient.prepare({ documentId, version, canonicalHash: hash });

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const already = await tx.anchor.findUnique({
        where: { documentId_version: { documentId, version } },
      });
      if (already) {
        throw new HttpException(
          {
            error: {
              code: 'anchor_already_exists',
              message: `Race condition: anchor was created concurrently for ${documentId} v${version}`,
              details: { anchorId: already.id },
            },
          },
          HttpStatus.CONFLICT,
        );
      }
      await tx.anchor.create({
        data: {
          id: crypto.randomUUID(),
          documentId,
          version,
          canonicalHash: hash,
          txId,
          signedTx,
          status: 'PREPARED',
        },
      });
    });

    try {
      await this.chainClient.broadcast(signedTx);
      await this.repository.updateState(documentId, version, 'BROADCAST_SENT');
    } catch {
      await this.repository.updateState(documentId, version, 'BROADCAST_TIMEOUT');
    }

    const anchor = await this.repository.findByDocumentAndVersion(documentId, version)!;

    return {
      anchorId: anchor.id,
      documentId: anchor.documentId,
      version: anchor.version,
      canonicalHash: hash,
      txId: anchor.txId,
      state: anchor.status,
    };
  }

  async verify(documentId: string, version: string, content: unknown): Promise<VerificationResult> {
    const anchor = await this.repository.findByDocumentAndVersion(documentId, version);
    const computedHash = canonicalHash(content);

    if (!anchor) {
      return { match: false, computedHash };
    }

    const anchorHash = (anchor as { canonicalHash: string }).canonicalHash;

    if (anchorHash === computedHash) {
      return {
        match: true,
        txId: anchor.txId,
        block: anchor.block ?? 0,
      };
    }

    return {
      match: false,
      storedHash: anchorHash,
      computedHash,
    };
  }
}
