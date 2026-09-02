export interface BankSendRequest {
  txid: string;
  amountCents: number;
  bankKey: string;
}

export type BankSendResult =
  | { kind: 'accepted' }
  | { kind: 'duplicate'; originalAcceptedAt: Date }
  | { kind: 'transient'; reason: string }
  | { kind: 'permanent_rejection'; code: string; reason: string };

export interface BankSettlement {
  txid: string;
  amountCents: number;
  settledAt: Date;
}

export interface BankClient {
  send(req: BankSendRequest): Promise<BankSendResult>;
  getStatement(date: string /* YYYY-MM-DD */): Promise<BankSettlement[]>;
}
