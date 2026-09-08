import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { ReconcileResult, ReconcileWindow } from './payout.types';

interface ReconcileRequest {
  from: string;
  to: string;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post('execute')
  async execute(): Promise<{ processed: number }> {
    const processed = await this.payoutService.executePayments();
    return { processed };
  }

  @Post('reconcile')
  async reconcile(@Body() body: ReconcileRequest): Promise<ReconcileResult> {
    if (!body.from || !body.to) {
      throw new BadRequestException({
        error: {
          code: 'invalid_input',
          message: 'Query parameters "from" and "to" are required.',
          details: {},
        },
      });
    }

    const from = new Date(body.from);
    const to = new Date(body.to);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException({
        error: {
          code: 'invalid_input',
          message: 'Expected ISO 8601 date strings for "from" and "to".',
          details: { from: body.from, to: body.to },
        },
      });
    }

    const window: ReconcileWindow = { from, to };
    return this.payoutService.reconcile(window);
  }
}
