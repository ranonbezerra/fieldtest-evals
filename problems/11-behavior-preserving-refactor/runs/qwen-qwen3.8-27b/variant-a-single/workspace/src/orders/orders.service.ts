import { Injectable } from '@nestjs/common';
import type { Order } from '@prisma/client';
import { InternalPaymentStatus, PaymentStatusMapper } from '../shared/payment-status-mapper.js';
import { OrdersRepository } from './orders.repository.js';

export interface OrderView {
  id: string;
  customerEmail: string;
  amountCents: number;
  paymentStatus: InternalPaymentStatus;
}

@Injectable()
export class OrdersService {
  // The original orders copy THREW on unknown provider codes. That divergence
  // is preserved on purpose (see NOTES.md) -- do not change it.
  private readonly statusMapper = new PaymentStatusMapper({ onUnknown: 'throw' });

  constructor(private readonly ordersRepository: OrdersRepository) {}

  listOrders(): Promise<OrderView[]> {
    return this.ordersRepository.findAll().then((rows) => rows.map((row) => this.toView(row)));
  }

  /**
   * Map a raw provider status to the internal status used for display.
   * Throws (envelope code "unrecognized_provider_status") on unknown codes.
   */
  displayStatusFor(providerStatus: string): InternalPaymentStatus {
    // With onUnknown: "throw", map() either returns a mapped status or throws,
    // so a plain InternalPaymentStatus is guaranteed here.
    return this.statusMapper.map(providerStatus) as InternalPaymentStatus;
  }

  private toView(row: Order): OrderView {
    return {
      id: row.id,
      customerEmail: row.customerEmail,
      amountCents: row.amountCents,
      paymentStatus: this.displayStatusFor(row.providerStatus),
    };
  }
}
