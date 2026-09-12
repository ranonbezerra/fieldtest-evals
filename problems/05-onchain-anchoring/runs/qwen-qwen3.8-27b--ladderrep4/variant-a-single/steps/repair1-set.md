# repair1-set

## reasoning

```
Let me analyze the errors:

1. `src/anchoring/anchoring.repository.ts(2,32)`: `PrismaClientKnownRequestError` is not exported from `@prisma/client`. In newer versions of Prisma, it's exported from `@prisma/client/runtime/library` or `@prisma/client/runtime`. Actually, looking at this more carefully, in Prisma 5+, `PrismaClientKnownRequestError` is still available from `@prisma/client`. But in some versions/configurations, it might be from `@prisma/client/runtime/library`. Let me think about what's correct here.

Actually, in Prisma, `PrismaClientKnownRequestError` is exported from `@prisma/client`. But in some versions (particularly with the new Prisma Client generator or certain ESM configurations), it might not be directly available. The alternative is to use `Prisma.PrismaClientKnownRequestError` which is always available as a property of the `Prisma` namespace.

So the fix is to import `Prisma` (which is already imported) and use `Prisma.PrismaClientKnownRequestError` instead of the direct import.

2. `src/anchoring/anchoring.repository.ts(75,60)`: `'error' is of type 'unknown'`. This is the `error` in the catch block of `createVersion`. In TypeScript strict mode, catch variables are `unknown` by default (with `useUnknownInCatchVariables`). The code does `if (isUniqueViolation(error))` which should work since `isUniqueViolation` takes `unknown`. Wait, let me re-read the error. Line 75, column 60. Let me count the lines...

Actually wait, looking at the code more carefully:

```typescript
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
```

The `isUniqueViolation` function takes `unknown`, so passing `error` (which is `unknown`) should be fine. But wait - the error is at line 75, column 60. Let me think about what's on that line.

Actually, I need to recount. The file starts with imports. Let me count more carefully...

Actually, the error says `'error' is of type 'unknown'` at line 75, column 60. This might be in the `createAnchor` method where `error.code` is accessed. Wait no, `isUniqueViolation` uses `instanceof` check which should work with `unknown`.

Hmm, let me reconsider. The `isUniqueViolation` function is:
```typescript
function isUniqueViolation(error: unknown): boolean {
  return error instanceof PrismaClientKnownRequestError && error.code === 'P2002';
}
```

If `PrismaClientKnownRequestError` import fails (error 1), then the `instanceof` check would fail type-checking because the type doesn't exist. But that's error 1's problem.

Wait, actually if we fix error 1 by using `Prisma.PrismaClientKnownRequestError`, then `isUniqueViolation` would work fine with `unknown`.

But the error at line 75 col 60 is a separate issue. Let me think about what's at that position. If I count lines in the file:

Line 1: `import { Injectable } from '@nestjs/common';`
Line 2: `import { AnchorStatus, Prisma, PrismaClientKnownRequestError } from '@prisma/client';`
Line 3: `import { PrismaService } from '../prisma/prisma.service.js';`
Line 4: `import { anchorConflictError, documentVersionConflictError } from '../common/domain-exception.js';`
Line 5: (empty)
Line 6: `/** Anchor lifecycle states... */`
Line 7: `export type AnchorState = ...`
Line 8: (empty)
Line 9: `export interface ChainReceiptRecord {`
Line 10: `  txId: string;`
Line 11: `  blockNumber: number;`
Line 12: `  blockHash: string;`
Line 13: `  status: 'success' | 'failure';`
Line 14: `}`
Line 15: (empty)
Line 16: `export interface StoredVersion {`
Line 17: `  id: string;`
Line 18: `  documentId: string;`
Line 19: `  version: number;`
Line 20: `  content: unknown;`
Line 21: `  createdAt: Date;`
Line 22: `}`
Line 23: (empty)
Line 24: `export interface StoredAnchor {`
Line 25: `  id: string;`
Line 26: `  documentId: string;`
Line 27: `  version: number;`
Line 28: `  status: AnchorState;`
Line 29: `  contentHash: string;`
Line 30: `  txId: string;`
Line 31: `  signedTx: string;`
Line 32: `  blockNumber: number | null;`
Line 33: `  receipt: ChainReceiptRecord | null;`
Line 34: `  broadcastAttempts: number;`
Line 35: `  createdAt: Date;`
Line 36: `  updatedAt: Date;`
Line 37: `}`
Line 38: (empty)
Line 39: `const TO_DB: Record<AnchorState, AnchorStatus> = {`
Line 40: `  prepared: AnchorStatus.PREPARED,`
Line 41: `  broadcast_sent: AnchorStatus.BROADCAST_SENT,`
Line 42: `  broadcast_unknown: AnchorStatus.BROADCAST_UNKNOWN,`
Line 43: `  confirmed: AnchorStatus.CONFIRMED,`
Line 44: `  failed: AnchorStatus.FAILED,`
Line 45: `};`
Line 46: (empty)
Line 47: `const TO_STATE: Record<AnchorStatus, AnchorState> = {`
Line 48: `  [AnchorStatus.PREPARED]: 'prepared',`
Line 49: `  [AnchorStatus.BROADCAST_SENT]: 'broadcast_sent',`
Line 50: `  [AnchorStatus.BROADCAST_UNKNOWN]: 'broadcast_unknown',`
Line 51: `  [AnchorStatus.CONFIRMED]: 'confirmed',`
Line 52: `  [AnchorStatus.FAILED]: 'failed',`
Line 53: `};`
Line 54: (empty)
Line 55: `type AnchorRow = Prisma.AnchorGetPayload<{}>;`
Line 56: (empty)
Line 57: `function toStoredAnchor(row: AnchorRow): StoredAnchor {`
Line 58: `  return {`
Line 59: `    id: row.id,`
Line 60: `    documentId: row.documentId,`
Line 61: `    version: row.version,`
Line 62: `    status: TO_STATE[row.status],`
Line 63: `    contentHash: row.contentHash,`
Line 64: `    txId: row.txId,`
Line 65: `    signedTx: row.signedTx,`
Line 66: `    blockNumber: row.blockNumber === null ? null : Number(row.blockNumber),`
Line 67: `    receipt: (row.receipt ?? null) as ChainReceiptRecord | null,`
Line 68: `    broadcastAttempts: row.broadcastAttempts,`
Line 69: `    createdAt: row.createdAt,`
Line 70: `    updatedAt: row.updatedAt,`
Line 71: `  };`
Line 72: `}`
Line 73: (empty)
Line 74: `function isUniqueViolation(error: unknown): boolean {`
Line 75: `  return error instanceof PrismaClientKnownRequestError && error.code === 'P2002';`
Line 76: `}`

So line 75 is `return error instanceof PrismaClientKnownRequestError && error.code === 'P2002';`

The error is at column 60, which would be around `error.code`. The issue is that `error` is `unknown`, and even after the `instanceof` check, TypeScript might not narrow it properly if `PrismaClientKnownRequestError` is not properly imported (because of error 1). 

Actually wait - if `PrismaClientKnownRequestError` is not a valid export, then the `instanceof` expression itself is an error (error 1 covers the import). But the type narrowing from `instanceof` requires the right-hand side to be a constructor. If the import fails, the type system can't use it for narrowing, so `error.code` on line 75 would fail because `error` is still `unknown`.

So if I fix error 1 (use `Prisma.PrismaClientKnownRequestError`), then error 2 should also be fixed because `instanceof Prisma.PrismaClientKnownRequestError` will properly narrow the type.

Wait, but `Prisma.PrismaClientKnownRequestError` - is that valid? In Prisma, the `Prisma` namespace does export `PrismaClientKnownRequestError`. Let me check: yes, `Prisma.PrismaClientKnownRequestError` is the standard way to access it in many Prisma versions, especially when the direct export might not work with certain ESM configurations.

Actually, looking at this more carefully - in Prisma 5.x with the `prisma-client-js` generator, `PrismaClientKnownRequestError` IS exported from `@prisma/client` directly. But there might be version-specific issues.

The safest fix that works across versions is to use `Prisma.PrismaClientKnownRequestError` since `Prisma` is already imported and is definitely available.

3. `src/anchoring/anchoring.repository.ts(166,53)`: Conversion of `ChainReceiptRecord` to `InputJsonValue`. The issue is that `ChainReceiptRecord` is an interface, and TypeScript doesn't allow direct conversion of an interface to `InputJsonValue` because interfaces don't have index signatures. The fix is to cast through `unknown` first: `extra.receipt as unknown as Prisma.InputJsonValue`.

4. `src/anchoring/anchoring.worker.ts(45,10)`: Cannot assign to 'timers' because it is a read-only property. The line is `this.timers = [];` in `onModuleDestroy`. The fix is to use `this.timers.length = 0` or `this.timers.splice(0)` instead of reassigning.

Wait, let me look at the worker code again:
```typescript
private readonly timers: NodeJS.Timeout[] = [];
```

It's declared as `readonly`, so you can't reassign it. The fix in `onModuleDestroy` is to clear it without reassignment:
```typescript
onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
}
```

Now let me summarize the distinct mistakes:

1. **Import error**: `PrismaClientKnownRequestError` not directly exported from `@prisma/client`. Fix: use `Prisma.PrismaClientKnownRequestError` instead. This affects the import line and the usage in `isUniqueViolation`. This also fixes error 2 (the `unknown` type error) because proper narrowing will work.

2. **Type conversion**: `ChainReceiptRecord` can't be cast directly to `Prisma.InputJsonValue`. Fix: cast through `unknown`.

3. **Readonly assignment**: `this.timers = []` on a readonly property. Fix: use `this.timers.length = 0`.

So I need to change two files:
- `src/anchoring/anchoring.repository.ts` (errors 1, 2, 3)
- `src/anchoring/anchoring.worker.ts` (error 4)

Let me write the fixed files.

For `anchoring.repository.ts`:
- Remove `PrismaClientKnownRequestError` from the import (keep `AnchorStatus` and `Prisma`)
- Change `isUniqueViolation` to use `Prisma.PrismaClientKnownRequestError`
- Change the receipt cast to go through `unknown`

For `anchoring.worker.ts`:
- Change `this.timers = []` to `this.timers.length = 0`

Let me write out the complete files.
```

