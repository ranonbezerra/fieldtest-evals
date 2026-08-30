# 04-payout.types.ts

## reasoning

```
The user is asking me to write exactly one file: `src/payout/payout.types.ts`. According to PLAN.md, this file should contain the following:
- OrderState
- ReconcileWindow
- PayoutResult
- ReconcileResult
- Error classes (InsufficientAttemptsError, BankClientError)

From section 3 of the plan:

```ts
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
```

The plan states that `payout.types.ts` reads `src/payout/bank-client.ts` — this is because `PayoutResult` uses `SendClassification` from bank-client.ts. So I need to import `SendClassification` from `./bank-client`.

The reference file bank-client.ts is at `src/payout/bank-client.ts` and exports `SendClassification`. So the import is:

```ts
import type { SendClassification } from "./bank-client";
```

Since it's ESM with `"type": "module"`, relative imports should work. In NestJS/TypeScript, depending on the configuration (moduleResolution), you might need file extensions. But in a typical NestJS project, imports without extensions are standard. The plan doesn't specify the import style. I'll use `./bank-client` without an extension. This is standard in NestJS projects. Actually, wait — the convention says ESM with `"type": "module"`. In strict ESM Node, relative imports require the `.js` extension. But NestJS projects typically use tsconfig with `moduleResolution: "node"`, or they use the bundler, so imports without extensions work. The plan's manifest says `payout.types.ts | reads: src/payout/bank-client.ts`. No specific import path is shown.

Hmm, which is more defensible? The plan's code blocks don't show imports at all. For a NestJS project (which typically uses ts-jest or ts-node with CommonJS-compatible module resolution, or a bundler), `import type { SendClassification } from "./bank-client";` is the most common style. I'll go with this without an extension, since NestJS + Prisma projects almost universally use that style.

Now, about the error classes: should I follow the plan exactly? The plan says:

```ts
export class InsufficientAttemptsError extends Error {
  readonly code = "insufficient_attempts";
  constructor(orderId: string) { super(`Order ${orderId} has exhausted attempts`); }
}

export class BankClientError extends Error {
  readonly code = "bank_client_error";
  constructor(message: string) { super(message); }
}
```

I should implement this exactly. One consideration: in TypeScript strict mode, when extending Error, you might need `Object.setPrototypeOf(this, new.target.prototype)` to fix the prototype chain for ES5 targets. But the plan doesn't mention this. The instructions say "implement exactly what the plan specifies for this file. Don't add exports, features, or files that the plan doesn't name." Adding a setPrototypeOf line is a minor robustness fix, but it's not in the plan. Hmm. "Complete" — write from first line to last line. The plan's code is the spec. I think I should follow the plan's code faithfully. Adding setPrototypeOf would be an improvement not requested by the plan. The discipline section says "do exactly what the task asks... don't improve code that wasn't asked to be changed." I'll keep it as per the plan.

Also, should the error classes have `name`? The plan doesn't specify. I'll keep it exactly as in the plan.

Let me double-check the details of ReconcileResult: `{ window: ReconcileWindow; matched_count: number }`. Yes.

PayoutResult: `{ order_id: string; txid: string; classification: SendClassification }`. Yes.

OrderState: "pending" | "sent" | "settled" | "manual_review" | "rejected". Yes.

ReconcileWindow: `{ from: Date; to: Date }`. Yes.

Do I need an ASSUMPTION comment? All symbols are present in the plan or references. `SendClassification` comes from bank-client.ts (reference). No missing symbols. So no ASSUMPTION comment needed.

The reply must be the complete content inside one fenced block, with nothing else.

Let me write it:

```ts
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
  constructor(orderId: string) {
    super(`Order ${orderId} has exhausted attempts`);
  }
}

export class BankClientError extends Error {
  readonly code = "bank_client_error";
  constructor(message: string) {
    super(message);
  }
}
```

Formatting: the plan shows single-line constructors. Should I keep them single-line to match the plan exactly? The plan's code block is:

```ts
export class InsufficientAttemptsError extends Error {
  readonly code = "insufficient_attempts";
  constructor(orderId: string) { super(`Order ${orderId} has exhausted attempts`); }
}
```

I'll keep it close to the plan. Either style is fine, but matching the plan reduces deviation. I'll keep the single-line constructor as in the plan.

One more consideration: `import type` vs regular import. `SendClassification` is a type only, so `import type` is cleaner and works with `isolatedModules`. Good.

Should I add a JSDoc comment? The plan doesn't have any. "Don't add what the plan doesn't name" — comments aren't exports/features, but minimal is safest. I'll keep it clean without extra comments.

Final answer: one fenced block with the file content, nothing else.
```

## reply

```ts
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
```
