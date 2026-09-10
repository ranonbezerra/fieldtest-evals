import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PayoutRepository } from '../src/payout/payout.repository';
import { PayoutService } from '../src/payout/payout.service';
import { PayoutWorker } from '../src/payout/payout.worker';
import { InsufficientFundsError } from '../src/payout/payout.errors';
import type { PayoutProvider } from '../src/payout/payout.provider';
// ASSUMPTION: payout.types exports CreatePayoutInput as the input shape for payout creation.
import type { CreatePayoutInput } from '../src/payout/payout.types';

describe('payout', () => {
  describe('concurrent creation against one account', () => {
    it('prevents overdraft when two requests race for the same available balance', async () => {
      // Account has 1_000 settled, 0 reserved → available = 1_000.
      // Each request asks for 600. Only one can be reserved.
      let callCount = 0;

      const mockRepo = {
        findAccountById: vi.fn(async (_id: string) => {
          callCount++;
          return {
            id: 'acc-1',
            settledBalance: 1000n,
            reservedBalance: callCount === 1 ? 0n : 600n,
          };
        }),
        findByIdempotencyKey: vi.fn(async () => null),
        reserveFunds: vi.fn(async (_accountId: string, _amount: bigint) => {}),
        createPayout: vi.fn(async (data: Record<string, unknown>) => ({
          id: `payout-${callCount}`,
          ...data,
        })),
        createMessage: vi.fn(async (data: Record<string, unknown>) => ({
          id: `msg-${callCount}`,
          ...data,
        })),
      } as unknown as PayoutRepository;

      const service = new PayoutService(mockRepo);

      const baseInput: CreatePayoutInput = {
        accountId: 'acc-1',
        amount: 600n,
        destinationAddress: '0xdestination',
        idempotencyKey: 'unique-key',
      };

      const results = await Promise.allSettled([
        service.createPayout(baseInput),
        service.createPayout({ ...baseInput, idempotencyKey: 'unique-key-2' }),
      ]);

      const successes = results.filter((r) => r.status === 'fulfilled');
      const failures = results.filter((r) => r.status === 'rejected');

      expect(successes.length).toBeLessThanOrEqual(1);
      expect(failures.length).toBeGreaterThanOrEqual(1);

      for (const f of failures) {
        if (f.status === 'rejected') {
          expect(f.reason).toBeInstanceOf(InsufficientFundsError);
        }
      }
    });

    it('returns the existing payout on duplicate idempotency key without reserving funds again', async () => {
      const existingPayout = {
        id: 'payout-existing',
        accountId: 'acc-1',
        idempotencyKey: 'key-1',
        amount: 500n,
        destinationAddress: '0xdestination',
        status: 'created',
      };

      const mockRepo = {
        findAccountById: vi.fn(async () => ({
          id: 'acc-1',
          settledBalance: 1000n,
          reservedBalance: 0n,
        })),
        findByIdempotencyKey: vi.fn(async () => existingPayout),
        reserveFunds: vi.fn(async () => {}),
        createPayout: vi.fn(),
        createMessage: vi.fn(),
      } as unknown as PayoutRepository;

      const service = new PayoutService(mockRepo);

      const result = await service.createPayout({
        accountId: 'acc-1',
        amount: 500n,
        destinationAddress: '0xdestination',
        idempotencyKey: 'key-1',
      });

      expect(result.id).toBe('payout-existing');
      expect(mockRepo.reserveFunds).not.toHaveBeenCalled();
      expect(mockRepo.createPayout).not.toHaveBeenCalled();
    });
  });

  describe('duplicate message delivery', () => {
    it('does not create duplicate ledger entries when the same message is processed twice', async () => {
      // The payout is already completed (simulating a crash between provider call and
      // marking the message as processed, then the message is re-delivered).
      const completedPayout = {
        id: 'payout-1',
        accountId: 'acc-1',
        amount: 500n,
        destinationAddress: '0xdestination',
        status: 'completed',
        txHash: '0xexisting-hash',
      };

      const message = {
        id: 'msg-1',
        type: 'payout.transfer',
        payload: JSON.parse(JSON.stringify({
          payoutId: 'payout-1',
          accountId: 'acc-1',
          amount: 500n,
          destinationAddress: '0xdestination',
        })),
        status: 'pending',
        attempts: 1,
        nextAttemptAt: new Date(),
      };

      let ledgerEntryCount = 0;

      const mockRepo = {
        findPendingMessages: vi.fn(async () => [message]),
        markMessageProcessing: vi.fn(async (_id: string) => {}),
        markMessageProcessed: vi.fn(async (_id: string) => {}),
        findPayoutById: vi.fn(async () => completedPayout),
        updatePayoutStatus: vi.fn(async (_id: string, _status: string) => {}),
        createLedgerEntry: vi.fn(async () => {
          ledgerEntryCount++;
          return { id: `ledger-${ledgerEntryCount}` };
        }),
        releaseReservedFunds: vi.fn(async (_accountId: string, _amount: bigint) => {}),
      } as unknown as PayoutRepository;

      const mockProvider: PayoutProvider = {
        transfer: vi.fn(async () => ({ txHash: '0xnew-hash' })),
      };

      const worker = new PayoutWorker(mockRepo, mockProvider);

      // First delivery: payout is already completed, so worker should skip.
      await worker.processMessages();

      const entriesAfterFirst = ledgerEntryCount;

      // Second delivery: same message re-delivered.
      await worker.processMessages();

      const entriesAfterSecond = ledgerEntryCount;

      // No ledger entries were created on either delivery because the payout was already done.
      expect(entriesAfterFirst).toBe(0);
      expect(entriesAfterSecond).toBe(0);
      // The provider was never called again.
      expect(mockProvider.transfer).not.toHaveBeenCalled();
    });

    it('applies effects exactly once across two full processing cycles', async () => {
      // Simulates: first cycle succeeds fully; second cycle re-delivers the same message
      // but the payout has already transitioned to completed.
      let payoutStatus = 'processing';

      const message = {
        id: 'msg-1',
        type: 'payout.transfer',
        payload: JSON.parse(JSON.stringify({
          payoutId: 'payout-1',
          accountId: 'acc-1',
          amount: 500n,
          destinationAddress: '0xdestination',
        })),
        status: 'pending',
        attempts: 1,
        nextAttemptAt: new Date(),
      };

      let ledgerEntryCount = 0;

      const mockRepo = {
        findPendingMessages: vi.fn(async () => [message]),
        markMessageProcessing: vi.fn(async (_id: string) => {}),
        markMessageProcessed: vi.fn(async (_id: string) => {}),
        findPayoutById: vi.fn(async () => ({
          id: 'payout-1',
          status: payoutStatus,
          txHash: payoutStatus === 'completed' ? '0xhash' : null,
        })),
        updatePayoutStatus: vi.fn(async (_id: string, status: string) => {
          payoutStatus = status;
        }),
        createLedgerEntry: vi.fn(async () => {
          ledgerEntryCount++;
          return { id: `ledger-${ledgerEntryCount}` };
        }),
        releaseReservedFunds: vi.fn(async (_accountId: string, _amount: bigint) => {}),
      } as unknown as PayoutRepository;

      const mockProvider: PayoutProvider = {
        transfer: vi.fn(async () => ({ txHash: '0xhash' })),
      };

      const worker = new PayoutWorker(mockRepo, mockProvider);

      // First cycle: payout is 'processing', so the worker should process it.
      await worker.processMessages();

      const entriesAfterFirst = ledgerEntryCount;
      expect(entriesAfterFirst).toBe(1);

      // Second cycle: same message re-delivered, but payout is now 'completed'.
      await worker.processMessages();

      const entriesAfterSecond = ledgerEntryCount;
      // No additional ledger entry on the duplicate delivery.
      expect(entriesAfterSecond).toBe(1);
    });
  });

  describe('retry exhaustion', () => {
    it('marks the payout as needs_review after exhausting all retries without a definitive outcome', async () => {
      const MAX_RETRIES = 3;
      let attemptCount = 0;

      let payoutStatus = 'processing';
      let messageAttempts = 0;

      const mockProvider: PayoutProvider = {
        transfer: vi.fn(async () => {
          attemptCount++;
          throw new Error('provider timeout — no definitive outcome');
        }),
      };

      const mockRepo = {
        findPendingMessages: vi.fn(async () => {
          // Only return the message if retries are not yet exhausted
          if (messageAttempts >= MAX_RETRIES) return [];
          return [{
            id: 'msg-1',
            type: 'payout.transfer',
            payload: JSON.parse(JSON.stringify({
              payoutId: 'payout-1',
              accountId: 'acc-1',
              amount: 500n,
              destinationAddress: '0xdestination',
            })),
            status: 'pending',
            attempts: messageAttempts,
            nextAttemptAt: new Date(),
          }];
        }),
        markMessageProcessing: vi.fn(async (_id: string) => {}),
        markMessageProcessed: vi.fn(async (_id: string) => {}),
        findPayoutById: vi.fn(async () => ({
          id: 'payout-1',
          status: payoutStatus,
          txHash: null,
        })),
        updatePayoutStatus: vi.fn(async (_id: string, status: string) => {
          payoutStatus = status;
        }),
        createLedgerEntry: vi.fn(),
        releaseReservedFunds: vi.fn(),
        scheduleRetry: vi.fn(async (_id: string) => {
          messageAttempts++;
        }),
      } as unknown as PayoutRepository;

      const worker = new PayoutWorker(mockRepo, mockProvider);

      // Process until the worker exhausts retries.
      for (let i = 0; i < MAX_RETRIES; i++) {
        await worker.processMessages();
      }

      // After exhausting retries without a definitive outcome, the payout
      // must be in a safe state that requires human intervention.
      expect(payoutStatus).toBe('needs_review');
      // The provider was called exactly MAX_RETRIES times.
      expect(attemptCount).toBe(MAX_RETRIES);
    });

    it('does not call the provider after retries are exhausted', async () => {
      const MAX_RETRIES = 2;
      let attemptCount = 0;
      let messageAttempts = 0;

      let payoutStatus = 'processing';

      const mockProvider: PayoutProvider = {
        transfer: vi.fn(async () => {
          attemptCount++;
          throw new Error('transient failure');
        }),
      };

      const mockRepo = {
        findPendingMessages: vi.fn(async () => {
          if (messageAttempts >= MAX_RETRIES) return [];
          return [{
            id: 'msg-1',
            type: 'payout.transfer',
            payload: JSON.parse(JSON.stringify({
              payoutId: 'payout-1',
              accountId: 'acc-1',
              amount: 500n,
              destinationAddress: '0xdestination',
            })),
            status: 'pending',
            attempts: messageAttempts,
            nextAttemptAt: new Date(),
          }];
        }),
        markMessageProcessing: vi.fn(async (_id: string) => {}),
        markMessageProcessed: vi.fn(async (_id: string) => {}),
        findPayoutById: vi.fn(async () => ({
          id: 'payout-1',
          status: payoutStatus,
          txHash: null,
        })),
        updatePayoutStatus: vi.fn(async (_id: string, status: string) => {
          payoutStatus = status;
        }),
        createLedgerEntry: vi.fn(),
        releaseReservedFunds: vi.fn(),
        scheduleRetry: vi.fn(async (_id: string) => {
          messageAttempts++;
        }),
      } as unknown as PayoutRepository;

      const worker = new PayoutWorker(mockRepo, mockProvider);

      // Exhaust retries
      for (let i = 0; i < MAX_RETRIES; i++) {
        await worker.processMessages();
      }

      const callsAfterExhaustion = attemptCount;

      // One more cycle should be a no-op
      await worker.processMessages();

      expect(attemptCount).toBe(callsAfterExhaustion);
      expect(payoutStatus).toBe('needs_review');
    });
  });
});
