import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import {
  Anchor,
  AnchorState,
} from '@prisma/client';

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createIntent(params: {
    documentId: string;
    version: number;
    hash: string;
    txId: string;
    signedTx: string;
  }): Promise<Anchor> {
    return this.prisma.anchor.create({
      data: {
        documentId: params.documentId,
        version: params.version,
        hash: params.hash,
        txId: params.txId,
        signedTx: params.signedTx,
        state: AnchorState.PREPARED,
      },
    });
  }

  async updateState(
    txId: string,
    state: AnchorState,
    blockNumber?: number,
  ): Promise<void> {
    await this.prisma.anchor.updateMany({
      where: { txId },
      data: {
        state,
        blockNumber,
        updatedAt: new Date(),
      },
    });
  }

  async findByTxId(txId: string) {
    // txId is not a unique field; use findFirst instead of findUnique
    return this.prisma.anchor.findFirst({ where: { txId } });
  }

  async findPending(): Promise<Anchor[]> {
    // pending includes BROADCASTED, UNKNOWN, PREPARED
    return this.prisma.anchor.findMany({
      where: {
        state: {
          in: [
            AnchorState.PREPARED,
            AnchorState.BROADCASTED,
            AnchorState.UNKNOWN,
          ],
        },
      },
    });
  }

  async findByDocumentVersion(
    documentId: string,
    version: number,
  ): Promise<Anchor | null> {
    // Use the generated compound unique name `uq_anchor_document_version`
    return this.prisma.anchor.findUnique({
      where: {
        uq_anchor_document_version: {
          documentId,
          version,
        },
      },
    });
  }
}
