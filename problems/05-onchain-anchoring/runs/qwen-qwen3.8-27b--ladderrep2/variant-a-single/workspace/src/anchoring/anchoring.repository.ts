import { Injectable } from '@nestjs/common';
import type { Anchor } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { DuplicateAnchorError } from './errors.js';
import type { AnchorStatus } from './types.js';

export interface AnchorRecord {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  signedTx: string;
  status: AnchorStatus;
  blockNumber: number | null;
  blockHash: string | null;
  broadcastAttempts: number;
  broadcastAt: Date | null;
  lastError: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAnchorInput {
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  signedTx: string;
}

export interface TransitionData {
  status: AnchorStatus;
  blockNumber?: number;
  blockHash?: string;
  lastError?: string | null;
  broadcastAt?: Date;
  confirmedAt?: Date;
  incrementAttempts?: boolean;
}

/**
 * The only layer that touches the database.
 */
@Injectable()
export class AnchoringRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateAnchorInput): Promise<AnchorRecord> {
    try {
      const row = await this.prisma.anchor.create({ data: { ...input, status: 'PREPARED' } });
      return toRecord(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DuplicateAnchorError(input.documentId, input.version);
      }
      throw err;
    }
  }

  async findById(id: string): Promise<AnchorRecord | null> {
    const row = await this.prisma.anchor.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async findByDocumentAndVersion(documentId: string, version: number): Promise<AnchorRecord | null> {
    const row = await this.prisma.anchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    return row ? toRecord(row) : null;
  }

  /**
   * Guarded transition: applies data only if the row is still in
   * `expectedStatus`. Returns false when someone else moved the row first —
   * this is what keeps the worker and the sweep from racing.
   */
  async transition(id: string, expectedStatus: AnchorStatus, data: TransitionData): Promise<boolean> {
    const { incrementAttempts, ...fields } = data;
    const result = await this.prisma.anchor.updateMany({
      where: { id, status: expectedStatus },
      data: {
        ...fields,
        ...(incrementAttempts ? { broadcastAttempts: { increment: 1 } } : {}),
      },
    });
    return result.count === 1;
  }

  async findByStatus(status: AnchorStatus, olderThan?: Date, limit = 25): Promise<AnchorRecord[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { status, ...(olderThan ? { updatedAt: { lt: olderThan } } : {}) },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map(toRecord);
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

function toRecord(row: Anchor): AnchorRecord {
  return {
    id: row.id,
    documentId: row.documentId,
    version: row.version,
    contentHash: row.contentHash,
    txId: row.txId,
    signedTx: row.signedTx,
    status: row.status,
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
    broadcastAttempts: row.broadcastAttempts,
    broadcastAt: row.broadcastAt,
    lastError: row.lastError,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
