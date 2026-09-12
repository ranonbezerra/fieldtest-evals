import { mapProviderStatus, type OrderStatus } from './orders.status.js';

export interface OrderView {
  id: string;
  reference: string;
  status: OrderStatus;
  amountMinor: number;
}

export interface OrderRecord {
  id: string;
  reference: string;
  providerStatus: string;
  amountMinor: number;
}

export class OrdersService {
  toView(record: OrderRecord): OrderView {
    return {
      id: record.id,
      reference: record.reference,
      status: mapProviderStatus(record.providerStatus),
      amountMinor: record.amountMinor,
    };
  }
}
