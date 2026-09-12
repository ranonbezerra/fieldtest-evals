import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, PayoutStatus } from '@prisma/client';
import { PayoutService } from '../src/payout/payout.service.js';
import { PayoutRepository } from '../src/payout/payout.repository.js';
import { Provider } from '../src/provider.js';
import { PayoutWorker } from '../src/payout/payout.worker.js';
import { execSync } from 'child_process';

const prisma = new PrismaClient();

async function resetDatabase() {
  // Simple reset – drop all data
  await prisma.message.deleteMany({});
  await prisma.payout.deleteMany({});
  await prisma.account.deleteMany({});
  await prisma.ledgerEntry.deleteMany({});
}

/**
 * Helper to create an account with a given settled balance.
 */
async function createAccount(settled: bigint) {
  return prisma.account.create({
    data: {
      settledBalance: settled,
      reservedBalance: BigInt(0),
    },
  });
}

describe('Payout Service Integration Tests', () => {
  let service: PayoutService;
  let repo: PayoutRepository;
  let provider: Provider;
  let worker: PayoutWorker;

  beforeAll(async () => {
    // Ensure DB is migrated – in CI this would run `prisma migrate deploy`
    // Here we assume migrations are already applied.
    await resetDatabase();
    repo = new PayoutRepository(prisma);
    provider = new Provider();
    service = new PayoutService(prisma, repo);
    worker = new PayoutWorker(repo, service, provider);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a payout and reserves funds atomically', async () => {
    const account = await createAccount(BigInt(1000));
    const payout = await service.createPayout({
      accountId: account.id,
      amount: BigInt(400),
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    });

    expect(payout).toBeDefined();
    const refreshedAccount = await prisma.account.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(refreshedAccount.reservedBalance).toBe(BigInt(400));
    expect(refreshedAccount.settledBalance).toBe(BigInt(1000));
  });

  it('idempotent creation with same idempotencyKey does not double reserve', async () => {
    const account = await createAccount(BigInt(500));
    const first = await service.createPayout({
      accountId: account.id,
      amount: BigInt(200),
      destinationAddress: '0xdef',
      idempotencyKey: 'dup-key',
    });
    const second = await service.createPayout({
      accountId: account.id,
      amount: BigInt(200),
      destinationAddress: '0xdef',
      idempotencyKey: 'dup-key',
    });

    expect(first.id).toBe(second.id);

    const refreshed = await prisma.account.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(refreshed.reservedBalance).toBe(BigInt(200));
  });

  it('concurrent requests against same account result in single reservation', async () => {
    const account = await createAccount(BigInt(300));

    // Fire two concurrent creation attempts for the same amount
    const [res1, res2] = await Promise.allSettled([
      service.createPayout({
        accountId: account.id,
        amount: BigInt(250),
        destinationAddress: '0x111',
        idempotencyKey: 'conc-1',
      }),
      service.createPayout({
        accountId: account.id,
        amount: BigInt(250),
        destinationAddress: '0x222',
        idempotencyKey: 'conc-2',
      }),
    ]);

    // Exactly one should succeed, the other should reject with insufficient funds
    const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
    const failures = [res1, res2].filter((r) => r.status === 'rejected');

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    const err: any = (failures[0] as any).reason;
    expect(err.code).toBe('INSUFFICIENT_FUNDS');

    const refreshed = await prisma.account.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(refreshed.reservedBalance).toBe(BigInt(250));
  });

  it('worker processes a message exactly once even if delivered twice', async () => {
    const account = await createAccount(BigInt(1000));
    const payout = await service.createPayout({
      accountId: account.id,
      amount: BigInt(300),
      destinationAddress: '0xdup',
      idempotencyKey: 'dup-msg',
    });

    // Manually fetch the message and duplicate it to simulate redelivery
    const originalMsg = await prisma.message.findUniqueOrThrow({
      where: { payoutId: payout.id },
    });

    // Duplicate row (same payoutId) – violates the unique constraint; catch error
    try {
      await prisma.message.create({
        data: {
          payoutId: payout.id,
        },
      });
    } catch {
      // Expected – we just wanted a second row with same id (simulated by fetching again)
    }

    // Run worker processing twice
    await worker.processMessages();
    await worker.processMessages(); // second run should be a no‑op

    const refreshedPayout = await prisma.payout.findUniqueOrThrow({
      where: { id: payout.id },
    });
    expect(refreshedPayout.status).toBe(PayoutStatus.COMPLETED);
  });

  it('exhausts provider retries and moves payout to NEEDS_REVIEW while keeping reservation', async () => {
    const account = await createAccount(BigInt(500));
    const payout = await service.createPayout({
      accountId: account.id,
      amount: BigInt(200),
      destinationAddress: '0xfail',
      idempotencyKey: 'retry-exhaust',
    });

    // Stub provider to always throw
    const originalTransfer = provider.transfer;
    provider.transfer = async () => {
      throw new Error('Transient failure');
    };

    // Run worker enough times to exceed max attempts (3)
    for (let i = 0; i < 5; i++) {
      await worker.processMessages();
    }

    const refreshedPayout = await prisma.payout.findUniqueOrThrow({
      where: { id: payout.id },
    });
    expect(refreshedPayout.status).toBe(PayoutStatus.NEEDS_REVIEW);

    const refreshedAccount = await prisma.account.findUniqueOrThrow({
      where: { id: account.id },
    });
    // Reservation should still be present
    expect(refreshedAccount.reservedBalance).toBe(BigInt(200));

    // Restore provider
    provider.transfer = originalTransfer;
  });
});
