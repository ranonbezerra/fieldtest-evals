import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OperationsRepository } from "../src/operations/operations.repository.js";
import { OperationsService } from "../src/operations/operations.service.js";
import type {
  OrderStatus,
  DashboardQuery,
  SimulateWriteInput,
  OperationRow,
  CompanyTotals,
  DashboardResult,
} from "../src/operations/operations.types.js";
import { ResourceNotFoundError } from "../src/operations/operations.types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────────

interface MockState {
  operations: Map<string, OperationRow>;
  totals: Map<string, { totalAmount: number; orderCount: number }>;
  workers: Map<string, { id: string; name: string; role: string }>;
}

function freshState(): MockState {
  return {
    operations: new Map(),
    totals: new Map(),
    workers: new Map([
      ["worker-1", { id: "worker-1", name: "Alice", role: "courier" }],
      ["worker-2", { id: "worker-2", name: "Bob", role: "driver" }],
    ]),
  };
}

function createMock(state: MockState) {
  return {
    findWorkerById: vi.fn(async (id: string) => state.workers.get(id) ?? null),
    findLastEventForOrder: vi.fn(async () => null),
    upsertOperation: vi.fn(
      async (
        _tx: unknown,
        order: SimulateWriteInput,
        worker: { name: string; role: string },
        lastEventType: string | null,
      ) => {
        const row: OperationRow = {
          order_id: order.order_id,
          company_id: order.company_id,
          status: order.status,
          amount: order.amount,
          currency: order.currency,
          worker_name: worker.name,
          worker_role: worker.role,
          last_event_type: lastEventType,
          created_at: new Date(),
        };
        state.operations.set(order.order_id, row);
      },
    ),
    upsertCompanyTotal: vi.fn(
      async (_tx: unknown, companyId: string, deltaAmount: string, deltaCount: number) => {
        const cur = state.totals.get(companyId) ?? { totalAmount: 0, orderCount: 0 };
        cur.totalAmount += Number(deltaAmount);
        cur.orderCount += deltaCount;
        state.totals.set(companyId, cur);
      },
    ),
    queryDashboard: vi.fn(async (query: DashboardQuery): Promise<DashboardResult> => {
      let rows = [...state.operations.values()].filter(
        (r) => r.company_id === query.company_id,
      );
      if (query.status !== undefined) {
        rows = rows.filter((r) => r.status === query.status);
      }
      if (query.date_from !== undefined) {
        rows = rows.filter((r) => r.created_at >= query.date_from);
      }
      if (query.date_to !== undefined) {
        rows = rows.filter((r) => r.created_at <= query.date_to);
      }
      rows.sort(
        (a, b) =>
          b.created_at.getTime() - a.created_at.getTime() ||
          b.order_id.localeCompare(a.order_id),
      );
      const total = rows.length;
      const start = (query.page - 1) * query.page_size;
      return {
        data: rows.slice(start, start + query.page_size),
        total_count: total,
        page: query.page,
        page_size: query.page_size,
      };
    }),
    getOperationByOrderId: vi.fn(async (id: string) => state.operations.get(id) ?? null),
    getCompanyTotal: vi.fn(
      async (companyId: string): Promise<CompanyTotals | null> => {
        const t = state.totals.get(companyId);
        if (!t) return null;
        return {
          company_id: companyId,
          total_amount: t.totalAmount.toFixed(2),
          order_count: t.orderCount,
        };
      },
    ),
  };
}

function buildService(state: MockState): OperationsService {
  const mock = createMock(state) as unknown as OperationsRepository;
  return new OperationsService(mock);
}

// ─── Tests ───────────────────────────────────────────────────────────────────────

describe("operations", () => {
  let state: MockState;
  let service: OperationsService;

  beforeEach(() => {
    state = freshState();
    service = buildService(state);
  });

  it("read-your-own-writes: approve an order, next getDashboard includes it with new status", async () => {
    const input: SimulateWriteInput = {
      order_id: "order-1",
      company_id: "company-1",
      worker_id: "worker-1",
      status: "approved",
      amount: "100.00",
      currency: "USD",
    };

    await service.simulateWrite(input);

    const result = await service.getDashboard({
      company_id: "company-1",
      page: 1,
      page_size: 10,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].order_id).toBe("order-1");
    expect(result.data[0].status).toBe("approved");
  });

  it("concurrent updates to one company's totals: two simultaneous writes leave total = sum of both", async () => {
    const inputA: SimulateWriteInput = {
      order_id: "order-a",
      company_id: "company-1",
      worker_id: "worker-1",
      status: "pending",
      amount: "50.00",
      currency: "USD",
    };
    const inputB: SimulateWriteInput = {
      order_id: "order-b",
      company_id: "company-1",
      worker_id: "worker-2",
      status: "pending",
      amount: "75.00",
      currency: "USD",
    };

    await Promise.all([service.simulateWrite(inputA), service.simulateWrite(inputB)]);

    const totals = await service.getCompanyTotals("company-1");
    expect(totals.total_amount).toBe("125.00");
    expect(totals.order_count).toBe(2);
  });

  it("dashboard filters by status and date range correctly", async () => {
    const baseTime = new Date("2025-01-15T10:00:00Z");

    state.operations.set("op-1", {
      order_id: "op-1",
      company_id: "company-1",
      status: "approved",
      amount: "10.00",
      currency: "USD",
      worker_name: "Alice",
      worker_role: "courier",
      last_event_type: null,
      created_at: baseTime,
    });
    state.operations.set("op-2", {
      order_id: "op-2",
      company_id: "company-1",
      status: "rejected",
      amount: "20.00",
      currency: "USD",
      worker_name: "Bob",
      worker_role: "driver",
      last_event_type: null,
      created_at: new Date(baseTime.getTime() + 3_600_000),
    });
    state.operations.set("op-3", {
      order_id: "op-3",
      company_id: "company-1",
      status: "approved",
      amount: "30.00",
      currency: "USD",
      worker_name: "Alice",
      worker_role: "courier",
      last_event_type: null,
      created_at: new Date(baseTime.getTime() + 7_200_000),
    });

    // status = "approved" AND date range covering only the first hour → op-1 only
    const result = await service.getDashboard({
      company_id: "company-1",
      status: "approved",
      date_from: baseTime,
      date_to: new Date(baseTime.getTime() + 3_600_000),
      page: 1,
      page_size: 10,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].order_id).toBe("op-1");
  });

  it("pagination returns correct page and total_count", async () => {
    const baseTime = new Date("2025-01-10T00:00:00Z");
    for (let i = 1; i <= 5; i++) {
      state.operations.set(`op-${i}`, {
        order_id: `op-${i}`,
        company_id: "company-1",
        status: "approved",
        amount: `${i * 10}.00`,
        currency: "USD",
        worker_name: "Alice",
        worker_role: "courier",
        last_event_type: null,
        created_at: new Date(baseTime.getTime() + i * 60_000),
      });
    }

    const page1 = await service.getDashboard({
      company_id: "company-1",
      page: 1,
      page_size: 2,
    });

    expect(page1.total_count).toBe(5);
    expect(page1.data).toHaveLength(2);
    expect(page1.data[0].order_id).toBe("op-5");
    expect(page1.data[1].order_id).toBe("op-4");

    const page2 = await service.getDashboard({
      company_id: "company-1",
      page: 2,
      page_size: 2,
    });

    expect(page2.data).toHaveLength(2);
    expect(page2.data[0].order_id).toBe("op-3");
    expect(page2.data[1].order_id).toBe("op-2");
  });
});
