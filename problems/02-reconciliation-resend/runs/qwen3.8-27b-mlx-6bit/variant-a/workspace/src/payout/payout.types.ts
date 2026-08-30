import type { SendClassification } from "./bank-client";

export type OrderState =
  | "pending"
  | "sent"
  | "settled"
  | "manual_review"
  | "rejected";

export interface ReconcileWindow {
  from: Date;
  to: Date;
}

export interface PayoutResult {
  order_id: string;
  txid: string;
  classification: SendClassification;
}

export interface ReconcileResult {
  window: ReconcileWindow;
  matched_count: number;
}

export class InsufficientAttemptsError extends Error {
  readonly code = "insufficient_attempts";
  constructor(orderId: string) { super(`Order ${orderId} has exhausted attempts`); }
}

export class BankClientError extends Error {
  readonly code = "bank_client_error";
  constructor(message: string) { super(message); }
}
