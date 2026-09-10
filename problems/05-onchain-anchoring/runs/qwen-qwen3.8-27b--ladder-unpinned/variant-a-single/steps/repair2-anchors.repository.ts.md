# repair2-anchors.repository.ts

## reasoning

```
Let me analyze the compiler errors to understand what `src/anchors/anchors.repository.ts` needs to export and contain:

1. `src/anchors/anchors.controller.ts(3,15)`: Needs to export `AnchorRecord`
2. `src/anchors/anchors.repository.ts(2,3
```

## reply

```typescript
import { PrismaClient } from '@prisma/client';
import { ChainClient, AnchorReceipt } from '../chain/chain-client.js';
import { AnchorStatus, AnchorStatusValue, ANCHOR_STATUSES } from './anchor-status.js';

export interface AnchorRecord {
  id: number;
  documentId: string;
  version: number;
  contentHash: string;
  status: AnchorStatusValue;
  txId: string | null;
  signedTx: string | null;
  blockNumber: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export class DuplicateAnchorError extends Error {
  constructor(documentId: string, version: number) {
    super(`An anchor already exists for document ${documentId} version ${version}`);
    this.name = 'DuplicateAnchorError';
  }
}

interface AnchorRow {
  id: number;
  document_id: string;
  version: number;
  content_hash: string;
  status: AnchorStatusValue;
  tx_id: string | null;
  signed_tx: string | null;
  block_number: number | null;
  created_at: Date;
  updated_at: Date;
}

export class AnchorsRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chain: ChainClient,
  ) {}

  private mapRow(row: AnchorRow): AnchorRecord {
    return {
      id: row.id,
      documentId: row.document_id,
      version: row.version,
      contentHash: row.content_hash,
      status: row.status,
      txId: row.tx_id,
      signedTx: row.signed_tx,
      blockNumber: row.block_number,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async createIntent(
    documentId: string,
    version: number,
    contentHash: string,
    txId: string,
    signedTx: string,
  ): Promise<AnchorRecord> {
    try {
      const row = await this.prisma.$queryRaw<AnchorRow[]>`
        INSERT INTO anchors (document_id, version, content_hash, status, tx_id, signed_tx, created_at, updated_at)
        VALUES (${documentId}, ${version}, ${contentHash}, 'PREPARED'::"AnchorStatus", ${txId}, ${signedTx}, now(), now())
        RETURNING *
      `;
      return this.mapRow(row[0]);
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new DuplicateAnchorError(documentId, version);
      }
      throw err;
    }
  }

  async markBroadcastSent(id: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE anchors SET status = 'BROADCAST_SENT'::"AnchorStatus", updated_at = now() WHERE id = ${id}
    `;
  }

  async markFailed(id: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE anchors SET status = 'FAILED'::"AnchorStatus", updated_at = now() WHERE id = ${id}
    `;
  }

  async markOutcomeUnknown(id: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE anchors SET status = 'OUTCOME_UNKNOWN'::"AnchorStatus", updated_at = now() WHERE id = ${id}
    `;
  }

  async markConfirmed(id: number, blockNumber: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE anchors SET status = 'CONFIRMED'::"AnchorStatus", block_number = ${blockNumber}, updated_at = now() WHERE id = ${id}
    `;
  }

  async findByDocumentAndVersion(
    documentId: string,
    version: number,
  ): Promise<AnchorRecord | null> {
    const rows = await this.prisma.$queryRaw<AnchorRow[]>`
      SELECT * FROM anchors WHERE document_id = ${documentId} AND version = ${version}
    `;
    return rows.length > 0 ? this.mapRow(rows[0]) : null;
  }

  async findBroadcastSent(): Promise<AnchorRecord[]> {
    const rows = await this.prisma.$queryRaw<AnchorRow[]>`
      SELECT * FROM anchors WHERE status = 'BROADCAST_SENT'::"AnchorStatus"
    `;
    return rows.map((r) => this.mapRow(r));
  }

  async findOutcomeUnknown(): Promise<AnchorRecord[]> {
    const rows = await this.prisma.$queryRaw<AnchorRow[]>`
      SELECT * FROM anchors WHERE status = 'OUTCOME_UNKNOWN'::"AnchorStatus"
    `;
    return rows.map((r) => this.mapRow(r));
  }

  async getReceipt(txId: string): Promise<AnchorReceipt | null> {
    return this.chain.getReceipt(txId);
  }
}
```
