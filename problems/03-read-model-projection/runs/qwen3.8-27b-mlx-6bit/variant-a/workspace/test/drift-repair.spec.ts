import { describe, it, expect, vi, beforeEach } from 'vitest';
// ASSUMPTION: The module '../src/drift-repair/drift-repair.service' cannot be resolved because its transitive imports (../operations/operations.types, ../operations/operations.repository) are missing or broken in the current workspace. The import is kept per plan; the error is expected to clear once those files compile.
import { DriftRepairService } from '../src/drift-repair/drift-repair.service';

// ASSUMPTION: The plan's DriftRepairService control flow requires fetching a source order by its primary key and recomputing company totals via SUM/COUNT, but the plan's repository interface does not explicitly list methods named `findOrderByOrderId` or `recomputeCompanyTotal`. These are assumed to exist on the repository for the drift-repair use case.

// ASSUMPTION: The plan's OperationRow type does not include `updated_at`, but the drift-repair logic requires comparing source.updated_at against projection.updated_at. The projection table DDL includes `updated_at`, so it is assumed the repository returns it (either OperationRow should include it, or findProjectionByWindow returns a wider shape).

interface MockProjectionRow {
  order_id: string;
  company_id: string;
  status: string;
  amount: string;
  currency: string;
  worker_name: string;
  worker_role: string;
  last_event_type: string | null;
  created_at: Date;
  updated_at: Date;
}

function makeProjectionRow(overrides: Partial<MockProjectionRow> = {}): MockProjectionRow {
  return {
    order_id: 'order-1',
    company_id: 'company-1',
    status: 'approved',
    amount: '100.00',
    currency: 'USD',
    worker_name: 'Alice',
    worker_role: 'driver',
    last_event_type: null,
    created_at: new Date('2024-01-15T10:00:00Z'),
    updated_at: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeSourceOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-1',
    company_id: 'company-1',
    worker_id: 'worker-1',
    status: 'approved',
    amount: '100.00',
    currency: 'USD',
    created_at: new Date('2024-01-15T10:00:00Z'),
    updated_at: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

describe('DriftRepairService', () => {
  let mockRepo: Record<string, ReturnType<typeof vi.fn>>;
  let service: DriftRepairService;

  beforeEach(() => {
    mockRepo = {
      findProjectionByWindow: vi.fn().mockResolvedValue([]),
      // ASSUMPTION: method name inferred from plan control flow step 3
      findOrderByOrderId: vi.fn().mockResolvedValue(null),
      findWorkerById: vi.fn().mockResolvedValue(null),
      findLastEventForOrder: vi.fn().mockResolvedValue(null),
      upsertOperation: vi.fn().mockResolvedValue(undefined),
      // ASSUMPTION: method name inferred from plan control flow step 4 (recompute via SUM/COUNT)
      recomputeCompanyTotal: vi.fn().mockResolvedValue(undefined),
    };

    // ASSUMPTION: DriftRepairService constructor expects OperationsRepository which is not resolvable; casting through unknown.
    service = new DriftRepairService(mockRepo as unknown as never);
  });

  it('detects and repairs a stale projection row', async () => {
    const now = new Date('2024-01-15T12:00:00Z');
    const dateSpy = vi.spyOn(global, 'Date').mockImplementation(
      (...args) => (args.length === 0 ? now : new Date(...args)),
    );

    const staleRow = makeProjectionRow({
      order_id: 'order-stale',
      updated_at: new Date('2024-01-15T11:30:00Z'),
    });

    const sourceOrder = makeSourceOrder({
      id: 'order-stale',
      updated_at: new Date('2024-01-15T11:35:00Z'), // newer than projection → stale
    });

    mockRepo.findProjectionByWindow.mockResolvedValue([staleRow] as unknown as Awaited<ReturnType<typeof mockRepo.findProjectionByWindow>>);
    mockRepo.findOrderByOrderId.mockResolvedValue(sourceOrder);
    mockRepo.findWorkerById.mockResolvedValue({ id: 'worker-1', name: 'Alice', role: 'driver' });
    mockRepo.findLastEventForOrder.mockResolvedValue('status_changed');

    const report = await service.run();

    expect(report.rows_checked).toBe(1);
    expect(report.rows_repaired).toBe(1);
    expect(mockRepo.upsertOperation).toHaveBeenCalledTimes(1);
    expect(mockRepo.recomputeCompanyTotal).toHaveBeenCalledWith('company-1');

    dateSpy.mockRestore();
  });

  it('skips rows where source is not newer than projection (concurrent write guard)', async () => {
    const now = new Date('2024-01-15T12:00:00Z');
    const dateSpy = vi.spyOn(global, 'Date').mockImplementation(
      (...args) => (args.length === 0 ? now : new Date(...args)),
    );

    const freshRow = makeProjectionRow({
      order_id: 'order-fresh',
      updated_at: new Date('2024-01-15T11:45:00Z'),
    });

    const sourceOrder = makeSourceOrder({
      id: 'order-fresh',
      updated_at: new Date('2024-01-15T11:30:00Z'), // older than projection → NOT stale
    });

    mockRepo.findProjectionByWindow.mockResolvedValue([freshRow] as unknown as Awaited<ReturnType<typeof mockRepo.findProjectionByWindow>>);
    mockRepo.findOrderByOrderId.mockResolvedValue(sourceOrder);

    const report = await service.run();

    expect(report.rows_checked).toBe(1);
    expect(report.rows_repaired).toBe(0);
    expect(mockRepo.upsertOperation).not.toHaveBeenCalled();
    expect(mockRepo.recomputeCompanyTotal).not.toHaveBeenCalled();

    dateSpy.mockRestore();
  });

  it('recomputes company totals after repair', async () => {
    const now = new Date('2024-01-15T12:00:00Z');
    const dateSpy = vi.spyOn(global, 'Date').mockImplementation(
      (...args) => (args.length === 0 ? now : new Date(...args)),
    );

    const staleRow1 = makeProjectionRow({
      order_id: 'order-a',
      company_id: 'company-x',
      updated_at: new Date('2024-01-15T11:00:00Z'),
    });
    const staleRow2 = makeProjectionRow({
      order_id: 'order-b',
      company_id: 'company-x',
      updated_at: new Date('2024-01-15T11:05:00Z'),
    });

    const sourceOrderA = makeSourceOrder({ id: 'order-a', company_id: 'company-x', updated_at: new Date('2024-01-15T11:10:00Z') });
    const sourceOrderB = makeSourceOrder({ id: 'order-b', company_id: 'company-x', updated_at: new Date('2024-01-15T11:15:00Z') });

    mockRepo.findProjectionByWindow.mockResolvedValue(
      [staleRow1, staleRow2] as unknown as Awaited<ReturnType<typeof mockRepo.findProjectionByWindow>>,
    );
    mockRepo.findOrderByOrderId
      .mockResolvedValueOnce(sourceOrderA)
      .mockResolvedValueOnce(sourceOrderB);
    mockRepo.findWorkerById.mockResolvedValue({ id: 'worker-1', name: 'Bob', role: 'driver' });
    mockRepo.findLastEventForOrder.mockResolvedValue(null);

    const report = await service.run();

    expect(report.rows_repaired).toBe(2);
    expect(mockRepo.recomputeCompanyTotal).toHaveBeenCalledWith('company-x');

    dateSpy.mockRestore();
  });
});
