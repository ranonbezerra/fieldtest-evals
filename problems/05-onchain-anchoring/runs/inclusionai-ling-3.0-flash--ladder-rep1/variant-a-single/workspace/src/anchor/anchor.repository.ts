import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.ts';
import type { Anchor, DocumentVersion, Prisma } from '@prisma/client';

type AnchorState = Anchor['status'];

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createDocumentVersion(
    data: Prisma.DocumentVersionCreateInput & { documentId: string; version: string }
  ): Promise<DocumentVersion> {
    return this.prisma.documentVersion.create({
      data: {
        documentId: data.documentId,
        version: data.version,
        content: data.content as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async findDocumentVersion(documentId: string, version: string): Promise<DocumentVersion | null> {
    return this.prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId, version } },
    });
  }

  async createAnchorIntent(
    data: Prisma.AnchorCreateInput & { documentId: string; version: string }
  ): Promise<Anchor> {
    return this.prisma.anchor.create({
      data: {
        documentId: data.documentId,
        version: data.version,
        canonicalHash: data.canonicalHash as string,
        txId: data.txId as string,
        signedTx: data.signedTx as string,
        status: (data.status as AnchorState) ?? 'PREPARED',
      },
    });
  }

  async findByDocumentAndVersion(documentId: string, version: string): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
  }

  async findByTxId(txId: string): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: { txId },
    });
  }

  async updateState(
    documentId: string,
    version: string,
    status: AnchorState,
    patch?: { block?: number }
  ): Promise<Anchor> {
    const data: Prisma.AnchorUpdateInput = { status };
    if (patch) {
      if (patch.block !== undefined) data.block = patch.block;
    }
    return this.prisma.anchor.update({
      where: { documentId_version: { documentId, version } },
      data,
    });
  }

  async findAllAnchors(): Promise<Anchor[]> {
    return this.prisma.anchor.findMany();
  }
}
