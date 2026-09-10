import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// @ts-expect-error -- module not yet created
import { PrismaService } from '../src/prisma/prisma.service';
// @ts-expect-error -- module not yet created
import { PayoutController } from '../src/payout/payout.controller';
// @ts-expect-error -- module not yet created
import { PayoutInsufficientFundsError } from '../src/payout/payout.errors';
// @ts-expect-error -- module not yet created
import { PayoutProvider } from '../src/payout/payout.provider';
// @ts-expect-error -- module not yet created
import { PayoutRepository } from '../src/payout/payout.repository';
// @ts-expect-error -- module not yet created
import { PayoutService } from '../src/payout/payout.service';
// @ts-expect-error -- module not yet created
import { PayoutWorker } from '../src/payout/payout.worker';
// @ts-expect-error -- module not yet created
import type { PayoutStatus } from '../src/payout/payout.types';

// ASSUMPTION: PayoutService exposes a createPayout method accepting
//   { accountId, amount, destinationAddress, idempotencyKey } and returning a payout record.
// ASSUMPTION: PayoutWorker exposes a processMessages() method that dequeues pending
//   messages, calls the provider, and updates payout + ledger state.
// ASSUMPTION: PayoutRepository exposes markMessageProcessed(messageId) and
//   findPayoutById(id) (or equivalent) used by the worker.
// ASSUMPTION: PayoutProvider exposes transfer({ to, amount }) -> { txHash } which
//   may throw to simulate failure.
// ASSUMPTION: The errors module exports a PayoutInsufficientFundsError class (or similar)
//   that the service throws when available balance < requested amount.

const MAX_RETRIES = 3;

function makeProviderMock(
  behavior: (callCount: number) => { txHash: string } | Promise<{ txHash: string }> | never,
) {
  let callCount = 0;
  const transfer = vi.fn(async () => {
    callCount += 1;
    return behavior(callCount);
  });
  return { transfer, get callCount() { return callCount; } };
}

