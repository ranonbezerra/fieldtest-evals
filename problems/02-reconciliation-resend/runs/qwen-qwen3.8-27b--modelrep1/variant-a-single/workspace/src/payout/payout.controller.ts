import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import type { ExecuteSummary, ReconcileSummary } from './payout.service.js';
import { PayoutService } from './payout.service.js';

const MAX_RECONCILE_SPAN_MS = 90 * 24 * 3_600_000;

/**
 * Operator surface for the payout job. Endpoints validate input only and
 * delegate — all logic lives in PayoutService.
 */
@Controller()
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post('payouts/execute')
  execute(): Promise<ExecuteSummary> {
    return this.service.executePayments();
  }

  @Post('reconciliations')
  reconcile(@Body() body: { from?: unknown; to?: unknown }): Promise<ReconcileSummary> {
    const from = parseIsoDate('from', body?.from);
    const to = parseIsoDate('to', body?.to);
    const spanMs = to.getTime() - from.getTime();
    if (spanMs <= 0) throw new BadRequestException('to must be strictly after from');
    if (spanMs > MAX_RECONCILE_SPAN_MS) {
      throw new BadRequestException(`window must not exceed ${Math.round(MAX_RECONCILE_SPAN_MS / 3_600_000)}h`);
    }
    return this.service.reconcile({ from, to });
  }
}

function parseIsoDate(field: string, raw: unknown): Date {
  if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
    throw new BadRequestException(`${field} must be an ISO-8601 date`);
  }
  return new Date(raw);
}
