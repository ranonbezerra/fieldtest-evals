import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Anchor, AnchorStatus } from '@prisma/client';

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createAnchorIntent(
    documentVersionId: string,
    contentHash: string,
    txId: string,
    signedTx: string,
  ): Promise<Anchor> {
    return this.prisma.anchor.create({
      data: {
        document_version_id: documentVersionId,
        content_hash: contentHash,
        tx_id: txId,
        signed_tx: signedTx,
        status: AnchorStatus.PREPARED,
      },
    });
  }

  async updateAnchorStatus(
    anchorId: string,
    status: AnchorStatus,
    blockNumber?: number,
  ): Promise<Anchor> {
    return this.prisma.anchor.update({
      where: { id: anchorId },
      data: {
        status,
        block_number: blockNumber,
      },
    });
  }

  async findAnchorByDocumentVersionId(documentVersionId: string): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: { document_version_id: documentVersionId },
    });
  }

  async findAnchorByTxId(txId: string): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: { tx_id: txId },
    });
  }

  async findPendingAnchors(): Promise<Anchor[]> {
    return this.prisma.anchor.findMany({
      where: { status: AnchorStatus.SENT },
    });
  }

  async findAnchorsInPrepOrSent(): Promise<Anchor[]> {
    return this.prisma.anchor.findMany({
      where: {
        status: { in: [AnchorStatus.PREPARED, AnchorStatus.SENT] },
      },
    });
  }
}
