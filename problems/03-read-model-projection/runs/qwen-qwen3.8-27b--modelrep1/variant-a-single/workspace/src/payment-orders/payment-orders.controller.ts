import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { asRecord, requirePositiveInt, requireStatus, requireUuid } from '../common/validation.js';
import { PaymentOrdersService } from './payment-orders.service.js';

@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(private readonly service: PaymentOrdersService) {}

  @Post()
  create(@Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.create({
      companyId: requireUuid(payload.company_id, 'company_id'),
      workerId: requireUuid(payload.worker_id, 'worker_id'),
      amountCents: requirePositiveInt(payload.amount_cents, 'amount_cents', 100_000_000),
    });
  }

  @Patch(':id')
  setStatus(@Param('id') id: string, @Body() body: unknown) {
    const payload = asRecord(body, 'request body');
    return this.service.setStatus(requireUuid(id, 'id'), requireStatus(payload.status, 'status'));
  }
}
