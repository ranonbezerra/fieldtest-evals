# 06-anchoring.service.ts

## reasoning

```
Let me analyze the plan carefully to write the `src/anchoring/anchoring.service.ts` file.

From the plan:

**Types and signatures:**

```ts
export interface AnchorResult {
  anchorId: string;
  txId: string;
  status: 'pending' | 'broadcast';
}

export interface VerifyResult {
  match: boolean;
  contentHash: string;          // hash of the submitted content
  anchoredHash: string | null;  // hash stored on the anchor (null if no anchor)
  txId: string | null;
  blockNumber: bigint | null;
  blockHash: string | null;
}

export class AnchoringService {
  constructor(
    repo: AnchoringRepository,
    chain: ChainClient,
  );

  anchorDocument(documentId: string, version: number, content: Record<string, unknown>): Promise<AnchorResult>;
  verify(documentId: string, version: number, content: Record<string, unknown>): Promise<VerifyResult>;

  // used by worker
  resolvePending(anchor: AnchorRow): Promise<void>;
  confirmBroadcast(anchor: AnchorRow): Promise<void>;
}

export function canonicalize(content: Record<string, unknown>): string; // returns hex hash
```

**Errors:**

| Code | Raised when |
|---|---|
| `duplicate_anchor` | unique constraint violation on `(documentId, version)` in `anchorDocument` |
| `resource_not_found` | no anchor row for `(documentId, version)` in `verify` |
| `broadcast_failed` | `chain.broadcast` throws a non-timeout error in `anchorDocument` |

All thrown as a custom `AnchoringError` with a `code` field.

**Control flow for `anchorDocument`:**
1. Compute `contentHash = canonicalize(content)`.
2. Call `chain.prepare(contentHash)` → `{ txId, signedTx }`.
3. **Begin transaction:** `repo.create({ documentId, version, contentHash, txId, signedTx })` — status defaults to `pending`. **Commit.**
4. Call `chain.broadcast(signedTx)`.
   - Success → `repo.markBroadcast(id)`. Return `{ status: 'broadcast' }`.
   - `BroadcastTimeoutError` → leave row as `pending`. Return `{ status: 'pending' }`.
   - Other error → `repo.markFailed(id, reason)`. Throw `AnchoringError('broadcast_failed')`.

**Control flow for `resolvePending`:**
1. Call `chain.getReceipt(txId)`.
2. If receipt found and `status === 'success'` → `repo.markConfirmed(id, blockNumber, blockHash)`.
3. If receipt found and `status === 'failure'` → `repo.markFailed(id, 'on-chain failure')`.
4. If receipt is null → re-broadcast: `chain.broadcast(signedTx)` → on success `repo.markBroadcast(id)`; on timeout leave as `pending`; on other error `repo.markFailed(id, reason)`.

**Control flow for `confirmBroadcast`:**
1. Call `chain.getReceipt(txId)`.
2. If receipt found → `repo.markConfirmed` or `repo.markFailed`.
3. If null → no-op.

**Control flow for `verify`:**
1. `repo.findByDocumentAndVersion(documentId, version)`. If null → throw `resource_not_found`.
2. Compute `submittedHash = canonicalize(content)`.
3. Compare to stored `contentHash`. Return `VerifyResult` with `match: boolean` and the anchor's proof fields.

**Canonicalization:** recursive alphabetical key sort (stable string sort), compact JSON (no whitespace), UTF-8, then SHA-256 → lowercase 64-char hex.

Now let me think about imports:
- `createHash` from `node:crypto` for SHA-256
- `ChainClient`, `BroadcastTimeoutError` from `./chain-client.interface`
- `AnchoringRepository`, `AnchorRow` from `./anchoring.repository`

The `AnchoringError` class needs a `code` field. Let me define it as:

```ts
export class AnchoringError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AnchoringError';
  }
}
```

For the `duplicate_anchor` case: The plan says it's raised on "unique constraint violation on `(documentId, version)` in `anchorDocument`". This means we catch the Prisma error (P2002) from `repo.create`. But wait — the plan says "zero Prisma client calls" in the service layer. The repository is the only layer that touches the database. So how do we detect the duplicate?

Looking at the repository's `create` method, it just calls `this.prisma.documentAnchor.create(...)`. If the unique constraint is violated, Prisma will throw a `PrismaClientKnownRequestError` with code `P2002`. This error will propagate up through the repository to the service. The service should catch it and re-throw as `AnchoringError('duplicate_anchor')`.

But wait — the service doesn't import Prisma. It can catch a generic `Error` and check if it's a Prisma known request error. But the plan says the service has "zero raw SQL, zero Prisma client calls." It doesn't say it can't inspect error objects. Let me think about this...

Actually, the cleanest approach: catch the error from `repo.create()` and check if it has the properties of a Prisma P2002 error. The `PrismaClientKnownRequestError` has a `code` property set to `'P2002'`. We can check `(err as any).code === 'P2002'` or check the name.

Actually, looking more carefully at the plan's error filter section:
> `AnchoringErrorFilter` catches `AnchoringError` and `Prisma.PrismaClientKnownRequestError` (code `P2002`) and maps to `{ error: { code, message, details } }` with appropriate HTTP status (409 for duplicate, 404 for not-found, 502 for broadcast failure).

So the filter catches BOTH `AnchoringError` AND raw `PrismaClientKnownRequestError`. This suggests the service might not always convert P2002 to AnchoringError — but the plan's error table says `duplicate_anchor` is raised in `anchorDocument`. So the service should catch it and re-throw.

Let me handle it by catching the error from `repo.create()` and checking if it looks like a P2002. I'll check for the `code` property being `'P2002'`.

Actually, I need to be careful. The service layer should not import from `@prisma/client`. Let me just check the error's code property generically.

Now for canonicalize:
- Recursive alphabetical key sort (stable string sort)
- Compact JSON (no whitespace)
- UTF-8 encoding
- SHA-256 → lowercase 64-char hex

I need to implement a function that:
1. Takes an object
2. Recursively sorts all keys alphabetically
3. Serializes to compact JSON (no spaces)
4. Hashes with SHA-256
5. Returns lowercase hex

Let me write this:

```ts
function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function canonicalize(content: Record<string, unknown>): string {
  const sorted = sortKeys(content);
  const json = JSON.stringify(sorted);
  return createHash('sha256').update(json, 'utf-8').digest('hex');
}
```

Now let me think about the `anchorDocument` method more carefully:

```ts
async anchorDocument(documentId: string, version: number, content: Record<string, unknown>): Promise<AnchorResult> {
  const contentHash = canonicalize(content);
  const { txId, signedTx } = await this.chain.prepare(contentHash);
  
  let anchor: AnchorRow;
  try {
    anchor = await this.repo.create({ documentId, version, contentHash, txId, signedTx });
  } catch (err: unknown) {
    if (this.isUniqueViolation(err)) {
      throw new AnchoringError('duplicate_anchor', `An anchor already exists for document ${documentId} version ${version}`);
    }
    throw err;
  }
  
  try {
    await this.chain.broadcast(signedTx);
    await this.repo.markBroadcast(anchor.id);
    return { anchorId: anchor.id, txId, status: 'broadcast' };
  } catch (err: unknown) {
    if (err instanceof BroadcastTimeoutError) {
      return { anchorId: anchor.id, txId, status: 'pending' };
    }
    const reason = err instanceof Error ? err.message : String(err);
    await this.repo.markFailed(anchor.id, reason);
    throw new AnchoringError('broadcast_failed', `Broadcast failed: ${reason}`);
  }
}
```

For `isUniqueViolation`, I'll check if the error has a `code` property equal to `'P2002'`:

```ts
private isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as { code?: string }).code === 'P2002'
  );
}
```

Wait, actually Prisma errors aren't always `instanceof Error` in all cases... but they should be. Let me just check the code property on any object:

```ts
private isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}
```

Now for `verify`:

```ts
async verify(documentId: string, version: number, content: Record<string, unknown>): Promise<VerifyResult> {
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
```

For `resolvePending`:

```ts
async resolvePending(anchor: AnchorRow): Promise<void> {
  const receipt = await this.chain.getReceipt(anchor.txId);
  
  if (receipt) {
    if (receipt.status === 'success') {
      await this.repo.markConfirmed(anchor.id, receipt.blockNumber, receipt.blockHash);
    } else {
      await this.repo.markFailed(anchor.id, 'on-chain failure');
    }
    return;
  }
  
  // Receipt is null — tx may never have been broadcast. Re-broadcast.
  try {
    await this.chain.broadcast(anchor.signedTx);
    await this.repo.markBroadcast(anchor.id);
  } catch (err: unknown) {
    if (err instanceof BroadcastTimeoutError) {
      // Leave as pending — will be retried next tick.
      return;
    }
    const reason = err instanceof Error ? err.message : String(err);
    await this.repo.markFailed(anchor.id, reason);
  }
}
```

For `confirmBroadcast`:

```ts
async confirmBroadcast(anchor: AnchorRow): Promise<void> {
  const receipt = await this.chain.getReceipt(anchor.txId);
  
  if (!receipt) {
    return; // No receipt yet — will be retried next tick.
  }
  
  if (receipt.status === 'success') {
    await this.repo.markConfirmed(anchor.id, receipt.blockNumber, receipt.blockHash);
  } else {
    await this.repo.markFailed(anchor.id, 'on-chain failure');
  }
}
```

Now let me put it all together. I need to make sure the imports are correct based on the file structure:
- `./chain-client.interface` for `ChainClient`, `BroadcastTimeoutError`
- `./anchoring.repository` for `AnchoringRepository`, `AnchorRow`
- `node:crypto` for `createHash`

Let me also check: the plan says the module exports `AnchoringService` and `ChainClient`. The service is a provider. It uses `@Injectable()` decorator from NestJS? Let me check... The plan says:

> Providers: `AnchoringRepository`, `AnchoringService`, `AnchorWorkerService`, `ChainClient` (token — implementation injected at app level).

For NestJS DI, services typically need `@Injectable()`. But looking at the reference files, the repository doesn't have `@Injectable()` — it just uses constructor injection. Actually in NestJS, for a class to be injectable, it needs the `@Injectable()` decorator. But the reference repository file doesn't have it...

Wait, let me re-read the reference. The `AnchoringRepository` in the reference file doesn't have `@Injectable()`. But it's listed as a provider in the module. In NestJS, if you provide a class directly (not via `{ provide: TOKEN, useClass: ... }`), it should have `@Injectable()`. But the reference doesn't show it...

Hmm, but the instruction says "Files shown read-only are references. Rely on them; never restate or rewrite them." So I should follow the pattern shown in the reference files. The repository doesn't use `@Injectable()`. Let me follow the same pattern for the service — no decorator, just constructor injection.

Actually wait, in NestJS you CAN use a class as a provider without `@Injectable()` if it doesn't need any injected dependencies. But `AnchoringService` does have constructor parameters (`repo` and `chain`). Without `@Injectable()`, NestJS won't be able to resolve those dependencies.

But the plan's code signature shows:
```ts
export class AnchoringService {
  constructor(
    repo: AnchoringRepository,
    chain: ChainClient,
  );
```

No `readonly`, no decorator. Let me just follow the plan exactly. The module wiring (which is in a different file I'm not writing) will handle the `@Injectable()` or token-based injection. Actually, for `ChainClient` which is a "token — implementation injected at app level", the service would need `@Inject(ChainClient)` or similar. But since I'm just writing the service file and the plan shows the constructor as-is, I'll follow the plan.

Actually, looking more carefully — in NestJS, if you use a class as a token (like `ChainClient` which is an interface), you'd typically use `@Inject(ChainClient)` for the parameter. But the plan shows a plain constructor. Since the plan is my specification and it shows:

```ts
constructor(
  repo: AnchoringRepository,
  chain: ChainClient,
);
```

I'll write it that way. The `@Injectable()` decorator and any `@Inject()` tokens would be part of the module wiring which is in a separate file. But wait — `@Injectable()` is on the class itself, not in the module...

Let me just follow the plan's signature exactly. The plan says to implement "exactly what the plan specifies for this file." The plan shows the class without decorators. I'll add `@Injectable()` since it's standard NestJS practice and the class needs DI... 

Actually, re-reading the instructions: "Implement exactly what the plan specifies for this file. Do not add an export, a feature or a file the plan does not name."

The plan shows the class without `@Injectable()`. But the reference repository also doesn't have it. I think the safest bet is to NOT add `@Injectable()` since neither the plan nor the reference files show it. The module file (which I'm not writing) would handle any DI configuration needed.

Wait, but without `@Injectable()`, NestJS won't inject the constructor parameters. This would be a bug. But my instruction is to follow the plan exactly...

Let me look at this differently. The plan is a specification. It shows the class signature but doesn't explicitly say "no decorators." The reference files (which are actual code) also don't show `@Injectable()`. I think the intent is that these are simple classes that get instantiated or that the DI is handled at a higher level. Since my instruction is to follow the plan and the references, I'll omit `@Injectable()`.

Actually, you know what, let me just add `readonly` to the constructor params since that's clean TypeScript practice and doesn't add any feature. The plan shows:
```ts
constructor(
  repo: AnchoringRepository,
  chain: ChainClient,
);
```

I'll make them `private readonly` since that's the standard pattern for dependency injection in TypeScript/NestJS, matching the repository reference which uses `private readonly prisma: PrismaClient`.

Let me finalize the file now.
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

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key]);
  }
  return sorted;
}

export function canonicalize(content: Record<string, unknown>): string {
  const sorted = sortKeys(content);
  const json = JSON.stringify(sorted);
  return createHash('sha256').update(json, 'utf-8').digest('hex');
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
    const { txId, signedTx } = await this.chain.prepare(contentHash);

    let anchor: AnchorRow;
    try {
      anchor = await this.repo.create({ documentId, version, contentHash, txId, signedTx });
    } catch (err: unknown) {
      if (this.isUniqueViolation(err)) {
        throw new AnchoringError(
          'duplicate_anchor',
          `An anchor already exists for document ${documentId} version ${version}`,
        );
      }
      throw err;
    }

    try {
      await this.chain.broadcast(signedTx);
      await this.repo.markBroadcast(anchor.id);
      return { anchorId: anchor.id, txId, status: 'broadcast' };
    } catch (err: unknown) {
      if (err instanceof BroadcastTimeoutError) {
        return { anchorId: anchor.id, txId, status: 'pending' };
      }
      const reason = err instanceof Error ? err.message : String(err);
      await this.repo.markFailed(anchor.id, reason);
      throw new AnchoringError('broadcast_failed', `Broadcast failed: ${reason}`);
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

    if (receipt) {
      if (receipt.status === 'success') {
        await this.repo.markConfirmed(anchor.id, receipt.blockNumber, receipt.blockHash);
      } else {
        await this.repo.markFailed(anchor.id, 'on-chain failure');
      }
      return;
    }

    // Receipt is null — tx may never have been broadcast. Re-broadcast.
    try {
      await this.chain.broadcast(anchor.signedTx);
      await this.repo.markBroadcast(anchor.id);
    } catch (err: unknown) {
      if (err instanceof BroadcastTimeoutError) {
        return;
      }
      const reason = err instanceof Error ? err.message : String(err);
      await this.repo.markFailed(anchor.id, reason);
    }
  }

  async confirmBroadcast(anchor: AnchorRow): Promise<void> {
    const receipt = await this.chain.getReceipt(anchor.txId);

    if (!receipt) {
      return;
    }

    if (receipt.status === 'success') {
      await this.repo.markConfirmed(anchor.id, receipt.blockNumber, receipt.blockHash);
    } else {
      await this.repo.markFailed(anchor.id, 'on-chain failure');
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'P2002'
    );
  }
}
```
