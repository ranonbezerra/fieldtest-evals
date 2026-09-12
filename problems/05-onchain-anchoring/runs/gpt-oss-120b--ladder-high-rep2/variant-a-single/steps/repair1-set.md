# repair1-set

## reasoning

```
The errors are path issues: tsconfig likely using baseUrl? The imports use relative paths but files are .ts with ESM. In repo structure, files are at src/anchor/anchor.service.ts etc. The imports use './anchor.service' which is correct relative. But error indicates cannot find module because extension missing? In ESM with "type": "module", need to add .js extension after compilation? Usually need to use .js in imports. So change imports to include .js extension. Apply to all imports referencing local files.

Modify each file import paths to include .js extension, e.g., import { AnchorService } from './anchor.service.js';

Also for prisma.service import '../prisma.service' -> '../prisma.service.js'

For blockchain client './blockchain/blockchain.client' -> './blockchain/blockchain.client.js'

In app.module.ts imports './anchor/anchor.module' -> './anchor/anchor.module.js' etc.

In test files imports need .js? Tests run ts-node? Usually ts-node resolves .ts. But error shows cannot find module '@nestjs/testing' maybe missing dev dependency? Probably need to add .js for relative imports only. The test imports from '../src/...', should include .js? Since compiled? In ts-node, .ts works. But error arises compile, so need .js.

Update all relative imports to .js.

List files to change: src/anchor/anchor.controller.ts, src/anchor/anchor.module.ts, src/anchor/anchor.repository.ts, src/anchor/anchor.service.ts, src/app.module.ts, src/main.ts, src/blockchain/fake-blockchain.service.ts, test/anchor.spec.ts.

Provide full content with corrected imports.
```

## reply

### src/anchor/anchor.controller.ts
```ts
import { Controller, Post, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { AnchorService } from './anchor.service.js';

@Controller('anchors')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post(':documentId/:version')
  async anchor(@Param('documentId') documentId: string, @Param('version') versionStr: string) {
    const version = parseInt(versionStr, 10);
    if (isNaN(version)) {
      throw new HttpException(
        { error: { code: 'invalid_input', message: 'Version must be an integer', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.anchorService.anchorDocument(documentId, version);
  }

  @Post(':documentId/:version/verify')
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') versionStr: string,
    @Body('content') content: any,
  ) {
    const version = parseInt(versionStr, 10);
    if (isNaN(version)) {
      throw new HttpException(
        { error: { code: 'invalid_input', message: 'Version must be an integer', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (content === undefined) {
      throw new HttpException(
        { error: { code: 'invalid_input', message: 'Missing content in request body', details: {} } },
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.anchorService.verify(documentId, version, content);
  }
}
```

### src/anchor/anchor.module.ts
```ts
import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller.js';
import { AnchorService } from './anchor.service.js';
import { AnchorRepository } from './anchor.repository.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  controllers: [AnchorController],
  providers: [AnchorService, AnchorRepository, PrismaService],
  exports: [AnchorService],
})
export class AnchorModule {}
```

