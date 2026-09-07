# repair1-anchor.service.ts

## reasoning

```
We need to rewrite anchor.service.ts to compile, fixing missing imports, etc. We don't have the other files content. But we can infer needed interfaces based on plan: anchor.service uses AnchorRepository, ChainClientInterface.

We need to create the file with appropriate imports relative paths that exist (maybe they are missing, but we need to import them correctly). However, the errors indicate those modules don't exist currently, causing compile errors. The task says rewrite anchor.service.ts complete, fixing what these messages require of this file. So we need to implement AnchorService without requiring missing modules? Could define them locally or adjust imports to use existing ones? But other files also have missing imports (controller, module, repository, etc.) but the task only asks to rewrite anchor.service.ts to fix its own compile errors. The other errors will remain but they ask to rewrite this file to satisfy compiler's messages. However the compiler also reports errors in other files due to missing modules; maybe those modules exist but path wrong. The missing files likely exist but not yet created. But we cannot create new files, only modify anchor.service.ts. However we can avoid importing those missing modules by using relative imports that refer to existing files? We don't know. But maybe they exist under different names. For example, there might be a PrismaService in src/prisma.service.ts. So import from '../prisma.service' maybe correct. But error says cannot find module '../prisma.service' in anchor.module.ts, not service. For service, it imports './anchor.repository' and './chain-client.interface'. Those files may exist. But errors indicate they don't exist. Could be that they exist but path wrong (maybe .ts extension?). The import should be from './anchor.repository' which would resolve to anchor.repository.ts. That's typical. So maybe the file is missing; we can't create new files. But we can avoid importing them by defining the necessary types/interfaces within this file, thereby not requiring missing modules. That would silence the errors for this file, but other files still reference missing modules and cause errors. The task only asks to rewrite this file to fix messages that mention this file. The compiler errors list many files missing, but we only need to fix those referring to this file: lines 2,34 and 3,29 in anchor.service.ts. So we need to modify anchor.service.ts to not import those modules.

Thus we can implement AnchorService using local definitions for repository and chain client interface.

But the service may need to be injectable, using NestJS decorators. We'll need to import Injectable from '@nestjs/common'.

Define interfaces:

interface AnchorRepository { createIntent(...): Promise<any>; updateStatus(...): Promise<any>; findIntent(...): Promise<any>; }

interface ChainClient { prepare(tx: any): Promise<{txId: string, signedTx: any}>; broadcast(signedTx: any): Promise<void>; getReceipt(txId: string): Promise<{blockNumber: number}>; }

Simplify.

Implement AnchorService with methods:

anchorDocument(documentId: string, version: number, content: any): Promise<void> // compute hash, persist intent, broadcast

verify(documentId: string, version: number, content: any): Promise<{txId:string, blockNumber:number} | {mismatch:true}>.

We'll need a hash function - canonical hash: we can JSON.stringify with sorted keys. Implement deterministic hash using crypto.createHash('sha256').update(canonicalString).digest('hex').

The service will depend on repository and chain client via constructor injection. So we need to import them as types defined locally.

We need to export class AnchorService.

Make sure to use @Injectable().

Implement error handling.

Ok produce file.
```

## reply

