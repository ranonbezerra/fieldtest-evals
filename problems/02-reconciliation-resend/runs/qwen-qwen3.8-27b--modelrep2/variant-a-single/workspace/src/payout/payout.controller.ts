import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PayoutService } from './payout.service.js';
import { ReconcileWindowDto } from './reconcile-window.dto.js';
import { todayUtcDate } from './date-window.js';
import type { ExecuteResult, ReconcileResult } from './order.types.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  /**
   * Kick a payout round. Body may carry a clock override for tests:
   * `{ "now": 1717315200000 }` (milliseconds).
   */
  @Post('execute')
  execute(@Body() body: { now?: number }): Promise<ExecuteResult> {
    return this.service.executePayments();
  }

  /**
   * Reconcile a statement window [from, to] (UTC calendar days, inclusive).
   * Defaults to today; overlapping windows are safe.
   */
  @Get('reconcile')
  reconcile(@Query() query: ReconcileWindowDto): Promise<ReconcileResult> {
    const now = Date.now();
    const from = query.from ?? todayUtcDate(now);
    const to = query.to ?? todayUtcDate(now);
    if (from > to) {
      throw new Error('reconcile window start must not be after end');
    }
    return this.service.reconcile({ from, to });
  }
}
