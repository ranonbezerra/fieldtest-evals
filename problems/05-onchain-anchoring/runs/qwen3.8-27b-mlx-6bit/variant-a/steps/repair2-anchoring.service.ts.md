# repair2-anchoring.service.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/anchoring/anchoring.service.ts`:

```
src/anchoring/anchoring.service.ts(2,52): error TS2307: Cannot find module './chain-client.interface' or its corresponding type declarations.
src/anchoring/anchoring.service.ts(3,48): error TS2307: Cannot find module './anchoring.repository' or its corresponding type declarations.
```

These are the only two errors that name `anchoring.service.ts`. The errors say the modules `./chain-client.interface` and `./anchoring.repository` cannot be found.

Now, the task says "Change nothing the messages do not name." So I need to fix only what these two errors require.

The errors are TS2307 - "Cannot find module". This means the import paths on lines 2 and 3 of `anchoring.service.ts` point to modules that don't exist at those paths.

Looking at the plan, the files should be:
- `src/anchoring/chain-client.interface.ts`
- `src/anchoring/anchoring.repository.ts`

The other files also reference these same modules and get the same error, which suggests these files simply don't exist yet. But the task says "Rewrite `src/anchoring/anchoring.service.ts` complete, fixing what these messages require of this file."

So the task is specifically about fixing `anchoring.service.ts`. The errors on that file are about not being able to find the imported modules. Since I can only change `anchoring.service.ts`, and the issue is that the modules don't exist...

Wait, let me re-read the task. "Rewrite `src/anchoring/anchoring.service.ts` complete, fixing what these messages require of this file."

The messages require that the imports resolve. Since I can only modify `anchoring.service.ts`, and the modules don't exist... 

Actually, looking more carefully at the problem - ALL files are getting "Cannot find module" errors for each other. This suggests that perhaps none of the files actually exist yet, or they exist but are empty/broken. The task is asking me to write `anchoring.service.ts` such that it compiles correctly.

But if `chain-client.interface.ts` and `anchoring.repository.ts` don't exist, then no amount of rewriting `anchoring.service.ts` will fix the "Cannot find module" error unless I change the import paths.

Wait - let me reconsider. The task says "fixing what these messages require of this file." Maybe the files DO exist but have issues, or maybe the import paths are wrong in `anchoring.service.ts`.

Actually, I think the most likely scenario is: the files exist (or will exist) at the correct paths as specified in the plan, and the issue is simply that `anchoring.service.ts` needs to be written correctly with proper imports from those paths. The "Cannot find module" errors might be because the files are currently empty or don't exist yet, but the task is just asking me to write `anchoring.service.ts` correctly.

Given that the task says "Change nothing the messages do not name" and only two lines in `anchoring.service.ts` are named (lines 2 and 3), I should write the complete file with correct imports from `./chain-client.interface` and `./anchoring.repository`.

Let me write the complete `anchoring.service.ts` based on the plan:

From the plan:
- `canonicalize(content)` - recursive alphabetical key sort, compact JSON, UTF-8, SHA-256, lowercase hex
- `AnchoringService` with constructor taking `AnchoringRepository` and `ChainClient`
- Methods: `anchorDocument`, `verify`, `resolvePending`, `confirmBroadcast`
- `AnchoringError` with a `code` field
- `AnchorResult` and `VerifyResult` interfaces

Let me write this:

