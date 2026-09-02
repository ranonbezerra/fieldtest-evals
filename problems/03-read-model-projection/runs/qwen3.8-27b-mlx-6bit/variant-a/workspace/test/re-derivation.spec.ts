import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReDerivationService } from '../src/re-derivation/re-derivation.service';
import type { ReDeriveInput, OperationRow } from '../src/operations/operations.types';
import type { OperationsRepository } from '../src/operations/operations.repository';

// ASSUMPTION: The repository method signatures are inferred from PLAN.md §3 since
// the source files referenced by this test do not yet exist in the workspace.

function createMockRepo(): OperationsRepository & {
  findOrdersByWindow: ReturnType<typeof vi.fn>;
  findWorkerById: ReturnType<typeof vi.fn>;
  findLastEventForOrder: ReturnType<typeof vi.fn>;
} {
  return {
    findOrdersByWindow: vi.fn(),
    findWorkerById: vi.fn(),
    findLastEventForOrder: vi.fn(),
  } as unknown as OperationsRepository & {
    findOrdersByWindow: ReturnType<typeof vi.fn>;
    findWorkerById: ReturnType<typeof vi.fn>;
    findLastEventForOrder: ReturnType<typeof vi.fn>;
  };
}

describe('ReDerivationService.reDerive', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let service: ReDerivationService;

  beforeEach(() => {
    repo = createMockRepo();
    service = new ReDerivationService(repo);
  });

  it('re-derives a window after a projection row has been corrupted, restoring correct data', async () => {
    const dateFrom = new Date('2025-01-01T00:00:00Z');
    const dateTo = new Date('2025-01-02T00:00:00Z');
    const input: ReDeriveInput = { date_from: dateFrom, date_to: dateTo };

    const sourceOrder = {
      id: 'order-1',
      company_id: 'company-1',
      worker_id: 'worker-1',
      status: 'approved',
      amount: '250.00',
      currency: 'USD',
      created_at: new Date('2025-01-01T12:00:00Z'),
      updated_at: new Date('2025-01-01T12:00:00Z'),
    };

    const worker = { id: 'worker-1', name: 'Alice', role: 'driver' };
    const lastEventType = 'status_changed';

    repo.findOrdersByWindow.mockResolvedValue([sourceOrder]);
    repo.findWorkerById.mockResolvedValue(worker);
    repo.findLastEventForOrder.mockResolvedValue(lastEventType);

    const result = await service.reDerive(input);

    // The re-derivation reported rewriting exactly one row.
    expect(result.rows_rewritten).toBe(1);

    // It fetched the source window.
    expect(repo.findOrdersByWindow).toHaveBeenCalledWith(dateFrom, dateTo);

    // It looked up the worker and last event for the order.
    expect(repo.findWorkerById).toHaveBeenCalledWith('worker-1');
    expect(repo.findLastEventForOrder).toHaveBeenCalledWith('order-1');
  });

  it('is idempotent: running re-derive twice on the same window produces the same result', async () => {
    const dateFrom = new Date('2025-01-01T00:00:00Z');
    const dateTo = new Date('2025-01-03T00:00:00Z');
    const input: ReDeriveInput = { date_from: dateFrom, date_to: dateTo };

    const orders = [
      {
        id: 'order-a',
        company_id: 'company-1',
        worker_id: 'worker-1',
        status: 'pending',
        amount: '100.00',
        currency: 'USD',
        created_at: new Date('2025-01-01T10:00:00Z'),
        updated_at: new Date('2025-01-01T10:00:00Z'),
      },
      {
        id: 'order-b',
        company_id: 'company-1',
        worker_id: 'worker-2',
        status: 'settled',
        amount: '200.00',
        currency: 'USD',
        created_at: new Date('2025-01-02T10:00:00Z'),
        updated_at: new Date('2025-01-02T10:00:00Z'),
      },
    ];

    repo.findOrdersByWindow.mockResolvedValue(orders);
    repo.findWorkerById.mockImplementation(async (id: string) => {
      if (id === 'worker-1') return { id, name: 'Alice', role: 'driver' };
      if (id === 'worker-2') return { id, name: 'Bob', role: 'rider' };
      return null;
    });
    repo.findLastEventForOrder.mockResolvedValue(null);

    const first = await service.reDerive(input);
    const second = await service.reDerive(input);

    expect(first.rows_rewritten).toBe(2);
    expect(second.rows_rewritten).toBe(2);
    expect(second.rows_rewritten).toBe(first.rows_rewritten);
  });
});
