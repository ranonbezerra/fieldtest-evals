export type OrderStatus = 'pending' | 'approved' | 'rejected';

export interface CreateOrderInput {
  companyId: string;
  workerId: string;
  eventId: string;
  amountCents: number;
}

export interface OperationRow {
  id: string;
  companyId: string;
  workerId: string;
  workerName: string;
  eventId: string;
  eventTitle: string;
  eventLocation: string;
  status: OrderStatus;
  amountCents: number;
  createdAt: Date;
}

export interface OperationQueryParams {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export interface OperationPage {
  items: OperationRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CompanyTotals {
  companyId: string;
  approvedTotalCents: bigint;
  rejectedTotalCents: bigint;
  pendingCount: number;
}

export interface DriftReport {
  windowStart: Date;
  windowEnd: Date;
  rowsCorrected: number;
  totalsCorrected: boolean;
}
