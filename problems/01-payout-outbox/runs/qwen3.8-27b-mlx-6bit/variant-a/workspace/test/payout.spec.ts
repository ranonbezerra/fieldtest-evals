import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnprocessableEntityException, ConflictException, NotFoundException } from '@nestjs/common';
import { PayoutService } from '../src/payout/payout.service.js';
import type { PayoutRepository } from '../src/payout/payout.repository.js';
import { OutboxService } from '../src/outbox/outbox.service.js';
import type { OutboxRepository } from '../src/outbox/outbox.repository.js';
import type { BlockchainProvider, PayoutStatus } from '../src/payout/payout.types.js';

// ASSUMPTION: The service identifies idempotency conflicts by checking for an error object with a `code` property equal to 'P2002', rather than using instanceof Prisma.PrismaClientKnownRequestError.

describe('PayoutService', () => {
  let repo: PayoutRepository;
  let service: PayoutService;

  beforeEach(() => {
    const repoMock = {
      createPayoutWithReservation: vi.fn(),
      updatePayout: vi.fn(),
      findById: vi.fn(),
      findByAccountIdAndIdempotencyKey: vi.fn(),
      confirmPayoutLedger: vi.fn(),
    };
    repo = repoMock as unknown as PayoutRepository;
    service = new PayoutService(repo);
  });

  it('returns a payout response on successful creation', async () => {
    const payoutRow = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(repo.createPayoutWithReservation).mockResolvedValue(payoutRow);

    const result = await service.create({
      accountId: 'acct-1',
      amount: '100',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    });

    expect(result.id).toBe('payout-1');
    expect(result.status).toBe('created');
    expect(result.amount).toBe('100');
  });

  it('throws UnprocessableEntityException when funds are insufficient (concurrent overdraft guard)', async () => {
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValue(new Error('INSUFFICIENT_FUNDS'));

    await expect(service.create({
      accountId: 'acct-1',
      amount: '999999',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    })).rejects.toThrow(UneprocessableEntityException);
  });

  it('throws NotFoundException when the account does not exist', async () => {
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValue(new Error('ACCOUNT_NOT_FOUND'));

    await expect(service.create({
      accountId: 'nonexistent',
      amount: '100',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    })).rejects.toThrow(NotFoundException);
  });

  it('returns the existing payout when the same idempotency key and body are retried', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValueOnce(p2002);

    const existing = {
      id: 'payout-existing',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(repo.findByAccountIdAndIdempotencyKey).mockResolvedValue(existing);

    const result = await service.create({
      accountId: 'acct-1',
      amount: '100',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    });

    expect(result.id).toBe('payout-existing');
  });

  it('throws ConflictException when the same idempotency key is reused with a different body', async () => {
    const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    vi.mocked(repo.createPayoutWithReservation).mockRejectedValueOnce(p2002);

    const existing = {
      id: 'payout-existing',
      accountId: 'acct-1',
      amount: 200n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(repo.findByAccountIdAndIdempotencyKey).mockResolvedValue(existing);

    await expect(service.create({
      accountId: 'acct-1',
      amount: '300',
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
    })).rejects.toThrow(ConflictException);
  });
});

describe('OutboxService', () => {
  let outboxRepo: OutboxRepository;
  let payoutRepo: PayoutRepository;
  let transfer: ReturnType<typeof vi.fn>;
  let provider: BlockchainProvider;
  let service: OutboxService;

  beforeEach(() => {
    const outboxRepoMock = {
      claimPending: vi.fn(),
      markDone: vi.fn(),
      recordAttempt: vi.fn(),
    };
    outboxRepo = outboxRepoMock as unknown as OutboxRepository;

    const payoutRepoMock = {
      createPayoutWithReservation: vi.fn(),
      updatePayout: vi.fn(),
      findById: vi.fn(),
      findByAccountIdAndIdempotencyKey: vi.fn(),
      confirmPayoutLedger: vi.fn(),
    };
    payoutRepo = payoutRepoMock as unknown as PayoutRepository;

    transfer = vi.fn();
    provider = { transfer } as unknown as BlockchainProvider;

    service = new OutboxService(outboxRepo, payoutRepo, provider);
  });

  it('completes a payout, posts the ledger entry, and marks the message done on provider success', async () => {
    const msg = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValue([msg as any]);

    const payout = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(payout);
    transfer.mockResolvedValue({ txHash: '0xtx123' });

    await service.processMessages();

    expect(transfer).toHaveBeenCalledWith({ to: '0xabc', amount: 100n });
    expect(payoutRepo.confirmPayoutLedger).toHaveBeenCalledWith('acct-1', 'payout-1', 100n);
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
  });

  it('skips processing when the payout is already completed (at-least-once redelivery)', async () => {
    const msg = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 1,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValue([msg as any]);

    const completedPayout = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'completed' as PayoutStatus,
      txHash: '0xtx123',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(completedPayout);

    await service.processMessages();

    expect(transfer).not.toHaveBeenCalled();
    expect(payoutRepo.confirmPayoutLedger).not.toHaveBeenCalled();
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
  });

  it('marks the payout needs_review and stops when retries are exhausted', async () => {
    // Message has already been attempted twice (attempts=2). This is the third failure → MAX_ATTEMPTS.
    const msg = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 2,
      nextAttemptAt: null,
      lastError: 'timeout',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValue([msg as any]);

    const payout = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'processing' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(payout);
    transfer.mockRejectedValueOnce(new Error('provider timeout'));

    await service.processMessages();

    expect(payoutRepo.updatePayout).toHaveBeenCalledWith('payout-1', 'needs_review');
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
    expect(payoutRepo.confirmPayoutLedger).not.toHaveBeenCalled();
  });

  it('records a failed attempt and leaves the message for the next tick on transient error', async () => {
    const msg = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValue([msg as any]);

    const payout = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValue(payout);
    transfer.mockRejectedValueOnce(new Error('transient'));

    await service.processMessages();

    expect(outboxRepo.recordAttempt).toHaveBeenCalledWith('msg-1', 1, null, 'transient');
    expect(outboxRepo.markDone).not.toHaveBeenCalled();
    expect(payoutRepo.confirmPayoutLedger).not.toHaveBeenCalled();
  });

  it('succeeds on a subsequent tick after a prior transient failure', async () => {
    // First tick: provider fails
    const msg1 = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValueOnce([msg1 as any]);

    const payoutCreated = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'created' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValueOnce(payoutCreated);
    transfer.mockRejectedValueOnce(new Error('transient'));

    await service.processMessages();
    expect(outboxRepo.recordAttempt).toHaveBeenCalledWith('msg-1', 1, null, 'transient');

    // Second tick: provider succeeds
    const msg2 = {
      id: 'msg-1',
      payoutId: 'payout-1',
      payload: { to: '0xabc', amount: '100' },
      status: 'processing',
      attempts: 1,
      nextAttemptAt: null,
      lastError: 'transient',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(outboxRepo.claimPending).mockResolvedValueOnce([msg2 as any]);

    const payoutProcessing = {
      id: 'payout-1',
      accountId: 'acct-1',
      amount: 100n,
      destinationAddress: '0xabc',
      idempotencyKey: 'key-1',
      status: 'processing' as PayoutStatus,
      txHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(payoutRepo.findById).mockResolvedValueOnce(payoutProcessing);
    transfer.mockResolvedValueOnce({ txHash: '0xtx456' });

    await service.processMessages();

    expect(payoutRepo.confirmPayoutLedger).toHaveBeenCalledWith('acct-1', 'payout-1', 100n);
    expect(outboxRepo.markDone).toHaveBeenCalledWith('msg-1');
  });
});