describe('payout service', () => {
  let prisma: PrismaService;
  let repository: PayoutRepository;
  let service: PayoutService;
  let worker: PayoutWorker;
  let provider: PayoutProvider;

  const accountId = 'acct_test_001';
  const destination = '0xabc123def456';
  const baseAmount = 10_000n; // minor units

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    // Seed an account with a known available balance.
    // ASSUMPTION: accounts table has (id, available_balance, settled_balance) columns
    // and ledger_entries track double-entry movements.
    await prisma.$executeRawUnsafe(`
      DELETE FROM ledger_entries;
      DELETE FROM payouts;
      DELETE FROM accounts;
      DELETE FROM messages;
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO accounts (id, available_balance, settled_balance)
      VALUES ($1, $2, $3)
    `, [accountId, baseAmount, 0n]);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    // Reset account balance before each test
    await prisma.$executeRawUnsafe(`
      UPDATE accounts SET available_balance = $1, settled_balance = $2 WHERE id = $3
    `, [baseAmount, 0n, accountId]);
    await prisma.$executeRawUnsafe(`DELETE FROM payouts`);
    await prisma.$executeRawUnsafe(`DELETE FROM messages`);
  });

  describe('concurrent creation against one account', () => {
    it('two racing requests for the full balance: exactly one succeeds, none overdraws', async () => {
      repository = new PayoutRepository(prisma);
      service = new PayoutService(repository, prisma);

      const key1 = `idem-${crypto.randomUUID()}`;
      const key2 = `idem-${crypto.randomUUID()}`;

      const [result1, result2] = await Promise.allSettled([
        service.createPayout({
          accountId,
          amount: baseAmount,
          destinationAddress: destination,
          idempotencyKey: key1,
        }),
        service.createPayout({
          accountId,
          amount: baseAmount,
          destinationAddress: destination,
          idempotencyKey: key2,
        }),
      ]);

      const fulfilled = [result1, result2].filter(
        (r): r is PromiseFulfilledResult<unknown> => r.status === 'fulfilled',
      );
      const rejected = [result1, result2].filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      // Exactly one should succeed, the other must be rejected (insufficient funds).
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // The rejected one must be an insufficient-funds error.
      const err = rejected[0].reason as { name?: string; code?: string };
      // ASSUMPTION: the service throws an error whose name or code identifies
      // insufficient funds. We accept either pattern.
      expect(
        err?.name === 'PayoutInsufficientFundsError' ||
        err?.code === 'insufficient_funds' ||
        err?.code === 'payout_insufficient_funds',
      ).toBe(true);

      // Account balance must be exactly zero (fully reserved, not negative).
      const row = await prisma.$queryRawAsync<{ available_balance: bigint }[]>(`
        SELECT available_balance FROM accounts WHERE id = $1
      `, [accountId]);
      expect(row[0].available_balance).toBe(0n);
    });

    it('retrying the same idempotencyKey does not create a second payout or double-reserve', async () => {
      repository = new PayoutRepository(prisma);
      service = new PayoutService(repository, prisma);

      const idemKey = `idem-${crypto.randomUUID()}`;
      const amount = 2_000n;

      const first = await service.createPayout({
        accountId,
        amount,
        destinationAddress: destination,
        idempotencyKey: idemKey,
      });

      const second = await service.createPayout({
        accountId,
        amount,
        destinationAddress: destination,
        idempotencyKey: idemKey,
      });

      // Same payout returned (same id), not a new one.
      // ASSUMPTION: createPayout returns an object with an `id` field.
      expect(second.id).toBe(first.id);

      // Balance reserved exactly once.
      const row = await prisma.$queryRawAsync<{ available_balance: bigint }[]>(`
        SELECT available_balance FROM accounts WHERE id = $1
      `, [accountId]);
      expect(row[0].available_balance).toBe(baseAmount - amount);
    });
  });

  describe('duplicate message delivery', () => {
    it('processing the same message twice does not double-send or double-record', async () => {
      repository = new PayoutRepository(prisma);
      service = new PayoutService(repository, prisma);

      const idemKey = `idem-${crypto.randomUUID()}`;
      const amount = 3_000n;

      await service.createPayout({
        accountId,
        amount,
        destinationAddress: destination,
        idempotencyKey: idemKey,
      });

      // Fetch the pending message created by the outbox insert.
      const msgs = await prisma.$queryRawAsync<{ id: string; payout_id: string }[]>(`
        SELECT id, payout_id FROM messages WHERE status = 'pending' LIMIT 1
      `);
      expect(msgs).toHaveLength(1);
      const msg = msgs[0];

      // Provider that always succeeds.
      const providerMock = makeProviderMock(() => ({ txHash: '0xdeadbeef' }));
      worker = new PayoutWorker(repository, providerMock as PayoutProvider);

      // Process the message the first time.
      await worker.processMessages();

      const afterFirst = await prisma.$queryRawAsync<{
        status: string;
        settled_balance: bigint;
      }[]>(`
        SELECT p.status, a.settled_balance
        FROM payouts p
        JOIN accounts a ON a.id = p.account_id
        WHERE p.id = $1
      `, [msg.payout_id]);
      expect(afterFirst[0].status).toBe('completed');
      expect(afterFirst[0].settled_balance).toBe(amount);

      // Re-insert the same message to simulate at-least-once redelivery.
      await prisma.$executeRawUnsafe(`
        INSERT INTO messages (id, payout_id, status, attempts)
        VALUES ($1, $2, 'pending', 0)
      `, [msg.id, msg.payout_id]);

      // Process again — the worker must detect the duplicate and be a no-op.
      await worker.processMessages();

      // Provider should have been called exactly once total.
      expect(providerMock.transfer).toHaveBeenCalledTimes(1);

      // Balance unchanged after duplicate processing.
      const afterSecond = await prisma.$queryRawAsync<{
        status: string;
        settled_balance: bigint;
      }[]>(`
        SELECT p.status, a.settled_balance
        FROM payouts p
        JOIN accounts a ON a.id = p.account_id
        WHERE p.id = $1
      `, [msg.payout_id]);
      expect(afterSecond[0].status).toBe('completed');
      expect(afterSecond[0].settled_balance).toBe(amount);
    });
  });

  describe('retry exhaustion', () => {
    it('marks payout as needs-review after max retries and does not lose funds', async () => {
      repository = new PayoutRepository(prisma);
      service = new PayoutService(repository, prisma);

      const idemKey = `idem-${crypto.randomUUID()}`;
      const amount = 5_000n;

      await service.createPayout({
        accountId,
        amount,
        destinationAddress: destination,
        idempotencyKey: idemKey,
      });

      const msgs = await prisma.$queryRawAsync<{ id: string; payout_id: string }[]>(`
        SELECT id, payout_id FROM messages WHERE status = 'pending' LIMIT 1
      `);
      const msg = msgs[0];

      // Provider that always throws (simulates persistent failure).
      const providerMock = makeProviderMock(() => {
        throw new Error('provider timeout');
      });
      worker = new PayoutWorker(repository, providerMock as PayoutProvider);

      // Run processMessages enough times to exhaust MAX_RETRIES.
      for (let i = 0; i < MAX_RETRIES; i++) {
        // Reset message to pending to simulate the worker re-picking it up
        // (in a real polling loop the message stays pending until processed
        // or exhausted; here we simulate the next poll cycle).
        await prisma.$executeRawUnsafe(`
          UPDATE messages SET status = 'pending' WHERE id = $1
        `, [msg.id]);
        await worker.processMessages();
      }

      // After exhausting retries, the payout must be in a safe terminal-ish state.
      const row = await prisma.$queryRawAsync<{ status: string }[]>(`
        SELECT status FROM payouts WHERE id = $1
      `, [msg.payout_id]);

      // ASSUMPTION: the worker transitions to 'needs-review' (or 'failed')
      // when retries are exhausted without a definitive provider outcome.
      const safeStates: string[] = ['needs-review', 'needs_review', 'failed'];
      expect(safeStates).toContain(row[0].status);

      // The settled balance must NOT have changed (no transfer confirmed).
      const bal = await prisma.$queryRawAsync<{ settled_balance: bigint }[]>(`
        SELECT settled_balance FROM accounts WHERE id = $1
      `, [accountId]);
      expect(bal[0].settled_balance).toBe(0n);

      // The reserved amount is still held (not returned to available, not lost).
      const avail = await prisma.$queryRawAsync<{ available_balance: bigint }[]>(`
        SELECT available_balance FROM accounts WHERE id = $1
      `, [accountId]);
      expect(avail[0].available_balance).toBe(baseAmount - amount);
    });

    it('provider transient failure then success: payout completes on retry', async () => {
      repository = new PayoutRepository(prisma);
      service = new PayoutService(repository, prisma);

      const idemKey = `idem-${crypto.randomUUID()}`;
      const amount = 1_500n;

      await service.createPayout({
        accountId,
        amount,
        destinationAddress: destination,
        idempotencyKey: idemKey,
      });

      const msgs = await prisma.$queryRawAsync<{ id: string; payout_id: string }[]>(`
        SELECT id, payout_id FROM messages WHERE status = 'pending' LIMIT 1
      `);
      const msg = msgs[0];

      // Fails once, then succeeds.
      const providerMock = makeProviderMock((n: number) => {
        if (n === 1) throw new Error('transient network error');
        return { txHash: '0xsuccess' };
      });
      worker = new PayoutWorker(repository, providerMock as PayoutProvider);

      // First poll: fails, message stays pending (or is re-queued).
      await worker.processMessages();
      // Reset for second poll if the worker marks it as 'retry' or similar.
      await prisma.$executeRawUnsafe(`
        UPDATE messages SET status = 'pending' WHERE id = $1
      `, [msg.id]);

      // Second poll: succeeds.
      await worker.processMessages();

      const row = await prisma.$queryRawAsync<{ status: string }[]>(`
        SELECT status FROM payouts WHERE id = $1
      `, [msg.payout_id]);
      expect(row[0].status).toBe('completed');

      const bal = await prisma.$queryRawAsync<{ settled_balance: bigint }[]>(`
        SELECT settled_balance FROM accounts WHERE id = $1
      `, [accountId]);
      expect(bal[0].settled_balance).toBe(amount);
    });
  });
});
