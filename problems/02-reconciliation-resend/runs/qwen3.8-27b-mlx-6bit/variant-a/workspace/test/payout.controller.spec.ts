import { describe, expect, it, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { PayoutController } from "../src/payout/payout.controller";
import type { PayoutResult, ReconcileResult } from "../src/payout/payout.types";
import { BankClientError, InsufficientAttemptsError } from "../src/payout/payout.types";

// ASSUMPTION: the plan asks for "200 responses" but this spec depends only on the
// controller and its types (per the manifest), so success is asserted as a resolved
// payload — the value Nest serializes as the 200 body — rather than a live HTTP round-trip.

function emptyService() {
  return { executePayments: vi.fn(), reconcile: vi.fn() };
}

function makeController(service: ReturnType<typeof emptyService>): PayoutController {
  return new PayoutController(service as never);
}

async function expectEnvelope(
  promise: Promise<unknown>,
  status: number,
  code: string,
  message?: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(HttpException);
  const ex = caught as HttpException;
  expect(ex.getStatus()).toBe(status);
  // The envelope is the contract: snake_case code, developer-facing message, details object (never null).
  expect(ex.getResponse()).toEqual({
    error: { code, message: message ?? expect.any(String), details: {} },
  });
}

describe("PayoutController", () => {
  describe("POST /execute-payments", () => {
    it("resolves with the payout results as the 200 body", async () => {
      const results: PayoutResult[] = [
        { order_id: "ord_1", txid: "a1b2c3d4e5f60718293a4b5c6d7e8f90", classification: "accepted" },
        { order_id: "ord_2", txid: "0f1e2d3c4b5a6978876543210fedcba9", classification: "duplicate" },
      ];
      const service = emptyService();
      service.executePayments.mockResolvedValue(results);
      const controller = makeController(service);

      await expect(controller.executePayments()).resolves.toEqual(results);
    });

    it("resolves with an empty array when there is nothing to send", async () => {
      const service = emptyService();
      service.executePayments.mockResolvedValue([]);
      const controller = makeController(service);

      await expect(controller.executePayments()).resolves.toEqual([]);
    });

    it("maps InsufficientAttemptsError to a 500 envelope with code insufficient_attempts", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue(new InsufficientAttemptsError("ord_9"));
      const controller = makeController(service);

      await expectEnvelope(
        controller.executePayments(),
        500,
        "insufficient_attempts",
        "Order ord_9 has exhausted attempts",
      );
    });

    it("maps BankClientError to a 502 envelope with code bank_client_error", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue(new BankClientError("bank unreachable"));
      const controller = makeController(service);

      await expectEnvelope(controller.executePayments(), 502, "bank_client_error", "bank unreachable");
    });

    it("maps an unexpected Error to a 500 envelope with code internal_error", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue(new Error("boom"));
      const controller = makeController(service);

      await expectEnvelope(controller.executePayments(), 500, "internal_error", "boom");
    });

    it("maps a non-Error rejection to a 500 envelope with code internal_error", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue("kaboom");
      const controller = makeController(service);

      await expectEnvelope(controller.executePayments(), 500, "internal_error", "Unexpected error");
    });
  });

  describe("POST /reconcile", () => {
    it("parses the ISO window into Dates and resolves with the reconcile result as the 200 body", async () => {
      const from = new Date("2025-01-01T00:00:00.000Z");
      const to = new Date("2025-01-02T00:00:00.000Z");
      const result: ReconcileResult = { window: { from, to }, matched_count: 3 };
      const service = emptyService();
      service.reconcile.mockResolvedValue(result);
      const controller = makeController(service);

      await expect(
        controller.reconcile({ from: "2025-01-01T00:00:00.000Z", to: "2025-01-02T00:00:00.000Z" }),
      ).resolves.toEqual(result);
      expect(service.reconcile).toHaveBeenCalledWith({ from, to });
    });

    it("rejects a window with missing fields with a 400 invalid_window envelope", async () => {
      const service = emptyService();
      const controller = makeController(service);

      await expectEnvelope(
        controller.reconcile({} as { from: string; to: string }),
        400,
        "invalid_window",
        "Body must be `{ from: ISO date string, to: ISO date string }`.",
      );
    });

    it("rejects a window with an invalid ISO date with a 400 invalid_window envelope", async () => {
      const service = emptyService();
      const controller = makeController(service);

      await expectEnvelope(
        controller.reconcile({ from: "not-a-date", to: "2025-01-02T00:00:00.000Z" }),
        400,
        "invalid_window",
        "`from` and `to` must be valid ISO 8601 date strings.",
      );
    });
  });
});
