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
