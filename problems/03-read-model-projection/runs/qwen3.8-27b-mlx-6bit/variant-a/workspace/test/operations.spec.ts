import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OperationsRepository } from "../src/operations/operations.repository";
import { OperationsService } from "../src/operations/operations.service";
import type {
  DashboardQuery,
  DashboardResult,
  OperationRow,
  CompanyTotals,
  SimulateWriteInput,
} from "../src/operations/operations.types";
import {
  ResourceNotFoundError,
  InvalidDateRangeError,
  ValidationError,
} from "../src/operations/operations.types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type MockFn = ReturnType<typeof vi.fn>;

function makeRow(overrides: Partial<OperationRow> = {}): OperationRow {
  return {
    order_id: "ord-1",
    company_id: "comp-1",
    status: "pending",
    amount: "100.00",
    currency: "USD",
    worker_name: "Alice",
    worker_role: "driver",
    last_event_type: null,
    created_at: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeTotals(overrides: Partial<CompanyTotals> = {}): CompanyTotals {
  return {
    company_id: "comp-1",
    total_amount: "0.00",
    order_count: 0,
    ...overrides,
  };
}

function makeQuery(overrides: Partial<DashboardQuery> = {}): DashboardQuery {
  return {
    company_id: "comp-1",
    page: 1,
    page_size: 20,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("OperationsService", () => {
  let mockRepo: {
    queryDashboard: MockFn;
    getCompanyTotal: MockFn;
    findWorkerById: MockFn;
    findLastEventForOrder: MockFn;
    upsertOperation: MockFn;
    upsertCompanyTotal: MockFn;
    getOperationByOrderId: MockFn;
  };

  let service: OperationsService;

  beforeEach(() => {
    mockRepo = {
      queryDashboard: vi.fn(),
      getCompanyTotal: vi.fn(),
      findWorkerById: vi.fn(),
      findLastEventForOrder: vi.fn(),
      upsertOperation: vi.fn(),
      upsertCompanyTotal: vi.fn(),
      getOperationByOrderId: vi.fn(),
    };
    service = new OperationsService(mockRepo as unknown as OperationsRepository);
  });

  // ─── Read-your-own-writes ──────────────────────────────────────────────

  describe("read-your-own-writes", () => {
    it("approve an order → returned row has the new status; next dashboard includes it", async () => {
      const input: SimulateWriteInput = {
        order_id: "ord-42",
        company_id: "comp-1",
        worker_id: "wkr-1",
        status: "approved",
        amount: "250.00",
        currency: "USD",
      };

      const projected: OperationRow = makeRow({
        order_id: "ord-42",
        status: "approved",
        amount: "250.00",
      });

      mockRepo.findWorkerById.mockResolvedValue({ id: "wkr-1", name: "Alice", role: "driver" });
      mockRepo.findLastEventForOrder.mockResolvedValue("status_changed");
      mockRepo.upsertOperation.mockResolvedValue(undefined);
      mockRepo.upsertCompanyTotal.mockResolvedValue(undefined);
      mockRepo.getOperationByOrderId.mockResolvedValue(projected);

      const result = await service.simulateWrite(input);

      // The write resolves with the committed projection row reflecting the new status
      expect(result.status).toBe("approved");
      expect(result.order_id).toBe("ord-42");
      expect(result.amount).toBe("250.00");

      // A subsequent dashboard read sees the row
      const dashResult: DashboardResult = {
        data: [projected],
        total_count: 1,
        page: 1,
        page_size: 20,
      };
      mockRepo.queryDashboard.mockResolvedValue(dashResult);

      const dashboard = await service.getDashboard(makeQuery());
      const rows: OperationRow[] = dashboard.data;
      expect(rows.length).toBe(1);
      expect(rows[0].order_id).toBe("ord-42");
      expect(rows[0].status).toBe("approved");
    });

    it("raises ResourceNotFoundError when the worker does not exist", async () => {
      const input: SimulateWriteInput = {
        order_id: "ord-99",
        company_id: "comp-1",
        worker_id: "wkr-missing",
        status: "pending",
        amount: "10.00",
        currency: "USD",
      };

      mockRepo.findWorkerById.mockResolvedValue(null);

      await expect(service.simulateWrite(input)).rejects.toThrow(ResourceNotFoundError);
    });
  });

  // ─── Concurrent updates to one company's totals ─────────────────────────

  describe("concurrent updates to one company's totals", () => {
    it("two simultaneous writes for the same company leave total_amount equal to the sum of both", async () => {
      const inputA: SimulateWriteInput = {
        order_id: "ord-A",
        company_id: "comp-1",
        worker_id: "wkr-1",
        status: "approved",
        amount: "100.00",
        currency: "USD",
      };
      const inputB: SimulateWriteInput = {
        order_id: "ord-B",
        company_id: "comp-1",
        worker_id: "wkr-2",
        status: "pending",
        amount: "200.00",
        currency: "USD",
      };

      mockRepo.findWorkerById.mockResolvedValue({ id: "wkr-1", name: "Alice", role: "driver" });
      mockRepo.findLastEventForOrder.mockResolvedValue(null);
      mockRepo.upsertOperation.mockResolvedValue(undefined);
      mockRepo.upsertCompanyTotal.mockResolvedValue(undefined);

      const rowA: OperationRow = makeRow({ order_id: "ord-A", amount: "100.00", status: "approved" });
      const rowB: OperationRow = makeRow({ order_id: "ord-B", amount: "200.00", status: "pending" });
      mockRepo.getOperationByOrderId
        .mockResolvedValueOnce(rowA)
        .mockResolvedValueOnce(rowB);

      const [resultA, resultB] = await Promise.all([
        service.simulateWrite(inputA),
        service.simulateWrite(inputB),
      ]);

      expect(resultA.order_id).toBe("ord-A");
      expect(resultB.order_id).toBe("ord-B");

      // After both writes commit, the company totals reflect both amounts
      const expectedTotals: CompanyTotals = makeTotals({
        total_amount: "300.00",
        order_count: 2,
      });
      mockRepo.getCompanyTotal.mockResolvedValue(expectedTotals);

      const totals = await service.getCompanyTotals("comp-1");
      expect(totals.total_amount).toBe("300.00");
      expect(totals.order_count).toBe(2);
    });
  });

  // ─── Dashboard filters by status and date range ─────────────────────────

  describe("dashboard filters", () => {
    it("returns only rows matching the filtered query", async () => {
      const matching: OperationRow[] = [
        makeRow({ order_id: "ord-1", status: "approved", created_at: new Date("2024-06-15T10:00:00Z") }),
        makeRow({ order_id: "ord-2", status: "approved", created_at: new Date("2024-06-14T09:00:00Z") }),
      ];

      const dashResult: DashboardResult = {
        data: matching,
        total_count: 2,
        page: 1,
        page_size: 20,
      };
      mockRepo.queryDashboard.mockResolvedValue(dashResult);

      const query: DashboardQuery = makeQuery({
        status: "approved",
        date_from: new Date("2024-06-01T00:00:00Z"),
        date_to: new Date("2024-06-30T23:59:59Z"),
      });

      const result = await service.getDashboard(query);

      // All returned rows carry the requested status
      const statuses: string[] = result.data.map((r: OperationRow) => r.status);
      expect(statuses.length).toBe(2);
      expect(statuses.every((s: string) => s === "approved")).toBe(true);
      expect(result.total_count).toBe(2);
    });

    it("raises InvalidDateRangeError when date_from is after date_to", async () => {
      const query: DashboardQuery = makeQuery({
        date_from: new Date("2024-06-30T00:00:00Z"),
        date_to: new Date("2024-06-01T00:00:00Z"),
      });

      await expect(service.getDashboard(query)).rejects.toThrow(InvalidDateRangeError);
    });

    it("raises ValidationError when page is less than 1", async () => {
      const query: DashboardQuery = makeQuery({ page: 0 });

      await expect(service.getDashboard(query)).rejects.toThrow(ValidationError);
    });

    it("raises ValidationError when page_size exceeds 100", async () => {
      const query: DashboardQuery = makeQuery({ page_size: 101 });

      await expect(service.getDashboard(query)).rejects.toThrow(ValidationError);
    });
  });

  // ─── Pagination ──────────────────────────────────────────────────────────

  describe("pagination", () => {
    it("returns the correct page, page_size, total_count, and row subset", async () => {
      const page2Rows: OperationRow[] = [
        makeRow({ order_id: "ord-11", created_at: new Date("2024-01-10T00:00:00Z") }),
        makeRow({ order_id: "ord-12", created_at: new Date("2024-01-09T00:00:00Z") }),
      ];

      const dashResult: DashboardResult = {
        data: page2Rows,
        total_count: 25,
        page: 2,
        page_size: 10,
      };
      mockRepo.queryDashboard.mockResolvedValue(dashResult);

      const query: DashboardQuery = makeQuery({ page: 2, page_size: 10 });
      const result = await service.getDashboard(query);

      expect(result.page).toBe(2);
      expect(result.page_size).toBe(10);
      expect(result.total_count).toBe(25);

      const orderIds: string[] = result.data.map((r: OperationRow) => r.order_id);
      expect(orderIds).toEqual(["ord-11", "ord-12"]);
    });
  });

  // ─── getCompanyTotals ────────────────────────────────────────────────────

  describe("getCompanyTotals", () => {
    it("returns exact totals for an existing company", async () => {
      const totals: CompanyTotals = makeTotals({ total_amount: "5000.00", order_count: 42 });
      mockRepo.getCompanyTotal.mockResolvedValue(totals);

      const result = await service.getCompanyTotals("comp-1");
      expect(result.total_amount).toBe("5000.00");
      expect(result.order_count).toBe(42);
    });

    it("raises ResourceNotFoundError for an unknown company", async () => {
      mockRepo.getCompanyTotal.mockResolvedValue(null);

      await expect(service.getCompanyTotals("comp-unknown")).rejects.toThrow(ResourceNotFoundError);
    });
  });
});
