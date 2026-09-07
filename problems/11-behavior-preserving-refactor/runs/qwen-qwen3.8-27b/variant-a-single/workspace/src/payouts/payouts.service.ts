import { Injectable } from '@nestjs/common';
import type { Payout } from '@prisma/client';
import { InternalPaymentStatus, PaymentStatusMapper } from '../shared/payment-status-mapper.js';
import { PayoutsRepository } from './payouts.repository.js';

export interface PayoutView {
  id: string;
  merchantId: string;
  amountCents: number;
  paymentStatus: InternalPaymentStatus;
}

@Injectable()
export class PayoutsService {
  // The original payouts copy RETURNED THE "unknown" SENTINEL on unknown
  // provider codes. That divergence is preserved on purpose (see NOTES.md)
  // -- do not change it.
  private readonly statusMapper = new PaymentStatusMapper({ onUnknown: 'unknown' });

  constructor(private readonly payoutsRepository: PayoutsRepository) {}

  listPayouts(): Promise<PayoutView[]> {
    return this.payoutsRepository.findAll().then((rows) => rows.map((row) => this.toView(row)));
  }

  /** Map a raw provider status. Returns "unknown" for unrecognized codes. */
  paymentStatusFor(providerStatus: string): InternalPaymentStatus {
    // With onUnknown: "unknown", map() never returns null; legacy "VOIDED"
    // is unreachable here (no legacyReportCasing), so the cast is safe.
    return this.statusMapper.map(providerStatus) as InternalPaymentStatus;
  }

  private toView(row: Payout): PayoutView {
    return {
      id: row.id,
      merchantId: row.merchantId,
      amountCents: row.amountCents,
      paymentStatus: this.paymentStatusFor(row.providerStatus),
    };
  }
}
