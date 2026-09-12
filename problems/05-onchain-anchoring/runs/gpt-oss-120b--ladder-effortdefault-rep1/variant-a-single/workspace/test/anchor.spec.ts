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
