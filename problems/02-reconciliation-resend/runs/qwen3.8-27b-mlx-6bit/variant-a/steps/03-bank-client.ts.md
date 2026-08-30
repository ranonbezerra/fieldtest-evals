# 03-bank-client.ts

## reasoning

```
We need answer user's request: write exactly one file src/payout/bank-client.ts based on PLAN.md. Need final only fenced code block, no explanation. Need ensure complete file exactly plan specifies: BankClient interface, SendClassification, BankSendResponse, Settlement. Need consider TypeScript strict, ESM. No imports needed. Need likely export types and interface.

Need inspect PLAN section 3: 
### `src/payout/bank-client.ts`

```ts
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
```

Need produce exactly that? The task says implement exactly what plan specifies for this file. Do not add export, feature or file plan does not name. So output that code. Could include maybe `export type BankSendRequest`? Plan doesn't name, so no. Need maybe inline request type. Use `amount_cents` number integer? Plan says number. Could enforce integer? TypeScript cannot. Plan only number. No extra comments? Fine.

Need final one fenced block. Ensure no extra text. Could include `export` all. Should we include semicolons? Yes.

Potential issue: PLAN says BankClient interface, SendClassification, BankSendResponse, Settlement. It doesn't mention `BankSendRequest`. Use inline object type as plan. Need not add JSDoc? Could be okay but no need.

Need satisfy "first line to last". final:
```ts
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
```

Need think if `BankSendResponse` classification is redundant? Bank.send returns response with classification. The service classifyResponse maybe takes BankSendResponse and returns classification. It's in plan. Good.

No import Date? global.

Double-check no need `export default`. No.

Now final only fenced.
```

## reply

```ts
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
```
