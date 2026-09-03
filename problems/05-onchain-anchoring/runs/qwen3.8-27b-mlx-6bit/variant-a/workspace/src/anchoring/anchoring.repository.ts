import { PrismaClient } from '@prisma/client';

export interface AnchorRow {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  signedTx: string;
  status: 'pending' | 'broadcast' | 'confirmed' | 'failed';
  blockNumber: bigint | null;
  blockHash: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type AnchorStatus = 'pending' | 'broadcast' | 'confirmed' | 'failed';

const VALID_STATUSES: readonly string[] = ['pending', 'broadcast', 'confirmed', 'failed'];

function toAnchorRow(row: {
  id: string;
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  signedTx: string;
  status: string;
  blockNumber: bigint | null;
  blockHash: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): AnchorRow {
  const status = row.status as AnchorStatus;
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid anchor status: ${row.status}`);
  }
  return { ...row, status };
}

export class AnchoringRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: {
    documentId: string;
    version: number;
    contentHash: string;
    txId: string;
    signedTx: string;
  }): Promise<AnchorRow> {
    const row = await this.prisma.documentAnchor.create({
      data: {
        documentId: data.documentId,
        version: data.version,
        contentHash: data.contentHash,
        txId: data.txId,
        signedTx: data.signedTx,
      },
    });
    return toAnchorRow(row);
  }

  async findById(id: string): Promise<AnchorRow | null> {
    const row = await this.prisma.documentAnchor.findUnique({ where: { id } });
    return row ? toAnchorRow(row) : null;
  }

  async findByDocumentAndVersion(documentId: string, version: number): Promise<AnchorRow | null> {
    const row = await this.prisma.documentAnchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
    return row ? toAnchorRow(row) : null;
  }

  async findPending(limit: number): Promise<AnchorRow[]> {
    const rows = await this.prisma.documentAnchor.findMany({
      where: { status: 'pending' },
      take: limit,
    });
    return rows.map(toAnchorRow);
  }

  async findBroadcast(limit: number): Promise<AnchorRow[]> {
    const rows = await this.prisma.documentAnchor.findMany({
      where: { status: 'broadcast' },
      take: limit,
    });
    return rows.map(toAnchorRow);
  }

  async markBroadcast(id: string): Promise<void> {
    await this.prisma.documentAnchor.update({
      where: { id },
      data: { status: 'broadcast' },
    });
  }

  async markConfirmed(id: string, blockNumber: bigint, blockHash: string): Promise<void> {
    await this.prisma.documentAnchor.update({
      where: { id },
      data: { status: 'confirmed', blockNumber, blockHash },
    });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.prisma.documentAnchor.update({
      where: { id },
      data: { status: 'failed', failureReason: reason },
    });
  }
}
