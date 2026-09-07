# repair2-anchor.repository.ts

## reasoning

```
We need to write repository file with proper imports. Likely other files missing; but we just need to make this compile. Provide placeholder classes/interfaces.

Assume prisma.service exists exporting PrismaService. Also chain-client.interface defines ChainClient with methods. We'll just import types.

Implement AnchorRepository class with methods: createAnchorIntent(documentId, version, txId), findPending, updateStatus, getByDocVersion maybe.

We'll just stub.

Use @Injectable.

Provide minimal code.
```

## reply

```ts
// src/anchor/anchor.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

// ASSUMPTION: The Prisma schema contains a model `anchor_intent`
// with columns (id, document_id, version, tx_id, status, created_at, updated_at)
// and a unique index on (document_id, version). Adjust field names if the actual
// schema differs.

export type AnchorStatus = 'pending' | 'broadcasted' | 'confirmed' | 'failed';

export interface AnchorIntent {
  id: number;
  document_id: string;
  version: number;
  tx_id: string;
  status: AnchorStatus;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists the anchor intent *before* broadcasting.
   */
  async createIntent(
    documentId: string,
    version: number,
    txId: string,
  ): Promise<AnchorIntent> {
    return this.prisma.anchor_intent.create({
      data: {
        document_id: documentId,
        version,
        tx_id: txId,
        status: 'pending',
      },
    });
  }

  /**
   * Retrieves a pending intent for the given document/version, if any.
   */
  async findPending(
    documentId: string,
    version: number,
  ): Promise<AnchorIntent | null> {
    return this.prisma.anchor_intent.findFirst({
      where: {
        document_id: documentId,
        version,
        status: 'pending',
      },
    });
  }

  /**
   * Updates the status of an existing intent.
   */
  async updateStatus(
    id: number,
    status: AnchorStatus,
  ): Promise<AnchorIntent> {
    return this.prisma.anchor_intent.update({
      where: { id },
      data: { status, updated_at: new Date() },
    });
  }

  /**
   * Retrieves the anchoring proof (txId and status) for a given document/version.
   */
  async getProof(
    documentId: string,
    version: number,
  ): Promise<{ txId: string; status: AnchorStatus } | null> {
    const intent = await this.prisma.anchor_intent.findFirst({
      where: {
        document_id: documentId,
        version,
      },
      select: {
        tx_id: true,
        status: true,
      },
    });

    if (!intent) {
      return null;
    }

    return { txId: intent.tx_id, status: intent.status as AnchorStatus };
  }
}
```
