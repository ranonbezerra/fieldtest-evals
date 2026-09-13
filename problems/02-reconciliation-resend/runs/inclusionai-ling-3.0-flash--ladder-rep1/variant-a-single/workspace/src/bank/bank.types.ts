export interface BankSendRequest {
  txid: string;
  amount: number;
  key: string;
}

export interface BankSendResult {
  outcome:
    | "accepted"
    | "duplicate"
    | "transient"
    | "permanent";
}

export interface Settlement {
  txid: string;
  amount: number;
  date: string;
  reference?: string;
}
