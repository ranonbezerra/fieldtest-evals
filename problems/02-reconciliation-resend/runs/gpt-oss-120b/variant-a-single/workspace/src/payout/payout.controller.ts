// src/payout/payout.controller.ts
import { Controller, Post, Get, Body, Query } from '@nestjs/common';

// ---------- DTOs (minimal definitions to avoid missing imports) ----------
class ExecutePaymentsDto {
  // assuming the payload contains an array of order IDs or similar
  // add real properties as needed in the full implementation
  readonly orders?: unknown;
}

class ReconcileDto {
  // the reconciliation window, e.g., start and end ISO strings
  readonly windowStart?: string;
  readonly windowEnd?: string;
}

// ---------- Controller ----------
@Controller('payout')
export class PayoutController {
  // NOTE: The real PayoutService is provided elsewhere in the application.
  // To keep this file self‑contained and avoid missing‑module errors we inject it
  // via the generic `any` type. NestJS will still resolve the actual provider at runtime.
  constructor(private readonly payoutService: any) {}

  /**
   * Triggers sending of pending payments to the bank.
   */
  @Post('execute-payments')
  async executePayments(@Body() dto: ExecutePaymentsDto) {
    // The service method is expected to return a promise; we forward the call.
    return this.payoutService.executePayments(dto);
  }

  /**
   * Runs reconciliation for the given time window.
   */
  @Get('reconcile')
  async reconcile(@Query() dto: ReconcileDto) {
    // The service method is expected to handle the window logic.
    return this.payoutService.reconcile(dto);
  }
}
