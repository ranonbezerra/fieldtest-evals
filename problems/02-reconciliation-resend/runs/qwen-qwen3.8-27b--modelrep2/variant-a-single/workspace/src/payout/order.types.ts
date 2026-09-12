export type OrderState = 'PENDING' | 'SENT' | 'SETTLED' | 'FAILED' | 'MANUAL_REVIEW';

/** Domain view of a payable order. Money is integer minor units (cents). */
export interface Order {
  id: string;
  supplierKey: string;
  amountMinor: bigint;
  effectiveDate: string; // 'YYYY-MM-DD'
  state: OrderState;
  attempts: number;
  txid: string | null;
  sentAt: Date | null;
  absentConfirmedAt: Date | null;
  lastError: string | null;
}

export type ClaimResult = { ok: true; order: Order } | { ok: false; reason: 'already_claimed' };

export type SendResultKind = 'success' | 'permanent' | 'transient';

export interface SendResult {
  kind: SendResultKind;
  note?: string;
}

export interface ReconcileWindow {
  from: string; // 'YYYY-MM-DD', inclusive
  to: string; // 'YYYY-MM-DD', inclusive
}

export interface ReconcileResult {
  scannedDays: number;
  entries: number;
  settled: number;
  absentConfirmed: number;
  parked: number;
  mismatches: number;
}

export interface ExecuteResult {
  executed: number;
  skipped: number;
}