```typescript
import { ChainClient, PreparedTx, ChainReceipt, BroadcastTimeoutError } from './chain-client.interface';
import { AnchoringRepository, AnchorRow } from './anchoring.repository';
import * as crypto from 'node:crypto';

export class AnchoringError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AnchoringError';
  }
}

export interface AnchorResult {
  anchorId: string;
  txId: string;
  status: 'pending' | 'broadcast';
}

export interface VerifyResult {
  match: boolean;
  contentHash: string;
  anchoredHash: string | null;
  txId: string | null;
  blockNumber: bigint | null;
  blockHash: string | null;
}

function canonicalizeObject(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeObject);
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = canonicalizeObject(record[key]);
  }
  return sorted;
}

export function canonicalize(content: Record<string, unknown>): string {
  const normalized = canonicalizeObject(content);
  const json = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(json, 'utf8').digest('hex');
}

export class AnchoringService {
  constructor(
    private readonly repo: AnchoringRepository,
    private readonly chain: ChainClient,
  ) {}

  async anchorDocument(
    documentId: string,
    version: number,
    content: Record<string, unknown>,
  ): Promise<AnchorResult> {
    const contentHash = canonicalize(content);

    // Step 1: Prepare the transaction (no DB access)
    const prepared: PreparedTx = await this.chain.prepare(contentHash);

    // Step 2: Persist the anchor intent BEFORE broadcasting
    const row = await this.repo.create({
      documentId,
      version,
      contentHash,
      txId: prepared.txId,
      signedTx: prepared.signedTx,
    });

    // Step 3: Broadcast
    try {
      await this.chain.broadcast(prepared.signedTx);
      await this.repo.markBroadcast(row.id);
      return { anchorId: row.id, txId: prepared.txId, status: 'broadcast' };
    } catch (err) {
      if (err instanceof BroadcastTimeoutError) {
        // Leave as pending; recovery sweep will handle it
        return { anchorId: row.id, txId: prepared.txId, status: 'pending' };
      }
      await this.repo.markFailed(row.id, err instanceof Error ? err.message : String(err));
      throw new AnchoringError('broadcast_failed', 'Broadcast to chain failed');
    }
  }

  async verify(
    documentId: string,
    version: number,
    content: Record<string, unknown>,
  ): Promise<VerifyResult> {
    const anchor = await this.repo.findByDocumentAndVersion(documentId, version);
    if (!anchor) {
      throw new AnchoringError('resource_not_found', `No anchor found for document ${documentId} version ${version}`);
    }

    const submittedHash = canonicalize(content);
    return {
      match: submittedHash === anchor.contentHash,
      contentHash: submittedHash,
      anchoredHash: anchor.contentHash,
      txId: anchor.txId,
      blockNumber: anchor.blockNumber,
      blockHash: anchor.blockHash,
    };
  }

  async resolvePending(anchor: AnchorRow): Promise<void> {
    // Query the chain first to check if the tx was already broadcast
    const receipt = await this.chain.getReceipt(anchor.txId);

    if (receipt !== null) {
      if (receipt.status === 'success') {
        await this.repo.markConfirmed(anchor.id, receipt.blockNumber, receipt.blockHash);
      } else {
        await this.repo.markFailed(anchor.id, 'on-chain failure');
      }
      return;
    }

    // No receipt — tx may never have been broadcast. Re-broadcast.
    try {
      await this.chain.broadcast(anchor.signedTx);
      await this.repo.markBroadcast(anchor.id);
    } catch (err) {
      if (err instanceof BroadcastTimeoutError) {
        // Leave as pending; will be retried next tick
        return;
      }
      await this.repo.markFailed(anchor.id, err instanceof Error ? err.message : String(err));
    }
  }

  async confirmBroadcast(anchor: AnchorRow): Promise<void> {
    const receipt = await this.chain.getReceipt(anchor.txId);
    if (receipt === null) {
      return; // Will be retried next tick
    }

    if (receipt.status === 'success') {
      await this.repo.markConfirmed(anchor.id, receipt.blockNumber, receipt.blockHash);
    } else {
      await this.repo.markFailed(anchor.id, 'on-chain failure');
    }
  }
}
```

Wait, I need to also handle the `duplicate_anchor` error. The plan says:

| Code | Raised when |
|---|---|
| `duplicate_anchor` | unique constraint violation on `(documentId, version)` in `anchorDocument` |

This would be a Prisma P2002 error. The plan says the error filter handles this by catching `Prisma.PrismaClientKnownRequestError` with code P2002. So the service doesn't need to explicitly throw `duplicate_anchor` - it would be thrown by Prisma and caught by the filter.

Actually, looking at the plan more carefully: "Errors raised by the service (all thrown as a custom AnchoringError with a code field)" - and `duplicate_anchor` is listed. But the plan also says the filter catches `Prisma.PrismaClientKnownRequestError` (code P2002). So maybe the service should catch the Prisma error and re-throw as AnchoringError? Or maybe the filter handles it directly?

The plan says: "`AnchoringErrorFilter` catches `AnchoringError` and `Prisma.PrismaClientKnownRequestError` (code P2002) and maps to..."

So the filter handles both. The service doesn't need to explicitly catch P2002 - it'll bubble up and the filter will handle it. That's fine.

Let me also check: the plan says `AnchoringError` is thrown by the service. The filter catches it. For `duplicate_anchor`, the Prisma error bubbles up and the filter catches P2002 directly. That makes sense.

Now, about the import paths - the errors say lines 2 and 3 can't find the modules. The plan specifies:
- Line 1 would be something (maybe an import from node:crypto or similar)
- Line 2: `import { ... } from './chain-client.interface'`
- Line 3: `import { ... } from './anchoring.repository'`

