import { describe, it, expect, vi, beforeEach } from 'vitest';
// ASSUMPTION: BankClient is the default named export of bank.client.ts
import { BankClient } from '../src/bank/bank.client';
// ASSUMPTION: PayoutsRepository is the default named export of payouts.repository.ts
import { PayoutsRepository } from '../src/payouts/payouts.repository';
// ASSUMPTION: PayoutsService and PayoutOrder are named exports of payouts.service.ts
import { PayoutsService, type PayoutOrder } from '../src/payouts/payouts.service';
// ASSUMPTION: ReconcileWindow is a named type export of payouts.service.ts
import type { ReconcileWindow } from '../src/payouts/payouts.service';

function makeOrder(overrides: Partial<PayoutOrder> = {}): PayoutOrder {
  return {
    id: 'ord-1',
    txid: 'tx-ord-1-20250101',
    amountMinor: 15000,
    key: 'bank-account-key',
    status: 'pending',
    attempts: 0,
    effectiveDate: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('PayoutsService', () => {
  let bank: BankClient;
  let repo: PayoutsRepository;
  let service: PayoutsService;

  beforeEach(() => {
    bank = {
      send: vi.fn(),
      getStatement: vi.fn(),
    } as unknown as BankClient;

    repo = {
      findPendingOrders: vi.fn().mockResolvedValue([]),
      findOrderById: vi.fn(),
      updateOrder: vi.fn().mockResolvedValue(undefined),
      incrementAttempt: vi.fn().mockResolvedValue(undefined),
    } as unknown as PayoutsRepository;

    service = new PayoutsService(bank, repo);
  });

  describe('executePayments', () => {
    it('sends each pending order via bank.send with the order txid, amount, and key', async () => {
      const order = makeOrder();
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.send as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'accepted' });

      await service.executePayments();

      expect(bank.send).toHaveBeenCalledWith({
        txid: order.txid,
        amount: order.amountMinor,
        key: order.key,
      });
    });

    it('classifies a transient error and does not advance the order past pending', async () => {
      const order = makeOrder();
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));

      await service.executePayments();

      // ASSUMPTION: on transient error the repo is told to increment attempt but status stays 'pending'
      expect(repo.incrementAttempt).toHaveBeenCalledWith(order.id);
      expect(repo.updateOrder).not.toHaveBeenCalledWith(order.id, expect.objectContaining({ status: 'settled' }));
    });

    it('does not advance an order to settled when bank.send returns duplicate', async () => {
      const order = makeOrder({ status: 'pending' });
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.send as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'duplicate' });

      await service.executePayments();

      // ASSUMPTION: duplicate means the bank already has it; service defers to reconcile
      expect(repo.updateOrder).not.toHaveBeenCalledWith(order.id, expect.objectContaining({ status: 'settled' }));
    });

    it('marks an order as permanently rejected when bank.send returns a permanent rejection', async () => {
      const order = makeOrder();
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.send as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'rejected', reason: 'invalid_key' });

      await service.executePayments();

      // ASSUMPTION: permanent rejection parks the order in a terminal 'rejected' state
      expect(repo.updateOrder).toHaveBeenCalledWith(order.id, expect.objectContaining({ status: 'rejected' }));
    });
  });

  describe('reconcile', () => {
    const window: ReconcileWindow = {
      from: new Date('2025-01-01T00:00:00Z'),
      to: new Date('2025-01-01T01:00:00Z'),
    };

    it('marks an order as settled when the statement contains its txid (timeout-but-settled: no resend)', async () => {
      const order = makeOrder({ status: 'pending', attempts: 1 });
      (repo.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValue(order);
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([
        { txid: order.txid, settledAt: new Date('2025-01-01T00:30:00Z') },
      ]);

      await service.reconcile(window);

      expect(repo.updateOrder).toHaveBeenCalledWith(order.id, expect.objectContaining({ status: 'settled' }));
      // The order must NOT be re-sent
      expect(bank.send).not.toHaveBeenCalled();
    });

    it('resends a proven-absent order with the same txid after publishing lag has passed', async () => {
      const order = makeOrder({ status: 'pending', attempts: 1 });
      (repo.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValue(order);
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      // Statement does NOT contain the order's txid → proven absent
      (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      (bank.send as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'accepted' });

      await service.reconcile(window);

      // Same txid is reused (deterministic derivation from order + effective date)
      expect(bank.send).toHaveBeenCalledWith({
        txid: order.txid,
        amount: order.amountMinor,
        key: order.key,
      });
      expect(repo.incrementAttempt).toHaveBeenCalledWith(order.id);
    });

    it('does not resend while within the publishing lag window', async () => {
      // ASSUMPTION: the service compares the order's last-attempt timestamp against the lag
      const order = makeOrder({ status: 'pending', attempts: 1 });
      (repo.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValue(order);
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      // Window is still within the ~30 min lag
      const lagWindow: ReconcileWindow = {
        from: new Date('2025-01-01T00:00:00Z'),
        to: new Date('2025-01-01T00:20:00Z'), // only 20 min elapsed
      };
      (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await service.reconcile(lagWindow);

      expect(bank.send).not.toHaveBeenCalled();
    });

    it('is idempotent: running reconcile twice over overlapping windows does not double-advance', async () => {
      const order = makeOrder({ status: 'pending', attempts: 1 });
      (repo.findOrderById as ReturnType<typeof vi.fn>).mockResolvedValue(order);
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([
        { txid: order.txid, settledAt: new Date('2025-01-01T00:30:00Z') },
      ]);

      await service.reconcile(window);
      // Second call: order is already settled, should be a no-op
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      await service.reconcile(window);

      // updateOrder to 'settled' should have been called exactly once
      expect(repo.updateOrder).toHaveBeenCalledTimes(1);
    });
  });

  describe('attempt exhaustion', () => {
    it('parks an order for manual review after 5 failed attempts and never auto-reverts', async () => {
      const order = makeOrder({ status: 'pending', attempts: 5 });
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      // 6th send attempt would exceed the cap — service should park instead
      (bank.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('timeout'));

      await service.executePayments();

      // ASSUMPTION: status becomes 'manual_review' (or 'parked') after cap is reached
      expect(repo.updateOrder).toHaveBeenCalledWith(order.id, expect.objectContaining({ status: 'manual_review' }));
      // No further send is attempted
      expect(bank.send).not.toHaveBeenCalled();
    });

    it('does not attempt to resend a manually-parked order', async () => {
      const order = makeOrder({ status: 'manual_review', attempts: 5 });
      (repo.findPendingOrders as ReturnType<typeof vi.fn>).mockResolvedValue([order]);
      (bank.getStatement as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await service.reconcile(window);

      expect(bank.send).not.toHaveBeenCalled();
    });
  });
});
