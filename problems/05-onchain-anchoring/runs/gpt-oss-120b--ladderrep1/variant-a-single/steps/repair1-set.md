# repair1-set

## reasoning

```
We need to add .js extensions to imports because ESM. The repo likely missing .js. So adjust all imports to include .js. Eg import { AnchorService } from './anchor.service'; should be './anchor.service.js'. Similarly others. Also for prisma.service path. Provide changes for those files.

List files with imports: anchor.controller.ts, anchor.module.ts, anchor.repository.ts, anchor.service.ts, anchor.worker.ts, fake-chain-client.service.ts, app.module.ts, main.ts, test files. Tests also need .js extensions? In tsconfig with moduleResolution node16, need .js in imports. So update.

Provide full file contents with corrected imports.
```

## reply

### src/anchor/anchor.controller.ts
```ts
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AnchorService } from './anchor.service.js';

@Controller('anchor')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post(':documentId/:version')
  async anchorDocument(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() content: unknown,
  ) {
    try {
      await this.anchorService.anchorDocument(
        documentId,
        parseInt(version, 10),
        content,
      );
      return { status: 'anchoring_started' };
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      throw new HttpException(
        { error: { code: 'internal_error', message: `${err}` , details: {} } },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('verify/:documentId/:version')
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() content: unknown,
  ) {
    const result = await this.anchorService.verify(
      documentId,
      parseInt(version, 10),
      content,
    );
    return result;
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
import { ChainClient } from './chain-client.interface.js';
import { FakeChainClient } from './fake-chain-client.service.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  controllers: [AnchorController],
  providers: [
    PrismaService,
    AnchorRepository,
    AnchorService,
    AnchorWorker,
    {
      provide: ChainClient,
      useClass: FakeChainClient, // in real env replace with real impl
    },
  ],
  exports: [AnchorService],
})
export class AnchorModule {}
```

