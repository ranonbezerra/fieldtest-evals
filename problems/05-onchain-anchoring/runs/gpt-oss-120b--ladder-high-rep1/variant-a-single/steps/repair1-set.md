# repair1-set

## reasoning

```
We need to add .ts extensions to imports because ESM. All imports missing .js? Actually need .ts? In node16, need .js extension pointing to compiled JS, but tsconfig likely uses "moduleResolution": "node16". So we should add .js extension to relative imports. Change all imports like './anchor.service' to './anchor.service.js' etc. Also imports from '../prisma.service' to '../prisma.service.js'. Also external package '@nestjs/testing' is okay. But maybe need .js extension for those too? Usually node_modules okay. So modify files accordingly.

List files to change: src/anchor/anchor.controller.ts, src/anchor/anchor.module.ts, src/anchor/anchor.repository.ts, src/anchor/anchor.service.ts, src/anchor/anchor.worker.ts, src/anchor/fake-chain-client.service.ts, src/app.module.ts, src/main.ts, test/anchor.spec.ts.

Update import paths adding .js where referring to local files.

Also canonical import missing extension; in anchor.service.ts line import computeCanonicalHash from './canonical'; need './canonical.js'.

Let's produce changed files.
```

## reply

### src/anchor/anchor.controller.ts
```ts
import { Controller, Post, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AnchorService } from './anchor.service.js';

@Controller('anchor')
export class AnchorController {
  constructor(private readonly anchorService: AnchorService) {}

  @Post(':documentId/:version')
  @HttpCode(HttpStatus.CREATED)
  async anchorDocument(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content: any },
  ) {
    const result = await this.anchorService.anchorDocument(documentId, Number(version), body.content);
    return result;
  }

  @Post(':documentId/:version/verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Param('documentId') documentId: string,
    @Param('version') version: string,
    @Body() body: { content: any },
  ) {
    const result = await this.anchorService.verify(documentId, Number(version), body.content);
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
import { AnchorWorkerService } from './anchor.worker.js';
import { ChainClient } from './chain-client.interface.js';
import { FakeChainClient } from './fake-chain-client.service.js';

@Module({
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    AnchorWorkerService,
    {
      provide: 'ChainClient',
      useClass: FakeChainClient,
    },
  ],
  exports: [AnchorService, AnchorWorkerService],
})
export class AnchorModule {}
```

### src/anchor/anchor.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Anchor } from '@prisma/client';
import { AnchorState as AnchorStateEnum } from './anchor-state.enum.js';

