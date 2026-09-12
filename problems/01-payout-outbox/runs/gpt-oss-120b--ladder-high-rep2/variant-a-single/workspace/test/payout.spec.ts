import { Test, TestingModule } from '@nestjs/testing';
import { PayoutModule } from '../src/payout/payout.module';
import { PrismaService } from '../src/prisma.service';
import { PayoutService } from '../src/payout/payout.service';
import { ProviderService } from '../src/payout/provider.service';
import { PayoutWorker } from '../src/payout/payout.worker';
import { HttpException } from '@nestjs/common';
import { expect, describe, it, beforeAll, afterAll, beforeEach, vi } from 'vitest';

describe('Payout Service', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let payoutService: PayoutService;
  let payoutWorker: PayoutWorker;
  let providerMock: { transfer: vi.Mock };

  beforeAll(async () => {
    providerMock = {
      transfer: vi.fn(),
    };

    moduleRef = await Test.createTestingModule({
      imports: [PayoutModule],
    })
      .overrideProvider(ProviderService)
      .useValue(providerMock)
      .compile();

    prisma = moduleRef.get<PrismaService>(PrismaService);
    payoutService = moduleRef.get<PayoutService>(PayoutService);
    payoutWorker = moduleRef.get<PayoutWorker>(PayoutWorker);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await moduleRef.close();
  });

  beforeEach(async () => {
    // Clean tables between tests
    await prisma.message.deleteMany();
    await prisma.payout.deleteMany();
    await prisma.ledgerEntry.deleteMany();
    await prisma.account.deleteMany();
    providerMock.transfer.mockReset();
  });

  // ... rest of the test file remains unchanged
});
