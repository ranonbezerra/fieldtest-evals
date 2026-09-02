import { describe, it, expect, vi, beforeEach } from "vitest";
import { DriftRepairService } from "../src/drift-repair/drift-repair.service";
// ASSUMPTION: DriftRepairService's constructor accepts an OperationsRepository as its sole dependency, per PLAN.md.
import { OperationsRepository } from "../src/operations/operations.repository";

// ASSUMPTION: The repository methods used by DriftRepairService.run() are:
//   findProjectionByWindow(from, to) – projection rows whose updated_at falls in [from, to]
//   findOrdersByWindow(from, to)     – source payment_orders in the same window (for comparison)
//   findWorkerById(id)               – worker lookup
//   findLastEventForOrder(orderId)   – latest event type for an order (may be null)
//   upsertOperation(...)             – writes the repaired projection row
//   recomputeCompanyTotal(companyId) – recomputes exact aggregate from source

describe("DriftRepairService", () => {
  let service: DriftRepairService;
  let repo: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    repo = {
      findProjectionByWindow: vi.fn(),
      findOrdersByWindow: vi.fn(),
      findWorkerById: vi.fn(),
      findLastEventForOrder: vi.fn(),
      upsertOperation: vi.fn(),
      recomputeCompanyTotal: vi.fn(),
    };
    service = new DriftRepairService(repo as unknown as OperationsRepository);
  });

  it("detects and repairs a stale projection row", async () => {
    const now = new Date("2025-01-15T12:00:00Z");
    const windowStart = new Date("2025-01-15T11:00:00Z");
    const windowEnd: Date = now;

    const projectionRow: Record<string, unknown> = {
      order_id: "order-1",
      company_id: "company-1",
      status: "pending",
      amount: "100.00",
      currency: "USD",
      worker_name: "Stale Name",
      worker_role: "driver",
      last_event_type: null,
      created_at: new Date("2025-01-15T10:00:00Z"),
      updated_at: new Date("2025-01-15T10:30:00Z"),
    };

    const sourceOrder: Record<string, unknown> = {
      id: "order-1",
      company_id: "company-1",
      worker_id: "worker-1",
      status: "approved",
      amount: "100.00",
      currency: "USD",
      created_at: new Date("2025-01-15T10:00:00Z"),
      updated_at: new Date("2025-01-15T11:30:00Z"), // newer than projection → stale
    };

    const worker = { id: "worker-1", name: "Current Name", role: "driver" };
    const lastEvent = "status_changed";

    repo.findProjectionByWindow.mockResolvedValue([projectionRow]);
    repo.findOrdersByWindow.mockResolvedValue([sourceOrder]);
    repo.findWorkerById.mockResolvedValue(worker);
    repo.findLastEventForOrder.mockResolvedValue(lastEvent);
    repo.upsertOperation.mockResolvedValue(undefined);
    repo.recomputeCompanyTotal.mockResolvedValue(undefined);

    const report = await service.run();

    expect(report.rows_checked).toBe(1);
    expect(report.rows_repaired).toBeGreaterThan(0);
    expect(repo.upsertOperation).toHaveBeenCalledTimes(1);
  });

  it("skips rows where the projection is already in sync with the source", async () => {
    const projectionRow: Record<string, unknown> = {
      order_id: "order-1",
      company_id: "company-1",
      status: "approved",
      amount: "200.00",
      currency: "USD",
      worker_name: "Worker A",
      worker_role: "driver",
      last_event_type: "status_changed",
      created_at: new Date("2025-01-15T10:00:00Z"),
      updated_at: new Date("2025-01-15T11:30:00Z"), // same or newer than source → in sync
    };

    const sourceOrder: Record<string, unknown> = {
      id: "order-1",
      company_id: "company-1",
      worker_id: "worker-1",
      status: "approved",
      amount: "200.00",
      currency: "USD",
      created_at: new Date("2025-01-15T10:00:00Z"),
      updated_at: new Date("2025-01-15T11:00:00Z"), // older than projection
    };

    repo.findProjectionByWindow.mockResolvedValue([projectionRow]);
    repo.findOrdersByWindow.mockResolvedValue([sourceOrder]);
    repo.upsertOperation.mockResolvedValue(undefined);
    repo.recomputeCompanyTotal.mockResolvedValue(undefined);

    const report = await service.run();

    expect(report.rows_checked).toBe(1);
    expect(report.rows_repaired).toBe(0);
    expect(repo.upsertOperation).not.toHaveBeenCalled();
    expect(repo.recomputeCompanyTotal).not.toHaveBeenCalled();
  });

  it("recomputes company totals after repairing stale rows", async () => {
    const projectionRow: Record<string, unknown> = {
      order_id: "order-1",
      company_id: "company-1",
      status: "pending",
      amount: "50.00",
      currency: "USD",
      worker_name: "Old",
      worker_role: "driver",
      last_event_type: null,
      created_at: new Date("2025-01-15T10:00:00Z"),
      updated_at: new Date("2025-01-15T10:15:00Z"),
    };

    const sourceOrder: Record<string, unknown> = {
      id: "order-1",
      company_id: "company-1",
      worker_id: "worker-1",
      status: "settled",
      amount: "75.00",
      currency: "USD",
      created_at: new Date("2025-01-15T10:00:00Z"),
      updated_at: new Date("2025-01-15T11:45:00Z"), // newer → stale
    };

    const worker = { id: "worker-1", name: "New", role: "driver" };

    repo.findProjectionByWindow.mockResolvedValue([projectionRow]);
    repo.findOrdersByWindow.mockResolvedValue([sourceOrder]);
    repo.findWorkerById.mockResolvedValue(worker);
    repo.findLastEventForOrder.mockResolvedValue(null);
    repo.upsertOperation.mockResolvedValue(undefined);
    repo.recomputeCompanyTotal.mockResolvedValue(undefined);

    const report = await service.run();

    expect(report.rows_repaired).toBeGreaterThan(0);
    expect(repo.recomputeCompanyTotal).toHaveBeenCalledWith("company-1");
  });
});
