import { Controller, Post, Body, Get, Param, HttpException, HttpStatus } from '@nestjs/common';
import { PayoutService } from './payout.service';
import { CreatePayoutInput, ReconcileWindow } from './payout.types';
import { PayoutRecord } from './payout.types';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @Post
  async create(@Body() input: CreatePayoutInput): Promise<PayoutRecord> {
    try {
      return await this.payoutService.createPayout(input);
    } catch (error: any) {
      if (error.message.startsWith('Order')) {
        throw new HttpException(
          { error: { code: 'resource_not_found', message: error.message, details: {} } },
          HttpStatus.NOT_FOUND,
        );
      }
      throw error;
    }
  }

  @Post('execute')
  async executePayments(): Promise<any> {
    return this.payoutService.executePayments();
  }

  @Post('reconcile')
  async reconcile(@Body() window: ReconcileWindow): Promise<any> {
    return this.payoutService.reconcile(window);
  }

  @Get(':id')
  async getById(@Param('id') id: string): Promise<PayoutRecord | { error: { code: string; message: string; details: object } }> {
    const payout = await this.payoutService.getPayout(id);
    if (!payout) {
      return {
        error: {
          code: 'resource_not_found',
          message: `Payout with id ${id} not found`,
          details: {},
        },
      };
    }
    return payout;
  }
}