### src/anchor/anchor.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Anchor, AnchorStatus } from '@prisma/client';

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createAnchorIntent(
    documentVersionId: string,
    contentHash: string,
    txId: string,
    signedTx: string,
  ): Promise<Anchor> {
    return this.prisma.anchor.create({
      data: {
        document_version_id: documentVersionId,
        content_hash: contentHash,
        tx_id: txId,
        signed_tx: signedTx,
        status: AnchorStatus.PREPARED,
      },
    });
  }

  async updateAnchorStatus(
    anchorId: string,
    status: AnchorStatus,
    blockNumber?: number,
  ): Promise<Anchor> {
    return this.prisma.anchor.update({
      where: { id: anchorId },
      data: {
        status,
        block_number: blockNumber,
      },
    });
  }

  async findAnchorByDocumentVersionId(documentVersionId: string): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: { document_version_id: documentVersionId },
    });
  }

  async findAnchorByTxId(txId: string): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: { tx_id: txId },
    });
  }

  async findPendingAnchors(): Promise<Anchor[]> {
    return this.prisma.anchor.findMany({
      where: { status: AnchorStatus.SENT },
    });
  }

  async findAnchorsInPrepOrSent(): Promise<Anchor[]> {
    return this.prisma.anchor.findMany({
      where: {
        status: { in: [AnchorStatus.PREPARED, AnchorStatus.SENT] },
      },
    });
  }
}
```

### src/anchor/anchor.service.ts
```ts
import { Injectable, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { PrismaService } from '../prisma.service.js';
import {
  BlockchainClient,
  BroadcastTimeoutError,
} from '../blockchain/blockchain.client.js';
import { AnchorStatus, DocumentVersion } from '@prisma/client';
import { createHash } from 'crypto';

@Injectable()
export class AnchorService {
  constructor(
    private readonly anchorRepo: AnchorRepository,
    private readonly prisma: PrismaService,
    @Inject('BlockchainClient') private readonly blockchainClient: BlockchainClient,
  ) {}

  private canonicalizeAndHash(obj: any): string {
    const sortKeys = (value: any): any => {
      if (Array.isArray(value)) {
        return value.map(sortKeys);
      } else if (value && typeof value === 'object') {
        const sorted: any = {};
        Object.keys(value)
          .sort()
          .forEach((key) => {
            sorted[key] = sortKeys(value[key]);
          });
        return sorted;
      }
      return value;
    };
    const canonical = sortKeys(obj);
    const json = JSON.stringify(canonical);
    const hash = createHash('sha256');
    hash.update(json, 'utf8');
    return hash.digest('hex');
  }

  private async getDocumentVersion(documentId: string, version: number): Promise<DocumentVersion> {
    const docVersion = await this.prisma.documentVersion.findFirst({
      where: { document_id: documentId, version },
    });
    if (!docVersion) {
      throw new HttpException(
        {
          error: {
            code: 'resource_not_found',
            message: 'Document version not found',
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return docVersion;
  }

  async anchorDocument(documentId: string, version: number): Promise<{ anchorId: string }> {
    const docVersion = await this.getDocumentVersion(documentId, version);
    const contentHash = this.canonicalizeAndHash(docVersion.content);

    const txData = { documentId, version, contentHash };
    const { txId, signedTx } = await this.blockchainClient.prepare(txData);

    let anchor;
    try {
      anchor = await this.anchorRepo.createAnchorIntent(
        docVersion.id,
        contentHash,
        txId,
        signedTx,
      );
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new HttpException(
          {
            error: {
              code: 'resource_already_exists',
              message: 'Anchor already exists for this document version',
              details: {},
            },
          },
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }

    try {
      await this.blockchainClient.broadcast(signedTx);
      await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.SENT);
    } catch (err) {
      if (err instanceof BroadcastTimeoutError) {
        await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.SENT);
      } else {
        await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.FAILED);
        throw err;
      }
    }

    return { anchorId: anchor.id };
  }

  async processPendingAnchors(): Promise<void> {
    const pending = await this.anchorRepo.findPendingAnchors();
    for (const anchor of pending) {
      const receipt = await this.blockchainClient.getReceipt(anchor.tx_id);
      if (receipt) {
        if (receipt.status === 'success') {
          await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.CONFIRMED, receipt.blockNumber);
        } else {
          await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.FAILED);
        }
      }
    }
  }

  async recoverAnchors(): Promise<void> {
    const toRecover = await this.anchorRepo.findAnchorsInPrepOrSent();
    for (const anchor of toRecover) {
      const receipt = await this.blockchainClient.getReceipt(anchor.tx_id);
      if (receipt) {
        if (receipt.status === 'success') {
          await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.CONFIRMED, receipt.blockNumber);
        } else {
          await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.FAILED);
        }
        continue;
      }

      try {
        await this.blockchainClient.broadcast(anchor.signed_tx);
        await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.SENT);
      } catch (err) {
        if (err instanceof BroadcastTimeoutError) {
          await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.SENT);
        } else {
          await this.anchorRepo.updateAnchorStatus(anchor.id, AnchorStatus.FAILED);
        }
      }
    }
  }

  async verify(
    documentId: string,
    version: number,
    content: any,
  ): Promise<
    | { proof: { txId: string; blockNumber: number } }
    | { mismatch: { expectedHash: string; actualHash: string } }
  > {
    const docVersion = await this.getDocumentVersion(documentId, version);
    const anchor = await this.anchorRepo.findAnchorByDocumentVersionId(docVersion.id);
    if (!anchor) {
      throw new HttpException(
        {
          error: {
            code: 'resource_not_found',
            message: 'No anchor for given document version',
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const actualHash = this.canonicalizeAndHash(content);
    if (actualHash !== anchor.content_hash) {
      return {
        mismatch: {
          expectedHash: anchor.content_hash,
          actualHash,
        },
      };
    }

    if (anchor.status !== AnchorStatus.CONFIRMED) {
      throw new HttpException(
        {
          error: {
            code: 'anchor_not_confirmed',
            message: 'Anchor exists but not yet confirmed on chain',
            details: { txId: anchor.tx_id },
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      proof: {
        txId: anchor.tx_id,
        blockNumber: anchor.block_number!,
      },
    };
  }
}
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { AnchorModule } from './anchor/anchor.module.js';
import { PrismaService } from './prisma.service.js';
import { FakeBlockchainService } from './blockchain/fake-blockchain.service.js';
import { BlockchainClient } from './blockchain/blockchain.client.js';

@Module({
  imports: [AnchorModule],
  providers: [
    PrismaService,
    { provide: 'BlockchainClient', useClass: FakeBlockchainService },
  ],
  exports: [PrismaService],
})
export class AppModule {}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### src/blockchain/fake-blockchain.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { BlockchainClient, ChainTx, ChainReceipt, BroadcastTimeoutError } from './blockchain.client.js';
import { createHash } from 'crypto';

interface TxRecord {
  signedTx: string;
  receipt?: ChainReceipt;
  broadcasted: boolean;
}

/**
 * A fake in‑memory blockchain client for tests.
 * Allows configuring timeouts and manually injecting receipts.
 */
@Injectable()
export class FakeBlockchainService implements BlockchainClient {
  private txMap: Map<string, TxRecord> = new Map();
  private timeoutTxIds: Set<string> = new Set();
  private alwaysTimeout = false;

  /** Force every broadcast to timeout (used by tests). */
  public setAlwaysTimeout(value: boolean) {
    this.alwaysTimeout = value;
  }

  /** Mark a specific transaction ID to timeout on broadcast. */
  public setTimeoutForTxId(txId: string) {
    this.timeoutTxIds.add(txId);
  }

  /** Remove a timeout flag for a specific transaction ID. */
  public clearTimeoutForTxId(txId: string) {
    this.timeoutTxIds.delete(txId);
  }

  /** Manually inject a receipt for a given transaction. */
  public setReceipt(txId: string, receipt: ChainReceipt) {
    const record = this.txMap.get(txId);
    if (record) {
      record.receipt = receipt;
    } else {
      this.txMap.set(txId, { signedTx: '', receipt, broadcasted: false });
    }
  }

  private computeTxId(txData: any): string {
    const hash = createHash('sha256');
    hash.update(JSON.stringify(txData));
    return hash.digest('hex');
  }

  async prepare(txData: any): Promise<ChainTx> {
    const txId = this.computeTxId(txData);
    const signedTx = JSON.stringify(txData); // deterministic signed payload
    if (!this.txMap.has(txId)) {
      this.txMap.set(txId, { signedTx, broadcasted: false });
    }
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    const txData = JSON.parse(signedTx);
    const txId = this.computeTxId(txData);
    const record = this.txMap.get(txId);
    if (!record) {
      throw new Error(`Transaction ${txId} not prepared`);
    }
    record.broadcasted = true;

    if (this.alwaysTimeout || this.timeoutTxIds.has(txId)) {
      // Simulate timeout – outcome unknown.
      throw new BroadcastTimeoutError();
    }

    // In the fake client we do not automatically generate a receipt.
    // Tests are expected to call `setReceipt` when they want the receipt to appear.
    return;
  }

  async getReceipt(txId: string): Promise<ChainReceipt | null> {
    const record = this.txMap.get(txId);
    return record?.receipt ?? null;
  }
}
```

### test/anchor.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AnchorService } from '../src/anchor/anchor.service.js';
import { AnchorRepository } from '../src/anchor/anchor.repository.js';
import { PrismaService } from '../src/prisma.service.js';
import { FakeBlockchainService } from '../src/blockchain/fake-blockchain.service.js';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

describe('AnchorService', () => {
  let moduleRef: TestingModule;
  let anchorService: AnchorService;
  let prisma: PrismaService;
  let blockchain: FakeBlockchainService;

  beforeAll(async () => {
    // Use an in‑memory SQLite DB for tests
    process.env.DATABASE_URL = 'file:memory:?cache=shared';

    moduleRef = await Test.createTestingModule({
      providers: [
        AnchorService,
        AnchorRepository,
        PrismaService,
        { provide: 'BlockchainClient', useClass: FakeBlockchainService },
      ],
    }).compile();

    anchorService = moduleRef.get<AnchorService>(AnchorService);
    prisma = moduleRef.get<PrismaService>(PrismaService);
    blockchain = moduleRef.get<FakeBlockchainService>(FakeBlockchainService);

    await prisma.$connect();

    // Clean any leftover data
    await prisma.anchor.deleteMany();
    await prisma.documentVersion.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.anchor.deleteMany();
    await prisma.documentVersion.deleteMany();
    blockchain.setAlwaysTimeout(false);
  });

  it('anchors a document successfully and confirms it', async () => {
    const docVersion = await prisma.documentVersion.create({
      data: {
        document_id: 'doc1',
        version: 1,
        content: { foo: 'bar', count: 42 },
      },
    });

    const result = await anchorService.anchorDocument('doc1', 1);
    expect(result.anchorId).toBeDefined();

    // Anchor should be in SENT state after broadcast
    let anchor = await prisma.anchor.findUnique({
      where: { document_version_id: docVersion.id },
    });
    expect(anchor).not.toBeNull();
    expect(anchor?.status).toBe('SENT');

    // Simulate receipt appearing on chain
    const receipt = { txId: anchor!.tx_id, blockNumber: 123, status: 'success' as const };
    blockchain.setReceipt(anchor!.tx_id, receipt);

    // Run confirmation worker
    await anchorService.processPendingAnchors();

    // Anchor should now be CONFIRMED
    anchor = await prisma.anchor.findUnique({ where: { document_version_id: docVersion.id } });
    expect(anchor?.status).toBe('CONFIRMED');
    expect(anchor?.block_number).toBe(123);

    // Verify with matching content (order does not matter)
    const verifyResult = await anchorService.verify('doc1', 1, { count: 42, foo: 'bar' });
    expect('proof' in verifyResult).toBe(true);
    if ('proof' in verifyResult) {
      expect(verifyResult.proof.txId).toBe(anchor?.tx_id);
      expect(verifyResult.proof.blockNumber).toBe(123);
    }

    // Verify with mismatching content
    const mismatchResult = await anchorService.verify('doc1', 1, { foo: 'baz', count: 42 });
    expect('mismatch' in mismatchResult).toBe(true);
  });

  it('recovers from broadcast timeout when transaction landed', async () => {
    const docVersion = await prisma.documentVersion.create({
      data: {
        document_id: 'doc2',
        version: 1,
        content: { a: 1 },
      },
    });

    // Force broadcast to timeout
    blockchain.setAlwaysTimeout(true);

    const result = await anchorService.anchorDocument('doc2', 1);
    const anchor = await prisma.anchor.findUnique({ where: { document_version_id: docVersion.id } });
    expect(anchor?.status).toBe('SENT');

    // Simulate that the transaction actually landed on chain
    const receipt = { txId: anchor!.tx_id, blockNumber: 200, status: 'success' as const };
    blockchain.setReceipt(anchor!.tx_id, receipt);

    // Run recovery sweep
    await anchorService.recoverAnchors();

    const updatedAnchor = await prisma.anchor.findUnique({ where: { document_version_id: docVersion.id } });
    expect(updatedAnchor?.status).toBe('CONFIRMED');
    expect(updatedAnchor?.block_number).toBe(200);
  });

  it('recovers from broadcast timeout when transaction did not land', async () => {
    const docVersion = await prisma.documentVersion.create({
      data: {
        document_id: 'doc3',
        version: 1,
        content: { x: true },
      },
    });

    // Force broadcast to timeout on the first attempt
    blockchain.setAlwaysTimeout(true);

    const result = await anchorService.anchorDocument('doc3', 1);
    const anchor = await prisma.anchor.findUnique({ where: { document_version_id: docVersion.id } });
    expect(anchor?.status).toBe('SENT');

    // No receipt – transaction never landed.
    // Allow re‑broadcast without timeout
    blockchain.setAlwaysTimeout(false);

    await anchorService.recoverAnchors();

    const afterRecover = await prisma.anchor.findUnique({ where: { document_version_id: docVersion.id } });
    expect(afterRecover?.status).toBe('SENT');

    // Now simulate receipt after the re‑broadcast
    const receipt = { txId: afterRecover!.tx_id, blockNumber: 300, status: 'success' as const };
    blockchain.setReceipt(afterRecover!.tx_id, receipt);

    // Process pending anchors (confirmation)
    await anchorService.processPendingAnchors();

    const finalAnchor = await prisma.anchor.findUnique({ where: { document_version_id: docVersion.id } });
    expect(finalAnchor?.status).toBe('CONFIRMED');
    expect(finalAnchor?.block_number).toBe(300);
  });

  it('enforces unique anchor per document version', async () => {
    const docVersion = await prisma.documentVersion.create({
      data: {
        document_id: 'doc4',
        version: 1,
        content: { hello: 'world' },
      },
    });

    // First anchoring succeeds
    await anchorService.anchorDocument('doc4', 1);

    // Second anchoring should fail due to the unique constraint
    await expect(anchorService.anchorDocument('doc4', 1)).rejects.toThrow(HttpException);
  });
});
```
