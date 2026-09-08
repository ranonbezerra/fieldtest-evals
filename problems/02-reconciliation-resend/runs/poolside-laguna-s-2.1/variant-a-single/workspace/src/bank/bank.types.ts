export const BANK_CLIENT = Symbol('BANK_CLIENT');

export type BankSendStatus =
  | 'accepted'
  | 'duplicate'
  | 'transient_error'
  | 'permanent_rejection';

export interface BankSendResult {
  status: BankSendStatus;
  txid?: string;
  error?: string;
}

export interface Settlement {
  txid: string;
  amount: number;
  status: string;
}

export interface BankClient {
  send(params: { txid: string; amount: number; key: string }): Promise<BankSendResult>;
  getStatement(date: Date): Promise<Settlement[]>;
}
