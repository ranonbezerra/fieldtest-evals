import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { DomainException } from '../common/domain-exception.js';
import { asString, isUuid, parseAmountCents, parseUuid, type Problems } from '../common/params.js';
import { PaymentOrderService } from './payment-orders.service.js';

@Controller('payment-orders')
export class PaymentOrdersController {
  constructor(@Inject(PaymentOrderService) private readonly paymentOrderService: PaymentOrderService) {}

  /** Simulated write path: create a payment order (initially pending). */
  @Post()
  create(@Body() body: Record<string, unknown>) {
    const payload = body ?? {};
    const problems: Problems = {};
    const companyId = parseUuid(asString(payload.company_id), 'company_id', problems);
    const workerId = parseUuid(asString(payload.worker_id), 'worker_id', problems);
    const eventId = parseUuid(asString(payload.event_id), 'event_id', problems);
    const amountCents = parseAmountCents(payload.amount_cents, problems);

    if (!companyId || !workerId || !eventId || amountCents === undefined || Object.keys(problems).length > 0) {
      throw new DomainException(400, 'validation_failed', 'invalid payment order payload', problems);
    }

    return this.paymentOrderService.create({ companyId, workerId, eventId, amountCents });
  }

  @Post(':id/approve')
  approve(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw new DomainException(400, 'validation_failed', 'id must be a UUID', { id });
    }
    return this.paymentOrderService.approve(id);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string) {
    if (!isUuid(id)) {
      throw new DomainException(400, 'validation_failed', 'id must be a UUID', { id });
    }
    return this.paymentOrderService.reject(id);
  }
}
