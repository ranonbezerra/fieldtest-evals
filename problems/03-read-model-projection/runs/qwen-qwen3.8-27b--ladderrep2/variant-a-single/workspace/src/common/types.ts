export const STATUSES = ['pending', 'approved', 'rejected', 'refunded'] as const;
export type Status = (typeof STATUSES)[number];

export interface OperationRowData {
  orderId: number;
  companyId: number;
  workerId: number;
  workerName: string | null;
  status: Status;
  amountCents: number;
  lastEventKind: string | null;
  createdAt: Date;
}

export interface CompanyTotalsData {
  companyId: number;
  pendingCount: number;
  pendingAmountCents: number;
  approvedCount: number;
  approvedAmountCents: number;
  rejectedCount: number;
  rejectedAmountCents: number;
  refundedCount: number;
  refundedAmountCents: number;
  version: number;
}

export interface TotalsDeltaEntry {
  count: number;
  amountCents: number;
}

export type TotalsDelta = Record<Status, TotalsDeltaEntry>;

export function zeroTotals(companyId: number): CompanyTotalsData {
  return {
    companyId,
    pendingCount: 0,
    pendingAmountCents: 0,
    approvedCount: 0,
    approvedAmountCents: 0,
    rejectedCount: 0,
    rejectedAmountCents: 0,
    refundedCount: 0,
    refundedAmountCents: 0,
    version: 0,
  };
}

export function emptyTotalsDelta(): TotalsDelta {
  return {
    pending: { count: 0, amountCents: 0 },
    approved: { count: 0, amountCents: 0 },
    rejected: { count: 0, amountCents: 0 },
    refunded: { count: 0, amountCents: 0 },
  };
}
