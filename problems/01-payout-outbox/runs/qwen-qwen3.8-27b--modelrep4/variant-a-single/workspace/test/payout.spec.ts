import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PayoutRepository } from '../src/payout/payout.repository';
import { PayoutError, PayoutService, type PayoutDto } from '../src/payout/payout.service';
import type { PayoutProvider, TransferArgs } from '../src/payout/payout.provider';

// Integration tests: require Postgres via DATABASE_URL (see prisma/schema.prisma)
// and a generated client (`pnpm prisma:generate`). Skipped when DATABASE_URL
// is absent.
const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite('payout service', () => {
  let prisma!: PrismaClient;
  const seededAccounts: string[] = [];

  class StubProvider implements PayoutProvider {
    readonly calls: TransferArgs[] = [];

    constructor(
      private readonly mode: 'success' | 'transient' | 'definitive' = 'success',
      private readonly failureMessage = 'stub provider failure',
    ) {}

    async transfer(args: TransferArgs): Promise<{ txHash: string }> {
      this.calls.push(args);
      if (this.mode === 'success') {
        return { txHash: `0xstub${this.calls.length}` };
      }
      const error = new Error(this.failureMessage);
      if (this.mode === 'definitive') {
        Object.assign(error, { definitive: true });
      }
      throw error;
    }
  }

  function makeService(provider: PayoutProvider): PayoutService {
    return new PayoutService(new PayoutRepository(prisma), provider);
  }

  async function seedAccount(availableMinor: bigint, pendingMinor = 0n): Promise<string> {
    const account = await prisma.account.create({ data: { availableMinor, pendingMinor } });
    seededAccounts.push(account.id);
    return account.id;
  }

  async function wipeAccount(accountId: string): Promise<void> {
    const payoutIds = (
      await prisma.payout.findMany({ where: { accountId }, select: { id: true } })
    ).map((p) => p.id);
    await prisma.payoutMessage.deleteMany({ where: { payoutId: { in: payoutIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { payoutId: { in: payoutIds } } });
    await prisma.payout.deleteMany({ where: { id: { in: payoutIds } } });
    await prisma.account.delete({ where: { id: accountId } });
  }

  beforeAll(() => {
    process.env.PAYOUT_MAX_ATTEMPTS ??= '3';
    process.env.PAYOUT_RETRY_BASE_MS ??= '0';
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    for (const accountId of seededAccounts) {
      await wipeAccount(accountId);
    }
    await prisma.$disconnect();
  });

  it('never overdraws an account when requests race on it', async () => {
    const accountId = await seedAccount(100_000n);
    const provider = new StubProvider();
    const service = makeService(provider);

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        service
          .createPayout({
            accountId,
            amountMinor: 60_000n,
            destinationAddress: `0xdst${i}`,
            idempotencyKey: `race-${i}-${randomUUID()}`,
          })
          .then(
            (payout) => ({ ok: true as const, payout }),
            (error: unknown) => ({ ok: false as const, error }),
          ),
      ),
    );

    const succeeded = results.filter((r): r is { ok: true; payout: PayoutDto } => r.ok);
    const failed = results.filter((r): r is { ok: false; error: unknown } => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(5);
    for (const r of failed) {
      expect(r.error).toBeInstanceOf(PayoutError);
      expect((r.error as PayoutError).httpStatus).toBe(409);
      expect((r.error as PayoutError).code).toBe('insufficient_funds');
    }

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.availableMinor).toBe(40_000n);
    expect(account.pendingMinor).toBe(60_000n);

    const payouts = await prisma.payout.findMany({ where: { accountId } });
    expect(payouts).toHaveLength(1);

    const ledger = await prisma.ledgerEntry.findMany({ where: { payoutId: payouts[0].id } });
    expect(ledger).toHaveLength(2);
    const debits = ledger
      .filter((e) => e.direction === 'debit')
      .reduce<bigint>((sum, e) => sum + e.amountMinor, 0n);
    const credits = ledger
      .filter((e) => e.direction === 'credit')
      .reduce<bigint>((sum, e) => sum + e.amountMinor, 0n);
    expect(debits).toBe(credits);
    expect(debits).toBe(60_000n);

    const messages = await prisma.payoutMessage.findMany({ where: { payoutId: payouts[0].id } });
    expect(messages).toHaveLength(1);
    expect(messages[0].status).toBe('pending');

    // The transfer never happens inside the request.
    expect(provider.calls).toHaveLength(0);
  });

  it('does not double-create or double-reserve when the same idempotency key races', async () => {
    const accountId = await seedAccount(100_000n);
    const service = makeService(new StubProvider());
    const input = {
      accountId,
      amountMinor: 30_000n,
      destinationAddress: '0xdst',
      idempotencyKey: `dup-${randomUUID()}`,
    };

    const results = await Promise.allSettled([
      service.createPayout(input),
      service.createPayout(input),
      service.createPayout(input),
    ]);

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<PayoutDto> => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(3);
    const ids = new Set(fulfilled.map((r) => r.value.id));
    expect(ids.size).toBe(1);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.availableMinor).toBe(70_000n);
    expect(account.pendingMinor).toBe(30_000n);

    const payouts = await prisma.payout.findMany({ where: { accountId } });
    expect(payouts).toHaveLength(1);

    const reserved = await prisma.ledgerEntry.findMany({
      where: { payoutId: payouts[0].id, event: 'reserved' },
    });
    expect(reserved).toHaveLength(2);
  });

  it('settles only on provider confirmation and survives duplicate message delivery', async () => {
    const accountId = await seedAccount(100_000n);
    const provider = new StubProvider();
    const service = makeService(provider);
    const { id: payoutId } = await service.createPayout({
      accountId,
      amountMinor: 40_000n,
      destinationAddress: '0xdst',
      idempotencyKey: `settle-${randomUUID()}`,
    });

    await service.processMessages();

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toEqual({ to: '0xdst', amount: 40_000n });
    let payout = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(payout.status).toBe('completed');
    expect(payout.txHash).toBe('0xstub1');
    let account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.availableMinor).toBe(60_000n);
    expect(account.pendingMinor).toBe(0n);
    const firstMessage = await prisma.payoutMessage.findUniqueOrThrow({ where: { payoutId } });
    expect(firstMessage.status).toBe('done');

    // At-least-once: force a redelivery of the same message, with two workers
    // polling at the same instant.
    await prisma.payoutMessage.update({
      where: { id: firstMessage.id },
      data: { status: 'pending', nextAttemptAt: new Date(), lockedAt: null, claimToken: null, attempts: 0 },
    });
    await Promise.all([service.processMessages(), service.processMessages()]);

    // No second transfer, no double posting, no balance drift.
    expect(provider.calls).toHaveLength(1);
    payout = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(payout.status).toBe('completed');
    expect(payout.txHash).toBe('0xstub1');
    account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.availableMinor).toBe(60_000n);
    expect(account.pendingMinor).toBe(0n);

    const settled = await prisma.ledgerEntry.findMany({ where: { payoutId, event: 'settled' } });
    expect(settled.map((e) => `${e.accountCode}:${e.direction}`).sort()).toEqual([
      'cash:stablecoin:credit',
      `payable:${accountId}:pending:debit`,
    ]);
  });

  it('releases the reservation when the provider rejects definitively', async () => {
    const accountId = await seedAccount(100_000n);
    const provider = new StubProvider('definitive', 'invalid destination address');
    const service = makeService(provider);
    const { id: payoutId } = await service.createPayout({
      accountId,
      amountMinor: 25_000n,
      destinationAddress: 'bad-address',
      idempotencyKey: `def-${randomUUID()}`,
    });

    await service.processMessages();

    // Definitive: no retries.
    expect(provider.calls).toHaveLength(1);
    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(payout.status).toBe('failed');
    expect(payout.failureReason).toBe('invalid destination address');

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.availableMinor).toBe(100_000n);
    expect(account.pendingMinor).toBe(0n);

    const events = (await prisma.ledgerEntry.findMany({ where: { payoutId } }))
      .map((e) => e.event)
      .sort();
    expect(events).toEqual(['released', 'released', 'reserved', 'reserved']);

    const message = await prisma.payoutMessage.findUniqueOrThrow({ where: { payoutId } });
    expect(message.status).toBe('done');
  });

  it('exhausts bounded retries, parks the payout in needs_review and keeps the funds reserved', async () => {
    const accountId = await seedAccount(100_000n);
    const provider = new StubProvider('transient', 'provider timed out');
    const service = makeService(provider);
    const { id: payoutId } = await service.createPayout({
      accountId,
      amountMinor: 25_000n,
      destinationAddress: '0xdst',
      idempotencyKey: `exh-${randomUUID()}`,
    });

    await service.processMessages(); // attempt 1 -> retry scheduled
    await service.processMessages(); // attempt 2 -> retry scheduled
    await service.processMessages(); // attempt 3 == PAYOUT_MAX_ATTEMPTS -> needs_review

    expect(provider.calls).toHaveLength(3);

    const payout = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
    expect(payout.status).toBe('needs_review');
    expect(payout.failureReason).toBe('provider timed out');

    const message = await prisma.payoutMessage.findUniqueOrThrow({ where: { payoutId } });
    expect(message.status).toBe('dead');
    expect(message.attempts).toBe(3);

    // Safe outcome: with no definitive outcome the funds stay reserved.
    // Releasing could double-pay if the timed-out transfer went through.
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.availableMinor).toBe(75_000n);
    expect(account.pendingMinor).toBe(25_000n);

    const events = (await prisma.ledgerEntry.findMany({ where: { payoutId } }))
      .map((e) => e.event)
      .sort();
    expect(events).toEqual(['reserved', 'reserved']);

    // A further pass does nothing.
    await service.processMessages();
    expect(provider.calls).toHaveLength(3);
  });
});
