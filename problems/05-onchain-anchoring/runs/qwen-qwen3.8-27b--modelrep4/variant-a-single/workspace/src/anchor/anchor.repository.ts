import { Injectable } from '@nestjs/common';
import { Prisma, type DocumentAnchor } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AnchorAlreadyExistsError } from './anchor.errors.js';

export const ANCHOR_STATES = ['PENDING_BROADCAST', 'BROADCAST', 'LIMBO', 'CONFIRMED', 'FAILED'] as const;
export type AnchorState = (typeof ANCHOR_STATES)[number];

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists the anchor intent (hash + tx identity) in PENDING_BROADCAST.
   * This row must exist BEFORE the tx is broadcast, so a crash cannot lose
   * the anchor.
   */
  async create(input: {
    documentId: string;
    version: string;
    anchorHash: string;
    txId: string;
  }): Promise<DocumentAnchor> {
    try {
      return await this.prisma.documentAnchor.create({
        data: {
          documentId: input.documentId,
          version: input.version,
          anchorHash: input.anchorHash,
          txId: input.txId,
          state: 'PENDING_BROADCAST',
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AnchorAlreadyExistsError(input.documentId, input.version);
      }
      throw err;
    }
  }

  async findByDocumentVersion(documentId: string, version: string): Promise<DocumentAnchor | null> {
    return this.prisma.documentAnchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
  }

  /** Rows whose anchoring is not yet terminal, oldest first. */
  async findInStates(states: readonly AnchorState[], limit: number): Promise<DocumentAnchor[]> {
    return this.prisma.documentAnchor.findMany({
      where: { state: { in: [...states] } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async markBroadcast(id: string): Promise<DocumentAnchor> {
    return this.prisma.documentAnchor.update({
      where: { id },
      data: { state: 'BROADCAST', broadcastAttempts: { increment: 1 } },
    });
  }

  async markLimbo(id: string, lastError: string): Promise<DocumentAnchor> {
    return this.prisma.documentAnchor.update({
      where: { id },
      data: { state: 'LIMBO', lastError, broadcastAttempts: { increment: 1 } },
    });
  }

  async markConfirmed(id: string, blockNumber: number): Promise<DocumentAnchor> {
    return this.prisma.documentAnchor.update({
      where: { id },
      data: {
        state: 'CONFIRMED',
        blockNumber,
        chainStatus: 'success',
        confirmedAt: new Date(),
        lastError: null,
      },
    });
  }

  async markFailed(id: string, lastError: string): Promise<DocumentAnchor> {
    return this.prisma.documentAnchor.update({
      where: { id },
      data: { state: 'FAILED', lastError },
    });
  }
}

function isUniqueViolation(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
