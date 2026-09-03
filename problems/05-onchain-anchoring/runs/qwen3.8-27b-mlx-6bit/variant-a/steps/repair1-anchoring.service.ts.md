# repair1-anchoring.service.ts

## reasoning

```
Let me analyze the compiler errors carefully:

1. `src/anchoring/anchoring.repository.ts` errors (lines 44, 50, 57): The `toAnchorRow` function's parameter type has `status: string`, but the return type is `AnchorRow` which requires `status: 'pending' | 'broadcast' | 'confirmed' | 'failed'`. The function does a cast internally, but the issue is that the input type to `toAnchorRow` declares `status: string`, and when spreading `{ ...row, status }`, TypeScript is complaining about the assignment at the call sites.

Wait, looking more carefully at the errors:
- Line 44 (findById): `row ? toAnchorRow(row) : null` - the issue is that Prisma returns `status: string` but `toAnchorRow` expects `status: string` in its parameter... Actually wait, the error says the return type of `toAnchorRow` is not assignable to `AnchorRow`. But `toAnchorRow` returns `AnchorRow`...

Let me re-read. The error at line 44 says:
```
Type '{ documentId: string; version: number; id: string; contentHash: string; txId: string; signedTx: string; status: string; blockNumber: bigint | null; blockHash: string | null; failureReason: string | null; createdAt: Date; updatedAt: Date; } | null' is not assignable to type 'AnchorRow | null'.
```

So `toAnchorRow(row)` is returning the wrong type? No wait - the error says the expression `row ? toAnchorRow(row) : null` has type `{...status: string...} | null`. That means TypeScript is not recognizing `toAnchorRow`'s return type as `AnchorRow`.

Actually, I think the issue is different. The `toAnchorRow` function takes a parameter with `status: string`, and the spread `{ ...row, status }` where `status` is the validated value - TypeScript should see this as returning `AnchorRow`. But wait, `{ ...row, status }` where `row` has `status: string` and we override with `status: AnchorStatus`... the resulting type should have `status: AnchorStatus`.

Hmm, but the actual error messages point to lines in `anchoring.repository.ts`, not `anchoring.service.ts`. The task says "Rewrite `src/anchoring/anchoring.service.ts` complete, fixing what these messages require of this file."

Wait, but the errors in `anchoring.repository.ts` are about the repository file itself. The task says to fix only `anchoring.service.ts`. But the errors in the repository file are about type incompatibility within that file...

Let me re-read the task: "Rewrite `src/anchoring/anchoring.service.ts` complete, fixing what these messages require of this file."

So I should ONLY rewrite `anchoring.service.ts`. The errors in other files are context - they tell me what the overall compilation state is. But I'm only asked to fix `anchoring.service.ts`.

Now, what errors are specifically in `anchoring.service.ts`?

```
src/anchoring/anchoring.service.ts(2,52): error TS2307: Cannot find module './chain-client.interface' or its corresponding type declarations.
src/anchoring/anchoring.service.ts(3,48): error TS2307: Cannot find module './anchoring.repository' or its corresponding type declarations.
```

These are "Cannot find module" errors. This means the imports in `anchoring.service.ts` are referencing modules that either don't exist or can't be found.

Looking at the imports:
- Line 2, column 52: `./chain-client.interface` - this file should exist at `src/anchoring/chain-client.interface.ts`
- Line 3, column 48: `./anchoring.repository` - this file exists (we can see it in the reference)

Wait, but `anchoring.repository.ts` IS shown as existing in the reference. So why can't it be found? 

Oh! The issue might be that `anchoring.repository.ts` itself has compilation errors, which could cascade. But "Cannot find module" (TS2307) specifically means the module resolution failed - the file isn't found at that path.

Hmm, but we're told to only fix `anchoring.service.ts`. The "Cannot find module" errors for `./chain-client.interface` and `./anchoring.repository` suggest these files might not exist yet (they're planned but not created). 

Wait, looking at the reference material again - `src/anchoring/anchoring.repository.ts` IS shown as existing. And the errors reference it at specific line numbers. So it exists but has type errors.

For `./chain-client.interface` - there's no reference to this file in the provided material. It's listed in the plan and manifest but not shown.

So the situation is:
1. `anchoring.service.ts` exists but can't find its dependencies (TS2307)
2. `anchoring.repository.ts` exists but has type errors (TS2322)
3. Other files (`chain-client.interface.ts`, `anchoring.module.ts`, `anchor-worker.service.ts`) don't exist yet

The task says: "Rewrite `src/anchoring/anchoring.service.ts` complete, fixing what these messages require of this file."

The errors that are "of this file" (anchoring.service.ts) are the TS2307 module resolution errors. To fix these, I need to write the service file with correct imports that will resolve once the other files exist.

But wait - if I just write the file with the same imports, it'll still have TS2307 errors because the modules don't exist. Unless... the task is asking me to write the file correctly assuming all other files will be in place.

Actually, re-reading more carefully: "fixing what these messages require of this file" - the messages say the module can't be found. The fix for THIS file is to ensure it imports from the correct paths. If the other files are supposed to exist (per the plan), then the imports should be correct and the TS2307 will resolve once those files are created.

But actually, I think the real issue might be different. Let me reconsider.

The task says the file "does not compile" and gives all compiler messages for the whole workspace. It asks me to rewrite `anchoring.service.ts` fixing "what these messages require of this file."

The TS2307 errors on lines 2 and 3 of `anchoring.service.ts` mean the imports are wrong or the files don't exist. Since I'm told to fix only this file, and the plan specifies these modules should exist at those paths, I should write the file with the correct imports as specified in the plan.

The TS2322 errors in `anchoring.repository.ts` are NOT in my file to fix. The TS2307 errors in `app.module.ts` and `test/anchoring.spec.ts` are also not my file to fix.

So my job is: write `src/anchoring/anchoring.service.ts` that:
1. Has correct imports from `./chain-client.interface` and `./anchoring.repository` (as per the plan)
2. Implements everything the plan specifies for this file
3. Will compile correctly once its dependencies exist

Let me also consider: maybe the TS2307 errors are because the current `anchoring.service.ts` has wrong import paths. Perhaps it's importing from wrong locations. By rewriting with correct paths, I fix the TS2307 "of this file."

Now let me write the complete `anchoring.service.ts` based on the plan:

From the plan:
- `canonicalize(content)` - recursive alphabetical key sort, compact JSON, UTF-8, SHA-256, lowercase hex
- `anchorDocument(documentId, version, content)` - compute hash, prepare, persist BEFORE broadcast, then broadcast
- `verify(documentId, version, content)` - recompute hash, compare, return proof or mismatch
- `resolvePending(anchor)` - query receipt first, then re-broadcast if needed
- `confirmBroadcast(anchor)` - query receipt, confirm or fail
- `AnchoringError` custom error class with `code` field

Let me think about the `AnchoringError` class. The plan says:
- `duplicate_anchor` - unique constraint violation
- `resource_not_found` - no anchor row in verify
- `broadcast_failed` - non-timeout broadcast error

The service needs to catch Prisma's P2002 error for duplicates. But wait - the service layer is supposed to have "Zero raw SQL, zero Prisma client calls." So how does the service catch a Prisma error?

Looking at the repository - it just calls prisma methods. If a unique constraint is violated, Prisma will throw a `PrismaClientKnownRequestError` with code `P2002`. This error would propagate up through the repository to the service. The service can catch it by checking the error type/code without making its own Prisma calls.

Actually, I need to think about this differently. The repository's `create` method will throw if the unique constraint is violated. The service can catch that error and re-throw as `AnchoringError`. But how does the service know it's a Prisma P2002 error without importing from `@prisma/client`?

Hmm, the plan says the service has "Zero raw SQL, zero Prisma client calls" - but catching an error that happens to be a Prisma error isn't a "Prisma client call." The service can check `error` properties without calling any Prisma methods.

Let me think about what the service needs:
- Import from `./chain-client.interface`: `ChainClient`, `PreparedTx`, `ChainReceipt`, `BroadcastTimeoutError`
- Import from `./anchoring.repository`: `AnchoringRepository`, `AnchorRow`

For the Prisma error detection, I'll need to check the error's properties. Prisma errors have a `code` property (like 'P2002'). I can check `(error as any).code === 'P2002'` without importing from `@prisma/client`.

Actually wait - looking at the plan's error filter section: "AnchoringErrorFilter catches AnchoringError and Prisma.PrismaClientKnownRequestError (code P2002)". So the plan envisions the controller-level filter handling Prisma errors directly, OR the service catching them and re-throwing.

But the plan also says the service raises `duplicate_anchor` for "unique constraint violation on (documentId, version) in anchorDocument". So the service should catch the Prisma error and convert it to `AnchoringError`.

Let me write this. I'll detect the Prisma P2002 error by checking the error object's properties without importing from `@prisma/client` (to keep the layer separation clean - we're not making Prisma calls, just inspecting an error that bubbled up).

Now for the `canonicalize` function:
- Recursive alphabetical key sort
- Compact JSON (no whitespace)
- UTF-8 encoding
- SHA-256 hash
- Lowercase 64-char hex

I'll use Node's `crypto` module for SHA-256.

Let me also think about the `bigint` handling. The plan uses `bigint` for block numbers. In the verify result, `blockNumber` is `bigint | null`.

Let me write the complete file now:

```typescript
import { createHash } from 'node:crypto';
import { ChainClient, BroadcastTimeoutError } from './chain-client.interface';
import { AnchoringRepository, AnchorRow } from './anchoring.repository';

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

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeJson(item));
    return `[${items.join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return `{${entries.join(',')}}`;
}

export function canonicalize(content: Record<string, unknown>): string {
  const canonical = canonicalizeJson(content);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
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
    const prepared = await this.chain.prepare(contentHash);

    let anchor: AnchorRow;
    try {
      anchor = await this.repo.create({
        documentId,
        version,
        contentHash,
        txId: prepared.txId,
        signedTx: prepared.signedTx,
      });
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        throw new AnchoringError('duplicate_anchor', `An anchor already exists for document ${documentId} version ${version}`);
      }
      throw err;
    }

    try {
      await this.chain.broadcast(prepared.signedTx);
      await this.repo.markBroadcast(anchor.id);
      return { anchorId: anchor.id, txId: anchor.txId, status: 'broadcast' };
    } catch (err) {
      if (err instanceof BroadcastTimeoutError) {
        return { anchorId: anchor.id, txId: anchor.txId, status: 'pending' };
      }
      await this.repo.markFailed(anchor.id, (err as Error).message);
      throw new AnchoringError('broadcast_failed', `Broadcast failed: ${(err as Error).message}`);
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
    const receipt = await this.chain.getReceipt(anchor.txId);

    if (receipt !== null) {
      if (receipt.status === 'success') {
        await this.repo.markConfirmed(anchor.id, receipt.blockNumber, receipt.blockHash);
      } else {
        await this.repo.markFailed(anchor.id, 'on-chain failure');
      }
      return;
    }

    // Receipt not found: tx may never have been broadcast or broadcast was lost.
    try {
      await this.chain.broadcast(anchor.signedTx);
      await this.repo.markBroadcast(anchor.id);
    } catch (err) {
      if (err instanceof BroadcastTimeoutError) {
        // Leave as pending; will be retried next tick.
        return;
      }
      await this.repo.markFailed(anchor.id, (err as Error).message);
    }
  }

  async confirmBroadcast(anchor: AnchorRow): Promise<void> {
    const receipt = await this.chain.getReceipt(anchor.txId);

    if (receipt === null) {
      return; // No receipt yet; retry next tick.
    }

    if (receipt.status === 'success') {
      await this.repo.markConfirmed(anchor.id, receipt.blockNumber, receipt.blockHash);
    } else {
      await this.repo.markFailed(anchor.id, 'on-chain failure');
    }
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return (
      err instanceof Error &&
      (err as { code?: string }).code === 'P2002'
    );
  }
}
```

