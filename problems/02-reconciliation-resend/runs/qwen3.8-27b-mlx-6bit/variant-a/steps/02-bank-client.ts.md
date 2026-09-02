# 02-bank-client.ts

## reasoning

```
The task is to write exactly one file: `src/payouts/bank-client.ts`. This file should contain the BankClient interface, BankSendRequest/Result, and BankSettlement types as specified in the plan.

From the plan (Section 3), the exact types and signatures are:

```ts
// ---- src/payouts/bank-client.ts ----

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
```

That's it. The plan is very explicit about what goes in this file. I should write it exactly as specified, with no extra exports, no extra features, no DI decorators (the plan doesn't mention any for this file), just the types and interface.

Let me write it cleanly with proper TypeScript formatting.
```

## reply

```ts
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
```
