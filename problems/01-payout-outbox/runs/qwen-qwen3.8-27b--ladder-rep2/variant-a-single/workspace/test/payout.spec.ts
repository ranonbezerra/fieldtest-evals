/**
 * Behavioural tests for the payout path (concurrent creation, idempotent
 * retries, at-least-once message delivery, retry exhaustion).
 *
 * Requires a PostgreSQL database at DATABASE_URL with the schema applied
 * (`pnpm prisma:migrate`) and `@prisma/client` generated
 * (`pnpm prisma:generate`). PAYOUT_MAX_PROVIDER_ATTEMPTS is pinned to 3 for
 * the exhaustion test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MessageStatus, PayoutStatus, PrismaClient } from '@prisma/client';
import { ApiError } from '../src/common/api-error.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { PayoutController } from '../src/payout/payout.controller.js';
import { PayoutRepository } from '../src/payout/payout.repository.js';
import { PayoutService, type PayoutDto } from '../src/payout/payout.service.js';
import type { PayoutProvider } from '../src/payout/payout-provider.js';

process.env.PAYOUT_MAX_PROVIDER_ATTEMPTS = '3';

const prisma = new PrismaClient();
// The repository only uses the query API, which PrismaClient fully provides.
const repo = new PayoutRepository(prisma as unknown as PrismaService);

type ProviderBehaviour = {
  transfer?: (call: number) => Promise<{ txHash: string }>;
  confirm?: (txHash: string) => Promise<{ settled: boolean }>;
};

function makeProvider(behaviour: ProviderBehaviour = {}) {
  const calls = { transfer: 0, confirm: 0 };
  const provider: PayoutProvider = {
    transfer: async () => {
      calls.transfer += 1;
      if (behaviour.transfer) {
        return behaviour.transfer(calls.transfer);
      }
      return { txHash: `tx-${calls.transfer}` };
    },
    confirmSettlement: async (txHash: string) => {
      calls.confirm += 1;
      if (behaviour.confirm) {
        return behaviour.confirm(txHash);
      }
      return { settled: true };
    },
  };
  return { provider, calls };
}

function makeService(provider: PayoutProvider): PayoutService {
  return new PayoutService(repo, provider);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ACC = 'acc-1';

function createCommand(
  over: Partial<{ idempotencyKey: string; amount: bigint; accountId: string }> = {},
) {
  return {
    accountId: ACC,
    amount: 3000n,
    destinationAddress: '0xdest',
    idempotencyKey: 'key-1',
    ...over,
  };
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.ledgerEntry.deleteMany();
  await prisma.outboxMessage.deleteMany();
  await prisma.payout.deleteMany();
  await prisma.account.deleteMany();
});

async function seedAccount(id: string, settled: bigint, held: bigint = 0n): Promise<void> {
  await prisma.account.create({ data: { id, settled, held } });
}

async function account(id: string = ACC) {
  return prisma.account.findUniqueOrThrow({ where: { id } });
}

async function ledgerSum(): Promise<bigint> {
  const entries = await prisma.ledgerEntry.findMany();
  return entries.reduce((sum, entry) => sum + entry.delta, 0n);
}

function fulfilled(value: PromiseSettledResult<PayoutDto>): PayoutDto {
  if (value.status !== 'fulfilled') {
    throw new Error(`expected fulfilled, got ${JSON.stringify(value)}`);
  }
  return value.value;
}

describe('POST /payouts — creation', () => {
  it('two concurrent creations with funds for one produce exactly one payout and never overdraw', async () => {
    await seedAccount(ACC, 4000n); // 40.00 available
    const service = makeService(makeProvider().provider);

    const [first, second] = await Promise.allSettled([
      service.createPayout(createCommand({ idempotencyKey: 'key-a' })),
      service.createPayout(createCommand({ idempotencyKey: 'key-b' })),
    ]);

    const results = [first, second];
    const winners = results.filter((r) => r.status === 'fulfilled');
    const losers = results.filter((r) => r.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const loser = losers[0] as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(ApiError);
    expect((loser.reason as ApiError).code).toBe('insufficient_funds');
    expect(fulfilled(winners[0]).status).toBe(PayoutStatus.CREATED);

    const acc = await account();
    expect(acc.settled).toBe(4000n); // settled never moves on creation
    expect(acc.held).toBe(3000n); // exactly one reservation, no overdraw
    expect(await prisma.payout.count()).toBe(1);
    expect(await prisma.outboxMessage.count()).toBe(1);
    expect(await prisma.ledgerEntry.count()).toBe(2); // one balanced reserve pair
    expect(await ledgerSum()).toBe(0n);
  });

  it('retrying the same idempotencyKey returns the original payout and reserves nothing further', async () => {
    await seedAccount(ACC, 4000n);
    const service = makeService(makeProvider().provider);

    const first = await service.createPayout(createCommand());
    const second = await service.createPayout(createCommand());

    expect(second).toEqual(first); // same response
    const acc = await account();
    expect(acc.settled).toBe(4000n);
    expect(acc.held).toBe(3000n); // not 6000n
    expect(await prisma.payout.count()).toBe(1);
    expect(await prisma.outboxMessage.count()).toBe(1);
  });

  it('two concurrent requests with the same idempotencyKey reserve once and return the same payout', async () => {
    await seedAccount(ACC, 10000n);
    const service = makeService(makeProvider().provider);

    const [a, b] = await Promise.allSettled([
      service.createPayout(createCommand()),
      service.createPayout(createCommand()),
    ]);

    // A duplicate is not an error: both resolve with the original payout.
    expect(fulfilled(a).id).toBe(fulfilled(b).id);
    const acc = await account();
    expect(acc.held).toBe(3000n);
    expect(acc.settled).toBe(10000n);
    expect(await prisma.payout.count()).toBe(1);
  });
});

describe('outbox worker — at-least-once delivery', () => {
  it('a message seen by two concurrent ticks results in exactly one transfer and one settlement', async () => {
    await seedAccount(ACC, 4000n);
    const { provider, calls } = makeProvider({
      transfer: async () => {
        await delay(50);
        return { txHash: 'tx-1' };
      },
      confirm: async () => {
        await delay(50);
        return { settled: true };
      },
    });
    const service = makeService(provider);
    const { id } = await service.createPayout(createCommand());

    // Simulated redelivery: two ticks observe the same OPEN message.
    await Promise.all([service.processMessages(), service.processMessages()]);

    expect(calls.transfer).toBe(1); // exactly one on-chain transfer
    const payout = await prisma.payout.findUniqueOrThrow({ where: { id } });
    expect(payout.status).toBe(PayoutStatus.COMPLETED);
    expect(payout.txHash).toBe('tx-1');
    const acc = await account();
    expect(acc.settled).toBe(1000n); // moved once, on confirmation
    expect(acc.held).toBe(0n);
    expect(await prisma.ledgerEntry.count()).toBe(4); // reserve pair + settle pair
    expect(await ledgerSum()).toBe(0n);
    const message = await prisma.outboxMessage.findUniqueOrThrow({ where: { payoutId: id } });
    expect(message.status).toBe(MessageStatus.PROCESSED);

    // A delivery after the terminal state is still a no-op.
    await service.processMessages();
    expect(calls.transfer).toBe(1);
  });

  it('a txHash is not settlement: the settled balance moves only on confirmation, and the transfer is never re-sent', async () => {
    await seedAccount(ACC, 4000n);
    let confirmAttempts = 0;
    const { provider, calls } = makeProvider({
      confirm: async () => {
        confirmAttempts += 1;
        if (confirmAttempts === 1) {
          throw new Error('confirmation timed out');
        }
        return { settled: true };
      },
    });
    const service = makeService(provider);
    const { id } = await service.createPayout(createCommand());

    await service.processMessages(); // transfer ok, confirmation fails transiently

    const sent = await prisma.payout.findUniqueOrThrow({ where: { id } });
    expect(sent.status).toBe(PayoutStatus.SENT);
    expect(sent.txHash).toBe('tx-1');
    expect(calls.transfer).toBe(1);
    const acc = await account();
    expect(acc.settled).toBe(4000n); // a txHash alone does not settle
    expect(acc.held).toBe(3000n);

    await service.processMessages(); // confirmation retries, never the transfer

    const completed = await prisma.payout.findUniqueOrThrow({ where: { id } });
    expect(completed.status).toBe(PayoutStatus.COMPLETED);
    expect(calls.transfer).toBe(1);
    const after = await account();
    expect(after.settled).toBe(1000n);
    expect(after.held).toBe(0n);
  });

  it('retry exhaustion without a definitive outcome parks the payout with the reservation intact', async () => {
    await seedAccount(ACC, 4000n);
    const { provider, calls } = makeProvider({
      transfer: async () => {
        throw new Error('provider timed out');
      },
    });
    const service = makeService(provider);
    const { id } = await service.createPayout(createCommand());

    await service.processMessages(); // attempt 1
    expect(calls.transfer).toBe(1);
    let payout = await prisma.payout.findUniqueOrThrow({ where: { id } });
    expect(payout.status).toBe(PayoutStatus.PROCESSING);

    await service.processMessages(); // attempt 2
    payout = await prisma.payout.findUniqueOrThrow({ where: { id } });
    expect(payout.status).toBe(PayoutStatus.PROCESSING);

    await service.processMessages(); // attempt 3 -> park
    payout = await prisma.payout.findUniqueOrThrow({ where: { id } });
    expect(payout.status).toBe(PayoutStatus.NEEDS_REVIEW);
    expect(payout.lastError).toContain('provider timed out');
    expect(calls.transfer).toBe(3);

    // Nothing reversed: the hold is intact and no release legs were written.
    const acc = await account();
    expect(acc.settled).toBe(4000n);
    expect(acc.held).toBe(3000n);
    expect(await prisma.ledgerEntry.count()).toBe(2);
    expect(await ledgerSum()).toBe(0n);
    const message = await prisma.outboxMessage.findUniqueOrThrow({ where: { payoutId: id } });
    expect(message.status).toBe(MessageStatus.PROCESSED);

    // A parked payout is never retried by the worker.
    await service.processMessages();
    expect(calls.transfer).toBe(3);
  });

  it('a definitive non-settlement releases the hold and marks the payout failed', async () => {
    await seedAccount(ACC, 4000n);
    const { provider } = makeProvider({
      confirm: async () => ({ settled: false }),
    });
    const service = makeService(provider);
    const { id } = await service.createPayout(createCommand());

    await service.processMessages();

    const payout = await prisma.payout.findUniqueOrThrow({ where: { id } });
    expect(payout.status).toBe(PayoutStatus.FAILED);
    const acc = await account();
    expect(acc.settled).toBe(4000n);
    expect(acc.held).toBe(0n); // released only because the funds provably did not move
    expect(await prisma.ledgerEntry.count()).toBe(4); // reserve pair + release pair
    expect(await ledgerSum()).toBe(0n);
  });
});

describe('POST /payouts — input validation and error envelope', () => {
  it('rejects malformed bodies with the validation_error envelope', async () => {
    const controller = new PayoutController(makeService(makeProvider().provider));

    await expect(
      controller.createPayout({ accountId: ACC, amount: '3000', destinationAddress: '0x', idempotencyKey: '' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'validation_error' });
    await expect(
      controller.createPayout({ accountId: ACC, amount: -5, destinationAddress: '0x', idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'validation_error' });
    await expect(
      controller.createPayout({ accountId: ACC, amount: '3.5', destinationAddress: '0x', idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'validation_error' });
    expect(await prisma.payout.count()).toBe(0);
  });

  it('returns resource_not_found for an unknown account', async () => {
    const service = makeService(makeProvider().provider);
    await expect(
      service.createPayout({ accountId: 'ghost', amount: 100n, destinationAddress: '0x', idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'resource_not_found' });
    expect(await prisma.payout.count()).toBe(0);
  });
});
