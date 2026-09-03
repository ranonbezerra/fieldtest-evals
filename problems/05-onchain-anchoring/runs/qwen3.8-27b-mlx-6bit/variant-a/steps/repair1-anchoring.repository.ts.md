# repair1-anchoring.repository.ts

## reasoning

```
The compiler errors for `src/anchoring/anchoring.repository.ts` are all about the same issue: the Prisma-generated type for `status` is `string`, but the `AnchorRow` interface defines it as `'pending' | 'broadcast' | 'confirmed' | 'failed'`.

The fix is to cast the `status` field when mapping Prisma results to `AnchorRow`. I need to write the complete file.

Looking at the plan:
- The repository uses Prisma
- It has methods: `create`, `findById`, `findByDocumentAndVersion`, `findPending`, `findBroadcast`, `markBroadcast`, `markConfirmed`, `markFailed`
- It defines the `AnchorRow` interface

The errors are on lines that return Prisma query results directly without casting the `status` field. The fix is to map the results, casting `status` to the union type.

Let me write the complete file:

```typescript
import { PrismaClient } from '@prisma/client';
import type { AnchorRow } from './anchoring.repository'; // no, this is circular

Actually, let me just write it properly. The AnchorRow interface is defined in this file itself based on the plan.

Looking at the error messages more carefully:
- Line 31 (create): returns an object with `status: string` not assignable to the union
- Line 44 (findByDocumentAndVersion or findById): same
- Line 50 (findPending): same
- Line 57 (findBroadcast): same

The fix is to cast `status` as the union type when returning Prisma results. I'll use a mapping function or inline casts.

Let me write the complete file:
```

## reply

```typescript
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
```
