import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Anchor } from '@prisma/client';
import { AnchorState as AnchorStateEnum } from './anchor-state.enum.js';

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPreparedAnchor(params: {
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
        state: AnchorStateEnum.PREPARED,
      },
    });
  }

  async updateState(id: number, state: AnchorStateEnum): Promise<Anchor> {
    return this.prisma.anchor.update({
      where: { id },
      data: { state },
    });
  }

  async updateToConfirmed(id: number, blockNumber: number): Promise<Anchor> {
    return this.prisma.anchor.update({
      where: { id },
      data: {
        state: AnchorStateEnum.CONFIRMED,
        blockNumber,
      },
    });
  }

  async findByDocumentAndVersion(documentId: string, version: number): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: {
        documentId_version: {
          documentId,
          version,
        },
      },
    });
  }

  async findByStates(states: AnchorStateEnum[]): Promise<Anchor[]> {
    return this.prisma.anchor.findMany({
      where: {
        state: {
          in: states,
        },
      },
    });
  }
}
