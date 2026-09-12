# repair1-set

## reasoning

```
The errors due to missing .ts extensions and missing files like prisma.service, anchor.model, chain-client.interface. Likely those files are not present; we need to create them with proper exports. Implement minimal definitions.

Create src/prisma.service.ts exporting PrismaService (using PrismaClient). Also src/anchor/anchor.model.ts exporting AnchorState enum. src/anchor/chain-client.interface.ts defining interface.

Add .js extensions in imports? Since using ES module with node16 resolution, imports need .js extension. However TypeScript can compile with .ts and emit .js; but error says need explicit file extensions. So adjust all import statements to include .js extension (e.g., './anchor.service.js'). Since files are .ts, the compiled .js will have same name. We'll add .js in import paths.

Update all imports accordingly.

Also test imports need .js? test files are .ts compiled, they also need .js extensions? They import from '../src/...'. Should also have .js.

Implement missing files.

Let's apply changes.
```

## reply

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { AnchorModule } from './anchor/anchor.module.js';

@Module({
  imports: [AnchorModule],
  providers: [PrismaService],
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

### src/prisma.service.ts
```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

### src/anchor/anchor.model.ts
```ts
export enum AnchorState {
  PREPARED = 'prepared',
  BROADCASTED = 'broadcasted',
  UNKNOWN = 'unknown',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}
```

### src/anchor/chain-client.interface.ts
```ts
export interface ChainClient {
  /**
   * Prepares a transaction for the given content hash.
   * Returns a deterministic transaction ID and a signed transaction payload.
   */
  prepare(tx: { hash: string }): Promise<{ txId: string; signedTx: string }>;

  /**
   * Broadcasts a signed transaction to the L2.
   * May resolve successfully or reject (e.g., timeout).
   */
  broadcast(signedTx: string): Promise<void>;

  /**
   * Retrieves a receipt for a transaction, if it has been mined.
   */
  getReceipt(
    txId: string,
  ): Promise<{ txId: string; blockNumber: number } | null>;
}
```

### src/anchor/anchor.controller.ts
```ts
import { Controller, Post, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AnchorService } from './anchor.service.js';

@Controller('anchor')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  /**
   * POST /anchor/:documentId/:version
   * Body: { content: any }
   */
  @Post(':documentId/:version')
  async anchorDocument(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body('content') content: any,
  ) {
    const versionNum = parseInt(version, 10);
    return this.anchorService.anchorDocument(documentId, versionNum, content);
  }

  /**
   * POST /anchor/:documentId/:version/verify
   * Body: { content: any }
   */
  @Post(':documentId/:version/verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body('content') content: any,
  ) {
    const versionNum = parseInt(version, 10);
    return this.anchorService.verify(documentId, versionNum, content);
  }
}
```

### src/anchor/anchor.module.ts
```ts
import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller.js';
import { AnchorService } from './anchor.service.js';
import { AnchorRepository } from './anchor.repository.js';
import { AnchorWorker } from './anchor.worker.js';
import { PrismaService } from '../prisma.service.js';
import { ChainClient } from './chain-client.interface.js';
import { FakeChainClient } from './fake-chain-client.js';

@Module({
  controllers: [AnchorController],
  providers: [
    AnchorRepository,
    AnchorService,
    AnchorWorker,
    PrismaService,
    {
      provide: 'CHAIN_CLIENT',
      useClass: FakeChainClient,
    },
  ],
  exports: [AnchorService, AnchorRepository],
})
export class AnchorModule {}
```

### src/anchor/anchor.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { AnchorState } from './anchor.model.js';
import { Anchor } from '@prisma/client';

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    documentId: string;
    version: number;
    contentHash: string;
    txId: string;
    signedTx: string;
    state: AnchorState;
  }): Promise<Anchor> {
    return this.prisma.anchor.create({ data });
  }

  async find(documentId: string, version: number): Promise<Anchor | null> {
    return this.prisma.anchor.findFirst({
      where: { documentId, version },
    });
  }

  async findByTxId(txId: string): Promise<Anchor | null> {
    return this.prisma.anchor.findFirst({ where: { txId } });
  }

  async updateState(
    txId: string,
    newState: AnchorState,
    blockNumber?: number,
  ): Promise<Anchor> {
    const data: any = { state: newState };
    if (blockNumber !== undefined) {
      data.blockNumber = blockNumber;
    }
    await this.prisma.anchor.update({
      where: { txId },
      data,
    });
    // Return the updated record
    return this.prisma.anchor.findFirst({ where: { txId } }) as Promise<Anchor>;
  }

  async findByStates(states: AnchorState[]): Promise<Anchor[]> {
    return this.prisma.anchor.findMany({
      where: { state: { in: states } },
    });
  }

  async deleteAll(): Promise<void> {
    await this.prisma.anchor.deleteMany({});
  }
}
```

### src/anchor/anchor.service.ts
```ts
import {
  Injectable,
  ConflictException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { ChainClient } from './chain-client.interface.js';
import { AnchorState } from './anchor.model.js';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AnchorService {
  constructor(
    private readonly anchorRepository: AnchorRepository,
    @Inject('CHAIN_CLIENT') private readonly chainClient: ChainClient,
  ) {}

  /**
   * Canonicalizes JSON by sorting object keys recursively, removing whitespace,
   * and then hashing the UTF-8 bytes with SHA-256.
   *
   * Canonicalization rules (as required for auditors):
   * - Objects: keys sorted lexicographically.
   * - Arrays: order preserved.
   * - Primitive values: represented using JSON.stringify.
   * - No additional whitespace or indentation.
   */
  private canonicalize(value: any): string {
    if (Array.isArray(value)) {
      return '[' + value.map((v) => this.canonicalize(v)).join(',') + ']';
    }
    if (value && typeof value === 'object') {
      const keys = Object.keys(value).sort();
      return (
        '{' +
        keys
          .map((k) => JSON.stringify(k) + ':' + this.canonicalize(value[k]))
          .join(',') +
        '}'
      );
    }
    return JSON.stringify(value);
  }

  private computeHash(content: any): string {
    const canonical = this.canonicalize(content);
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /**
   * Anchors a document version on-chain.
   * Ensures the transaction identity is persisted before broadcasting.
   */
  async anchorDocument(documentId: string, version: number, content: any) {
    const contentHash = this.computeHash(content);
    // Prepare transaction
    const { txId, signedTx } = await this.chainClient.prepare({ hash: contentHash });

    // Persist intent
    let anchor;
    try {
      anchor = await this.anchorRepository.create({
        documentId,
        version,
        contentHash,
        txId,
        signedTx,
        state: AnchorState.PREPARED,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Unique constraint violation
        throw new ConflictException('Anchor already exists for this document and version');
      }
      throw new InternalServerErrorException('Failed to persist anchor intent');
    }

    // Broadcast
    try {
      await this.chainClient.broadcast(signedTx);
      await this.anchorRepository.updateState(txId, AnchorState.BROADCASTED);
    } catch (e) {
      // Timeout or unknown outcome
      await this.anchorRepository.updateState(txId, AnchorState.UNKNOWN);
    }

    return {
      documentId,
      version,
      txId,
      state: anchor.state,
    };
  }

  /**
   * Verifies provided content against the anchored hash.
   * Returns an anchoring proof if content matches and anchor is confirmed,
   * otherwise returns a mismatch report or error envelope.
   */
  async verify(documentId: string, version: number, content: any) {
    const anchor = await this.anchorRepository.find(documentId, version);
    if (!anchor) {
      throw new HttpException(
        {
          error: {
            code: 'resource_not_found',
            message: `Anchor not found for document ${documentId} version ${version}`,
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const suppliedHash = this.computeHash(content);
    if (suppliedHash !== anchor.contentHash) {
      return {
        mismatch: {
          expectedHash: anchor.contentHash,
          actualHash: suppliedHash,
        },
      };
    }

    if (anchor.state !== AnchorState.CONFIRMED) {
      throw new HttpException(
        {
          error: {
            code: 'anchor_not_confirmed',
            message: `Anchor exists but not yet confirmed (state: ${anchor.state})`,
            details: {},
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      proof: {
        txId: anchor.txId,
        blockNumber: anchor.blockNumber,
      },
    };
  }
}
```

### src/anchor/anchor.worker.ts
```ts
import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { ChainClient } from './chain-client.interface.js';
import { AnchorState } from './anchor.model.js';

@Injectable()
export class AnchorWorker implements OnModuleInit, OnModuleDestroy {
  private intervalId: NodeJS.Timer | undefined;
  private readonly pollIntervalMs = 5000; // 5 seconds

  constructor(
    private readonly anchorRepository: AnchorRepository,
    @Inject('CHAIN_CLIENT') private readonly chainClient: ChainClient,
  ) {}

  onModuleInit() {
    this.intervalId = setInterval(() => this.processPendingAnchors(), this.pollIntervalMs);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  /**
   * Public method for manual triggering (tests or admin commands).
   */
  async processPendingAnchors() {
    const pendingAnchors = await this.anchorRepository.findByStates([
      AnchorState.PREPARED,
      AnchorState.BROADCASTED,
      AnchorState.UNKNOWN,
    ]);

    for (const anchor of pendingAnchors) {
      // First, check if a receipt already exists on-chain
      const receipt = await this.chainClient.getReceipt(anchor.txId);
      if (receipt) {
        await this.anchorRepository.updateState(anchor.txId, AnchorState.CONFIRMED, receipt.blockNumber);
        continue;
      }

      // No receipt yet; attempt broadcast if needed
      if (anchor.state === AnchorState.PREPARED || anchor.state === AnchorState.UNKNOWN) {
        try {
          await this.chainClient.broadcast(anchor.signedTx);
          // After a successful broadcast, check again for receipt
          const postReceipt = await this.chainClient.getReceipt(anchor.txId);
          if (postReceipt) {
            await this.anchorRepository.updateState(anchor.txId, AnchorState.CONFIRMED, postReceipt.blockNumber);
          } else {
            await this.anchorRepository.updateState(anchor.txId, AnchorState.BROADCASTED);
          }
        } catch (e) {
          // Keep as unknown; a future sweep may retry
          await this.anchorRepository.updateState(anchor.txId, AnchorState.UNKNOWN);
        }
      }
      // If state is BROADCASTED, we simply wait for receipt in subsequent polls
    }
  }

  /**
   * Explicit sweep (e.g., on startup) to resolve any limbo anchors.
   */
  async sweepStuckAnchors() {
    await this.processPendingAnchors();
  }
}
```

### src/anchor/fake-chain-client.ts
```ts
import { ChainClient } from './chain-client.interface.js';
import crypto from 'crypto';

type Receipt = { txId: string; blockNumber: number };

export class FakeChainClient implements ChainClient {
  // Map signedTx => txId
  private signedTxMap = new Map<string, string>();
  // Receipts stored by txId
  private receipts = new Map<string, Receipt>();
  // Global flag to force timeout on broadcast
  private forceTimeout = false;
  // Simple block number generator
  private nextBlockNumber = 1;

  /**
   * In tests, set to true to make all subsequent broadcast calls reject with a timeout.
   */
  setForceTimeout(flag: boolean) {
    this.forceTimeout = flag;
  }

  /**
   * Adds a receipt for a transaction, simulating that it landed on-chain.
   */
  addReceipt(txId: string, blockNumber?: number) {
    const bn = blockNumber ?? this.nextBlockNumber++;
    this.receipts.set(txId, { txId, blockNumber: bn });
  }

  /**
   * Clears all internal state (for test isolation).
   */
  clear() {
    this.signedTxMap.clear();
    this.receipts.clear();
    this.forceTimeout = false;
    this.nextBlockNumber = 1;
  }

  async prepare(tx: { hash: string }): Promise<{ txId: string; signedTx: string }> {
    // Deterministic txId based on hash
    const txId = crypto.createHash('sha256').update(tx.hash).digest('hex');
    const signedTx = `signed_${txId}`;
    this.signedTxMap.set(signedTx, txId);
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    const txId = this.signedTxMap.get(signedTx);
    if (!txId) {
      throw new Error('Unknown signed transaction');
    }
    if (this.forceTimeout) {
      // Simulate timeout without creating a receipt
      throw new Error('Timeout');
    }
    // Simulate successful broadcast by creating a receipt if absent
    if (!this.receipts.has(txId)) {
      this.addReceipt(txId);
    }
    // Resolve successfully
    return;
  }

  async getReceipt(txId: string): Promise<{ txId: string; blockNumber: number } | null> {
    const receipt = this.receipts.get(txId);
    return receipt ?? null;
  }
}
```

### test/anchor.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AnchorModule } from '../src/anchor/anchor.module.js';
import { AnchorService } from '../src/anchor/anchor.service.js';
import { AnchorRepository } from '../src/anchor/anchor.repository.js';
import { AnchorWorker } from '../src/anchor/anchor.worker.js';
import { FakeChainClient } from '../src/anchor/fake-chain-client.js';
import { PrismaService } from '../src/prisma.service.js';
import { AnchorState } from '../src/anchor/anchor.model.js';
import { ConflictException } from '@nestjs/common';

describe('Anchor flow', () => {
  let module: TestingModule;
  let anchorService: AnchorService;
  let anchorRepository: AnchorRepository;
  let anchorWorker: AnchorWorker;
  let chainClient: FakeChainClient;
  let prisma: PrismaService;

  const documentId = 'doc-123';
  const version = 1;
  const content = { patient: 'John Doe', test: 'Blood', result: { hemoglobin: 13.5 } };
  const differentContent = { patient: 'John Doe', test: 'Blood', result: { hemoglobin: 14.0 } };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AnchorModule],
    }).compile();

    anchorService = module.get<AnchorService>(AnchorService);
    anchorRepository = module.get<AnchorRepository>(AnchorRepository);
    anchorWorker = module.get<AnchorWorker>(AnchorWorker);
    chainClient = module.get<FakeChainClient>('CHAIN_CLIENT');
    prisma = module.get<PrismaService>(PrismaService);
  });

  beforeEach(async () => {
    await anchorRepository.deleteAll();
    chainClient.clear();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('anchors a document and confirms after receipt', async () => {
    // Normal flow: broadcast succeeds
    const result = await anchorService.anchorDocument(documentId, version, content);
    expect(result).toHaveProperty('txId');

    // Worker should find receipt (broadcast created one) and confirm
    await anchorWorker.processPendingAnchors();

    const anchor = await anchorRepository.find(documentId, version);
    expect(anchor).toBeDefined();
    expect(anchor?.state).toBe(AnchorState.CONFIRMED);
    expect(anchor?.blockNumber).toBeDefined();

    const verifyResult = await anchorService.verify(documentId, version, content);
    expect(verifyResult).toHaveProperty('proof');
    expect(verifyResult.proof.txId).toBe(result.txId);
    expect(verifyResult.proof.blockNumber).toBe(anchor?.blockNumber);
  });

  it('broadcast timeout but transaction landed; recovery confirms without re-broadcast', async () => {
    // Force broadcast to timeout
    chainClient.setForceTimeout(true);
    const result = await anchorService.anchorDocument(documentId, version, content);
    // State should be UNKNOWN
    const anchorAfter = await anchorRepository.find(documentId, version);
    expect(anchorAfter?.state).toBe(AnchorState.UNKNOWN);

    // Simulate that the transaction landed despite timeout
    chainClient.setForceTimeout(false);
    chainClient.addReceipt(result.txId, 42);

    // Run recovery sweep
    await anchorWorker.sweepStuckAnchors();

    const anchor = await anchorRepository.find(documentId, version);
    expect(anchor?.state).toBe(AnchorState.CONFIRMED);
    expect(anchor?.blockNumber).toBe(42);
  });

  it('broadcast timeout and no receipt; re-broadcast leads to single anchor', async () => {
    // Force timeout on first broadcast
    chainClient.setForceTimeout(true);
    await anchorService.anchorDocument(documentId, version, content);
    const anchorPre = await anchorRepository.find(documentId, version);
    expect(anchorPre?.state).toBe(AnchorState.UNKNOWN);

    // Allow broadcast to succeed now
    chainClient.setForceTimeout(false);

    // Run recovery sweep; should re-broadcast and then confirm
    await anchorWorker.sweepStuckAnchors();

    const anchor = await anchorRepository.find(documentId, version);
    expect(anchor?.state).toBe(AnchorState.CONFIRMED);
    expect(anchor?.blockNumber).toBeDefined();

    // Ensure only one anchor row exists
    const allAnchors = await anchorRepository.findByStates([
      AnchorState.CONFIRMED,
      AnchorState.PREPARED,
      AnchorState.UNKNOWN,
      AnchorState.BROADCASTED,
    ]);
    expect(allAnchors).toHaveLength(1);
  });

  it('prevents duplicate anchoring of same document version', async () => {
    await anchorService.anchorDocument(documentId, version, content);
    await expect(
      anchorService.anchorDocument(documentId, version, content),
    ).rejects.toThrow(ConflictException);
  });

  it('verify returns mismatch when content differs', async () => {
    // Anchor normally
    await anchorService.anchorDocument(documentId, version, content);
    await anchorWorker.processPendingAnchors(); // confirm

    const verifyResult = await anchorService.verify(documentId, version, differentContent);
    expect(verifyResult).toHaveProperty('mismatch');
    expect(verifyResult.mismatch.expectedHash).toBeDefined();
    expect(verifyResult.mismatch.actualHash).toBeDefined();
    expect(verifyResult.mismatch.expectedHash).not.toBe(verifyResult.mismatch.actualHash);
  });

  it('recovery after crash: anchor persisted, broadcast timed out, receipt present', async () => {
    // Simulate first process: force timeout, anchorDocument persists intent and attempts broadcast (timeout)
    chainClient.setForceTimeout(true);
    await anchorService.anchorDocument(documentId, version, content);
    // At this point, anchor exists with state UNKNOWN

    // Simulate receipt landing while process is down
    const anchor = await anchorRepository.find(documentId, version);
    expect(anchor).toBeDefined();
    const txId = anchor?.txId!;
    chainClient.setForceTimeout(false);
    chainClient.addReceipt(txId, 55);

    // Simulate new process startup and run recovery sweep
    const newWorker = new AnchorWorker(anchorRepository, chainClient);
    await newWorker.sweepStuckAnchors();

    const recoveredAnchor = await anchorRepository.find(documentId, version);
    expect(recoveredAnchor?.state).toBe(AnchorState.CONFIRMED);
    expect(recoveredAnchor?.blockNumber).toBe(55);
  });
});
```
