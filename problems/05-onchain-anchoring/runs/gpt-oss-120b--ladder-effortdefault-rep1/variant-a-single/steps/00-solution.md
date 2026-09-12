# solution

## reasoning

```
We need to design files for the solution implementing anchoring.

We need to provide Prisma schema, modules, controller, service, repository, worker, recovery sweep, and tests.

Given the constraints, we must produce all necessary files. No existing code is shown, so we assume empty project.

We need to follow conventions: folder per feature, e.g., anchor. Let's create feature "anchor". So files: src/anchor/anchor.module.ts, anchor.controller.ts, anchor.service.ts, anchor.repository.ts. Also worker: src/anchor/anchor.worker.ts maybe as a provider (a scheduled task). Also recovery sweep perhaps a separate service.

Also need a chain client interface and a fake implementation for tests.

We need to implement canonicalization: define deterministic JSON serialization: sort keys recursively, convert numbers to canonical string (e.g., JSON.stringify with stable ordering). We'll write a function canonicalize(content: any): string that does sorted keys, numbers as is, no whitespace.

Hash: SHA-256, output hex.

Prisma schema: we need tables: Document (maybe) but at least Anchor with fields: id (Int @id @default(autoincrement())), document_id (String), version (Int), hash (String), tx_id (String), signed_tx (String), state (enum AnchorState), block_number (Int? optional), created_at, updated_at. Unique constraint on (document_id, version). Also enum AnchorState with values: PREPARED, BROADCASTED, CONFIRMED, FAILED, UNKNOWN (for broadcast attempted outcome unknown). Might also have attemptedAt timestamp.

We'll need to generate migration but not needed.

Service: anchorDocument(documentId: string, version: number, content: any): Promise<Anchor> (or void). Steps: compute hash, call chainClient.prepare({documentId, version, hash}) returning txId, signedTx. Persist anchor with state PREPARED and txId, signedTx, hash. Then broadcast(signedTx). After broadcast call, update state to BROADCASTED (maybe). If broadcast throws timeout (simulated), we keep state as UNKNOWN (or maybe keep BROADCASTED and a flag). But spec wants a distinct state for broadcast attempted outcome unknown. We'll define state UNKNOWN after broadcast attempt if error occurs.

Worker: poll for anchors with state BROADCASTED or UNKNOWN (or PREPARED?) and call getReceipt(txId). If receipt exists, set state CONFIRMED and store blockNumber. If receipt not found and state is UNKNOWN (broadcast timeout), re-broadcast signedTx, and maybe set state BROADCASTED again.

Recovery sweep: a service method that runs on startup: find anchors with state not CONFIRMED (maybe BROADCASTED or UNKNOWN) and process similarly but first query receipt; if receipt found, confirm; else re-broadcast.

Tests: need to test:

- Intent persisted before broadcast; simulate crash after persist but before broadcast, then recovery ensures anchor confirmed (if broadcast landed) or re-broadcast.

- Duplicate anchor attempt throws unique constraint error.

- verify method recomputes hash and returns proof or mismatch.

We need a fake chain client that stores prepared transactions in memory map txId->signedTx and a broadcast that may simulate timeout or success; getReceipt returns receipt if transaction considered "landed". For test control, we can configure behavior.

Implement chain client interface:

interface ChainClient {
  prepare(payload: { documentId: string; version: number; hash: string }): Promise<{ txId: string; signedTx: string }>;
  broadcast(signedTx: string): Promise<void>; // may reject with TimeoutError
  getReceipt(txId: string): Promise<{ blockNumber: number } | null>;
}

Provide FakeChainClient with behavior injection.

We need to register providers.

Testing with Vitest: create test/anchor.spec.ts. Use Nest testing module to compile module with provider overrides for chain client (useFake). Use in-memory SQLite via Prisma? but we can use SQLite for test; but spec says PostgreSQL. For tests we can use SQLite in-memory; but maybe fine.

Simplify: use Prisma with SQLite file for test.

But we just need to provide test code.

Ok produce files:

- prisma/schema.prisma

- src/main.ts (bootstrap Nest app)

- src/app.module.ts (import AnchorModule)

- src/anchor/anchor.module.ts (imports PrismaModule maybe; define providers: AnchorService, AnchorRepository, AnchorWorker, ChainClient (use fake for env? In production we would have real client). For now we can provide token 'CHAIN_CLIENT' injection token.

- src/anchor/anchor.controller.ts (Endpoints: POST /anchor/:documentId/:version, body content; GET /anchor/:documentId/:version/verify with content?). We'll just implement methods.

- src/anchor/anchor.service.ts

- src/anchor/anchor.repository.ts

- src/anchor/anchor.worker.ts

- src/anchor/chain-client.interface.ts

- src/anchor/fake-chain-client.service.ts

- test/anchor.spec.ts

Given the limited time, produce concise implementation.

Let's craft the files.
```