Wait, I need to double-check the `BroadcastTimeoutError` import. The plan says it's defined in `chain-client.interface.ts`. Let me make sure I'm importing it correctly.

Also, looking at the error messages again - the TS2307 errors are on lines 2 and 3. This suggests the current file has imports on those lines that can't be resolved. My rewrite will have the correct imports (assuming the target files will exist per the plan).

Let me also reconsider: the task says "Change nothing the messages do not name." The messages that name `anchoring.service.ts` are only the two TS2307 errors. So I need to make sure my file's imports are correct. The rest of the file content should follow the plan.

I think my solution is correct. Let me finalize it.
```

## reply

```typescript
import { createHash } from 'node:crypto';
import { ChainClient, BroadcastTimeoutError } from './chain-client.interface';
import { AnchoringRepository, AnchorRow } from './anchoring.repository';

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

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeJson(item));
    return `[${items.join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return `{${entries.join(',')}}`;
}

export function canonicalize(content: Record<string, unknown>): string {
  const canonical = canonicalizeJson(content);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
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
    const prepared = await this.chain.prepare(contentHash);

    let anchor: AnchorRow;
    try {
      anchor = await this.repo.create({
        documentId,
        version,
        contentHash,
        txId: prepared.txId,
        signedTx: prepared.signedTx,
      });
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        throw new AnchoringError(
          'duplicate_anchor',
          `An anchor already exists for document ${documentId} version ${version}`,
        );
      }
      throw err;
    }

    try {
      await this.chain.broadcast(prepared.signedTx);
      await this.repo.markBroadcast(anchor.id);
      return { anchorId: anchor.id, txId: anchor.txId, status: 'broadcast' };
    } catch (err) {
      if (err instanceof BroadcastTimeoutError) {
        return { anchorId: anchor.id, txId: anchor.txId, status: 'pending' };
      }
      await this.repo.markFailed(anchor.id, (err as Error).message);
      throw new AnchoringError('broadcast_failed', `Broadcast failed: ${(err as Error).message}`);
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
    const receipt = await this.chain.getReceipt(anchor.txId);

    if (receipt !== null) {
      if (receipt.status === 'success') {
        await this.repo.markConfirmed(anchor.id, receipt.blockNumber, receipt.blockHash);
      } else {
        await this.repo.markFailed(anchor.id, 'on-chain failure');
      }
      return;
    }

    // Receipt not found: tx may never have been broadcast or the broadcast was lost.
    try {
      await this.chain.broadcast(anchor.signedTx);
      await this.repo.markBroadcast(anchor.id);
    } catch (err) {
      if (err instanceof BroadcastTimeoutError) {
        return; // Leave as pending; retried next tick.
      }
      await this.repo.markFailed(anchor.id, (err as Error).message);
    }
  }

  async confirmBroadcast(anchor: AnchorRow): Promise<void> {
    const receipt = await this.chain.getReceipt(anchor.txId);

    if (receipt === null) {
      return; // No receipt yet; retry next tick.
    }

    if (receipt.status === 'success') {
      await this.repo.markConfirmed(anchor.id, receipt.blockNumber, receipt.blockHash);
    } else {
      await this.repo.markFailed(anchor.id, 'on-chain failure');
    }
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return err instanceof Error && (err as { code?: string }).code === 'P2002';
  }
}
```
