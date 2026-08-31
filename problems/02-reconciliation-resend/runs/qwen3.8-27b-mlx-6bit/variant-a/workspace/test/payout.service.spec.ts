import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BankClient, BankSendResponse, SendClassification, Settlement } from "../src/payout/bank-client";
import type { PayoutRepository } from "../src/payout/payout.repository";
import { PayoutService } from "../src/payout/payout.service";
import type { Order, ReconcileRun, SendEvent } from "@prisma/client";

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "ord-1",
    supplier_key: "key-1",
    amount_cents: 100,
    effective_date: "2025-01-15",
    txid: "txid-1",
    state: "pending",
    send_attempts: 0,
    created_at: new Date("2025-01-15T00:00:00.000Z"),
    updated_at: new Date("2025-01-15T00:00:00.000Z"),
    ...overrides,
  };
}

function makeSettlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    txid: "txid-1",
    amount_cents: 100,
    settled_at: new Date("2025-01-15T00:10:00.000Z"),
    ...overrides,
  };
}

function makeBankMock(): BankClient {
  return {
    send: vi.fn(),
    getStatement: vi.fn(),
  };
}

function makeRepoMock(): PayoutRepository {
  return {
    findPendingOrders: vi.fn(),
    findById: vi.fn(),
    claimOrder: vi.fn(),
    updateState: vi.fn(),
    findOrdersByTxids: vi.fn(),
    findOrdersByEffectiveDate: vi.fn(),
    createReconcileRun: vi.fn(),
    getLatestReconcileRunForDate: vi.fn(),
    createSendEvent: vi.fn(),
  } as unknown as PayoutRepository;
}

