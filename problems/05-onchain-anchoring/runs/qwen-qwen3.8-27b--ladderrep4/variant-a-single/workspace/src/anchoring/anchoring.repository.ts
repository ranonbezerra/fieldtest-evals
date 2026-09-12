import { Injectable } from '@nestjs/common';
import { AnchorStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { anchorConflictError, documentVersionConflictError } from '../common/domain-exception.js';

/** Anchor lifecycle states (the schema enum; DB values are snake_case). */
export type AnchorState = 'prepared' | 'broadcast_sent' | 'broadcast_unknown' | 'confirmed' | 'failed';

export interface ChainReceiptRecord {
  txId: string;
  blockNumber: number;
  blockHash: string;
  status: 'success' | 'failure';
}

export interface StoredVersion {
  id: string;
  documentId: string;
  version: number;
  content: unknown;
  createdAt: Date;
}

export interface StoredAnchor {
  id: string;
  documentId: string;
  version: number;
  status: AnchorState;
  contentHash: string;
  txId: string;
  signedTx: string;
  blockNumber: number | null;
  receipt: ChainReceiptRecord | null;
  broadcastAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

const TO_DB: Record<AnchorState, AnchorStatus> = {
  prepared: AnchorStatus.PREPARED,
  broadcast_sent: AnchorStatus.BROADCAST_SENT,
  broadcast_unknown: AnchorStatus.BROADCAST_UNKNOWN,
  confirmed: AnchorStatus.CONFIRMED,
  failed: AnchorStatus.FAILED,
};

const TO_STATE: Record<AnchorStatus, AnchorState> = {
  [AnchorStatus.PREPARED]: 'prepared',
  [AnchorStatus.BROADCAST_SENT]: 'broadcast_sent',
  [AnchorStatus.BROADCAST_UNKNOWN]: 'broadcast_unknown',
  [AnchorStatus.CONFIRMED]: 'confirmed',
  [AnchorStatus.FAILED]: 'failed',
};

type AnchorRow = Prisma.AnchorGetPayload<{}>;

function toStoredAnchor(row: AnchorRow): StoredAnchor {
  return {
    id: row.id,
    documentId: row.documentId,
    version: row.version,
    status: TO_STATE[row.status],
    contentHash: row.contentHash,
    txId: row.txId,
    signedTx: row.signedTx,
    blockNumber: row.blockNumber === null ? null : Number(row.blockNumber),
    receipt: (row.receipt ?? null) as ChainReceiptRecord | null,
    broadcastAttempts: row.broadcastAttempts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** The only layer that touches the database. All Prisma calls live here. */
@Injectable()
export class AnchoringRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findVersion(documentId: string, version: number): Promise<StoredVersion | null> {
    const row = await this.prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    if (!row) return null;
    return { id: row.id, documentId: row.documentId, version: row.version, content: row.content, createdAt: row.createdAt };
  }

  async createVersion(documentId: string, version: number, content: Record<string, unknown>): Promise<StoredVersion> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.document.upsert({ where: { id: documentId }, update: {}, create: { id: documentId } });
        await tx.documentVersion.create({ data: { documentId, version, content: content as Prisma.InputJsonValue } });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw documentVersionConflictError(documentId, version);
      throw error;
    }
    const created = await this.findVersion(documentId, version);
    if (!created) throw new Error('createVersion: version row missing after commit');
    return created;
  }

  async createAnchor(data: {
    documentId: string;
    version: number;
    contentHash: string;
    txId: string;
    signedTx: string;
  }): Promise<StoredAnchor> {
    try {
      const row = await this.prisma.anchor.create({ data: { ...data, status: AnchorStatus.PREPARED } });
      return toStoredAnchor(row);
    } catch (error) {
      // One anchor per (document, version): the unique constraint is the enforcement.
      if (isUniqueViolation(error)) throw anchorConflictError(data.documentId, data.version);
      throw error;
    }
  }

  async findAnchor(documentId: string, version: number): Promise<StoredAnchor | null> {
    const row = await this.prisma.anchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    return row ? toStoredAnchor(row) : null;
  }

  async findById(id: string): Promise<StoredAnchor | null> {
    const row = await this.prisma.anchor.findUnique({ where: { id } });
    return row ? toStoredAnchor(row) : null;
  }

  async listByStatuses(states: AnchorState[], limit: number): Promise<StoredAnchor[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { status: { in: states.map((s) => TO_DB[s]) } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map(toStoredAnchor);
  }

  async listStuck(states: AnchorState[], stuckBefore: Date, limit: number): Promise<StoredAnchor[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { status: { in: states.map((s) => TO_DB[s]) }, updatedAt: { lt: stuckBefore } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map(toStoredAnchor);
  }

  /**
   * Atomic compare-and-set transition: only succeeds if the row is still in
   * one of `from` states. Returns false when a concurrent worker already
   * moved it, so two instances cannot double-advance or double-confirm.
   */
  async transition(
    id: string,
    from: AnchorState[],
    to: AnchorState,
    extra: { blockNumber?: number; receipt?: ChainReceiptRecord; incrementBroadcastAttempts?: boolean } = {},
  ): Promise<boolean> {
    const data: Prisma.AnchorUpdateManyMutationInput = { status: TO_DB[to] };
    if (extra.blockNumber !== undefined) data.blockNumber = BigInt(extra.blockNumber);
    if (extra.receipt !== undefined) data.receipt = extra.receipt as unknown as Prisma.InputJsonValue;
    if (extra.incrementBroadcastAttempts) data.broadcastAttempts = { increment: 1 };
    const result = await this.prisma.anchor.updateMany({
      where: { id, status: { in: from.map((s) => TO_DB[s]) } },
      data,
    });
    return result.count > 0;
  }
}
