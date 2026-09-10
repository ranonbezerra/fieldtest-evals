# repair2-anchors.service.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/anchors/anchors.service.ts`:

1. `src/anchors/anchors.service.ts(19,3): error TS2305: Module '"./anchors.repository.js"' has no exported member 'AnchorRecord'.`
2. `src/
```

## reply

/anchors/anchors.service.ts(20,3): error TS2305: Module '"./anchors.repository.js"' has no exported member 'AnchorStatusValue'.`
3. `src/anchors/anchors.service.ts(22,3): error TS2305: Module '"./anchors.repository.js"' has no exported member 'DuplicateAnchorError'.`
4. `src/anchors/anchors.service.ts(168,35): error TS2339: Property 'createIntent' does not exist on type 'AnchorsRepository'.`
5. `src/anchors/anchors.service.ts(181,11): error TS18046: 'error' is of type 'unknown'.`
6. `src/anchors/anchors.service.ts(182,11): error TS18046: 'error' is of type 'unknown'.`
7. `src/anchors/anchors.service.ts(193,33): error TS2339: Property 'markBroadcastSent' does not exist on type 'AnchorsRepository'.`
8. `src/anchors/anchors.service.ts(198,28): error TS2339: Property 'markFailed' does not exist on type 'AnchorsRepository'.`
9. `src/anchors/anchors.service.ts(207,33): error TS2339: Property 'markOutcomeUnknown' does not exist on type 'AnchorsRepository'.`
10. `src/anchors/anchors.service.ts(218,39): error TS2551: Property 'findByDocumentVersion' does not exist on type 'AnchorsRepository'. Did you mean 'findByDocumentAndVersion'?`

Now let me look at the reference `anchors.repository.ts` to understand what's actually exported:

From the reference, `AnchorsRepository` exports:
- `AnchorRecord` (interface)
- `DuplicateAnchorError` (class)
- `AnchorsRepository` (class)

The repository methods available are:
- `createIntent(documentId, version, contentHash, txId, signedTx)`
- `markBroadcastSent(id)`
- `markFailed(id)`
- `markOutcomeUnknown(id)`
- `markConfirmed(id, blockNumber)`
- `findByDocumentAndVersion(documentId, version)`
- `findBroadcastSent()`
- `findOutcomeUnknown()`
- `getReceipt(txId)`

And from `./anchor-status.js`:
- `AnchorStatus` (enum)
- `AnchorStatusValue` (type)
- `ANCHOR_STATUSES`

Wait, but the errors say the module `"./anchors.repository.js"` has no exported member `AnchorRecord`, `AnchorStatusValue`, or `DuplicateAnchorError`. But looking at the reference code, `AnchorRecord` and `DuplicateAnchorError` ARE exported from `anchors.repository.ts`. And `AnchorStatusValue` comes from `./anchor-status.js`.

So the errors are saying the service is importing from the wrong module. Let me re-read:

- `AnchorRecord` - exported from `./anchors.repository.js` ✓ (it IS in the reference)
- `AnchorStatusValue` - this is from `./anchor-status.js`, NOT from `./anchors.repository.js`
- `DuplicateAnchorError` - exported from `./anchors.repository.js` ✓

Wait, but the compiler says these don't exist. That's strange. Let me re-read the errors more carefully.

Actually, looking at the reference code again:

```typescript
export interface AnchorRecord { ... }
export class DuplicateAnchorError extends Error { ... }
```

These ARE exported. So why does the compiler say they're not?

Oh wait - I think the issue might be that the actual file in the workspace is different from the reference. The reference shows what the file SHOULD look like, but maybe the actual file has issues. Let me look at the other errors:

```
src/anchors/anchors.repository.ts(2,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
src/anchors/anchors.repository.ts(8,33): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../chain/chain-client.js'?
src/anchors/anchors.repository.ts(33,30): error TS2339: Property 'PENDING_BROADCAST' does not exist on type '{ PREPARED: "PREPARED"; BROADCAST_SENT: "BROADCAST_SENT"; OUTCOME_UNKNOWN: "OUTCOME_UNKNOWN"; CONFIRMED: "CONFIRMED"; FAILED: "FAILED"; }'.
```

So the repository file itself has errors! Line 2 imports from `'../prisma/prisma.service'` (wrong path), line 8 has a missing `.js` extension, and line 33 references `PENDING_BROADCAST` which doesn't exist.

But wait - the reference file I was given uses `PrismaClient` from `@prisma/client`, not from `'../prisma/prisma.service'`. So the actual file in the workspace must be different from the reference.

Hmm, but the instructions say "Rely on them; never reproduce them and never rewrite them." So I should take the reference as the source of truth for what the repository looks like.

Actually wait, let me re-read the instructions. The reference is a "read-only reference" - it shows what the file looks like. But the compiler errors are from the ACTUAL workspace. So there might be discrepancies between the reference and the actual file.

But the task says "Rewrite `src/anchors/anchors.service.ts` complete, fixing what these messages require of this file." So I only need to fix the service file. The other files' errors are listed for context but I shouldn't change them.

Let me focus on what the service file needs to do:

Looking at the errors in the service:
1. Line 19: imports `AnchorRecord` from `./anchors.repository.js` - but the compiler says it's not exported. However, the reference shows it IS exported. So maybe the actual repository file in the workspace is different from the reference? Or maybe the import path is wrong?

Wait, I think I need to reconsider. The reference file I was given shows the INTENDED state of the repository. But the actual file in the workspace might have compile errors that prevent the exports from being resolved. When a file has compile errors, TypeScript might not be able to resolve its exports properly.

Actually no - TypeScript does resolve exports even when there are type errors in the file. The `TS2307` (cannot find module) and `TS2835` (missing extension) errors would prevent the module from being loaded at all, which would cascade.

But I'm told to only change `anchors.service.ts`. So I need to work with what I can see.

Let me think about this differently. The reference shows the repository file. The compiler errors tell me what's wrong with the service. I need to write a service that:
1. Imports correctly from the repository (using the correct paths that actually exist)
2. Uses the correct method names on the repository
3. Handles `unknown` error types properly

Given that the repository file has its own compile errors (missing module, wrong import path, wrong enum value), the exports might not be resolvable. But I can only fix the service file.

Let me think about what imports the service needs:
- From the repository: `AnchorsRepository`, and possibly `AnchorRecord`, `DuplicateAnchorError`
- From anchor-status: `AnchorStatusValue` (or `AnchorStatus`)
- From chain-client: `ChainClient`

The key insight is: the reference shows the repository DOES export `AnchorRecord` and `DuplicateAnchorError`. The fact that the compiler can't find them is because the repository file itself has errors (can't find `../prisma/prisma.service`). But I'm told not to change files the messages don't name.

Wait, let me re-read: "Change nothing the messages do not name." The messages DO name `anchors.repository.ts` in some errors. But the task says "Rewrite `src/anchors/anchors.service.ts` complete, fixing what these messages require of this file." So I should ONLY change the service file.

OK so my approach:
1. I'll import `AnchorRecord` and `DuplicateAnchorError` from `./anchors.repository.js` (they ARE exported in the reference, the compile error is in the repository file itself which I can't fix)
2. I'll import `AnchorStatusValue` from `./anchor-status.js` (NOT from the repository)
3. I'll use `findByDocumentAndVersion` (not `findByDocumentVersion`)
4. I'll type the error properly (use `err` instead of `error`, or cast it)
5. I'll use the correct method names that exist on the repository

Actually wait - if the repository file can't compile because of its own errors, then importing from it will still produce errors in the service. But the task says to fix what the messages require of THIS file. So I should write the service as if the repository is correct (as shown in the reference), and the remaining errors will be in the repository file which I'm not asked to fix.

Let me now think about what the service needs to do based on the variant description:

1. `anchorDocument(documentId, version)` — computes a canonical hash, persists anchor intent with tx identity BEFORE broadcasting, then broadcasts.
2. A confirmation worker (that's in the worker file, not service)
3. `verify(documentId, version, content)` — recomputes hash, returns proof or mismatch.
4. Exactly one anchor per (document, version).

The service methods based on the error line numbers:
- Line 168: `createIntent` call
- Line 181-182: error handling with `error` of type `unknown`
- Line 193: `markBroadcastSent` call
- Line 198: `markFailed` call
- Line 207: `markOutcomeUnknown` call
- Line 218: `findByDocumentVersion` (should be `findByDocumentAndVersion`)

Let me write the service. I need to figure out the full API:

From the variant:
- `anchorDocument(documentId, version)` - main anchoring flow
- `verify(documentId, version, content)` - verification

The flow for `anchorDocument`:
1. Get the document content (or it's passed in? Let me think...)
2. Compute canonical hash
3. Call `chain.prepare(tx)` to get `{txId, signedTx}`
4. Persist anchor intent with txId and signedTx (status: PREPARED)
5. Call `chain.broadcast(signedTx)` 
6. If broadcast succeeds → markBroadcastSent
7. If broadcast throws → markFailed or markOutcomeUnknown

Wait, looking at the repository methods:
- `createIntent(documentId, version, contentHash, txId, signedTx)` - creates with status PREPARED
- `markBroadcastSent(id)` - transitions to BROADCAST_SENT
- `markFailed(id)` - transitions to FAILED
- `markOutcomeUnknown(id)` - transitions to OUTCOME_UNKNOWN
- `markConfirmed(id, blockNumber)` - transitions to CONFIRMED

So the flow is:
1. Compute hash
2. `chain.prepare(...)` → get txId, signedTx
3. `repo.createIntent(...)` → persist with status PREPARED (this is the "persist BEFORE broadcast" part)
4. `chain.broadcast(signedTx)` → if success, `repo.markBroadcastSent(id)`; if error, `repo.markFailed(id)` or `repo.markOutcomeUnknown(id)`

For `verify`:
1. Get the anchor for (documentId, version)
2. If not found → return not anchored
3. Recompute hash from content
4. Compare with stored hash
5. If match and confirmed → return proof (txId, blockNumber)
6. If mismatch → return mismatch report

Now let me think about the canonicalization. The variant says "computes a canonical hash of the structured content (define the canonicalization; the PDF is a rendering, not the source of truth)". So the structured JSON content is the source of truth. Canonical JSON would mean: sorted keys, no whitespace, consistent encoding.

Let me write the service:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AnchorsRepository, AnchorRecord, DuplicateAnchorError } from './anchors.repository.js';
import { AnchorStatus, AnchorStatusValue } from './anchor-status.js';
import { ChainClient, AnchorReceipt } from '../chain/chain-client.js';

// ... 
```

Wait, I need to think about what `ChainClient` interface looks like. From the variant:
- `prepare(tx) -> {txId, signedTx}`
- `broadcast(signedTx)`
- `getReceipt(txId)`

And from the reference repository, it imports `ChainClient, AnchorReceipt` from `'../chain/chain-client.js'`.

Let me think about the `AnchorReceipt` shape. The worker uses `getReceipt(txId)` and then checks the result to decide whether to mark confirmed or failed. So `AnchorReceipt` probably has something like `{ blockNumber, status }` or similar.

Looking at the worker errors:
```
src/anchors/anchors.worker.ts(60,47): error TS2345: Argument of type 'number' is not assignable to parameter of type 'AnchorStatus'.
```

This suggests the worker is passing a `number` where an `AnchorStatus` is expected. This might be about a status check.

Let me think about what the worker does:
- `findBroadcastSent()` → for each, call `getReceipt(txId)` → if confirmed, `markConfirmed(id, blockNumber)`; if failed, `markFailed(id)`
- `findOutcomeUnknown()` → for each, call `getReceipt(txId)` → same resolution

The `AnchorReceipt` probably looks like:
```typescript
interface AnchorReceipt {
  status: AnchorStatusValue; // or some chain status
  blockNumber: number | null;
}
```

Or maybe it's simpler - the receipt from the chain might just be:
```typescript
interface AnchorReceipt {
  blockNumber: number;
  // or status: 'confirmed' | 'failed' | 'pending'
}
```

Since I can't see the actual `chain-client.ts` file, I'll need to make assumptions. Let me look at what the worker file errors tell me:

The worker calls:
- `findBroadcastSent()` → returns records
- For each record, gets receipt via `getReceipt(txId)` (which is on the repo, which delegates to chain)
- Then calls `markConfirmed(id, blockNumber)` or `markFailed(id)`

The error at line 60: `Argument of type 'number' is not assignable to parameter of type 'AnchorStatus'` - this is confusing. Maybe the worker is doing something like `if (receipt.status === AnchorStatus.CONFIRMED)` and the receipt status is a number?

I think I need to make an assumption about the `AnchorReceipt` shape. Based on the worker logic (check receipt, then either confirm or fail), I'll assume:

```typescript
interface AnchorReceipt {
  status: 'confirmed' | 'failed' | 'pending';
  blockNumber: number | null;
}
```

Or maybe it's even simpler - the receipt is just the block number, and if it exists, it's confirmed; if not, it's still pending.

Actually, looking more carefully at the worker errors and the `markConfirmed(id, blockNumber)` signature, I think the receipt probably has a `blockNumber` field. If `blockNumber` is present (non-null), the tx is confirmed. If the receipt indicates failure, mark failed.

Let me just make a reasonable assumption and move forward. I'll define the service to work with the interface as described in the variant.

Now, for the service file, here's my plan:

```typescript
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AnchorsRepository, AnchorRecord, DuplicateAnchorError } from './anchors.repository.js';
import { AnchorStatusValue } from './anchor-status.js';
import { ChainClient, AnchorReceipt } from '../chain/chain-client.js';

export interface AnchorResult {
  anchorId: number;
  txId: string;
  status: AnchorStatusValue;
  blockNumber: number | null;
}

export interface VerifyResult {
  anchored: boolean;
  match: boolean;
  contentHash: string;
  expectedHash?: string;
  txId?: string;
  blockNumber?: number;
  status?: AnchorStatusValue;
}

@Injectable()
export class AnchorsService {
  private readonly logger = new Logger(AnchorsService.name);

  constructor(
    private readonly anchors: AnchorsRepository,
    private readonly chain: ChainClient,
  ) {}

  canonicalize(content: unknown): string {
    // Canonical JSON: sort keys recursively, no whitespace
    const canonical = JSON.stringify(content, (_, value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.keys(value).sort().reduce((sorted: Record<string, unknown>, key) => {
          sorted[key] = value[key];
          return sorted;
        }, {});
      }
      return value;
    });
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  async anchorDocument(documentId: string, version: number, content: unknown): Promise<AnchorResult> {
    const contentHash = this.canonicalize(content);
    
    // Check if already anchored
    const existing = await this.anchors.findByDocumentAndVersion(documentId, version);
    if (existing) {
      throw new DuplicateAnchorError(documentId, version);
    }

    // Prepare transaction
    const { txId, signedTx } = await this.chain.prepare(contentHash);
    
    // Persist anchor intent BEFORE broadcasting
    const record = await this.anchors.createIntent(documentId, version, contentHash, txId, signedTx);
    
    // Broadcast
    try {
      await this.chain.broadcast(signedTx);
      await this.anchors.markBroadcastSent(record.id);
      return { anchorId: record.id, txId, status: 'BROADCAST_SENT', blockNumber: null };
    } catch (err: unknown) {
      // Determine if this is a definitive failure or unknown outcome
      if (this.isDefinitiveFailure(err)) {
        await this.anchors.markFailed(record.id);
        return { anchorId: record.id, txId, status: 'FAILED', blockNumber: null };
      }
      await this.anchors.markOutcomeUnknown(record.id);
      return { anchorId: record.id, txId, status: 'OUTCOME_UNKNOWN', blockNumber: null };
    }
  }

  async verify(documentId: string, version: number, content: unknown): Promise<VerifyResult> {
    const anchor = await this.anchors.findByDocumentAndVersion(documentId, version);
    if (!anchor) {
      return { anchored: false, match: false, contentHash: this.canonicalize(content) };
    }

    const contentHash = this.canonicalize(content);
    const match = contentHash === anchor.contentHash;

    return {
      anchored: true,
      match,
      contentHash,
      expectedHash: anchor.contentHash,
      txId: anchor.txId ?? undefined,
      blockNumber: anchor.blockNumber ?? undefined,
      status: anchor.status,
    };
  }

  private isDefinitiveFailure(err: unknown): boolean {
    // A definitive failure is one where we know the tx was rejected
    // (e.g., invalid signature, insufficient funds). A timeout or network
    // error means the outcome is unknown.
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      return msg.includes('rejected') || msg.includes('invalid') || msg.includes('insufficient');
    }
    return false;
  }
}
```

Wait, but I need to check what the `ChainClient` interface looks like. The variant says `prepare(tx) -> {txId, signedTx}`. What is `tx`? It's probably the content to be anchored, or a hash, or some transaction data.

Let me look at the repository reference again - it imports `ChainClient, AnchorReceipt` from `'../chain/chain-client.js'`. The repository doesn't call `chain.prepare` or `chain.broadcast` - only `chain.getReceipt`. So the service must be calling `prepare` and `broadcast`.

I'll assume `prepare` takes some transaction data (maybe the content hash or a structured tx object) and returns `{ txId, signedTx }`. And `broadcast` takes the `signedTx` string.

Let me also reconsider the `VerifyResult` - the variant says "returns the anchoring proof (txId, block) or a mismatch report." So it should clearly indicate whether the content matches and provide the proof.

Now let me also think about the line numbers. The errors reference specific lines in the original file. My rewrite doesn't need to match those line numbers - I just need to fix the actual issues.

Let me also think about whether `AnchorRecord` is actually needed as an import. If I'm not explicitly typing variables as `AnchorRecord`, I might not need to import it. But the service likely uses it for return types or internal typing.

Actually, looking at the error messages again:
- Line 19: `AnchorRecord` import
- Line 20: `AnchorStatusValue` import  
- Line 22: `DuplicateAnchorError` import

These are all on consecutive lines (19, 20, 22 - with line 21 being something else). The original file imports these from `./anchors.repository.js`. But `AnchorStatusValue` is actually from `./anchor-status.js` based on the reference repository file.

So the fix for the service is:
1. Import `AnchorRecord` and `DuplicateAnchorError` from `./anchors.repository.js` (they ARE exported there per the reference)
2. Import `AnchorStatusValue` from `./anchor-status.js` (NOT from the repository)
3. Use `findByDocumentAndVersion` instead of `findByDocumentVersion`
4. Properly type the error variable (use `err` and narrow the type)
5. The methods `createIntent`, `markBroadcastSent`, `markFailed`, `markOutcomeUnknown` DO exist on the repository per the reference

Wait, but the compiler says they don't exist. That's because the repository file itself has compile errors. Since I can't fix the repository, I should still reference these methods correctly (as they appear in the reference) and the errors will remain in the repository file.

Actually, I realize I should double-check: the task says "fixing what these messages require of this file." The messages that are about the service file are:
1. Import `AnchorRecord` from repository - fix: it IS exported, the error is in the repo file
2. Import `AnchorStatusValue` from repository - fix: import from `./anchor-status.js` instead
3. Import `DuplicateAnchorError` from repository - fix: it IS exported
4. `createIntent` doesn't exist - fix: it DOES exist in the reference
5. `error` is of type `unknown` - fix: properly type the catch variable
6. `markBroadcastSent` doesn't exist - fix: it DOES exist
7. `markFailed` doesn't exist - fix: it DOES exist
8. `markOutcomeUnknown` doesn't exist - fix: it DOES exist
9. `findByDocumentVersion` → `findByDocumentAndVersion` - fix: use correct name

So the actual fixes I need to make in the service are:
- Change the import of `AnchorStatusValue` to come from `./anchor-status.js`
- Change `findByDocumentVersion` to `findByDocumentAndVersion`
- Fix the `error` type issue (use proper type narrowing)
- Keep `createIntent`, `markBroadcastSent`, `markFailed`, `markOutcomeUnknown` as-is (they exist in the reference)

For the `error` type issue at lines 181-182: the original code probably has `catch (error)` and then accesses `error.something` without narrowing. The fix is to either:
- Use `catch (err: unknown)` and then narrow
- Or use `catch (error: any)` (but that's not great)
- Or use a type guard

Let me write the complete service now. I need to be careful about what the `ChainClient` interface expects for `prepare`. The variant says `prepare(tx) -> {txId, signedTx}`. I'll assume `tx` is some kind of transaction payload. Given that we're anchoring a hash, I'll assume it takes the content hash or some structured data.

Actually, let me think about this more carefully. The `prepare` method is described as "local, deterministic" - it prepares and signs the transaction locally. The input would be what's being anchored (the hash or content). The output is `{txId, signedTx}`.

I'll assume `prepare` takes a string (the content hash) or some transaction data object. Let me go with the content hash as the input since that's what's being anchored.

Let me finalize my service:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AnchorsRepository, AnchorRecord, DuplicateAnchorError } from './anchors.repository.js';
import { AnchorStatusValue } from './anchor-status.js';
import { ChainClient, AnchorReceipt } from '../chain/chain-client.js';

export interface AnchorResult {
  anchorId: number;
  txId: string;
  status: AnchorStatusValue;
  blockNumber: number | null;
}

export interface VerifyResult {
  anchored: boolean;
  match: boolean;
  contentHash: string;
  expectedHash: string | null;
  txId: string | null;
  blockNumber: number | null;
  status: AnchorStatusValue | null;
}

@Injectable()
export class AnchorsService {
  private readonly logger = new Logger(AnchorsService.name);

  constructor(
    private readonly anchors: AnchorsRepository,
    private readonly chain: ChainClient,
  ) {}

  /**
   * Canonical JSON serialization: recursively sort object keys,
   * remove insignificant whitespace. Arrays preserve order.
   */
  canonicalize(content: unknown): string {
    const canonical = JSON.stringify(content, (_key, value) => {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(value as Record<string, unknown>).sort()) {
          sorted[k] = (value as Record<string, unknown>)[k];
        }
        return sorted;
      }
      return value;
    });
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  async anchorDocument(
    documentId: string,
    version: number,
    content: unknown,
  ): Promise<AnchorResult> {
    const contentHash = this.canonicalize(content);

    // Prepare transaction locally (deterministic)
    const { txId, signedTx } = await this.chain.prepare(contentHash);

    // Persist anchor intent BEFORE broadcasting
    let record: AnchorRecord;
    try {
      record = await this.anchors.createIntent(documentId, version, contentHash, txId, signedTx);
    } catch (error: unknown) {
      if (error instanceof DuplicateAnchorError) {
        throw error;
      }
      throw error;
    }

    // Broadcast
    try {
      await this.chain.broadcast(signedTx);
      await this.anchors.markBroadcastSent(record.id);
      return { anchorId: record.id, txId, status: 'BROADCAST_SENT', blockNumber: null };
    } catch (error: unknown) {
      if (this.isDefinitiveBroadcastFailure(error)) {
        await this.anchors.markFailed(record.id);
        return { anchorId: record.id, txId, status: 'FAILED', blockNumber: null };
      }
      // Timeout or network error: outcome unknown
      await this.anchors.markOutcomeUnknown(record.id);
      return { anchorId: record.id, txId, status: 'OUTCOME_UNKNOWN', blockNumber: null };
    }
  }

  async verify(
    documentId: string,
    version: number,
    content: unknown,
  ): Promise<VerifyResult> {
    const anchor = await this.anchors.findByDocumentAndVersion(documentId, version);

    if (!anchor) {
      return {
        anchored: false,
        match: false,
        contentHash: this.canonicalize(content),
        expectedHash: null,
        txId: null,
        blockNumber: null,
        status: null,
      };
    }

    const contentHash = this.canonicalize(content);
    const match = contentHash === anchor.contentHash;

    return {
      anchored: true,
      match,
      contentHash,
      expectedHash: anchor.contentHash,
      txId: anchor.txId,
      blockNumber: anchor.blockNumber,
      status: anchor.status,
    };
  }

  private isDefinitiveBroadcastFailure(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('rejected') ||
        msg.includes('invalid') ||
        msg.includes('insufficient')
      );
    }
    return false;
  }
}
```

Hmm wait, I need to double-check the `prepare` method signature. The variant says `prepare(tx) -> {txId, signedTx}`. What is `tx`? It could be:
- A string (the hash)
- An object (transaction data)

Since I can't see the actual `ChainClient` interface, I'll make an assumption. The most logical thing for an onchain anchor is to prepare a transaction that contains the hash. I'll assume `prepare` takes a string (the content hash).

Actually, looking at this more carefully - the variant says the chain client exposes `prepare(tx)`. The `tx` likely represents a transaction to be signed. In most chain abstractions, you'd pass in the transaction data (which could include the hash being anchored). Let me just use the content hash as the argument - it's the simplest interpretation.

One more thing - I should check if `AnchorRecord` is actually needed as a type import. In my code, I use `let record: AnchorRecord` - so yes, I need it. But I could also just use the return type of `createIntent` directly. Let me keep the explicit type for clarity.

Let me also reconsider whether I need `AnchorReceipt` imported. In my service, I don't directly use `AnchorReceipt` - that's used by the worker. So I don't need to import it.

Let me also reconsider the `AnchorStatusValue` import. Looking at the reference, `anchor-status.js` exports `AnchorStatus`, `AnchorStatusValue`, and `ANCHOR_STATUSES`. I need `AnchorStatusValue` for my return types. I don't think I need `AnchorStatus` (the enum) or `ANCHOR_STATUSES` in the service.

Final check on my code:
- ✅ `AnchorRecord` imported from `./anchors.repository.js` (it IS exported there per reference)
- ✅ `AnchorStatusValue` imported from `./anchor-status.js` (fixing the original wrong import)
- ✅ `DuplicateAnchorError` imported from `./anchors.repository.js` (it IS exported there)
- ✅ `createIntent` used (exists in reference)
- ✅ `markBroadcastSent` used (exists in reference)
- ✅ `markFailed` used (exists in reference)
- ✅ `markOutcomeUnknown` used (exists in reference)
- ✅ `findByDocumentAndVersion` used (correct name, fixing the typo)
- ✅ Error properly typed as `unknown` with narrowing
- ✅ `ChainClient` imported from correct path

I think this is good. Let me write the final version.
</think>

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AnchorsRepository, AnchorRecord, DuplicateAnchorError } from './anchors.repository.js';
import { AnchorStatusValue } from './anchor-status.js';
import { ChainClient } from '../chain/chain-client.js';

export interface AnchorResult {
  anchorId: number;
  txId: string;
  status: AnchorStatusValue;
  blockNumber: number | null;
}

export interface VerifyResult {
  anchored: boolean;
  match: boolean;
  contentHash: string;
  expectedHash: string | null;
  txId: string | null;
  blockNumber: number | null;
  status: AnchorStatusValue | null;
}

@Injectable()
export class AnchorsService {
  private readonly logger = new Logger(AnchorsService.name);

  constructor(
    private readonly anchors: AnchorsRepository,
    private readonly chain: ChainClient,
  ) {}

  /**
   * Canonical JSON: recursively sort object keys (arrays keep order),
   * no insignificant whitespace. The structured JSON is the source of truth;
   * the PDF is merely a rendering.
   */
  canonicalize(content: unknown): string {
    const canonical = JSON.stringify(content, (_key, value) => {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const source = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(source).sort()) {
          sorted[k] = source[k];
        }
        return sorted;
      }
      return value;
    });
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  async anchorDocument(
    documentId: string,
    version: number,
    content: unknown,
  ): Promise<AnchorResult> {
    const contentHash = this.canonicalize(content);

    // Prepare transaction locally (deterministic, no network call)
    const { txId, signedTx } = await this.chain.prepare(contentHash);

    // Persist anchor intent with tx identity BEFORE broadcasting.
    // This guarantees that even if the process crashes after broadcast,
    // the txId is recoverable for the recovery sweep.
    let record: AnchorRecord;
    try {
      record = await this.anchors.createIntent(documentId, version, contentHash, txId, signedTx);
    } catch (error: unknown) {
      if (error instanceof DuplicateAnchorError) {
        throw error;
      }
      throw error;
    }

    // Broadcast to the chain
    try {
      await this.chain.broadcast(signedTx);
      await this.anchors.markBroadcastSent(record.id);
      return { anchorId: record.id, txId, status: 'BROADCAST_SENT', blockNumber: null };
    } catch (error: unknown) {
      if (this.isDefinitiveBroadcastFailure(error)) {
        await this.anchors.markFailed(record.id);
        return { anchorId: record.id, txId, status: 'FAILED', blockNumber: null };
      }
      // Timeout or network error: we cannot determine whether the tx landed.
      await this.anchors.markOutcomeUnknown(record.id);
      return { anchorId: record.id, txId, status: 'OUTCOME_UNKNOWN', blockNumber: null };
    }
  }

  async verify(
    documentId: string,
    version: number,
    content: unknown,
  ): Promise<VerifyResult> {
    const anchor = await this.anchors.findByDocumentAndVersion(documentId, version);

    if (!anchor) {
      return {
        anchored: false,
        match: false,
        contentHash: this.canonicalize(content),
        expectedHash: null,
        txId: null,
        blockNumber: null,
        status: null,
      };
    }

    const contentHash = this.canonicalize(content);
    const match = contentHash === anchor.contentHash;

    return {
      anchored: true,
      match,
      contentHash,
      expectedHash: anchor.contentHash,
      txId: anchor.txId,
      blockNumber: anchor.blockNumber,
      status: anchor.status,
    };
  }

  private isDefinitiveBroadcastFailure(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('rejected') ||
        msg.includes('invalid') ||
        msg.includes('insufficient')
      );
    }
    return false;
  }
}
```
