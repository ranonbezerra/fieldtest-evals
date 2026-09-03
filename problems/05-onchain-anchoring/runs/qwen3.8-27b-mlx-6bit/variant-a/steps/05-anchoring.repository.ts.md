# 05-anchoring.repository.ts

## reasoning

```
Let me analyze the plan carefully for what `src/anchoring/anchoring.repository.ts` should contain.

From the plan:

```ts
export class AnchoringRepository {
  constructor(prisma: PrismaClient);

  create(data: {
    documentId: string;
    version: number;
    contentHash: string;
    txId: string;
    signedTx: string;
  }): Promise<AnchorRow>;

  findById(id: string): Promise<AnchorRow | null>;
  findByDocumentAndVersion(documentId: string, version: number): Promise<AnchorRow | null>;
  findPending(limit: number): Promise<AnchorRow[]>;
  findBroadcast(limit: number): Promise<AnchorRow[]>;

  markBroadcast(id: string): Promise<void>;
  markConfirmed(id: string, blockNumber: bigint, blockHash: string): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
}

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
```

The plan says the repository is "Prisma-backed CRUD for anchors". It touches the database (it's the repository layer).

The Prisma model from the schema would be `DocumentAnchor` (PascalCase class name for the table `document_anchors`). The fields would map to:
- `id` -> `id`
- `documentId` -> `document_id` (via @map)
- `version` -> `version`
- `contentHash` -> `content_hash` (via @map)
- `txId` -> `tx_id` (via @map)
- `signedTx` -> `signed_tx` (via @map)
- `status` -> `status`
- `blockNumber` -> `block_number` (via @map)
- `blockHash` -> `block_hash` (via @map)
- `failureReason` -> `failure_reason` (via @map)
- `createdAt` -> `created_at` (via @map)
- `updatedAt` -> `updated_at` (via @map)

Now, the repository needs to:
1. Import `PrismaClient` from `@prisma/client`
2. Define the `AnchorRow` interface
3. Implement all methods

For the Prisma model name, since the table is `document_anchors` and the convention is PascalCase for classes, the Prisma model would be `DocumentAnchor`. The prisma client property would be `prisma.documentAnchor`.

Let me think about the `create` method. It should insert a new row with status defaulting to `pending`. Looking at the plan, the create data doesn't include `status` - it defaults to `pending` in the schema.

For `markBroadcast`, it updates status to 'broadcast'.
For `markConfirmed`, it updates status to 'confirmed' and sets blockNumber and blockHash.
For `markFailed`, it updates status to 'failed' and sets failureReason.

The plan says "zero raw SQL, zero Prisma client calls" for the service layer, and the repository is "the only layer that touches the database." So the repository uses Prisma directly.

Let me also consider: the plan says `findPending(limit: number)` and `findBroadcast(limit: number)` - these query by status with a limit.

For the Prisma model, I need to assume the model name. The table is `document_anchors`, so the Prisma model (PascalCase) would be `DocumentAnchor`. The prisma client accessor would be `prisma.documentAnchor`.

Let me write the file:

```ts
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

export class AnchoringRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: {
    documentId: string;
    version: number;
    contentHash: string;
    txId: string;
    signedTx: string;
  }): Promise<AnchorRow> {
    return this.prisma.documentAnchor.create({
      data: {
        documentId: data.documentId,
        version: data.version,
        contentHash: data.contentHash,
        txId: data.txId,
        signedTx: data.signedTx,
      },
    });
  }

  async findById(id: string): Promise<AnchorRow | null> {
    return this.prisma.documentAnchor.findUnique({ where: { id } });
  }

  async findByDocumentAndVersion(documentId: string, version: number): Promise<AnchorRow | null> {
    return this.prisma.documentAnchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
  }

  async findPending(limit: number): Promise<AnchorRow[]> {
    return this.prisma.documentAnchor.findMany({
      where: { status: 'pending' },
      take: limit,
    });
  }

  async findBroadcast(limit: number): Promise<AnchorRow[]> {
    return this.prisma.documentAnchor.findMany({
      where: { status: 'broadcast' },
      take: limit,
    });
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

Wait, I need to think about the `documentId_version` composite key. In Prisma, when you have `@@unique([documentId, version])`, the generated composite key name is `documentId_version`. That's the default naming convention.

Actually, let me reconsider. The plan says `@@unique([documentId, version])`. In Prisma, the default name for a composite unique constraint on fields `documentId` and `version` would be `documentId_version`. So the where clause would use `documentId_version: { documentId, version }`.

This looks correct. Let me also make sure I'm not adding anything the plan doesn't specify. The plan names:
- `AnchoringRepository` class with the exact methods listed
- `AnchorRow` interface with the exact fields listed

I think this is complete. Let me also check: should I import `Prisma` for error handling? No, the plan says the repository just does CRUD. The error filter handles `Prisma.PrismaClientKnownRequestError` in the controller layer.

One thing: the plan says the file "reads: src/anchoring/chain-client.interface.ts" - but looking at the actual code, the repository doesn't need any types from chain-client.interface.ts. The `AnchorRow` type is self-contained. The chain-client interface has `ChainReceipt`, `PreparedTx`, `ChainClient`, `BroadcastTimeoutError` - none of which are needed in the repository.

Wait, let me re-read the manifest: "src/anchoring/anchoring.repository.ts | reads: src/anchoring/chain-client.interface.ts | Prisma-backed CRUD for anchors, AnchorRow type"

Hmm, maybe the plan intended for the repository to import something from chain-client? But looking at the actual code, I don't see why. The AnchorRow type is fully defined in the repository file itself. Maybe it's a mistake in the plan, or maybe it was originally intended to share a type. I'll follow what makes sense: the repository file is self-contained with its own `AnchorRow` interface and only needs `PrismaClient`.

Actually, I won't import from chain-client.interface.ts since nothing in the repository's API references types from there. The plan's manifest might just be noting a potential dependency that isn't actually used. I'll keep it clean.

Let me finalize the file.
```

## reply

```ts
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

export class AnchoringRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: {
    documentId: string;
    version: number;
    contentHash: string;
    txId: string;
    signedTx: string;
  }): Promise<AnchorRow> {
    return this.prisma.documentAnchor.create({
      data: {
        documentId: data.documentId,
        version: data.version,
        contentHash: data.contentHash,
        txId: data.txId,
        signedTx: data.signedTx,
      },
    });
  }

  async findById(id: string): Promise<AnchorRow | null> {
    return this.prisma.documentAnchor.findUnique({ where: { id } });
  }

  async findByDocumentAndVersion(documentId: string, version: number): Promise<AnchorRow | null> {
    return this.prisma.documentAnchor.findUnique({
      where: { documentId_version: { documentId, version } },
    });
  }

  async findPending(limit: number): Promise<AnchorRow[]> {
    return this.prisma.documentAnchor.findMany({
      where: { status: 'pending' },
      take: limit,
    });
  }

  async findBroadcast(limit: number): Promise<AnchorRow[]> {
    return this.prisma.documentAnchor.findMany({
      where: { status: 'broadcast' },
      take: limit,
    });
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
