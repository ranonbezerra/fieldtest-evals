import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { AnchorState } from './anchor.model.js';
import { Anchor } from '@prisma/client';

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    documentId: string;
    version: number;
    contentHash: string;
    txId: string;
    signedTx: string;
    state: AnchorState;
  }): Promise<Anchor> {
    return this.prisma.anchor.create({ data });
  }

  async find(documentId: string, version: number): Promise<Anchor | null> {
    return this.prisma.anchor.findFirst({
      where: { documentId, version },
    });
  }

  async findByTxId(txId: string): Promise<Anchor | null> {
    return this.prisma.anchor.findFirst({ where: { txId } });
  }

  async updateState(
    txId: string,
    newState: AnchorState,
    blockNumber?: number,
  ): Promise<Anchor> {
    const data: any = { state: newState };
    if (blockNumber !== undefined) {
      data.blockNumber = blockNumber;
    }
    await this.prisma.anchor.update({
      where: { txId },
      data,
    });
    // Return the updated record
    return this.prisma.anchor.findFirst({ where: { txId } }) as Promise<Anchor>;
  }

  async findByStates(states: AnchorState[]): Promise<Anchor[]> {
    return this.prisma.anchor.findMany({
      where: { state: { in: states } },
    });
  }

  async deleteAll(): Promise<void> {
    await this.prisma.anchor.deleteMany({});
  }
}
