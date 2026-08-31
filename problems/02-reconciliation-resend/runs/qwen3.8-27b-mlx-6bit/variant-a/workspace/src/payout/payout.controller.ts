import { Body, Controller, HttpException, Post } from "@nestjs/common";
import { PayoutService } from "./payout.service";
import type { PayoutResult, ReconcileResult, ReconcileWindow } from "./payout.types";
import { BankClientError, InsufficientAttemptsError } from "./payout.types";

@Controller()
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post("execute-payments")
  async executePayments(): Promise<PayoutResult[]> {
    try {
      return await this.service.executePayments();
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  @Post("reconcile")
  async reconcile(@Body() body: { from: string; to: string }): Promise<ReconcileResult> {
    const window = this.parseWindow(body);
    try {
      return await this.service.reconcile(window);
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  private parseWindow(body: { from: string; to: string }): ReconcileWindow {
    const fromRaw = body?.from;
    const toRaw = body?.to;
    if (typeof fromRaw !== "string" || typeof toRaw !== "string") {
      // ASSUMPTION: the plan defines no error code for a malformed window; using 400 with "invalid_window".
      this.fail(400, "invalid_window", "Body must be `{ from: ISO date string, to: ISO date string }`.");
    }
    const from = new Date(fromRaw);
    const to = new Date(toRaw);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      this.fail(400, "invalid_window", "`from` and `to` must be valid ISO 8601 date strings.");
    }
    return { from, to };
  }

  private toHttpException(err: unknown): HttpException {
    // ASSUMPTION: the plan specifies these codes but not their HTTP statuses; using 500 for the
    // internal invariant violation and 502 for the upstream bank failure.
    if (err instanceof InsufficientAttemptsError) {
      return this.build(500, "insufficient_attempts", err.message);
    }
    if (err instanceof BankClientError) {
      return this.build(502, "bank_client_error", err.message);
    }
    const message = err instanceof Error ? err.message : "Unexpected error";
    return this.build(500, "internal_error", message);
  }

  private build(status: number, code: string, message: string): HttpException {
    return new HttpException({ error: { code, message, details: {} } }, status);
  }

  private fail(status: number, code: string, message: string): never {
    throw this.build(status, code, message);
  }
}
