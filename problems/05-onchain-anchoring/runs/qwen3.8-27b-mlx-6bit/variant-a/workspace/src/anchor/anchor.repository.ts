import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

export type AnchorState = 'pending' | 'broadcasting' | 'confirmed' | 'failed';

export interface AnchorRecord {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  content: string;
  txId: string | null;
  state: AnchorState;
  blockNumber: number | null;
}

export interface NewAnchor {
  documentId: string;
  version: number;
  contentHash: string;
  content: string;
  txId: string | null;
  state: AnchorState;
}

export class DuplicateAnchorError extends Error {
  constructor(message = 'An anchor already exists for this document and version') {
    super(message);
    this.name = 'DuplicateAnchorError';
  }
}

type AnchorRow = {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  content: string;
  txId: string | null;
  state: string;
  blockNumber: number | null;
};

function toAnchorRecord(row: AnchorRow): AnchorRecord {
  return {
    id: row.id,
    documentId: row.documentId,
    version: row.version,
    contentHash: row.contentHash,
    content: row.content,
    txId: row.txId,
    state: row.state as AnchorState,
    blockNumber: row.blockNumber,
  };
}

export class AnchorRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: NewAnchor): Promise<AnchorRecord> {
    try {
      const row = await this.prisma.anchor.create({ data: input });
      return toAnchorRecord(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new DuplicateAnchorError(
          `An anchor already exists for document ${input.documentId} version ${input.version}`,
        );
      }
      throw error;
    }
  }

  async findUnique(documentId: string, version: number): Promise<AnchorRecord | null> {
    const row = await this.prisma.anchor.findFirst({
      where: { documentId, version },
    });
    return row ? toAnchorRecord(row) : null;
  }

  async findByState(state: AnchorState, limit?: number): Promise<AnchorRecord[]> {
    const rows = await this.prisma.anchor.findMany({
      where: { state },
      ...(limit !== undefined ? { take: limit } : {}),
    });
    return rows.map(toAnchorRecord);
  }

  async updateState(
    id: string,
    patch: { state?: AnchorState; txId?: string; blockNumber?: number | null },
  ): Promise<AnchorRecord> {
    const row = await this.prisma.anchor.update({
      where: { id },
      data: patch,
    });
    return toAnchorRecord(row);
  }
}
