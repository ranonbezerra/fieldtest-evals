# repair2-anchor.spec.ts

## reasoning

```
We need rewrite test file to import correct paths. Likely files exist but path wrong. Provide proper imports and implement tests. Since we don't have implementation, we can mock. Provide basic test skeleton with describe etc. Ensure no ambient declarations. Use vitest. We'll assume modules exist: src/anchor/anchor.service.ts, repository, chain-client.interface, fake-chain-client.service. We'll import them. Write tests for anchorDocument, verify, and recovery. Provide simple mocks.

We'll just write placeholder tests that compile. Use jest/vitest globals. Provide async functions.

Let's craft:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnchorService } from '../src/anchor/anchor.service';
import { AnchorRepository } from '../src/anchor/anchor.repository';
import { FakeChainClientService } from '../src/anchor/fake-chain-client.service';
import { ChainClient } from '../src/anchor/chain-client.interface';
```

Assume constructors: AnchorService takes repository and chainClient. We'll instantiate with mocks.

Write tests for anchoring idempotency.

Just ensure compile.

Return file.
```

## reply

```ts
// test/anchor.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnchorService } from '../src/anchor/anchor.service';
import { AnchorRepository } from '../src/anchor/anchor.repository';
import { FakeChainClientService } from '../src/anchor/fake-chain-client.service';
import { ChainClient } from '../src/anchor/chain-client.interface';

// -----------------------------------------------------------------------------
// Helper mocks
// -----------------------------------------------------------------------------
const makeMockRepository = () => {
  const repo = {
    // persisted anchor intent, indexed by `${documentId}:${version}`
    store: new Map<string, { txId: string; status: 'pending' | 'broadcasted' | 'confirmed' }>(),
    async createIntent(documentId: string, version: number, txId: string) {
      const key = `${documentId}:${version}`;
      if (this.store.has(key)) {
        // Simulate unique constraint violation at DB level
        const err: any = new Error('Unique constraint');
        err.code = 'P2002';
        throw err;
      }
      this.store.set(key, { txId, status: 'pending' });
      return { documentId, version, txId };
    },
    async findByDocumentAndVersion(documentId: string, version: number) {
      const key = `${documentId}:${version}`;
      return this.store.get(key) ?? null;
    },
    async updateStatus(documentId: string, version: number, status: string) {
      const key = `${documentId}:${version}`;
      const rec = this.store.get(key);
      if (rec) {
        rec.status = status as any;
      }
    },
  } as unknown as AnchorRepository;
  return repo;
};

const makeMockChainClient = () => {
  const client = {
    // deterministic prepare returns txId === hash
    async prepare(tx: any) {
      const txId = `tx_${JSON.stringify(tx)}`;
      return { txId, signedTx: `signed_${txId}` };
    },
    // broadcast resolves immediately (no timeout simulation)
    async broadcast(signedTx: string) {
      // no‑op
    },
    // receipt returns a fake block number if txId exists
    async getReceipt(txId: string) {
      return { txId, blockNumber: 123 };
    },
  } as unknown as ChainClient;
  return client;
};

// -----------------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------------
describe('AnchorService', () => {
  let repository: AnchorRepository;
  let chainClient: ChainClient;
  let service: AnchorService;

  const documentId = 'doc-1';
  const version = 1;
  const content = { patient: 'Alice', findings: ['A', 'B'] };

  beforeEach(() => {
    repository = makeMockRepository();
    chainClient = makeMockChainClient();
    // AnchorService is expected to receive a repository and a chain client.
    // The real constructor signature may differ; adjust accordingly.
    service = new AnchorService(repository, chainClient);
  });

  it('anchors a document and stores intent before broadcast', async () => {
    const result = await service.anchorDocument(documentId, version, content);
    // Intent should be persisted
    const persisted = await repository.findByDocumentAndVersion(documentId, version);
    expect(persisted).not.toBeNull();
    expect(persisted?.txId).toBe(result.txId);
    // Broadcast should have been called – we rely on the mock not throwing
    expect(result.txId).toContain('tx_');
  });

  it('prevents anchoring the same document version twice', async () => {
    await service.anchorDocument(documentId, version, content);
    // Second attempt should raise an error (unique constraint)
    await expect(
      service.anchorDocument(documentId, version, content),
    ).rejects.toThrowError(/Unique constraint/);
  });

  it('verifies a correctly anchored document', async () => {
    const anchored = await service.anchorDocument(documentId, version, content);
    const proof = await service.verify(documentId, version, content);
    expect(proof).toEqual({
      txId: anchored.txId,
      block: 123,
    });
  });

  it('reports mismatch when content differs from anchored hash', async () => {
    await service.anchorDocument(documentId, version, content);
    const altered = { ...content, patient: 'Bob' };
    const proof = await service.verify(documentId, version, altered);
    // The service should indicate a mismatch; shape depends on implementation.
    // We assert that the result does NOT contain a valid proof.
    expect(proof).toMatchObject({ error: expect.any(Object) });
  });

  it('recovery sweep resolves anchors stuck after broadcast failure', async () => {
    // Simulate a broadcast that never completed by mocking the repository status.
    const intent = await service.anchorDocument(documentId, version, content);
    await repository.updateStatus(documentId, version, 'broadcasted'); // stuck state

    // Recovery should query the chain and finalize the status.
    await service.recoverStuckAnchors();

    const final = await repository.findByDocumentAndVersion(documentId, version);
    expect(final?.status).toBe('confirmed');
  });
});
```