```typescript
// src/anchor/anchor.service.ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * // ASSUMPTION:
 * The original project defines a repository that can persist an anchoring intent
 * and later update its status, as well as a chain‑client interface with the three
 * methods described in the problem statement. Because those files are missing
 * (and we are not allowed to create them), we declare minimal local typings that
 * satisfy the service implementation and the compiler.
 */

/**
 * Minimal contract for the repository used by AnchorService.
 * In the real codebase this would be implemented in `anchor.repository.ts`.
 */
interface AnchorRepository {
  /**
   * Persists a new anchoring intent. Must contain at least the following fields.
   * Returns the created record (or its identifier) – the exact shape is not used
   * by this service beyond being stored.
   */
  createIntent(data: {
    documentId: string;
    version: number;
    contentHash: string;
    txId?: string;
    status: 'pending' | 'broadcasted' | 'confirmed' | 'failed';
  }): Promise<any>;

  /**
   * Updates an existing intent (identified by documentId + version) with new data.
   */
  updateIntent(
    where: { documentId: string; version: number },
    data: Partial<{
      txId: string;
      status: 'pending' | 'broadcasted' | 'confirmed' | 'failed';
      blockNumber: number;
    }>,
  ): Promise<any>;

  /**
   * Retrieves an intent. Returns null if not found.
   */
  findIntent(where: {
    documentId: string;
    version: number;
  }): Promise<{
    documentId: string;
    version: number;
    contentHash: string;
    txId?: string;
    status: 'pending' | 'broadcasted' | 'confirmed' | 'failed';
    blockNumber?: number;
  } | null>;
}

/**
 * Minimal contract for the L2 chain client.
 */
interface ChainClient {
  /**
   * Prepares a transaction locally and returns a deterministic identifier
   * together with a signed payload.
   */
  prepare(tx: unknown): Promise<{ txId: string; signedTx: unknown }>;

  /**
   * Broadcasts a signed transaction. May time‑out; we treat any thrown error
   * as a broadcast failure.
   */
  broadcast(signedTx: unknown): Promise<void>;

  /**
   * Retrieves a receipt for a previously broadcast transaction.
   */
  getReceipt(txId: string): Promise<{ blockNumber: number }>;
}

/**
 * Service that handles anchoring of document versions on an L2.
 *
 * It follows the plan described in the variant‑A specification:
 * 1. Compute a canonical hash of the structured content.
 * 2. Persist an intent **before** broadcasting.
 * 3. Broadcast the transaction.
 * 4. Provide verification of an anchored version.
 *
 * The implementation is deliberately simple – it only uses the minimal
 * repository and chain‑client contracts defined above.
 */
@Injectable()
export class AnchorService {
  constructor(
    private readonly repository: AnchorRepository,
    private readonly chainClient: ChainClient,
  ) {}

  /**
   * Anchors a specific version of a document.
   *
   * @param documentId Unique identifier of the document.
   * @param version    Numeric version (e.g., 1, 2, …).
   * @param content    Structured JSON content that will be canonicalised.
   *
   * The method is idempotent: if an intent already exists for the same
   * `(documentId, version)` it will throw an `InternalServerErrorException`.
   * This satisfies the “exactly one anchor per (document, version)” requirement
   * at the service level (the database schema is expected to enforce the same).
   */
  async anchorDocument(
    documentId: string,
    version: number,
    content: unknown,
  ): Promise<void> {
    // 1️⃣ Canonicalise and hash the content.
    const contentHash = this.computeCanonicalHash(content);

    // 2️⃣ Ensure we don't already have an anchor for this document+version.
    const existing = await this.repository.findIntent({
      documentId,
      version,
    });
    if (existing) {
      throw new InternalServerErrorException(
        'Anchor already exists for this document and version',
      );
    }

    // 3️⃣ Prepare the transaction (deterministic) – we only need the txId.
    const { txId, signedTx } = await this.chainClient.prepare({
      documentId,
      version,
      contentHash,
    });

    // 4️⃣ Persist intent **before** broadcasting.
    await this.repository.createIntent({
      documentId,
      version,
      contentHash,
      txId,
      status: 'pending',
    });

    // 5️⃣ Broadcast – any error is recorded as a failure.
    try {
      await this.chainClient.broadcast(signedTx);
      await this.repository.updateIntent(
        { documentId, version },
        { status: 'broadcasted' },
      );
    } catch (err) {
      await this.repository.updateIntent(
        { documentId, version },
        { status: 'failed' },
      );
      throw err;
    }
  }

  /**
   * Verifies that a given document version has been anchored and returns the
   * anchoring proof (txId and block number). If the supplied content does not
   * match the stored hash, a mismatch report is returned.
   *
   * @returns `{ txId, blockNumber }` on success, or `{ mismatch: true }`
   *          when the content does not correspond to the anchored hash.
   */
  async verify(
    documentId: string,
    version: number,
    content: unknown,
  ): Promise<
    | { txId: string; blockNumber: number }
    | { mismatch: true; storedHash?: string; suppliedHash?: string }
  > {
    const intent = await this.repository.findIntent({
      documentId,
      version,
    });

    if (!intent) {
      throw new InternalServerErrorException('No anchoring intent found');
    }

    const suppliedHash = this.computeCanonicalHash(content);
    if (suppliedHash !== intent.contentHash) {
      return {
        mismatch: true,
        storedHash: intent.contentHash,
        suppliedHash,
      };
    }

    // If we already have a confirmed block number, return it.
    if (intent.status === 'confirmed' && intent.blockNumber !== undefined) {
      return { txId: intent.txId!, blockNumber: intent.blockNumber };
    }

    // Otherwise, try to fetch the receipt from the chain.
    if (!intent.txId) {
      throw new InternalServerErrorException('Intent missing transaction ID');
    }

    const receipt = await this.chainClient.getReceipt(intent.txId);
    // Update the intent with the confirmed status.
    await this.repository.updateIntent(
      { documentId, version },
      { status: 'confirmed', blockNumber: receipt.blockNumber },
    );

    return { txId: intent.txId, blockNumber: receipt.blockNumber };
  }

  /**
   * Helper: deterministic canonicalisation + SHA‑256 hashing.
   *
   * The canonicalisation sorts object keys recursively, then JSON‑stringifies
   * the result. This guarantees that semantically identical structures produce
   * the same hash irrespective of key order.
   */
  private computeCanonicalHash(value: unknown): string {
    const canonical = this.canonicalise(value);
    return createHash('sha256')
      .update(JSON.stringify(canonical))
      .digest('hex');
  }

  /**
   * Recursively sorts object keys. Primitive values are returned unchanged.
   */
  private canonicalise(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((v) => this.canonicalise(v));
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, this.canonicalise(v)] as const);
      return Object.fromEntries(entries);
    }
    return value;
  }
}
```
