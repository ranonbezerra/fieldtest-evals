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
