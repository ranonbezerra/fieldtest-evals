import { Injectable } from '@nestjs/common';
import { AnchorStatus, DocumentAnchor, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const NON_TERMINAL: AnchorStatus[] = [AnchorStatus.PREPARED, AnchorStatus.BROADCAST];

@Injectable()
export class AnchorsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAnchor(documentId: string, version: number): Promise<DocumentAnchor | null> {
    return this.prisma.documentAnchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
  }

  /**
   * Persist the anchor intent (content hash + tx identity). Returns null when a
   * unique constraint ((documentId, version) or txId) already has a row.
   */
  async createAnchor(data: {
    documentId: string;
    version: number;
    contentHash: string;
    txId: string;
    signedTx: string;
  }): Promise<DocumentAnchor | null> {
    try {
      return await this.prisma.documentAnchor.create({ data: { ...data, status: AnchorStatus.PREPARED } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }

  markBroadcast(id: string, attempt: number): Promise<DocumentAnchor> {
    return this.prisma.documentAnchor.update({
      where: { id },
      data: { status: AnchorStatus.BROADCAST, attempt },
    });
  }

  /** Idempotently record one more broadcast attempt (recovery sweep). */
  recordBroadcastAttempt(id: string): Promise<boolean> {
    return this.prisma.documentAnchor
      .updateMany({
        where: { id, status: { in: NON_TERMINAL } },
        data: { status: AnchorStatus.BROADCAST, attempt: { increment: 1 } },
      })
      .then((res) => res.count > 0);
  }

  markConfirmed(id: string, blockNumber: number, blockHash: string): Promise<boolean> {
    return this.prisma.documentAnchor
      .updateMany({
        where: { id, status: { in: NON_TERMINAL } },
        data: { status: AnchorStatus.CONFIRMED, blockNumber, blockHash, confirmedAt: new Date() },
      })
      .then((res) => res.count > 0);
  }

  markFailed(id: string, failureReason: string): Promise<boolean> {
    return this.prisma.documentAnchor
      .updateMany({
        where: { id, status: { in: NON_TERMINAL } },
        data: { status: AnchorStatus.FAILED, failureReason },
      })
      .then((res) => res.count > 0);
  }

  findNonTerminal(): Promise<DocumentAnchor[]> {
    return this.prisma.documentAnchor.findMany({ where: { status: { in: NON_TERMINAL } } });
  }

  findNonTerminalStale(olderThan: Date): Promise<DocumentAnchor[]> {
    return this.prisma.documentAnchor.findMany({
      where: { status: { in: NON_TERMINAL }, updatedAt: { lte: olderThan } },
    });
  }
}
