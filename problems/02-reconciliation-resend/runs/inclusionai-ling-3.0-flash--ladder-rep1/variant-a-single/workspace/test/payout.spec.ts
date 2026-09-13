import { describe, it, expect, beforeEach } from "vitest";
import { PayoutService } from "../src/payout/payout.service";
import { BankService } from "../src/bank/bank.service";
import { PayoutStatus, SendOutcome } from "../src/payout/payout.types";
import { Settlement, BankSendResult, BankSendRequest } from "../src/bank/bank.types";

// Minimal in-memory Payout-like object for test construction.
interface TestPayout {
  id: string;
  orderRef: string;
  txid: string;
  amount: number;
  status: string;
  effectiveDate: Date;
  key: string;
  attemptCount: number;
  bankReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Simple deterministic txid helper (mirrors src/payout/payout.utils.ts).
function deriveTxid(orderRef: string, effectiveDate: Date): string {
  const dateStr = effectiveDate.toISOString().split("T")[0];
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(`${orderRef}:${dateStr}`).digest("hex").substring(0, 24);
}

// In-memory repository that tracks state and records all calls for assertion.
class InMemoryPayoutRepository {
  payouts: Map<string, TestPayout> = new Map();
  calls: Array<{
    method: string;
    id: string;
    status?: string;
    attemptCount?: number;
    bankReference?: string | null;
  }> = [];

  async create(data: {
    orderRef: string;
    amount: number;
    key: string;
    effectiveDate: Date;
  }): Promise<TestPayout> {
    const txid = deriveTxid(data.orderRef, data.effectiveDate);
    const payout: TestPayout = {
      id: crypto.randomUUID(),
      ...data,
      txid,
      status: PayoutStatus.PENDING,
      attemptCount: 0,
      bankReference: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.payouts.set(payout.id, payout);
    return payout;
  }

  async findPending(): Promise<TestPayout[]> {
    return Array.from(this.payouts.values()).filter(
      (p) => p.status === PayoutStatus.PENDING,
    );
  }

  async findAwaitingSet(): Promise<TestPayout[]> {
    return Array.from(this.payouts.values()).filter(
      (p) => p.status === PayoutStatus.AWAITING_SET,
    );
  }

  async updateStatus(
    id: string,
    status: string,
    data: { attemptCount?: number; bankReference?: string | null },
  ): Promise<void> {
    const payout = this.payouts.get(id);
    if (!payout) return;
    const updated: TestPayout = {
      ...payout,
      status,
      ...data,
      updatedAt: new Date(),
    };
    this.payouts.set(id, updated);
    this.calls.push({ method: "updateStatus", id, status, ...data });
  }

  getPayout(id: string): TestPayout | undefined {
    return this.payouts.get(id);
  }
}

// Mock BankService that records calls and returns configured responses.
class MockBankService extends BankService {
  sendResults: Map<string, BankSendResult> = new Map();
  statementResults: Settlement[] = [];
  sendCalls: Array<BankSendRequest> = [];

  override async send(req: BankSendRequest): Promise<BankSendResult> {
    this.sendCalls.push(req);
    const result = this.sendResults.get(req.txid);
    if (result) return result;
    const results = Array.from(this.sendResults.values());
    if (results.length > 0) return results[0];
    return { outcome: SendOutcome.TRANSIENT };
  }

  override async getStatement(_start: Date, _end: Date): Promise<Settlement[]> {
    return this.statementResults;
  }

  configureSend(txid: string, outcome: SendOutcome): void {
    this.sendResults.set(txid, { outcome });
  }

