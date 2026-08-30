export type SendClassification =
  | "accepted"
  | "duplicate"
  | "transient_error"
  | "permanent_rejection";

export interface BankSendResponse {
  classification: SendClassification;
  txid: string;
  message?: string;
}

export interface Settlement {
  txid: string;
  amount_cents: number;
  settled_at: Date;
}

export interface BankClient {
  send(req: { txid: string; amount_cents: number; key: string }): Promise<BankSendResponse>;
  getStatement(date: string): Promise<Settlement[]>;
}