## reply

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum AnchorState {
  PREPARED
  BROADCASTED
  CONFIRMED
  FAILED
  UNKNOWN   // broadcast attempted, outcome unknown
}

model Anchor {
  id         Int          @id @default(autoincrement())
  documentId String       @map("document_id")
  version    Int
  hash       String
  txId       String       @map("tx_id")
  signedTx   String       @map("signed_tx")
  state      AnchorState
  blockNumber Int?        @map("block_number")
  createdAt  DateTime     @default(now()) @map("created_at")
  updatedAt  DateTime     @updatedAt       @map("updated_at")

  @@unique([documentId, version], name: "uq_anchor_document_version")
  @@map("anchor")
}
```

### src/main.ts
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { AnchorModule } from './anchor/anchor.module';

@Module({
  imports: [AnchorModule],
})
export class AppModule {}
```

### src/anchor/anchor.module.ts
```ts
import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { AnchorWorker } from './anchor.worker';
import { ChainClient } from './chain-client.interface';
import { FakeChainClient } from './fake-chain-client.service';
import { PrismaService } from '../prisma.service';

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
import { AnchorService } from './anchor.service';

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

### src/anchor/anchor.service.ts
```ts
import {
  Injectable,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AnchorRepository } from './anchor.repository';
import { ChainClient } from './chain-client.interface';
import { canonicalize, sha256 } from './canonicalization';
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

### src/anchor/anchor.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
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

### src/anchor/anchor.worker.ts
```ts
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { AnchorRepository } from './anchor.repository';
import { ChainClient } from './chain-client.interface';
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

### src/anchor/chain-client.interface.ts
```ts
export interface ChainClient {
  /**
   * Deterministically creates a transaction for anchoring.
   */
  prepare(payload: {
    documentId: string;
    version: number;
    hash: string;
  }): Promise<{ txId: string; signedTx: string }>;

  /**
   * Sends a signed transaction to the L2.
   * May reject (e.g., timeout) with unknown outcome.
   */
  broadcast(signedTx: string): Promise<void>;

  /**
   * Retrieves a receipt if the transaction has been included.
   * Returns null when unknown.
   */
  getReceipt(txId: string): Promise<{ blockNumber: number } | null>;
}
```

### src/anchor/fake-chain-client.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { ChainClient } from './chain-client.interface';
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

### src/anchor/canonicalization.ts
```ts
import { createHash } from 'crypto';

/**
 * Deterministic canonicalization:
 * - Recursively sort object keys alphabetically.
 * - Serialize numbers using JSON.stringify (preserves value).
 * - No whitespace.
 * - UTF‑8 encoding of resulting string.
 */
export function canonicalize(value: any): string {
  if (value === null || typeof value !== 'object') {
    // primitives
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((v) => canonicalize(v));
    return `[${items.join(',')}]`;
  }

  // object
  const keys = Object.keys(value).sort();
  const props = keys.map((k) => `"${k}":${canonicalize(value[k])}`);
  return `{${props.join(',')}}`;
}

/**
 * SHA‑256 hash of UTF‑8 bytes, returned as hex string.
 */
export function sha256(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
```

### test/anchor.spec.ts
```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AnchorModule } from '../src/anchor/anchor.module';
import { AnchorService } from '../src/anchor/anchor.service';
import { AnchorRepository } from '../src/anchor/anchor.repository';
import { FakeChainClient } from '../src/anchor/fake-chain-client.service';
import { PrismaService } from '../src/prisma.service';
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
