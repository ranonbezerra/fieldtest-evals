# repair1-anchor.repository.ts

## reasoning

```
We need to write repository file with correct imports. Likely other files missing, but we only can modify this file. We must add imports that exist? We don't know their paths. Probably they exist but missing extension. Use correct relative paths. repository should import PrismaService from '../prisma.service'. That file likely exists. Also export class AnchorRepository with methods to create intent, update status, find anchor, etc. Provide minimal to compile.

Define interface AnchorRecord with fields. Use Prisma client types via PrismaService. We'll assume PrismaService has property client.

Implement class with constructor injecting PrismaService. Provide methods: createAnchorIntent(documentId:string, version:number, txId:string): Promise<void> ; updateAnchorStatus(...); getAnchor(...). Use prisma.anchor (model). We'll assume model name Anchor.

Write file with NestJS Injectable.

Add necessary imports and export.
```

## reply

```ts
// src/anchor/anchor.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// ASSUMPTION: The Prisma schema defines a model named `anchor` with the
// following fields (or compatible ones). Adjust the type annotations if the
// actual schema differs.
//   - id: string (primary key, generated)
//   - document_id: string
//   - version: int
//   - tx_id: string
//   - status: string ('pending' | 'broadcasted' | 'confirmed' | 'failed')
//   - block_number: int | null
//   - created_at: Date
//   - updated_at: Date

export type AnchorStatus = 'pending' | 'broadcasted' | 'confirmed' | 'failed';

export interface AnchorRecord {
  id: string;
  documentId: string;
  version: number;
  txId: string;
  status: AnchorStatus;
  blockNumber?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Repository responsible for all database interactions related to document
 * anchoring. It is the sole layer that touches Prisma.
 */
@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists an intent to anchor a document version. This is called *before*
   * broadcasting the transaction, guaranteeing that the `txId` is stored even
   * if broadcasting later fails or times‑out.
   */
  async createAnchorIntent(
    documentId: string,
    version: number,
    txId: string,
  ): Promise<AnchorRecord> {
    const created = await this.prisma.anchor.create({
      data: {
        document_id: documentId,
        version,
        tx_id: txId,
        status: 'pending',
      },
    });

    return this.mapPrismaModel(created);
  }

  /**
   * Updates the anchoring record after the transaction has been broadcast.
   * Typical status transition: `pending` → `broadcasted`.
   */
  async markBroadcasted(
    documentId: string,
    version: number,
    txId: string,
  ): Promise<AnchorRecord> {
    const updated = await this.prisma.anchor.updateMany({
      where: {
        document_id: documentId,
        version,
        tx_id: txId,
      },
      data: {
        status: 'broadcasted',
      },
    });

    // `updateMany` returns a count, not the record. Fetch the record afterwards.
    return this.findAnchor(documentId, version);
  }

  /**
   * Persists the final confirmation (block number) once the receipt is known.
   */
  async confirmAnchor(
    documentId: string,
    version: number,
    blockNumber: number,
  ): Promise<AnchorRecord> {
    await this.prisma.anchor.updateMany({
      where: {
        document_id: documentId,
        version,
      },
      data: {
        status: 'confirmed',
        block_number: blockNumber,
      },
    });

    return this.findAnchor(documentId, version);
  }

  /**
   * Marks an anchoring attempt as failed (e.g., broadcast timeout).
   */
  async failAnchor(
    documentId: string,
    version: number,
    reason?: string,
  ): Promise<AnchorRecord> {
    await this.prisma.anchor.updateMany({
      where: {
        document_id: documentId,
        version,
      },
      data: {
        status: 'failed',
      },
    });

    return this.findAnchor(documentId, version);
  }

  /**
   * Retrieves the anchoring record for a given document/version.
   * Throws if not found – the service layer can translate this into the
   * standard error envelope.
   */
  async findAnchor(documentId: string, version: number): Promise<AnchorRecord> {
    const record = await this.prisma.anchor.findUnique({
      where: {
        document_id_version: {
          document_id: documentId,
          version,
        },
      },
    });

    if (!record) {
      throw new Error(
        `Anchor record not found for documentId=${documentId}, version=${version}`,
      );
    }

    return this.mapPrismaModel(record);
  }

  /**
   * Helper to map the raw Prisma model (snake_case fields) to the
   * camelCase `AnchorRecord` type used elsewhere in the codebase.
   */
  private mapPrismaModel(prismaModel: any): AnchorRecord {
    return {
      id: prismaModel.id,
      documentId: prismaModel.document_id,
      version: prismaModel.version,
      txId: prismaModel.tx_id,
      status: prismaModel.status as AnchorStatus,
      blockNumber: prismaModel.block_number,
      createdAt: prismaModel.created_at,
      updatedAt: prismaModel.updated_at,
    };
  }
}
```
