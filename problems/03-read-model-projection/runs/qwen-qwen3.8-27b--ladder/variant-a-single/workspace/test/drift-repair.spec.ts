import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DriftRepairService } from '../../src/drift-repair/drift-repair.service';
import { DriftRepairRepository } from '../../src/drift-repair/drift-repair.repository';

// ASSUMPTION: test/helpers/services.ts has an internal arity error (TS2554 at line 23)
// that is unrelated to how the spec file consumes it; this spec is self-contained
// to avoid depending on a broken helper.

interface SourceRow {
  orderId: string;
  companyId: string;
  status: string;
  amountCents: number;
  occurredAt: Date;
}

interface ProjectionRow {
  orderId: string;
  companyId: string;
  status: string;
  amountCents: number;
  occurredAt: Date;
}

function createMockRepo() {
  return {
    findDrift: vi.fn(),
    getSourceRows: vi.fn(),
    getProjectionRows: vi.fn(),
    insertProjectionRows: vi.fn(),
    updateProjectionRows: vi.fn(),
  };
}

describe('DriftRepairService', () => {
  let mockRepo: ReturnType<typeof createMockRepo>;
  let service: DriftRepairService;

  const from = new Date('2024-01-01T00:00:00Z');
  const to = new Date('2024-01-01T01:00:00Z');

  beforeEach(() => {
    mockRepo = createMockRepo();
    service = new DriftRepairService(mockRepo as unknown as DriftRepairRepository);
  });

  describe('repairWindow', () => {
    it('returns zero repaired rows when projection already matches source', async () => {
      const sourceRows: SourceRow[] = [
        { orderId: 'o1', companyId: 'c1', status: 'approved', amountCents: 1000, occurredAt: from },
      ];
      const projectionRows: ProjectionRow[] = [
        { orderId: 'o1', companyId: 'c1', status: 'approved', amountCents: 1000, occurredAt: from },
      ];

      mockRepo.getSourceRows.mockResolvedValue(sourceRows);
      mockRepo.getProjectionRows.mockResolvedValue(projectionRows);

      const result = await service.repairWindow(from, to);

      expect(result).toEqual({ windowsChecked: 1, rowsRepaired: 0 });
    });

    it('re-inserts projection rows missing from the source', async () => {
      const sourceRows: SourceRow[] = [
        { orderId: 'o1', companyId: 'c1', status: 'approved', amountCents: 1000, occurredAt: from },
        { orderId: 'o2', companyId: 'c1', status: 'pending', amountCents: 500, occurredAt: from },
      ];
      const projectionRows: ProjectionRow[] = [];

      mockRepo.getSourceRows.mockResolvedValue(sourceRows);
      mockRepo.getProjectionRows.mockResolvedValue(projectionRows);
      mockRepo.insertProjectionRows.mockResolvedValue(undefined);

      const result = await service.repairWindow(from, to);

      expect(result.rowsRepaired).toBe(2);
      expect(mockRepo.insertProjectionRows).toHaveBeenCalledWith([
        { orderId: 'o1', companyId: 'c1', status: 'approved', amountCents: 1000, occurredAt: from },
        { orderId: 'o2', companyId: 'c1', status: 'pending', amountCents: 500, occurredAt: from },
      ]);
    });

    it('re-updates projection rows whose status or amount diverged', async () => {
      const sourceRows: SourceRow[] = [
        { orderId: 'o1', companyId: 'c1', status: 'rejected', amountCents: 2000, occurredAt: from },
      ];
      const projectionRows: ProjectionRow[] = [
        { orderId: 'o1', companyId: 'c1', status: 'approved', amountCents: 1000, occurredAt: from },
      ];

      mockRepo.getSourceRows.mockResolvedValue(sourceRows);
      mockRepo.getProjectionRows.mockResolvedValue(projectionRows);
      mockRepo.updateProjectionRows.mockResolvedValue(undefined);

      const result = await service.repairWindow(from, to);

      expect(result.rowsRepaired).toBe(1);
      expect(mockRepo.updateProjectionRows).toHaveBeenCalledWith([
        { orderId: 'o1', status: 'rejected', amountCents: 2000 },
      ]);
    });

    it('handles a mixed window with both missing and stale rows', async () => {
      const sourceRows: SourceRow[] = [
        { orderId: 'o1', companyId: 'c1', status: 'approved', amountCents: 1000, occurredAt: from },
        { orderId: 'o2', companyId: 'c2', status: 'pending', amountCents: 300, occurredAt: from },
      ];
      const projectionRows: ProjectionRow[] = [
        { orderId: 'o1', companyId: 'c1', status: 'rejected', amountCents: 999, occurredAt: from },
      ];

      mockRepo.getSourceRows.mockResolvedValue(sourceRows);
      mockRepo.getProjectionRows.mockResolvedValue(projectionRows);
      mockRepo.insertProjectionRows.mockResolvedValue(undefined);
      mockRepo.updateProjectionRows.mockResolvedValue(undefined);

      const result = await service.repairWindow(from, to);

      expect(result.rowsRepaired).toBe(2);
      expect(mockRepo.updateProjectionRows).toHaveBeenCalledWith([
        { orderId: 'o1', status: 'approved', amountCents: 1000 },
      ]);
      expect(mockRepo.insertProjectionRows).toHaveBeenCalledWith([
        { orderId: 'o2', companyId: 'c2', status: 'pending', amountCents: 300, occurredAt: from },
      ]);
    });

    it('returns zero when both source and projection are empty', async () => {
      mockRepo.getSourceRows.mockResolvedValue([]);
      mockRepo.getProjectionRows.mockResolvedValue([]);

      const result = await service.repairWindow(from, to);

      expect(result).toEqual({ windowsChecked: 1, rowsRepaired: 0 });
    });
  });

  describe('runScheduledRepair', () => {
    it('checks 168 one-hour windows over 7 days and aggregates repairs', async () => {
      mockRepo.getSourceRows.mockResolvedValue([
        { orderId: 'o1', companyId: 'c1', status: 'approved', amountCents: 100, occurredAt: from },
      ]);
      mockRepo.getProjectionRows.mockResolvedValue([]);
      mockRepo.insertProjectionRows.mockResolvedValue(undefined);

      const result = await service.runScheduledRepair();

      expect(result.windowsChecked).toBe(168);
      expect(result.rowsRepaired).toBe(168);
      expect(mockRepo.getSourceRows).toHaveBeenCalledTimes(168);
    });

    it('returns zero repairs when every window is clean', async () => {
      mockRepo.getSourceRows.mockResolvedValue([]);
      mockRepo.getProjectionRows.mockResolvedValue([]);

      const result = await service.runScheduledRepair();

      expect(result).toEqual({ windowsChecked: 168, rowsRepaired: 0 });
    });
  });
});
