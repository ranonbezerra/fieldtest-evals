import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { ChainClient } from '../src/chain/chain-client.interface.js';
import { FakeChainClient } from '../src/chain/fake-chain-client.js';
import { AnchorService } from '../src/anchor/anchor.service.js';
import { AnchorRepository } from '../src/anchor/anchor.repository.js';
import { ConfirmationWorker } from '../src/anchor/confirmation-worker.js';
import { RecoverySweep } from '../src/anchor/recovery-sweep.js';
import { AnchorController } from '../src/anchor/anchor.controller.js';
import type { VerifyResult } from '../src/anchor/anchor.types.js';

describe('Anchor', () => {
  let prisma: PrismaClient;
  let chainClient: FakeChainClient;
  let anchorService: AnchorService;
  let repository: AnchorRepository;
  let confirmationWorker: ConfirmationWorker;
  let recoverySweep: RecoverySweep;
  let controller: AnchorController;

  const DOC_ID = 'doc-1';
  const VERSION = '1.0.0';
  const CONTENT = { title: 'Report', patient: { id: 42, name: 'Alice' }, findings: ['normal'] };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [],
      providers: [
        { provide: PrismaClient, useValue: new PrismaClient() },
        { provide: 'ChainClient', useClass: FakeChainClient },
        AnchorService,
        AnchorRepository,
        AnchorController,
        ConfirmationWorker,
        RecoverySweep,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaClient);
    await prisma.$connect();
    chainClient = moduleRef.get<FakeChainClient>('ChainClient');
    anchorService = moduleRef.get(AnchorService);
    repository = moduleRef.get(AnchorRepository);
    confirmationWorker = moduleRef.get(ConfirmationWorker);
    recoverySweep = moduleRef.get(RecoverySweep);
    controller = moduleRef.get(AnchorController);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    chainClient.reset();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "anchors" CASCADE');
  });

  // ─── Canonical hashing ───────────────────────────────────────────

  describe('canonicalHash', () => {
    it('is deterministic for the same content', async () => {
      const { canonicalHash } = await import('../src/anchor/anchor.service.js');
      const h1 = canonicalHash(CONTENT);
      const h2 = canonicalHash(CONTENT);
      expect(h1).toBe(h2);
    });

    it('is insensitive to key ordering', async () => {
      const { canonicalHash } = await import('../src/anchor/anchor.service.js');
      const reordered = { patient: CONTENT.patient, findings: CONTENT.findings, title: CONTENT.title };
      expect(canonicalHash(CONTENT)).toBe(canonicalHash(reordered));
    });

    it('produces different hashes for different content', async () => {
      const { canonicalHash } = await import('../src/anchor/anchor.service.js');
      const different = { ...CONTENT, title: 'Different' };
      expect(canonicalHash(CONTENT)).not.toBe(canonicalHash(different));
    });
  });

  // ─── anchorDocument ──────────────────────────────────────────────

  describe('anchorDocument', () => {
    it('persists anchor intent with tx identity BEFORE broadcasting', async () => {
      chainClient.setBroadcastOutcome('success');

      const broadcastSpy = jest.spyOn(chainClient, 'broadcast').mockImplementation(async () => {});

      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      expect(anchor.contentHash).toBeTruthy();
      expect(anchor.txId).toBeTruthy();
      expect(anchor.signedTx).toBeTruthy();
      expect(anchor.status).toBe('BROADCAST_SENT');

      const dbRecord = await repository.findById(anchor.id);
      expect(dbRecord).not.toBeNull();

      broadcastSpy.mockRestore();
    });

    it('rejects duplicate (documentId, version) via database unique constraint', async () => {
      chainClient.setBroadcastOutcome('success');

      await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      await expect(
        anchorService.anchorDocument(DOC_ID, VERSION, CONTENT),
      ).rejects.toThrow('P2002');
    });

    it('handles broadcast timeout by setting BROADCAST_LIMBO status', async () => {
      chainClient.setBroadcastOutcome('timeout');

      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      expect(anchor.status).toBe('BROADCAST_LIMBO');
      expect(anchor.txId).toBeTruthy();
      expect(anchor.signedTx).toBeTruthy();
    });

    it('produces exactly one anchor with one txId even when broadcast times out', async () => {
      chainClient.setBroadcastOutcome('timeout');

      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      await expect(
        anchorService.anchorDocument(DOC_ID, VERSION, CONTENT),
      ).rejects.toThrow();

      const all = await prisma.anchor.findMany();
      expect(all).toHaveLength(1);
      expect(all[0].txId).toBe(anchor.txId);
    });
  });

  // ─── Confirmation worker ─────────────────────────────────────────

  describe('ConfirmationWorker', () => {
    it('confirms a BROADCAST_SENT anchor when receipt exists', async () => {
      chainClient.setBroadcastOutcome('success');
      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      chainClient.addReceipt(anchor.txId, 12345, 'confirmed');

      const processed = await confirmationWorker.run();
      expect(processed).toHaveLength(1);
      expect(processed[0].status).toBe('CONFIRMED');
      expect(processed[0].block).toBe(12345);
    });

    it('leaves BROADCAST_SENT anchor unchanged when no receipt yet', async () => {
      chainClient.setBroadcastOutcome('success');
      await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      const processed = await confirmationWorker.run();
      expect(processed).toHaveLength(0);

      const anchor = await repository.findByDocumentAndVersion(DOC_ID, VERSION);
      expect(anchor!.status).toBe('BROADCAST_SENT');
    });
  });

  // ─── Recovery sweep ──────────────────────────────────────────────

  describe('RecoverySweep', () => {
    it('broadcast timed out but landed → recovery confirms from receipt, NO re-broadcast', async () => {
      chainClient.setBroadcastOutcome('timeout');

      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);
      expect(anchor.status).toBe('BROADCAST_LIMBO');

      chainClient.addReceipt(anchor.txId, 98765, 'confirmed');

      const broadcastSpy = jest.spyOn(chainClient, 'broadcast').mockImplementation(async () => {});

      const processed = await recoverySweep.run();
      expect(processed).toHaveLength(1);
      expect(processed[0].status).toBe('CONFIRMED');
      expect(processed[0].block).toBe(98765);

      expect(broadcastSpy).not.toHaveBeenCalled();

      broadcastSpy.mockRestore();
    });

    it('broadcast timed out and did not land → re-broadcasts same signed tx, one anchor', async () => {
      chainClient.setBroadcastOutcome('timeout');

      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);
      expect(anchor.status).toBe('BROADCAST_LIMBO');

      const broadcastSpy = jest.spyOn(chainClient, 'broadcast').mockImplementation(async () => {});

      const processed = await recoverySweep.run();
      expect(processed).toHaveLength(1);
      expect(processed[0].status).toBe('BROADCAST_SENT');

      expect(broadcastSpy).toHaveBeenCalledWith(anchor.signedTx);

      broadcastSpy.mockRestore();

      const all = await prisma.anchor.findMany();
      expect(all).toHaveLength(1);
      expect(all[0].txId).toBe(anchor.txId);
    });

    it('recovers PREPARED anchors (crash before broadcast) by broadcasting same signed tx', async () => {
      chainClient.setBroadcastOutcome('success');

      const { txId, signedTx } = chainClient.prepare({ documentId: DOC_ID, version: VERSION, contentHash: 'fakehash' });
      await repository.create({
        documentId: DOC_ID,
        version: VERSION,
        contentHash: 'fakehash',
        txId,
        signedTx,
        status: 'PREPARED',
      });

      const broadcastSpy = jest.spyOn(chainClient, 'broadcast').mockImplementation(async () => {});

      const processed = await recoverySweep.run();
      expect(processed).toHaveLength(1);
      expect(processed[0].status).toBe('BROADCAST_SENT');
      expect(broadcastSpy).toHaveBeenCalledWith(signedTx);

      broadcastSpy.mockRestore();
    });
  });

  // ─── verify ──────────────────────────────────────────────────────

  describe('verify', () => {
    it('returns anchoring proof for matching content', async () => {
      chainClient.setBroadcastOutcome('success');
      await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      const anchor = await anchorService.getAnchor(DOC_ID, VERSION);
      chainClient.addReceipt(anchor!.txId, 54321, 'confirmed');

      await confirmationWorker.run();

      const result = (await controller.verify(DOC_ID, VERSION, { content: CONTENT })) as VerifyResult;
      expect((result as { txId: string }).txId).toBe(anchor!.txId);
      expect((result as { block: number }).block).toBe(54321);
    });

    it('returns mismatch report for non-matching content', async () => {
      chainClient.setBroadcastOutcome('success');
      await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);

      const anchor = await anchorService.getAnchor(DOC_ID, VERSION);
      chainClient.addReceipt(anchor!.txId, 54321, 'confirmed');
      await confirmationWorker.run();

      const result = (await controller.verify(DOC_ID, VERSION, { content: { title: 'Tampered' } })) as VerifyResult;
      expect((result as { mismatch: boolean }).mismatch).toBe(true);
      expect((result as { expectedHash: string }).expectedHash).toBe(anchor!.contentHash);
    });

    it('throws anchor_not_found when no anchor exists', async () => {
      await expect(
        controller.verify('nonexistent', '1.0', { content: {} }),
      ).rejects.toThrow('anchor_not_found');
    });
  });

  // ─── Crash recovery integration ──────────────────────────────────

  describe('crash recovery integration', () => {
    it('one anchor, one txId after crash between broadcast and confirmation', async () => {
      chainClient.setBroadcastOutcome('success');

      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);
      const txId = anchor.txId;

      expect((await prisma.anchor.count())).toBe(1);

      chainClient.addReceipt(txId, 11111, 'confirmed');

      await confirmationWorker.run();

      const finalAnchor = await repository.findByDocumentAndVersion(DOC_ID, VERSION);
      expect(finalAnchor).not.toBeNull();
      expect(finalAnchor!.status).toBe('CONFIRMED');
      expect(finalAnchor!.block).toBe(11111);
      expect(finalAnchor!.txId).toBe(txId);

      const all = await prisma.anchor.findMany();
      expect(all).toHaveLength(1);
      expect(all[0].txId).toBe(txId);
    });

    it('crash before confirmation with broadcast timeout — recovery sweep resolves', async () => {
      chainClient.setBroadcastOutcome('timeout');

      const anchor = await anchorService.anchorDocument(DOC_ID, VERSION, CONTENT);
      expect(anchor.status).toBe('BROADCAST_LIMBO');

      chainClient.addReceipt(anchor.txId, 22222, 'confirmed');
      await recoverySweep.run();

      const finalAnchor = await repository.findByDocumentAndVersion(DOC_ID, VERSION);
      expect(finalAnchor!.status).toBe('CONFIRMED');
      expect(finalAnchor!.block).toBe(22222);
      expect(finalAnchor!.txId).toBe(anchor.txId);

      const all = await prisma.anchor.findMany();
      expect(all).toHaveLength(1);
    });
  });
});
