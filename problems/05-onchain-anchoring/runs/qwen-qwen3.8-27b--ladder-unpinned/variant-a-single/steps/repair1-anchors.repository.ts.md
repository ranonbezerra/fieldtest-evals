# repair1-anchors.repository.ts

## reasoning

```
Let me analyze the two compiler errors:

1. **Line 62, column 53**: `Type 'AnchorTxPayload' is not assignable to type 'JsonNull | InputJsonValue'` — The issue is that `AnchorTxPayload` is an interface, and Prisma's `Json` field
```

## reply

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Anchor,
  AnchorStatus,
  Prisma,
} from '@prisma/client';
import { AnchorTxPayload } from '../chain/chain-client';

export interface CreateAnchorIntent {
  documentId: string;
  version: number;
  contentHash: string;
  txId: string;
  payload: AnchorTxPayload;
}

export interface AnchorWithPayload extends Omit<Anchor, 'payload'> {
  payload: AnchorTxPayload;
}

@Injectable()
export class AnchorsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(intent: CreateAnchorIntent): Promise<AnchorWithPayload> {
    const anchor = await this.prisma.anchor.create({
      data: {
        documentId: intent.documentId,
        version: intent.version,
        contentHash: intent.contentHash,
        txId: intent.txId,
        status: AnchorStatus.PENDING_BROADCAST,
        payload: {
          kind: intent.payload.kind,
          documentId: intent.payload.documentId,
          version: intent.payload.version,
          contentHash: intent.payload.contentHash,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return { ...anchor, payload: intent.payload };
  }

  async findByDocumentAndVersion(
    documentId: string,
    version: number,
  ): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
  }

  async findByTxId(txId: string): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: { txId },
    });
  }

  async updateStatus(
    id: string,
    status: AnchorStatus,
    receipt?: {
      blockNumber: bigint;
      blockHash: string;
      failureReason?: string;
    },
  ): Promise<Anchor> {
    const data: Prisma.AnchorUpdateInput = { status };
    if (receipt) {
      data.blockNumber = receipt.blockNumber;
      data.blockHash = receipt.blockHash;
      data.failureReason = receipt.failureReason ?? null;
    }
    return this.prisma.anchor.update({
      where: { id },
      data,
    });
  }

  async findStuck(
    status: AnchorStatus,
    olderThan: Date,
  ): Promise<Anchor[]> {
    return this.prisma.anchor.findMany({
      where: {
        status,
        updatedAt: { lt: olderThan },
      },
    });
  }
}
```