@Injectable()
export class AnchorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createPreparedAnchor(params: {
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
        state: AnchorStateEnum.PREPARED,
      },
    });
  }

  async updateState(id: number, state: AnchorStateEnum): Promise<Anchor> {
    return this.prisma.anchor.update({
      where: { id },
      data: { state },
    });
  }

  async updateToConfirmed(id: number, blockNumber: number): Promise<Anchor> {
    return this.prisma.anchor.update({
      where: { id },
      data: {
        state: AnchorStateEnum.CONFIRMED,
        blockNumber,
      },
    });
  }

  async findByDocumentAndVersion(documentId: string, version: number): Promise<Anchor | null> {
    return this.prisma.anchor.findUnique({
      where: {
        documentId_version: {
          documentId,
          version,
        },
      },
    });
  }

  async findByStates(states: AnchorStateEnum[]): Promise<Anchor[]> {
    return this.prisma.anchor.findMany({
      where: {
        state: {
          in: states,
        },
      },
    });
  }
}
```

### src/anchor/anchor.service.ts
```ts
import { Injectable, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { ChainClient } from './chain-client.interface.js';
import { computeCanonicalHash } from './canonical.js';
import { AnchorState } from './anchor-state.enum.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class AnchorService {
  constructor(
    private readonly repository: AnchorRepository,
    @Inject('ChainClient') private readonly chainClient: ChainClient,
  ) {}

  /**
   * Anchors a document version on-chain.
   * Returns the transaction identifier.
   */
  async anchorDocument(documentId: string, version: number, content: any): Promise<{ txId: string }> {
    const hash = computeCanonicalHash(content);
    const { txId, signedTx } = await this.chainClient.prepare({ documentId, version, hash });

    // Persist the intent (state PREPARED) before broadcasting
    let anchor;
    try {
      anchor = await this.repository.createPreparedAnchor({
        documentId,
        version,
        hash,
        txId,
        signedTx,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Unique constraint violation
        throw new HttpException(
          {
            error: {
              code: 'anchor_exists',
              message: `Anchor already exists for document ${documentId} version ${version}`,
              details: {},
            },
          },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    // Broadcast the signed transaction
    try {
      await this.chainClient.broadcast(signedTx);
      await this.repository.updateState(anchor.id, AnchorState.BROADCASTED);
    } catch (e) {
      // Broadcast timed out or outcome unknown
      await this.repository.updateState(anchor.id, AnchorState.BROADCAST_UNKNOWN);
    }

    return { txId };
  }

  /**
   * Verifies that the supplied content matches the anchored hash.
   * Returns the anchoring proof (txId and block number) if matching,
   * otherwise throws a hash mismatch error.
   */
  async verify(documentId: string, version: number, content: any) {
    const anchor = await this.repository.findByDocumentAndVersion(documentId, version);
    if (!anchor) {
      throw new HttpException(
        {
          error: {
            code: 'resource_not_found',
            message: `No anchor found for document ${documentId} version ${version}`,
            details: {},
          },
        },
        HttpStatus.NOT_FOUND,
      );
    }

    const hash = computeCanonicalHash(content);
    if (hash !== anchor.hash) {
      throw new HttpException(
        {
          error: {
            code: 'hash_mismatch',
            message: 'Provided content does not match anchored content',
            details: {
              expected: anchor.hash,
              provided: hash,
            },
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    return {
      txId: anchor.txId,
      blockNumber: anchor.blockNumber ?? null,
    };
  }
}
```

### src/anchor/anchor.worker.ts
```ts
import { Injectable, Inject } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository.js';
import { ChainClient } from './chain-client.interface.js';
import { AnchorState } from './anchor-state.enum.js';

@Injectable()
export class AnchorWorkerService {
  constructor(
    private readonly repository: AnchorRepository,
    @Inject('ChainClient') private readonly chainClient: ChainClient,
  ) {}

  /**
   * Processes anchors that are pending confirmation.
   * For each anchor:
   *   - Query the chain for a receipt.
   *   - If receipt exists, mark as CONFIRMED.
   *   - If no receipt and the anchor is in BROADCAST_UNKNOWN, re‑broadcast the same signed transaction.
   */
  async processPending(): Promise<void> {
    const pending = await this.repository.findByStates([AnchorState.BROADCASTED, AnchorState.BROADCAST_UNKNOWN]);

    for (const anchor of pending) {
      const receipt = await this.chainClient.getReceipt(anchor.txId);
      if (receipt) {
        await this.repository.updateToConfirmed(anchor.id, receipt.blockNumber);
        continue;
      }

      if (anchor.state === AnchorState.BROADCAST_UNKNOWN) {
        try {
          await this.chainClient.broadcast(anchor.signedTx);
          await this.repository.updateState(anchor.id, AnchorState.BROADCASTED);
        } catch (e) {
          // If broadcast still times out, keep state as BROADCAST_UNKNOWN for future retries.
        }
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

interface BroadcastOutcome {
  shouldTimeout: boolean;
  shouldLand: boolean;
}

/**
 * In-memory fake implementation of the L2 chain client.
 * Allows tests to configure broadcast outcomes and inspect call counts.
 */
@Injectable()
export class FakeChainClient implements ChainClient {
  private txStore = new Map<
    string,
    {
      signedTx: string;
      receipt?: { blockNumber: number };
    }
  >();

  private blockCounter = 0;
  private nextBroadcastOutcome: BroadcastOutcome = { shouldTimeout: false, shouldLand: true };
  private broadcastCount = 0;

  /**
   * Configures the outcome of the next broadcast call.
   * Subsequent calls revert to the default (no timeout, lands).
   */
  setNextBroadcastOutcome(opts: Partial<BroadcastOutcome>) {
    this.nextBroadcastOutcome = {
      shouldTimeout: opts.shouldTimeout ?? this.nextBroadcastOutcome.shouldTimeout,
      shouldLand: opts.shouldLand ?? this.nextBroadcastOutcome.shouldLand,
    };
  }

  reset() {
    this.txStore.clear();
    this.blockCounter = 0;
    this.broadcastCount = 0;
    this.nextBroadcastOutcome = { shouldTimeout: false, shouldLand: true };
  }

  getBroadcastCount(): number {
    return this.broadcastCount;
  }

  async prepare(txData: { documentId: string; version: number; hash: string }): Promise<{ txId: string; signedTx: string }> {
    const txId = randomUUID();
    const signedTx = JSON.stringify({ txId, txData });
    this.txStore.set(txId, { signedTx });
    return { txId, signedTx };
  }

  async broadcast(signedTx: string): Promise<void> {
    this.broadcastCount += 1;

    let parsed: any;
    try {
      parsed = JSON.parse(signedTx);
    } catch {
      throw new Error('InvalidSignedTx');
    }
    const txId: string = parsed.txId;
    const record = this.txStore.get(txId);
    if (!record) {
      throw new Error(`Unknown txId ${txId}`);
    }

    // Simulate landing on chain if configured to do so
    if (this.nextBroadcastOutcome.shouldLand) {
      if (!record.receipt) {
        this.blockCounter += 1;
        record.receipt = { blockNumber: this.blockCounter };
      }
    }

    // Simulate timeout condition
    if (this.nextBroadcastOutcome.shouldTimeout) {
      // Reset outcome for subsequent calls
      this.nextBroadcastOutcome = { shouldTimeout: false, shouldLand: true };
      throw new Error('BroadcastTimeout');
    }

    // Reset outcome for subsequent calls
    this.nextBroadcastOutcome = { shouldTimeout: false, shouldLand: true };
  }

  async getReceipt(txId: string): Promise<{ txId: string; blockNumber: number } | null> {
    const record = this.txStore.get(txId);
    if (record && record.receipt) {
      return { txId, blockNumber: record.receipt.blockNumber };
    }
    return null;
  }
}
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { AnchorModule } from './anchor/anchor.module.js';
import { PrismaService } from './prisma.service.js';

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
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(3000);
}
bootstrap();
```

### test/anchor.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { AnchorService } from '../src/anchor/anchor.service.js';
import { AnchorRepository } from '../src/anchor/anchor.repository.js';
import { AnchorWorkerService } from '../src/anchor/anchor.worker.js';
import { FakeChainClient } from '../src/anchor/fake-chain-client.service.js';
import { PrismaService } from '../src/prisma.service.js';
import { AnchorState } from '../src/anchor/anchor-state.enum.js';
import { HttpException } from '@nestjs/common';
import { expect, describe, it, beforeAll, afterEach } from 'vitest';

process.env.DATABASE_URL = 'file:./test.db?mode=memory&cache=shared';

let moduleRef: TestingModule;
let anchorService: AnchorService;
let anchorRepository: AnchorRepository;
let worker: AnchorWorkerService;
let chainClient: FakeChainClient;
let prisma: PrismaService;

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  anchorService = moduleRef.get<AnchorService>(AnchorService);
  anchorRepository = moduleRef.get<AnchorRepository>(AnchorRepository);
  worker = moduleRef.get<AnchorWorkerService>(AnchorWorkerService);
  chainClient = moduleRef.get<FakeChainClient>('ChainClient');
  prisma = moduleRef.get<PrismaService>(PrismaService);
});

afterEach(async () => {
  // Clean database and reset fake client state
  await prisma.anchor.deleteMany();
  chainClient.reset();
});

describe('Anchor flow', () => {
  it('persists intent before broadcast and handles broadcast timeout', async () => {
    chainClient.setNextBroadcastOutcome({ shouldTimeout: true, shouldLand: true });

    const content = { b: 'test', a: 1 };
    const result = await anchorService.anchorDocument('doc1', 1, content);
    expect(result).toHaveProperty('txId');

    const anchor = await anchorRepository.findByDocumentAndVersion('doc1', 1);
    expect(anchor).not.toBeNull();
    expect(anchor?.state).toBe(AnchorState.BROADCAST_UNKNOWN);
  });

  it('recovery sweep confirms landed transaction without rebroadcast', async () => {
    chainClient.setNextBroadcastOutcome({ shouldTimeout: true, shouldLand: true });

    const content = { a: 2 };
    const { txId } = await anchorService.anchorDocument('doc2', 1, content);

    // Process pending anchors (recovery)
    await worker.processPending();

    const anchor = await anchorRepository.findByDocumentAndVersion('doc2', 1);
    expect(anchor?.state).toBe(AnchorState.CONFIRMED);
    expect(anchor?.blockNumber).toBeDefined();
    expect(chainClient.getBroadcastCount()).toBe(1);
  });

  it('re‑broadcasts when transaction did not land and then confirms', async () => {
    // First broadcast times out and does not land
    chainClient.setNextBroadcastOutcome({ shouldTimeout: true, shouldLand: false });
    const content = { x: 'value' };
    await anchorService.anchorDocument('doc3', 1, content);

    // Configure next broadcast to succeed and land
    chainClient.setNextBroadcastOutcome({ shouldTimeout: false, shouldLand: true });

    // Process pending (should re‑broadcast)
    await worker.processPending();

    let anchor = await anchorRepository.findByDocumentAndVersion('doc3', 1);
    expect(anchor?.state).toBe(AnchorState.BROADCASTED);
    expect(chainClient.getBroadcastCount()).toBe(2);

    // Process again to confirm receipt
    await worker.processPending();

    anchor = await anchorRepository.findByDocumentAndVersion('doc3', 1);
    expect(anchor?.state).toBe(AnchorState.CONFIRMED);
    expect(anchor?.blockNumber).toBeDefined();
  });

  it('enforces unique anchor per document version at the schema level', async () => {
    chainClient.setNextBroadcastOutcome({ shouldTimeout: false, shouldLand: false });
    const content = { data: 'first' };
    await anchorService.anchorDocument('doc4', 1, content);

    await expect(
      anchorService.anchorDocument('doc4', 1, content),
    ).rejects.toThrow(HttpException);

    try {
      await anchorService.anchorDocument('doc4', 1, content);
    } catch (e) {
      const httpEx = e as HttpException;
      const response = httpEx.getResponse() as any;
      expect(response.error.code).toBe('anchor_exists');
    }
  });

  it('verify returns proof for matching content and mismatch otherwise', async () => {
    // Anchor and confirm
    chainClient.setNextBroadcastOutcome({ shouldTimeout: false, shouldLand: true });
    const content = { key: 'value' };
    const { txId } = await anchorService.anchorDocument('doc5', 1, content);
    await worker.processPending();

    // Successful verification
    const proof = await anchorService.verify('doc5', 1, content);
    expect(proof.txId).toBe(txId);
    expect(proof.blockNumber).toBeDefined();

    // Mismatched content
    await expect(
      anchorService.verify('doc5', 1, { key: 'different' }),
    ).rejects.toThrow(HttpException);

    try {
      await anchorService.verify('doc5', 1, { key: 'different' });
    } catch (e) {
      const httpEx = e as HttpException;
      const response = httpEx.getResponse() as any;
      expect(response.error.code).toBe('hash_mismatch');
    }
  });
});
```