  configureStatement(settlements: Settlement[]): void {
    this.statementResults = settlements;
  }
}

// Factory to build a PayoutService with the in-memory repo and mock bank.
function buildService(): {
  service: PayoutService;
  repo: InMemoryPayoutRepository;
  bank: MockBankService;
} {
  const repo = new InMemoryPayoutRepository();
  const bank = new MockBankService();

  // PayoutService expects PayoutRepository and BankService via constructor.
  // We bypass NestJS DI by directly instantiating with our test doubles.
  const service = new (require("../src/payout/payout.service").PayoutService)(
    repo,
    bank,
  );

  return { service, repo, bank };
}

// Helper: create a payout and set its createdAt to a specific time ago.
async function createPayout(
  repo: InMemoryPayoutRepository,
  opts: {
    orderRef: string;
    amount: number;
    key: string;
    effectiveDate: Date;
    createdAt?: Date;
  },
): Promise<TestPayout> {
  const payout = await repo.create(opts);
  if (opts.createdAt) {
    const updated = { ...payout, createdAt: opts.createdAt, updatedAt: opts.createdAt };
    repo.payouts.set(payout.id, updated);
    return updated;
  }
  return payout;
}

describe("PayoutService", () => {
  let service: PayoutService;
  let repo: InMemoryPayoutRepository;
  let bank: MockBankService;

  beforeEach(() => {
    const built = buildService();
    service = built.service;
    repo = built.repo;
    bank = built.bank;
  });

  // ── Send outcome classification ─────────────────────────────────────

  describe("executePayments — send outcome classification", () => {
    it("accepted → AWAITING_SET", async () => {
      const payout = await createPayout(repo, {
        orderRef: "ORD-001",
        amount: 10000,
        key: "SUP-KEY-1",
        effectiveDate: new Date("2025-01-15"),
      });
      bank.configureSend(payout.txid, SendOutcome.ACCEPTED);

      await service.executePayments();

      const current = repo.getPayout(payout.id)!;
      expect(current.status).toBe(PayoutStatus.AWAITING_SET);
      expect(current.attemptCount).toBe(1);
    });

    it("duplicate → SETTLED", async () => {
      const payout = await createPayout(repo, {
        orderRef: "ORD-002",
        amount: 20000,
        key: "SUP-KEY-2",
        effectiveDate: new Date("2025-01-15"),
      });
      bank.configureSend(payout.txid, SendOutcome.DUPLICATE);

      await service.executePayments();

      const current = repo.getPayout(payout.id)!;
      expect(current.status).toBe(PayoutStatus.SETTLED);
      expect(current.attemptCount).toBe(1);
    });

    it("transient → AWAITING_SET (outcome unknown — wait for evidence)", async () => {
      const payout = await createPayout(repo, {
        orderRef: "ORD-003",
        amount: 30000,
        key: "SUP-KEY-3",
        effectiveDate: new Date("2025-01-15"),
      });
      bank.configureSend(payout.txid, SendOutcome.TRANSIENT);

      await service.executePayments();

      const current = repo.getPayout(payout.id)!;
      expect(current.status).toBe(PayoutStatus.AWAITING_SET);
      expect(current.attemptCount).toBe(1);
    });

    it("permanent → REJECTED", async () => {
      const payout = await createPayout(repo, {
        orderRef: "ORD-004",
        amount: 40000,
        key: "SUP-KEY-4",
        effectiveDate: new Date("2025-01-15"),
      });
      bank.configureSend(payout.txid, SendOutcome.PERMANENT);

      await service.executePayments();

      const current = repo.getPayout(payout.id)!;
      expect(current.status).toBe(PayoutStatus.REJECTED);
      expect(current.attemptCount).toBe(1);
    });
  });

  // ── Reconciliation scenarios ────────────────────────────────────────

  describe("reconcile — timeout-but-settled", () => {
    it("send timed out but order is in the statement → no resend, order settles", async () => {
      const payout = await createPayout(repo, {
        orderRef: "ORD-100",
        amount: 50000,
        key: "SUP-KEY-100",
        effectiveDate: new Date("2025-01-15"),
      });

      // Step 1: executePayments — send times out (transient)
      bank.configureSend(payout.txid, SendOutcome.TRANSIENT);
      await service.executePayments();

      let current = repo.getPayout(payout.id)!;
      expect(current.status).toBe(PayoutStatus.AWAITING_SET);
      expect(current.attemptCount).toBe(1);

      // Step 2: reconcile — order IS in the statement (settled at the bank)
      bank.configureStatement([
        { txid: payout.txid, amount: 50000, date: "2025-01-15", reference: "BANK-REF-1" },
      ]);
      const now = new Date();
      await service.reconcile({ start: new Date(now.getTime() - 3600_000), end: now });

      current = repo.getPayout(payout.id)!;
      expect(current.status).toBe(PayoutStatus.SETTLED);
      expect(current.bankReference).toBe("BANK-REF-1");

      // No resend happened — bank.send was called exactly once (from executePayments)
      expect(bank.sendCalls.length).toBe(1);
    });
  });

  describe("reconcile — proven-absent (resend, same txid)", () => {
    it("send timed out and proven absent past lag → resend with SAME txid", async () => {
      const createdAt = new Date(Date.now() - 65 * 60 * 1000); // 65 min ago
      const payout = await createPayout(repo, {
        orderRef: "ORD-200",
        amount: 60000,
        key: "SUP-KEY-200",
        effectiveDate: new Date("2025-01-15"),
        createdAt,
      });

      // Step 1: executePayments — send times out (transient)
      bank.configureSend(payout.txid, SendOutcome.TRANSIENT);
      await service.executePayments();

      let current = repo.getPayout(payout.id)!;
      expect(current.status).toBe(PayoutStatus.AWAITING_SET);
      expect(current.attemptCount).toBe(1);

      // Step 2: reconcile — order NOT in statement, past publishing lag → resend
      bank.configureStatement([]); // empty statement — proven absent
      bank.sendCalls = []; // reset to isolate the resend call
      const now = new Date();
      await service.reconcile({ start: new Date(now.getTime() - 3600_000), end: now });

      current = repo.getPayout(payout.id)!;
      expect(current.status).toBe(PayoutStatus.AWAITING_SET); // resend returns transient again
      expect(current.attemptCount).toBe(2);

      // Resend used the SAME txid
      expect(bank.sendCalls.length).toBe(1);
      expect(bank.sendCalls[0].txid).toBe(payout.txid);

      // Step 3: settle via statement
      bank.configureStatement([
        { txid: payout.txid, amount: 60000, date: "2025-01-15" },
      ]);
      await service.reconcile({ start: new Date(now.getTime() - 3600_000), end: now });

      current = repo.getPayout(payout.id)!;
      expect(current.status).toBe(PayoutStatus.SETTLED);
    });
  });

  describe("reconcile — attempt exhaustion", () => {
    it("after 5 attempts → parked for manual review, nothing reverted", async () => {
      const createdAt = new Date(Date.now() - 65 * 60 * 1000);
      const payout = await createPayout(repo, {
        orderRef: "ORD-300",
        amount: 70000,
        key: "SUP-KEY-300",
        effectiveDate: new Date("2025-01-15"),
        createdAt,
      });

      // executePayments → attempt 1 (transient)
      bank.configureSend(payout.txid, SendOutcome.TRANSIENT);
      await service.executePayments();

      let current = repo.getPayout(payout.id)!;
      expect(current.attemptCount).toBe(1);

      // Reconcile runs 4 more times, each time resending (transient) → attempts 2-5
      const now = new Date();
      const window = { start: new Date(now.getTime() - 3600_000), end: now };

      // Attempt 2
      bank.sendCalls = [];
      bank.configureStatement([]);
      await service.reconcile(window);
      current = repo.getPayout(payout.id)!;
      expect(current.attemptCount).toBe(2);
      expect(current.status).toBe(PayoutStatus.AWAITING_SET);

      // Attempt 3
      bank.sendCalls = [];
      await service.reconcile(window);
      current = repo.getPayout(payout.id)!;
      expect(current.attemptCount).toBe(3);

      // Attempt 4
      bank.sendCalls = [];
      await service.reconcile(window);
      current = repo.getPayout(payout.id)!;
      expect(current.attemptCount).toBe(4);

      // Attempt 5
      bank.sendCalls = [];
      await service.reconcile(window);
      current = repo.getPayout(payout.id)!;
      expect(current.attemptCount).toBe(5);

      // Attempt 6 — should now park
      bank.sendCalls = [];
      await service.reconcile(window);
      current = repo.getPayout(payout.id)!;
      expect(current.status).toBe(PayoutStatus.PARKED);
      expect(current.attemptCount).toBe(5); // no more increments

      // No resend happened on the park attempt
      expect(bank.sendCalls.length).toBe(0);

      // Subsequent reconcile calls do not change state
      bank.sendCalls = [];
      await service.reconcile(window);
      current = repo.getPayout(payout.id)!;
      expect(current.status).toBe(PayoutStatus.PARKED);
      expect(bank.sendCalls.length).toBe(0);
    });
  });

  // ── Idempotency ─────────────────────────────────────────────────────

  describe("reconcile — idempotency", () => {
    it("reconcile run twice over the same window → identical state after both runs", async () => {
      const payout = await createPayout(repo, {
        orderRef: "ORD-400",
        amount: 80000,
        key: "SUP-KEY-400",
        effectiveDate: new Date("2025-01-15"),
      });

      // Send is transient
      bank.configureSend(payout.txid, SendOutcome.TRANSIENT);
      await service.executePayments();

      const now = new Date();
      const window = { start: new Date(now.getTime() - 3600_000), end: now };

      // First reconcile — statement contains txid → settles
      bank.configureStatement([{ txid: payout.txid, amount: 80000, date: "2025-01-15" }]);
      await service.reconcile(window);

      let current = repo.getPayout(payout.id)!;
      expect(current.status).toBe(PayoutStatus.SETTLED);

      const callCountAfterFirst = bank.sendCalls.length;

      // Second reconcile — same window
      await service.reconcile(window);
      current = repo.getPayout(payout.id)!;
      expect(current.status).toBe(PayoutStatus.SETTLED);
      // No additional bank.send calls (no resend)
      expect(bank.sendCalls.length).toBe(callCountAfterFirst);
      // No additional updateStatus calls beyond the first settle
      const updateCalls = repo.calls.filter((c) => c.id === payout.id);
      expect(updateCalls.length).toBe(1);
    });
  });

  // ── Derived txid ────────────────────────────────────────────────────

  it("derives deterministic txid from orderRef + effectiveDate", async () => {
    const payout1 = await createPayout(repo, {
      orderRef: "ORD-500",
      amount: 90000,
      key: "SUP-KEY-500",
      effectiveDate: new Date("2025-03-01"),
    });
    const payout2 = await createPayout(repo, {
      orderRef: "ORD-500",
      amount: 90000,
      key: "SUP-KEY-500",
      effectiveDate: new Date("2025-03-01"),
    });

    expect(payout1.txid).toBe(payout2.txid);

    // Different effectiveDate → different txid
    const payout3 = await createPayout(repo, {
      orderRef: "ORD-500",
      amount: 90000,
      key: "SUP-KEY-500",
      effectiveDate: new Date("2025-03-02"),
    });
    expect(payout1.txid).not.toBe(payout3.txid);
  });
});
