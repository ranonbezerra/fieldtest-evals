import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Anchor } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { UniqueViolationError } from '../errors.js';

export type AnchorState = 'pending' | 'confirmed';

export interface AnchorRecord {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  signedTx: string;
  state: AnchorState;
  blockNumber: number | null;
  createdAt: Date;
  broadcastAt: Date | null;
  confirmedAt: Date | null;
}

export interface AnchorCreateInput {
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  signedTx: string;
}

/**
 * The only layer that touches the database. The (documentId, version) unique
 * constraint in the schema guarantees at most one anchor per
 * (document, version).
 */
@Injectable()
export class AnchorRepository implements OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  async create(data: AnchorCreateInput): Promise<AnchorRecord> {
    try {
      const row = await this.prisma.anchor.create({
        data: { id: randomUUID(), ...data, state: 'pending' },
      });
      return this.toRecord(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new UniqueViolationError(
          { documentId: data.documentId, version: data.version },
          'An anchor already exists for this (document, version)',
        );
      }
      throw err;
    }
  }

  async findByDocumentAndVersion(documentId: string, version: number): Promise<AnchorRecord | null> {
    const row = await this.prisma.anchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    return row === null ? null : this.toRecord(row);
  }

  /** Pending anchors whose send was recorded: ready for receipt polling. */
  async findPendingSent(limit: number): Promise<AnchorRecord[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { state: 'pending', broadcastAt: { not: null } },
      orderBy: { broadcastAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  /** Pending anchors older than the cutoff: broadcast outcome unresolved (limbo candidates). */
  async findStalePending(olderThan: Date, limit: number): Promise<AnchorRecord[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { state: 'pending', createdAt: { lt: olderThan } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  async markBroadcast(id: string): Promise<AnchorRecord> {
    const row = await this.prisma.anchor.update({
      where: { id },
      data: { broadcastAt: new Date() },
    });
    return this.toRecord(row);
  }

  /**
   * Atomically advances pending -> confirmed. Returns false when the row was
   * already confirmed (a competing worker won the race).
   */
  async confirm(id: string, blockNumber: number): Promise<boolean> {
    const result = await this.prisma.anchor.updateMany({
      where: { id, state: 'pending' },
      data: { state: 'confirmed', blockNumber, confirmedAt: new Date() },
    });
    return result.count > 0;
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private toRecord(row: Anchor): AnchorRecord {
    return {
      id: row.id,
      documentId: row.documentId,
      version: row.version,
      contentHash: row.contentHash,
      txId: row.txId,
      signedTx: row.signedTx,
      state: row.state,
      blockNumber: row.blockNumber,
      createdAt: row.createdAt,
      broadcastAt: row.broadcastAt,
      confirmedAt: row.confirmedAt,
    };
  }
}