This matches what I have. The "Cannot find module" errors are because those files don't exist yet (or are empty). But the task is just to write `anchoring.service.ts` correctly. If those files exist with the correct exports, this file will compile.

I think my solution is correct. Let me finalize it.
```

## reply

```typescript
import { ChainClient, BroadcastTimeoutError } from './chain-client.interface';
import { AnchoringRepository, AnchorRow } from './anchoring.repository';
import * as crypto from 'node:crypto';

export class AnchoringError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AnchoringError';
  }
}

export interface AnchorResult {
  anchorId: string;
  txId: string;
  status: 'pending' | 'broadcast';
}

export interface VerifyResult {
  match: boolean;
  contentHash: string;
  anchoredHash: string | null;
  txId: string | null;
  blockNumber: bigint | null;
  blockHash: string | null;
}

function canonicalizeObject(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeObject);
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = canonicalizeObject(record[key]);
  }
  return sorted;
}

export function canonicalize(content: Record<string, unknown>): string {
  const normalized = canonicalizeObject(content);
  const json = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(json, 'utf8').digest('hex');
}

export class AnchoringService {
  constructor(
    private readonly repo: AnchoringRepository,
    private readonly chain: ChainClient,
  ) {}

  async anchorDocument(
    documentId: string,
    version: number,
    content: Record<string, unknown>,
  ): Promise<AnchorResult> {
    const contentHash = canonicalize(content);

    // Prepare the transaction (no DB access)
    const prepared = await this.chain.prepare(contentHash);

    // Persist the anchor intent BEFORE broadcasting
    const row = await this.repo.create({
      documentId,
      version,
      contentHash,
      txId: prepared.txId,
      signedTx: prepared.signedTx,
    });

    // Broadcast
    try {
      await this.chain.broadcast(prepared.signedTx);
      await this.repo.markBroadcast(row.id);
      return { anchorId: row.id, txId: prepared.txId, status: 'broadcast' };
    } catch (err) {
      if (err instanceof BroadcastTimeoutError) {
        // Leave as pending; recovery sweep will handle it
        return { anchorId: row.id, txId: prepared.txId, status: 'pending' };
      }
      await this.repo.markFailed(row.id, err instanceof Error ? err.message : String(err));
      throw new AnchoringError('broadcast_failed', 'Broadcast to chain failed');
    }
  }

  async verify(
    documentId: string,
    version: number,
    content: Record<string, unknown>,
  ): Promise<VerifyResult> {
    const anchor = await this.repo.findByDocumentAndVersion(documentId, version);
    if (!anchor) {
      throw new AnchoringError(
        'resource_not_found',
        `No anchor found for document ${documentId} version ${version}`,
      );
    }

    const submittedHash = canonicalize(content);
    return {
      match: submittedHash === anchor.contentHash,
      contentHash: submittedHash,
      anchoredHash: anchor.contentHash,
      txId: anchor.txId,
      blockNumber: anchor.blockNumber,
      blockHash: anchor.blockHash,
    };
  }

  async resolvePending(anchor: AnchorRow): Promise<void> {
    // Query the chain first to check if the tx was already broadcast
    const receipt = await this.chain.getReceipt(anchor.txId);

    if (receipt !== null) {
      if (receipt.status === 'success') {
        await this.repo.markConfirmed(anchor.id, receipt.blockNumber, receipt.blockHash);
      } else {
        await this.repo.markFailed(anchor.id, 'on-chain failure');
      }
      return;
    }

    // No receipt — tx may never have been broadcast. Re-broadcast.
    try {
      await this.chain.broadcast(anchor.signedTx);
      await this.repo.markBroadcast(anchor.id);
    } catch (err) {
      if (err instanceof BroadcastTimeoutError) {
        // Leave as pending; will be retried next tick
        return;
      }
      await this.repo.markFailed(anchor.id, err instanceof Error ? err.message : String(err));
    }
  }

  async confirmBroadcast(anchor: AnchorRow): Promise<void> {
    const receipt = await this.chain.getReceipt(anchor.txId);
    if (receipt === null) {
      // Will be retried next tick
      return;
    }

    if (receipt.status === 'success') {
      await this.repo.markConfirmed(anchor.id, receipt.blockNumber, receipt.blockHash);
    } else {
      await this.repo.markFailed(anchor.id, 'on-chain failure');
    }
  }
}
```
