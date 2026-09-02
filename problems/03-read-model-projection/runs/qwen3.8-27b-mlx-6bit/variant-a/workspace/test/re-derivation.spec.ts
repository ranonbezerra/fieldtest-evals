import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReDerivationService } from '../src/re-derivation/re-derivation.service';
import { InvalidDateRangeError, ReDeriveInput } from '../src/operations/operations.types';
import type { OperationsRepository } from '../src/operations/operations.repository';

// ASSUMPTION: The ReDerivationService re-derivation path calls findOrdersByWindow,
// findWorkerById, findLastEventForOrder, and upsertOperation on OperationsRepository.
// A totals-recompute method is also expected but its exact name cannot be confirmed
// from the plan alone; it is not asserted on directly here.

describe('ReDerivationService.reDerive', () => {
  const makeRepoMock = () => ({
    findOrdersByWindow: vi.fn(),
    findWorkerById: vi.fn(),
    findLastEventForOrder: vi.fn(),
    upsertOperation: vi.fn(),
  });

  let repoMock: ReturnType<typeof makeRepoMock>;
  let service: ReDerivationService;

  beforeEach(() => {
    repoMock = makeRepoMock();
    service = new ReDerivationService(repoMock as unknown as OperationsRepository);
  });

  it('restores a corrupted projection row to match the source', async () => {
    // Source of truth: order is "approved" with amount 200.00.
    // The projection row (not visible to the service) has been corrupted to "pending" / 999.99.
    // After reDerive the upsert must carry the source values, proving the corrupted row is repaired.
    const createdAt = new Date('2024-06-15T10:00:00Z');
    const sourceOrder: Record<string, unknown> = {
      id: 'ord-1',
      company_id: 'co-1',
      worker_id: 'wk-1',
      status: 'approved',
      amount: '200.00',
      currency: 'USD',
      created_at: createdAt,
      updated_at: createdAt,
    };

    repoMock.findOrdersByWindow.mockResolvedValue([sourceOrder]);
    repoMock.findWorkerById.mockResolvedValue({ id: 'wk-1', name: 'Alice', role: 'driver' });
    repoMock.findLastEventForOrder.mockResolvedValue('status_changed');
    repoMock.upsertOperation.mockResolvedValue(undefined);

    const input: ReDeriveInput = {
      date_from: new Date('2024-06-15T00:00:00Z'),
      date_to: new Date('2024-06-16T00:00:00Z'),
    };

    const result = await service.reDerive(input);

    expect(result.rows_rewritten).toBe(1);

    // The projection upsert received the source's status and amount,
    // confirming the corrupted row was overwritten with correct values.
    const [, orderArg] = repoMock.upsertOperation.mock.calls[0];
    expect(orderArg.status).toBe('approved');
    expect(String(orderArg.amount)).toBe('200.00');
  });

  it('is idempotent — a second run on the same window produces identical upserts', async () => {
    const createdAt = new Date('2024-06-15T10:00:00Z');
    const sourceOrder: Record<string, unknown> = {
      id: 'ord-2',
      company_id: 'co-1',
      worker_id: 'wk-2',
      status: 'settled',
      amount: '50.00',
      currency: 'EUR',
      created_at: createdAt,
      updated_at: createdAt,
    };

    repoMock.findOrdersByWindow.mockResolvedValue([sourceOrder]);
    repoMock.findWorkerById.mockResolvedValue({ id: 'wk-2', name: 'Bob', role: 'rider' });
    repoMock.findLastEventForOrder.mockResolvedValue(null);
    repoMock.upsertOperation.mockResolvedValue(undefined);

    const input: ReDeriveInput = {
      date_from: new Date('2024-06-15T00:00:00Z'),
      date_to: new Date('2024-06-16T00:00:00Z'),
    };

    const first = await service.reDerive(input);
    const second = await service.reDerive(input);

    expect(first.rows_rewritten).toBe(1);
    expect(second.rows_rewritten).toBe(1);

    // Both invocations produced the same upsert arguments → no drift on replay.
    const firstUpsertArgs = repoMock.upsertOperation.mock.calls[0];
    const secondUpsertArgs = repoMock.upsertOperation.mock.calls[1];
    expect(secondUpsertArgs).toEqual(firstUpsertArgs);
  });

  it('rejects an invalid date range (from >= to)', async () => {
    const input: ReDeriveInput = {
      date_from: new Date('2024-06-16T00:00:00Z'),
      date_to: new Date('2024-06-15T00:00:00Z'),
    };

    await expect(service.reDerive(input)).rejects.toBeInstanceOf(InvalidDateRangeError);
  });
});
