import { Body, Controller, Post } from '@nestjs/common';
import { HttpError } from '../common/http-error.js';
import { PayoutService } from './payout.service.js';

interface ReconcileBody {
  from?: string;
  to?: string;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post('executions')
  execute() {
    return this.service.executePayments();
  }

  @Post('reconciliations')
  reconcile(@Body() body: ReconcileBody | undefined) {
    const now = new Date();
    const from = body?.from
      ? parseDate(body.from, 'from')
      : new Date(now.getTime() - 30 * 60 * 1000);
    const to = body?.to ? parseDate(body.to, 'to') : now;

    if (from.getTime() > to.getTime()) {
      throw new HttpError(400, 'invalid_window', 'from must not be after to', {
        from: body?.from,
        to: body?.to,
      });
    }

    return this.service.reconcile({ from, to });
  }
}

function parseDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'invalid_window', `${field} must be an ISO-8601 date`, {
      field,
      value,
    });
  }
  return parsed;
}