describe("PayoutService", () => {
  let service: PayoutService;
  let repo: PayoutRepository;
  let bank: BankClient;

  beforeEach(() => {
    repo = makeRepoMock();
    bank = makeBankMock();
    service = new PayoutService(repo, bank);
    vi.clearAllMocks();
  });

  describe("deriveTxid", () => {
    it("returns the same value for the same inputs across calls", () => {
      const a = service.deriveTxid("ord-1", "2025-01-15");
      const b = service.deriveTxid("ord-1", "2025-01-15");
      expect(a).toBe(b);
    });

    it("returns different values for different inputs", () => {
      const a = service.deriveTxid("ord-1", "2025-01-15");
      const b = service.deriveTxid("ord-2", "2025-01-15");
      expect(a).not.toBe(b);
    });

    it("returns a 32-character hex string", () => {
      const txid = service.deriveTxid("ord-1", "2025-01-15");
      expect(txid).toHaveLength(32);
      expect(txid).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("executePayments", () => {
    it("sends pending orders and records accepted classification", async () => {
      const order = makeOrder({ id: "ord-1", state: "pending", send_attempts: 0, txid: "txid-1" });
      vi.mocked(repo.findPendingOrders).mockResolvedValue([order]);
      vi.mocked(repo.claimOrder).mockResolvedValue({ ...order, state: "sent", send_attempts: 1 });
      vi.mocked(bank.send).mockResolvedValue({ classification: "accepted", txid: "txid-1" });

      const results = await service.executePayments();

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ order_id: "ord-1", txid: "txid-1", classification: "accepted" });
      expect(repo.claimOrder).toHaveBeenCalledWith("ord-1");
      expect(bank.send).toHaveBeenCalledWith({ txid: "txid-1", amount_cents: 100, key: "key-1" });
    });

    it("skips orders that fail the atomic claim (concurrent claim)", async () => {
      const order = makeOrder({ id: "ord-1", state: "pending" });
      vi.mocked(repo.findPendingOrders).mockResolvedValue([order]);
      vi.mocked(repo.claimOrder).mockResolvedValue(null);

      const results = await service.executePayments();

      expect(results).toHaveLength(0);
      expect(bank.send).not.toHaveBeenCalled();
    });

    it("marks order settled on duplicate response", async () => {
      const order = makeOrder({ id: "ord-1", state: "pending" });
      vi.mocked(repo.findPendingOrders).mockResolvedValue([order]);
      vi.mocked(repo.claimOrder).mockResolvedValue({ ...order, state: "sent", send_attempts: 1 });
      vi.mocked(bank.send).mockResolvedValue({ classification: "duplicate", txid: "txid-1" });

      const results = await service.executePayments();

      expect(results[0].classification).toBe("duplicate");
      expect(repo.updateState).toHaveBeenCalledWith("ord-1", "settled");
    });

    it("marks order rejected on permanent_rejection", async () => {
      const order = makeOrder({ id: "ord-1", state: "pending" });
      vi.mocked(repo.findPendingOrders).mockResolvedValue([order]);
      vi.mocked(repo.claimOrder).mockResolvedValue({ ...order, state: "sent", send_attempts: 1 });
      vi.mocked(bank.send).mockResolvedValue({ classification: "permanent_rejection", txid: "txid-1" });

      const results = await service.executePayments();

      expect(results[0].classification).toBe("permanent_rejection");
      expect(repo.updateState).toHaveBeenCalledWith("ord-1", "rejected");
    });

    it("keeps order in sent state on transient_error", async () => {
      const order = makeOrder({ id: "ord-1", state: "pending" });
      vi.mocked(repo.findPendingOrders).mockResolvedValue([order]);
      vi.mocked(repo.claimOrder).mockResolvedValue({ ...order, state: "sent", send_attempts: 1 });
      vi.mocked(bank.send).mockResolvedValue({ classification: "transient_error", txid: "txid-1" });

      const results = await service.executePayments();

      expect(results[0].classification).toBe("transient_error");
      expect(repo.updateState).not.toHaveBeenCalled();
    });

    it("treats unclassifiable bank.send exception as transient_error", async () => {
      const order = makeOrder({ id: "ord-1", state: "pending" });
      vi.mocked(repo.findPendingOrders).mockResolvedValue([order]);
      vi.mocked(repo.claimOrder).mockResolvedValue({ ...order, state: "sent", send_attempts: 1 });
      vi.mocked(bank.send).mockRejectedValue(new Error("network timeout"));

      const results = await service.executePayments();

      expect(results[0].classification).toBe("transient_error");
    });

    it("does not send orders already in terminal states", async () => {
      vi.mocked(repo.findPendingOrders).mockResolvedValue([]);

      const results = await service.executePayments();

      expect(results).toHaveLength(0);
      expect(bank.send).not.toHaveBeenCalled();
    });
  });

  describe("reconcile", () => {
    const window = { from: new Date("2025-01-15T00:00:00.000Z"), to: new Date("2025-01-15T23:59:59.999Z") };

    function setupReconcileMocks(
      orders: Order[],
      statement: Settlement[],
      published: boolean,
    ) {
      vi.mocked(repo.findOrdersByEffectiveDateRange as any).mockResolvedValue(orders);
      vi.mocked(bank.getStatement).mockResolvedValue(statement);
      if (published) {
        vi.setSystemTime(new Date("2025-01-15T01:00:00.000Z"));
      } else {
        vi.setSystemTime(new Date("2025-01-15T00:20:00.000Z"));
      }
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("timeout-but-settled: order in sent state with txid in statement becomes settled", async () => {
      const order = makeOrder({ id: "ord-1", state: "sent", send_attempts: 1, txid: "txid-1" });
      const settlement = makeSettlement({ txid: "txid-1", settled_at: new Date("2025-01-15T00:10:00.000Z") });
      setupReconcileMocks([order], [settlement], true);
      vi.mocked(repo.findOrdersByEffectiveDate).mockResolvedValue([order]);

      const result = await service.reconcile(window);

      expect(repo.updateState).toHaveBeenCalledWith("ord-1", "settled");
      expect(result.matched_count).toBe(1);
    });

    it("proven-absent with attempts < 5: order reverts to pending for resend", async () => {
      const order = makeOrder({ id: "ord-1", state: "sent", send_attempts: 1, txid: "txid-1" });
      setupReconcileMocks([order], [], true);
      vi.mocked(repo.findOrdersByEffectiveDate).mockResolvedValue([order]);

      await service.reconcile(window);

      expect(repo.updateState).toHaveBeenCalledWith("ord-1", "pending");
    });

    it("proven-absent with attempts >= 5: order moves to manual_review", async () => {
      const order = makeOrder({ id: "ord-1", state: "sent", send_attempts: 5, txid: "txid-1" });
      setupReconcileMocks([order], [], true);
      vi.mocked(repo.findOrdersByEffectiveDate).mockResolvedValue([order]);

      await service.reconcile(window);

      expect(repo.updateState).toHaveBeenCalledWith("ord-1", "manual_review");
    });

    it("attempt exhaustion: after 5 sends all proven absent, order is parked and no further sends occur", async () => {
      const order = makeOrder({ id: "ord-1", state: "sent", send_attempts: 5, txid: "txid-1" });
      setupReconcileMocks([order], [], true);
      vi.mocked(repo.findOrdersByEffectiveDate).mockResolvedValue([order]);

      await service.reconcile(window);

      expect(repo.updateState).toHaveBeenCalledWith("ord-1", "manual_review");

      vi.mocked(repo.findPendingOrders).mockResolvedValue([]);
      const results = await service.executePayments();
      expect(results).toHaveLength(0);
      expect(bank.send).not.toHaveBeenCalled();
    });

    it("duplicate on first send: order settles without extra attempt consumption", async () => {
      const order = makeOrder({ id: "ord-1", state: "pending" });
      vi.mocked(repo.findPendingOrders).mockResolvedValue([order]);
      vi.mocked(repo.claimOrder).mockResolvedValue({ ...order, state: "sent", send_attempts: 1 });
      vi.mocked(bank.send).mockResolvedValue({ classification: "duplicate", txid: "txid-1" });

      const results = await service.executePayments();

      expect(results[0].classification).toBe("duplicate");
      expect(repo.updateState).toHaveBeenCalledWith("ord-1", "settled");
    });

    it("permanent rejection: order moves to rejected and is never sent again", async () => {
      const order = makeOrder({ id: "ord-1", state: "pending" });
      vi.mocked(repo.findPendingOrders).mockResolvedValue([order]);
      vi.mocked(repo.claimOrder).mockResolvedValue({ ...order, state: "sent", send_attempts: 1 });
      vi.mocked(bank.send).mockResolvedValue({ classification: "permanent_rejection", txid: "txid-1" });

      await service.executePayments();
      expect(repo.updateState).toHaveBeenCalledWith("ord-1", "rejected");

      vi.mocked(repo.findPendingOrders).mockResolvedValue([]);
      const results = await service.executePayments();
      expect(results).toHaveLength(0);
    });

    it("overlapping windows: second run does not re-transition already-settled orders", async () => {
      const order = makeOrder({ id: "ord-1", state: "sent", send_attempts: 1, txid: "txid-1" });
      const settlement = makeSettlement({ txid: "txid-1", settled_at: new Date("2025-01-15T00:10:00.000Z") });
      setupReconcileMocks([order], [settlement], true);
      vi.mocked(repo.findOrdersByEffectiveDate).mockResolvedValue([order]);

      await service.reconcile(window);
      expect(repo.updateState).toHaveBeenCalledWith("ord-1", "settled");

      vi.clearAllMocks();
      const settledOrder = makeOrder({ id: "ord-1", state: "settled", send_attempts: 1, txid: "txid-1" });
      vi.mocked(repo.findOrdersByEffectiveDateRange as any).mockResolvedValue([settledOrder]);
      vi.mocked(bank.getStatement).mockResolvedValue([settlement]);
      vi.mocked(repo.findOrdersByEffectiveDate).mockResolvedValue([settledOrder]);

      const result = await service.reconcile(window);
      expect(repo.updateState).not.toHaveBeenCalledWith("ord-1", "settled");
      expect(result.matched_count).toBe(0);
    });

    it("statement not yet published: no orders are marked proven-absent", async () => {
      const order = makeOrder({ id: "ord-1", state: "sent", send_attempts: 1, txid: "txid-1" });
      const settlement = makeSettlement({ txid: "txid-1", settled_at: new Date("2025-01-15T00:10:00.000Z") });
      setupReconcileMocks([order], [settlement], false);
      vi.mocked(repo.findOrdersByEffectiveDate).mockResolvedValue([order]);

      const result = await service.reconcile(window);

      expect(repo.updateState).not.toHaveBeenCalled();
      expect(result.matched_count).toBe(0);
    });

    it("concurrent executePayments claim: only one succeeds", async () => {
      const order = makeOrder({ id: "ord-1", state: "pending" });
      vi.mocked(repo.findPendingOrders).mockResolvedValue([order]);
      vi.mocked(repo.claimOrder)
        .mockResolvedValueOnce({ ...order, state: "sent", send_attempts: 1 })
        .mockResolvedValueOnce(null);

      const results = await service.executePayments();
      expect(results).toHaveLength(1);

      vi.clearAllMocks();
      vi.mocked(repo.findPendingOrders).mockResolvedValue([order]);
      vi.mocked(repo.claimOrder).mockResolvedValue(null);

      const results2 = await service.executePayments();
      expect(results2).toHaveLength(0);
    });

    it("resend uses the same txid as the original send", async () => {
      const order = makeOrder({ id: "ord-1", state: "sent", send_attempts: 1, txid: "txid-original" });
      setupReconcileMocks([order], [], true);
      vi.mocked(repo.findOrdersByEffectiveDate).mockResolvedValue([order]);

      await service.reconcile(window);
      expect(repo.updateState).toHaveBeenCalledWith("ord-1", "pending");

      const pendingOrder = makeOrder({ id: "ord-1", state: "pending", send_attempts: 1, txid: "txid-original" });
      vi.mocked(repo.findPendingOrders).mockResolvedValue([pendingOrder]);
      vi.mocked(repo.claimOrder).mockResolvedValue({ ...pendingOrder, state: "sent", send_attempts: 2 });
      vi.mocked(bank.send).mockResolvedValue({ classification: "duplicate", txid: "txid-original" });

      const results = await service.executePayments();
      expect(bank.send).toHaveBeenCalledWith({ txid: "txid-original", amount_cents: 100, key: "key-1" });
      expect(results[0].txid).toBe("txid-original");
    });
  });
});
