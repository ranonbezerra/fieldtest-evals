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