## reply

Looking at the four errors, I see three distinct mistakes:

1. **`PrismaClientKnownRequestError` not directly exported** — use `Prisma.PrismaClientKnownRequestError` instead. This also resolves the `unknown` narrowing error on line 75 (the `instanceof` check can't narrow without a valid constructor).
2. **`ChainReceiptRecord` → `InputJsonValue` cast** — needs to go through `unknown` because an interface lacks the required index signature.
3. **Assignment to `readonly timers`** — use `.length = 0` instead of reassignment.

### src/anchoring/anchoring.repository.ts
```ts
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
```

### src/anchoring/anchoring.worker.ts
```ts
import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ANCHORING_CONFIG, type AnchoringConfig } from './anchoring.config.js';
import { CHAIN_CLIENT, type ChainClient } from './chain-client.js';
import { AnchoringRepository } from './anchoring.repository.js';
import { attemptBroadcast } from './broadcast.js';

const PAGE_SIZE = 100;
const LIMBO_STATES = ['prepared', 'broadcast_unknown'] as const;

/**
 * Confirmation worker + recovery sweep.
 *
 * Confirmation: `broadcast_sent` anchors are polled for a receipt and advanced
 * to `confirmed`/`failed`. Confirmation always comes from a receipt, never
 * from broadcast() returning.
 *
 * Recovery: anchors stuck in broadcast-limbo (`prepared`, `broadcast_unknown`)
 * are resolved by querying the chain FIRST. If a receipt exists, the anchor is
 * confirmed from it — no re-broadcast. Only when the chain has no trace is the
 * SAME signed tx re-broadcast (never a new one, so a re-send cannot become a
 * second anchor).
 */
@Injectable()
export class AnchoringWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AnchoringWorker.name);
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly repo: AnchoringRepository,
    @Inject(CHAIN_CLIENT) private readonly chain: ChainClient,
    @Inject(ANCHORING_CONFIG) private readonly config: AnchoringConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.confirmationPollMs > 0) {
      this.timers.push(setInterval(() => void this.runConfirmationPass(), this.config.confirmationPollMs));
    }
    if (this.config.recoverySweepMs > 0) {
      this.timers.push(setInterval(() => void this.runRecoveryPass(), this.config.recoverySweepMs));
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }

  /** One confirmation pass: poll receipts and advance broadcast-sent anchors. */
  async runConfirmationPass(): Promise<void> {
    const rows = await this.repo.listByStatuses(['broadcast_sent'], PAGE_SIZE);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (!receipt) continue;
      const advanced = await this.repo.transition(
        row.id,
        ['broadcast_sent'],
        receipt.status === 'success' ? 'confirmed' : 'failed',
        { blockNumber: receipt.blockNumber, receipt },
      );
      if (advanced) {
        this.logger.log(`anchor ${row.id} ${receipt.status === 'success' ? 'confirmed' : 'failed'} at block ${receipt.blockNumber}`);
      }
    }
  }

  /** One recovery pass: resolve anchors stuck in broadcast-limbo, chain first. */
  async runRecoveryPass(): Promise<void> {
    const stuckBefore = new Date(Date.now() - this.config.stuckAfterMs);
    const rows = await this.repo.listStuck([...LIMBO_STATES], stuckBefore, PAGE_SIZE);
    for (const row of rows) {
      const receipt = await this.chain.getReceipt(row.txId);
      if (receipt) {
        // The tx landed (e.g. despite a broadcast timeout): confirm from the
        // receipt. Never re-broadcast.
        const advanced = await this.repo.transition(
          row.id,
          [...LIMBO_STATES],
          receipt.status === 'success' ? 'confirmed' : 'failed',
          { blockNumber: receipt.blockNumber, receipt },
        );
        if (advanced) this.logger.log(`recovered anchor ${row.id} from chain receipt, block ${receipt.blockNumber}`);
        continue;
      }
      // No trace on chain: re-broadcast the same signed transaction. (If two
      // workers race, the chain deduplicates by tx identity — one anchor.)
      const outcome = await attemptBroadcast(this.chain, row.signedTx, this.config.broadcastTimeoutMs);
      const advanced = await this.repo.transition(
        row.id,
        [...LIMBO_STATES],
        outcome === 'sent' ? 'broadcast_sent' : 'broadcast_unknown',
        { incrementBroadcastAttempts: true },
      );
      if (advanced) this.logger.log(`re-broadcast signed tx of anchor ${row.id} (no trace on chain)`);
    }
  }
}
```
