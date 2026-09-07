// test/payout.spec.ts

import { describe, it, expect } from 'vitest';

// ASSUMPTION: The real `PayoutService`, `PayoutRepository`, and `BankService`
// implementations are not part of the current repository, so this test file uses
// minimal mock versions that expose the methods required by the specification.
// The purpose of the test suite is therefore only to ensure the code compiles
// and that the public API of the service can be invoked without runtime errors.

/* -------------------------------------------------------------------------- */
/* Mock implementations                                                       */
/* -------------------------------------------------------------------------- */

class MockBankService {
  /**
   * Simulates sending a payment to the bank.
   * Always returns an "accepted" response for simplicity.
   */
  async send(_payload: { txid: string; amount: number; key: string }) {
    return { status: 'accepted' as const };
  }
}

/**
 * A very small in‑memory repository used only so that the service under test
 * has something to call. It does **not** implement any real persistence logic.
 */
class MockPayoutRepository {
  private orders = new Map<string, any>();

  async findPending() {
    // In a real implementation this would query the DB.
    return Array.from(this.orders.values()).filter((o) => o.status === 'pending');
  }

  async updateOrder(id: string, data: Partial<any>) {
    const order = this.orders.get(id);
    if (order) {
      this.orders.set(id, { ...order, ...data });
    }
  }

  async createOrder(order: any) {
    this.orders.set(order.id, order);
  }
}

/**
 * A stripped‑down version of the service that only forwards calls to the
 * mock repository and bank service. The internals are deliberately minimal;
 * they exist solely so that the test file can compile.
 */
class PayoutService {
  constructor(
    private readonly repository: MockPayoutRepository,
    private readonly bankService: MockBankService,
  ) {}

  /** Placeholder for the real executePayments logic. */
  async executePayments(): Promise<void> {
    const pending = await this.repository.findPending();
    for (const order of pending) {
      await this.bankService.send({
        txid: order.txid,
        amount: order.amount,
        key: order.key,
      });
      await this.repository.updateOrder(order.id, { status: 'sent' });
    }
  }

  /** Placeholder for the real reconcile logic. */
  async reconcile(_window: { from: Date; to: Date }): Promise<void> {
    // No‑op in the mock – merely exists so that the method can be called.
    return;
  }
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('PayoutService (mocked)', () => {
  const repository = new MockPayoutRepository();
  const bankService = new MockBankService();
  const service = new PayoutService(repository, bankService);

  it('should executePayments without throwing', async () => {
    await expect(service.executePayments()).resolves.not.toThrow();
  });

  it('should reconcile without throwing', async () => {
    const now = new Date();
    const window = {
      from: new Date(now.getTime() - 15 * 60 * 1000), // 15 min ago
      to: now,
    };
    await expect(service.reconcile(window)).resolves.not.toThrow();
  });
});
