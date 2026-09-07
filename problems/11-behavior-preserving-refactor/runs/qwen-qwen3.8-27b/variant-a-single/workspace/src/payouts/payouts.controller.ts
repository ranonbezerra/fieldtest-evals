import { Controller, Get } from '@nestjs/common';
import { PayoutView, PayoutsService } from './payouts.service.js';

@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Get()
  listPayouts(): Promise<PayoutView[]> {
    return this.payoutsService.listPayouts();
  }
}
