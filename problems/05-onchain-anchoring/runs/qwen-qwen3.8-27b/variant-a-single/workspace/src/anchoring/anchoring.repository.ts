import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Anchor } from '@prisma/client';
import { UniqueConstraintViolationError } from '../errors.js';

export interface AnchorIntentInput {
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  signedTx: string;
}

const IN_FLIGHT = ['broadcast_sent', 'broadcast_unknown'] as const;
const RECOVERABLE = ['pending_broadcast', 'broadcast_sent', 'broadcast_unknown'] as const;

@Injectable()
export class AnchoringRepository implements OnApplicationShutdown {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }

  findByDocumentVersion(documentId: string, version: number): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({ where: { documentId_version: { documentId, version } } });
  }

  /**
   * Persists the anchor intent. Uniqueness of (document, version) is enforced
   * by the schema; a duplicate raises UniqueConstraintViolationError.
   */
  async create(intent: AnchorIntentInput): Promise<Anchor> {
    try {
      return await this.prisma.anchor.create({
        data: { ...intent, status: 'pending_broadcast', attempts: 0 },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new UniqueConstraintViolationError();
      }
      throw error;
    }
  }

  markBroadcastSent(id: string, attempts: number): Promise<Anchor> {
    return this.prisma.anchor.update({
      where: { id },
      data: { status: 'broadcast_sent', attempts, error: null },
    });
  }

  markBroadcastUnknown(id: string, attempts: number): Promise<Anchor> {
    return this.prisma.anchor.update({
      where: { id },
      data: { status: 'broadcast_unknown', attempts },
    });
  }

  markConfirmed(id: string, blockNumber: bigint, logIndex: number): Promise<Anchor> {
    return this.prisma.anchor.update({
      where: { id },
      data: { status: 'confirmed', blockNumber, logIndex, confirmedAt: new Date(), error: null },
    });
  }

  markFailed(id: string, error: string): Promise<Anchor> {
    return this.prisma.anchor.update({ where: { id }, data: { status: 'failed', error } });
  }

  /** Anchors whose broadcast was accepted (or lost) and whose receipt may now exist. */
  findInFlight(): Promise<Anchor[]> {
    return this.prisma.anchor.findMany({
      where: { status: { in: [...IN_FLIGHT] } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Anchors stuck in broadcast limbo, including intents that were never broadcast. */
  findStuck(olderThan: Date): Promise<Anchor[]> {
    return this.prisma.anchor.findMany({
      where: { status: { in: [...RECOVERABLE] }, updatedAt: { lt: olderThan } },
      orderBy: { createdAt: 'asc' },
    });
  }
}
