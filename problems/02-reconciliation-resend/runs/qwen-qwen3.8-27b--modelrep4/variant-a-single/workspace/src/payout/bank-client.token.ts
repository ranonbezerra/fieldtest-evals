export const BANK_CLIENT = 'BANK_CLIENT';

export interface BankSendInput {
  txid: string;
  amount: number;
  key: string;
}

export type BankSendResult =
  | { kind: 'accepted'; txid: string }
  | { kind: 'duplicate'; txid: string }
  | { kind: 'transient'; message: string }
  | { kind: 'permanent'; message: string };

export interface BankSettlement {
  txid: string;
  amount: number;
  settledAt?: string;
  bankReference?: string;
}

export interface BankClient {
  send(input: BankSendInput): Promise<BankSendResult>;
  getStatement(date: string): Promise<BankSettlement[]>;
}
