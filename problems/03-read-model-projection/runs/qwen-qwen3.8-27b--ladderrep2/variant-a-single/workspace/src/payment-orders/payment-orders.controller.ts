import { Body, Controller, Param, Post, BadRequestException } from '@nestjs/common';
import { parseRequiredPositiveInt } from '../common/validation';
import { PaymentOrdersService } from './payment-orders.service';

@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(private readonly orders: PaymentOrdersService) {}

  @Post()
  create(@Body() body: { companyId?: unknown; workerId?: unknown; amountCents?: unknown }) {
    const payload = body ?? {};
    const companyId = payload.companyId;
    const workerId = payload.workerId;
    if (typeof companyId !== 'string' || companyId.length === 0) {
      throw new BadRequestException('companyId must be a non-empty string');
    }
    if (typeof workerId !== 'string' || workerId.length === 0) {
      throw new BadRequestException('workerId must be a non-empty string');
    }
    return this.orders.create({
      companyId,
      workerId,
      amountCents: parseRequiredPositiveInt(payload.amountCents, 'amountCents'),
    });
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    return this.orders.approve(id);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string) {
    return this.orders.reject(id);
  }

  @Post(':id/refund')
  refund(@Param('id') id: string) {
    return this.orders.refund(id);
  }
}
