export enum SendOutcome {
  ACCEPTED = 'accepted',
  DUPLICATE = 'duplicate',
  TRANSIENT_ERROR = 'transient_error',
  PERMANENT_REJECTION = 'permanent_rejection',
}

export interface BankSendRequest {
  txid: string;
  amount: number;
  key: string;
}

export interface BankSendResponse {
  outcome: SendOutcome;
  code?: string;
  message?: string;
}

export interface BankSettlement {
  txid: string;
  amount: number;
  date: string;
}

export interface BankGateway {
  send(request: BankSendRequest): Promise<BankSendResponse>;
  getStatement(date: string): Promise<BankSettlement[]>;
}