### src/anchor/anchor.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import {
  Anchor,
  AnchorState,
} from '@prisma/client';

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createIntent(params: {
    documentId: string;
    version: number;
    hash: string;
    txId: string;
    signedTx: string;
  }): Promise<Anchor> {
    return this.prisma.anchor.create({
      data: {
        documentId: params.documentId,
        version: params.version,
        hash: params.hash,
        txId: params.txId,
        signedTx: params.signedTx,
        state: AnchorState.PREPARED,
      },
    });
  }

  async updateState(
    txId: string,
    state: AnchorState,
    blockNumber?: number,
  ): Promise<void> {
    await this.prisma.anchor.updateMany({
      where: { txId },
      data: {
        state,
        blockNumber,
        updatedAt: new Date(),
      },
    });
  }

  async findByTxId(txId: string) {
    return this.prisma.anchor.findUnique({ where: { txId } });
  }

  async findPending(): Promise<Anchor[]> {
    // pending includes BROADCASTED, UNKNOWN, PREPARED
    return this.prisma.anchor.findMany({
      where: {
        state: {
          in: [
            AnchorState.PREPARED,
            AnchorState.BROADCASTED,
            AnchorState.UNKNOWN,
          ],
        },
      },
    });
  }

  async findByDocumentVersion(
    documentId: string,
    version: number,
  ): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: {
        documentId_version: {
          documentId,
          version,
        },
      },
    });
  }
}
```

### src/anchor/anchor.service.ts
```ts
import {
  Injectable,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { ChainClient } from './chain-client.interface.js';
import { canonicalize, sha256 } from './canonicalization.js';
import { AnchorState } from '@prisma/client';

@Injectable()
export class AnchorService {
  constructor(
    private readonly repo: AnchorRepository,
    private readonly chain: ChainClient,
  ) {}

  /**
   * Anchor a document version.
   * Steps:
   * 1. canonicalize content and hash it
   * 2. prepare transaction (deterministic, yields txId & signedTx)
   * 3. persist intent (state PREPARED) with txId, signedTx, hash
   * 4. broadcast signedTx
   *    - on success set state BROADCASTED
   *    - on timeout set state UNKNOWN (outcome unknown)
   */
  async anchorDocument(
    documentId: string,
    version: number,
    content: unknown,
  ): Promise<void> {
    const canonical = canonicalize(content);
    const hash = sha256(canonical);

    const { txId, signedTx } = await this.chain.prepare({
      documentId,
      version,
      hash,
    });

    try {
      await this.repo.createIntent({
        documentId,
        version,
        hash,
        txId,
        signedTx,
      });
    } catch (err: any) {
      // Prisma throws a unique constraint violation (code P2002) when duplicate
      if (err.code === 'P2002') {
        throw new ConflictException({
          error: {
            code: 'anchor_already_exists',
            message: `Anchor for document ${documentId} version ${version} already exists`,
            details: {},
          },
        });
      }
      throw new InternalServerErrorException({
        error: {
          code: 'db_error',
          message: err.message,
          details: {},
        },
      });
    }

    try {
      await this.chain.broadcast(signedTx);
      await this.repo.updateState(txId, AnchorState.BROADCASTED);
    } catch (err: any) {
      // Assume any error here is a timeout / unknown outcome
      await this.repo.updateState(txId, AnchorState.UNKNOWN);
      // rethrow so the controller can report if needed, but we swallow to keep flow
    }
  }

  /**
   * Verify content against stored anchor.
   * Returns proof (txId, blockNumber) if hash matches and anchor is confirmed.
   * Otherwise returns mismatch report.
   */
  async verify(
    documentId: string,
    version: number,
    content: unknown,
  ): Promise<any> {
    const anchor = await this.repo.findByDocumentVersion(documentId, version);
    if (!anchor) {
      return {
        error: {
          code: 'anchor_not_found',
          message: `No anchor for document ${documentId} version ${version}`,
          details: {},
        },
      };
    }

    const canonical = canonicalize(content);
    const hash = sha256(canonical);

    if (hash !== anchor.hash) {
      return {
        error: {
          code: 'hash_mismatch',
          message: 'Provided content does not match anchored hash',
          details: { expected: anchor.hash, actual: hash },
        },
      };
    }

    if (anchor.state !== AnchorState.CONFIRMED) {
      return {
        error: {
          code: 'anchor_not_confirmed',
          message: 'Anchor exists but is not yet confirmed on chain',
          details: { state: anchor.state },
        },
      };
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
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { ChainClient } from './chain-client.interface.js';
import { AnchorState } from '@prisma/client';

/**
 * Confirmation worker that polls pending anchors, queries receipts,
 * and updates state. Also acts as the recovery sweep at startup.
 */
@Injectable()
export class AnchorWorker implements OnModuleInit {
  private readonly logger = new Logger(AnchorWorker.name);
  private readonly intervalMs = 5000; // 5 seconds for demo

  constructor(
    private readonly repo: AnchorRepository,
    private readonly chain: ChainClient,
  ) {}

  onModuleInit() {
    this.startPolling();
  }

  private startPolling() {
    setInterval(() => this.processPending(), this.intervalMs);
    // also run once at startup (recovery sweep)
    this.processPending().catch((e) =>
      this.logger.error('Error during recovery sweep', e),
    );
  }

  private async processPending() {
    const pending = await this.repo.findPending();
    for (const anchor of pending) {
      try {
        const receipt = await this.chain.getReceipt(anchor.txId);
        if (receipt) {
          // Transaction landed – confirm
          await this.repo.updateState(
            anchor.txId,
            AnchorState.CONFIRMED,
            receipt.blockNumber,
          );
          this.logger.log(`Anchor ${anchor.id} confirmed at block ${receipt.blockNumber}`);
          continue;
        }

        // No receipt yet
        if (anchor.state === AnchorState.UNKNOWN) {
          // outcome unknown – re‑broadcast same signedTx
          await this.chain.broadcast(anchor.signedTx);
          await this.repo.updateState(anchor.txId, AnchorState.BROADCASTED);
          this.logger.log(`Re‑broadcasted tx ${anchor.txId}`);
        } else if (anchor.state === AnchorState.PREPARED) {
          // broadcast not yet attempted (e.g., crash before broadcast)
          await this.chain.broadcast(anchor.signedTx);
          await this.repo.updateState(anchor.txId, AnchorState.BROADCASTED);
          this.logger.log(`Broadcasted pending tx ${anchor.txId}`);
        }
        // otherwise keep waiting
      } catch (err: any) {
        // If broadcast fails again, keep state UNKNOWN
        if (anchor.state !== AnchorState.UNKNOWN) {
          await this.repo.updateState(anchor.txId, AnchorState.UNKNOWN);
        }
        this.logger.warn(`Error processing anchor ${anchor.id}: ${err}`);
      }
    }
  }
}
```

### src/anchor/fake-chain-client.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { ChainClient } from './chain-client.interface.js';
import { randomUUID } from 'crypto';

/**
 * Simple in‑memory fake that allows tests to control behavior.
 * It records prepared txs and simulates broadcast outcomes.
 */
@Injectable()
export class FakeChainClient implements ChainClient {
  // txId => { signedTx, landed?, blockNumber }
  private store = new Map<
    string,
    { signedTx: string; landed: boolean; blockNumber?: number }
  >();

  // Controls for tests
  public shouldBroadcastSucceed = true;
  public nextBlockNumber = 1000;

  async prepare(payload: {
    documentId: string;
    version: number;
    hash: string;
  }): Promise<{ txId: string; signedTx: string }> {
    const txId = randomUUID();
    const signedTx = `signed(${payload.documentId}|${payload.version}|${payload.hash})`;
    this.store.set(txId, { signedTx, landed: false });
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    // Find the txId for this signedTx
    const entry = [...this.store.entries()].find(
      ([, v]) => v.signedTx === signedTx,
    );
    if (!entry) {
      throw new Error('Unknown signedTx');
    }
    const [txId, meta] = entry;
    if (!this.shouldBroadcastSucceed) {
      // Simulate timeout – we do *not* mark landed
      throw new Error('Broadcast timeout');
    }
    // Mark as landed
    meta.landed = true;
    meta.blockNumber = this.nextBlockNumber++;
    this.store.set(txId, meta);
  }

  async getReceipt(
    txId: string,
  ): Promise<{ blockNumber: number } | null> {
    const meta = this.store.get(txId);
    if (meta && meta.landed && meta.blockNumber !== undefined) {
      return { blockNumber: meta.blockNumber };
    }
    return null;
  }
}
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { AnchorModule } from './anchor/anchor.module.js';

@Module({
  imports: [AnchorModule],
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

### test/anchor.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AnchorModule } from '../src/anchor/anchor.module.js';
import { AnchorService } from '../src/anchor/anchor.service.js';
import { AnchorRepository } from '../src/anchor/anchor.repository.js';
import { FakeChainClient } from '../src/anchor/fake-chain-client.service.js';
import { PrismaService } from '../src/prisma.service.js';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe('AnchorFeature (variant A)', () => {
  let module: TestingModule;
  let service: AnchorService;
  let repo: AnchorRepository;
  let chain: FakeChainClient;
  let prisma: PrismaService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [AnchorModule],
    }).overrideProvider(PrismaService).useValue(new PrismaService()).compile();

    service = module.get<AnchorService>(AnchorService);
    repo = module.get<AnchorRepository>(AnchorRepository);
    chain = module.get<FakeChainClient>(FakeChainClient);
    prisma = module.get<PrismaService>(PrismaService);

    // Ensure clean DB
    await prisma.anchor.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists intent before broadcast and recovers from timeout (landed)', async () => {
    // Arrange: broadcast will succeed, but we simulate a crash after persist
    chain.shouldBroadcastSucceed = false; // first broadcast will timeout

    const docId = 'doc1';
    const version = 1;
    const content = { patient: 'Alice', value: 42 };

    // Act: call anchorDocument – it will persist intent then attempt broadcast (which times out)
    await service.anchorDocument(docId, version, content);
    const intent = await repo.findByDocumentVersion(docId, version);
    expect(intent).toBeTruthy();
    expect(intent?.state).toBe('UNKNOWN');

    // Simulate recovery sweep (worker runs on startup)
    // First, make broadcast succeed now
    chain.shouldBroadcastSucceed = true;

    // Manually invoke worker processing (use private method via any)
    const worker = module.get<any>('AnchorWorker');
    await worker.processPending();

    const confirmed = await repo.findByDocumentVersion(docId, version);
    expect(confirmed?.state).toBe('CONFIRMED');
    expect(confirmed?.blockNumber).toBeGreaterThan(0);
  });

  it('persists intent before broadcast and recovers from timeout (not landed)', async () => {
    // Clean previous data
    await prisma.anchor.deleteMany({});

    // broadcast will always timeout, and receipt will never exist
    chain.shouldBroadcastSucceed = false;

    const docId = 'doc2';
    const version = 1;
    const content = { patient: 'Bob', value: 99 };

    await service.anchorDocument(docId, version, content);
    const intent = await repo.findByDocumentVersion(docId, version);
    expect(intent?.state).toBe('UNKNOWN');

    // recovery sweep should attempt re‑broadcast but still timeout
    const worker = module.get<any>('AnchorWorker');
    await worker.processPending();

    const after = await repo.findByDocumentVersion(docId, version);
    // State remains UNKNOWN because broadcast still fails
    expect(after?.state).toBe('UNKNOWN');
  });

  it('rejects duplicate anchor for same document & version', async () => {
    await prisma.anchor.deleteMany({});
    chain.shouldBroadcastSucceed = true;

    const docId = 'doc3';
    const version = 1;
    const content = { a: 1 };

    await service.anchorDocument(docId, version, content);
    await expect(
      service.anchorDocument(docId, version, content),
    ).rejects.toMatchObject({
      response: {
        error: {
          code: 'anchor_already_exists',
        },
      },
    });
  });

  it('verify returns proof when content matches and anchor confirmed', async () => {
    await prisma.anchor.deleteMany({});
    chain.shouldBroadcastSucceed = true;

    const docId = 'doc4';
    const version = 1;
    const content = { foo: 'bar', num: 123 };

    await service.anchorDocument(docId, version, content);
    // let worker confirm
    const worker = module.get<any>('AnchorWorker');
    await worker.processPending();

    const result = await service.verify(docId, version, content);
    expect(result).toHaveProperty('proof');
    expect(result.proof).toHaveProperty('txId');
    expect(result.proof).toHaveProperty('blockNumber');
  });

  it('verify returns mismatch when content differs', async () => {
    await prisma.anchor.deleteMany({});
    chain.shouldBroadcastSucceed = true;

    const docId = 'doc5';
    const version = 1;
    const content = { x: 10 };
    const other = { x: 11 };

    await service.anchorDocument(docId, version, content);
    const worker = module.get<any>('AnchorWorker');
    await worker.processPending();

    const result = await service.verify(docId, version, other);
    expect(result).toHaveProperty('error');
    expect(result.error.code).toBe('hash_mismatch');
  });
});
```
