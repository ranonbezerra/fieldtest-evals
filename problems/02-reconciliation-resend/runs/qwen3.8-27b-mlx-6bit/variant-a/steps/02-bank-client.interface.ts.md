# 02-bank-client.interface.ts

## reasoning

```
The user is asking to write exactly one file: `src/payment/bank-client.interface.ts`. This file contains the BankClient interface, BankSendRequest/Response, and Settlement types, following the plan in PLAN.md.

Let's look at Section 3 of the plan, "Types and signatures":

```typescript
// ─── Bank client (injected dependency) ───────────────────────────────

interface BankSendRequest {
  txid: string;
  amount_minor_units: number;
  key: string;
}

type BankSendStatus = 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';

interface BankSendResponse {
  status: BankSendStatus;
  message?: string;
}

interface Settlement {
  txid: string;
  amount_minor_units: number;
  settled_at: Date;
}

interface BankClient {
  send(req: BankSendRequest): Promise<BankSendResponse>;
  getStatement(date: Date): Promise<Settlement[]>;
}
```

Also, the plan lists error classes:

```typescript
class BankTransientError extends Error {
  constructor(public readonly code: string, message: string);
}
// Raised by BankClient.send() on transient failures (network, 5xx).

class BankPermanentError extends Error {
  constructor(public readonly code: string, message: string);
}
// Raised by BankClient.send() on permanent rejection (4xx).
```

The question is: should the error classes be included in this file? According to the manifest, this file contains "BankClient interface, BankSendRequest/Response, Settlement types". The errors section is in the plan under "Types and signatures" but labeled as "─── Errors ───". The manifest for this file only says "BankClient interface, BankSendRequest/Response, Settlement types".

Hmm. The instructions say: "Implement exactly what the plan specifies for this file. Do not add exports, functionality, or files not named in the plan."

The manifest entry says: `src/payment/bank-client.interface.ts | reads: - | BankClient interface, BankSendRequest/Response, Settlement types`

So the manifest defines this file as containing exactly: BankClient interface, BankSendRequest/Response, Settlement types. The error classes (BankTransientError, BankPermanentError) are not named in this file's manifest. They might belong elsewhere... but the plan doesn't specify a separate file for them. Hmm, actually in the plan's manifest no other file is given the error classes either. The files listed in the manifest are:

- prisma/schema.prisma
- src/payment/bank-client.interface.ts — BankClient interface, BankSendRequest/Response, Settlement types
- src/payment/payment.repository.ts — reads bank-client.interface.ts — all Prisma queries...
- src/payment/payment.service.ts — reads bank-client.interface.ts, payment.repository.ts — PaymentService: executePayments, reconcile, deriveTxid
- src/payment/payment.module.ts
- src/app.module.ts
- test/payment.spec.ts

The errors are raised by BankClient.send(). Since this is the only file describing the bank client's contract, it's most defensible to include them in this interface file — because they are part of the contract for what `send` may throw. The manifest description is a summary and might not be exhaustive. But the instructions say "Do not add exports, functionality, or files not named in the plan" — that is about not adding things the plan doesn't name. The error classes are named in the plan (Section 3, Errors subsection). And no other file claims them. So it seems correct to include them in this file. They are part of the bank client's contract (comments say "raised by BankClient.send()").

Since `send(req)` is declared in this file, and the errors are exceptions it throws, they belong here. The "reads: -" also suggests self-containedness.

Now, regarding the TypeScript details:

1. Types need to be exported (so other files can import them). Since the repository and service will use these, `export` is required.

2. The plan writes field names in snake_case: `amount_minor_units`, `settled_at`. That's exactly what the plan says, so keep it.

3. The plan uses `amount_minor_units: number` in the Bank types, but the repository's `OrderRecord` also uses `number`. Postgres bigint should map to `string` in Prisma by default, but that's a concern for schema/repository, not this file. Follow the plan exactly: `number`.

4. Error classes: the plan shows them with a constructor signature `constructor(public readonly code: string, message: string)`. So I should implement them as actual classes extending Error, with a code parameter property and calling super(message).

5. Naming: TS files are `kebab-case.role.ts` — `bank-client.interface.ts` ✓. Class names in PascalCase ✓.

6. ESM with `"type": "module"` — no impact on interface files.

Let me consider whether `Settlement` should be a type alias or an interface. The plan uses `interface Settlement`. Keep it.

Also the plan's comment header style: "─── Bank client (injected dependency) ───". I could include a concise English comment. The codebase rules say "code and comments in English." Fine.

Now let me write the file:

```typescript
// Bank client contract for the instant-payment payout reconciler.
// The concrete transport (HTTP, etc.) is provided externally and injected.

export interface BankSendRequest {
  txid: string;
  amount_minor_units: number;
  key: string;
}

export type BankSendStatus =
  | 'accepted'
  | 'duplicate'
  | 'transient_error'
  | 'permanent_rejection';

export interface BankSendResponse {
  status: BankSendStatus;
  message?: string;
}

export interface Settlement {
  txid: string;
  amount_minor_units: number;
  settled_at: Date;
}

export interface BankClient {
  send(req: BankSendRequest): Promise<BankSendResponse>;
  getStatement(date: Date): Promise<Settlement[]>;
}

/**
 * Raised by BankClient.send() on transient failures (network, 5xx).
 */
export class BankTransientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BankTransientError';
  }
}

/**
 * Raised by BankClient.send() on permanent rejection (4xx).
 */
export class BankPermanentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BankPermanentError';
  }
}
```

Wait — should I set `this.name`? The plan just shows a constructor signature. Adding `this.name = ...` is a reasonable practice, but the instructions say "Implement exactly what the plan specifies for this file." The constructor signature in the plan: `constructor(public readonly code: string, message: string);` — this is shorthand. Implementing it requires calling `super(message)` to correctly extend Error in TypeScript strict mode (actually, not strictly required — if you don't call super, TS will auto-insert a `super()` call if the constructor has no super call... actually in ES2015+ classes, when you extend Error and define a constructor without calling super, TS will emit an implicit `super()` — but here we want to pass message). To have `message` set, I should call `super(message)`. That's the minimum defensible implementation of the given signature.

Setting `this.name` is a small defensible addition but... "Do not add exports, functionality, or files not named in the plan" — the error classes themselves are named in the plan. Setting `this.name` is standard for a custom Error subclass and hard to call "adding functionality." But in strict discipline, I should stick closer. Hmm. The `instanceof` check works without setting name. But the name on Error subclasses is conventional. I think it's fine and defensible. Alternatively, minimize: just `super(message)`.

Actually, let me reconsider whether to include the error classes at all. The manifest line for this file: "BankClient interface, BankSendRequest/Response, Settlement types". Strictly read, the errors are not in the manifest summary. But the plan's Section 3 contains them in a Types and signatures section alongside these types, and no other file in the manifest claims them. The test references: "BankTransientError raised on transient failure (network, 5xx)" — the tests would import it from somewhere. The only plausible home is this interface file. So include them.

The instruction: "If a symbol you truly need is missing from both the plan and references, do not guess silently... mark it with a single `// ASSUMPTION` comment." Nothing is truly missing here. The constructor signature in the plan is shorthand but implementable without guessing: `code` becomes a public readonly property, `message` is passed to super.

One subtlety: parameter properties with `public readonly` — fine in TypeScript strict.

Another consideration: should `BankSendStatus` be included? It's part of BankSendResponse, so needed. The manifest says "BankSendRequest/Response" — the status type is part of defining the response. Fine.

Also: should `Settlement` use `settled_at: Date`? The plan says so. Keep it.

Note the plan's own comments on the errors: "Raised by BankClient.send() on transient failures (network, 5xx)." I can keep these as doc comments.

Formatting: the repo's convention is English comments, fine.

Also — `export type BankSendStatus` vs plain `type`? Need to export for service to use. The plan's snippet doesn't show export keyword (it's a design doc), but the file must export for other modules. The rule says don't add exports the plan doesn't name — but exporting the named types is obviously necessary. That's not adding a new export, it's making the named things importable. Fine.

Double-check ESM: `import type` works elsewhere. Here, just export declarations.

Let me write the final file. Keep it clean, minimal, complete.

Another thought about `settled_at` in Settlement: it's the bank's settlement timestamp. And in `BankSendRequest`, `amount_minor_units: number` — the plan states "amount is integer in minor units". `number` as per the plan. Fine.

Final content:

```typescript
// Contract for the bank's instant-payment API, injected as a dependency.
// The concrete transport lives outside this repository.

/** A single payout instruction sent to the bank. */
export interface BankSendRequest {
  /** Deterministic transaction id derived from order + effective date. */
  txid: string;
  /** Payout amount in minor units (integers only). */
  amount_minor_units: number;
  /** Bank account identifier of the supplier (IBAN/SP number). */
  key: string;
}

/** Outcome categories for a bank.send response. */
export type BankSendStatus =
  | 'accepted'
  | 'duplicate'
  | 'transient_error'
  | 'permanent_rejection';

export interface BankSendResponse {
  status: BankSendStatus;
  message?: string;
}

/** A settlement entry as reported by bank.getStatement(date). */
export interface Settlement {
  /** The txid we sent with the original payout. */
  txid: string;
  amount_minor_units: number;
  /** The bank's settlement timestamp. */
  settled_at: Date;
}

export interface BankClient {
  /**
   * Sends a payout instruction. May throw BankTransientError (network, 5xx)
   * or BankPermanentError (4xx); a client-side timeout is handled by the caller.
   */
  send(req: BankSendRequest): Promise<BankSendResponse>;

  /** Fetches the settlement statement for a calendar date (up to ~30 min lag). */
  getStatement(date: Date): Promise<Settlement[]>;
}

/** Raised by BankClient.send() on transient failures (network, 5xx). */
export class BankTransientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BankTransientError';
  }
}

/** Raised by BankClient.send() on permanent rejection (4xx). */
export class BankPermanentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BankPermanentError';
  }
}
```

Hmm, about "client-side timeouts are handled by the caller" — per plan 4e, timeouts are treated the same as transient. That's a service-side classification detail. My comment says "handled by the caller", which is vague. Should I just write the doc comments more simply to avoid misstating: for `send`, say "may throw BankTransientError on transient failures (network, 5xx) or BankPermanentError on permanent rejection (4xx)." Per plan: "timeouts (requests exceeding client timeout, treated same as transient) → markInDoubt" — timeout handling is a service concern. Keep the doc minimal and accurate.

Also, comment verbosity: "code and comments in English" — fine, keep concise. Should I trim doc comments a bit to avoid adding things that aren't in the plan? Comments are not "functionality". Small, helpful comments are fine and align with the style seen in the plan (the plan itself has comments like "Raised by BankClient.send() on transient failures (network, 5xx).").

Should I drop the `this.name` assignment? Let me think about "exactly what the plan specifies." The plan's constructor: `constructor(public readonly code: string, message: string);` — that's shorthand notation. Any correct implementation needs `super(...)`. Passing `message` to super is the obvious intent (otherwise message is unused, and with strict + noUnusedParameters it would error). So `super(message)` is required. `this.name` — a judgment call. I'll keep it since it's the customary minimum for a custom error and makes the contract clearer, and it doesn't contradict the plan. Actually... strict discipline: "Do not add exports, functionality, or files not named in the plan." Setting `name` is not a feature. It's fine.

One more check: no import needed in this file (`Date` is a global). Good — consistent with the manifest "reads: -".

Line style: use single quotes (plan uses single quotes). Semicolons present. Trailing commas in multi-line — the plan snippet shows `| 'permanent_rejection';` with no trailing comma... but for multi-line parameter lists, the plan doesn't indicate. Use a consistent style: trailing commas are common with prettier. The plan snippets don't show multi-line parameters anywhere. Either works. Use trailing commas for multi-line lists (prettier default) — defensible.

Actually, let me match the plan's formatting for the union type exactly:

```typescript
export type BankSendStatus =
  | 'accepted'
  | 'duplicate'
  | 'transient_error'
  | 'permanent_rejection';
```

Plan shows it on one line: `type BankSendStatus = 'accepted' | 'duplicate' | 'transient_error' | 'permanent_rejection';` — that's 88 characters. Might exceed typical line length. Multi-line is fine and same meaning. Keep multi-line for readability.

Final check on reply format: "Reply with the full content of `src/payment/bank-client.interface.ts` in a single fenced block, and nothing else." So only the fenced code block.
```

## reply

```typescript
// Contract for the bank's instant-payment API, injected as a dependency.
// The concrete transport (HTTP, etc.) lives outside this repository.

/** A single payout instruction sent to the bank. */
export interface BankSendRequest {
  /** Deterministic transaction id derived from order + effective date. */
  txid: string;
  /** Payout amount in minor units (integers only). */
  amount_minor_units: number;
  /** Bank account identifier of the supplier (IBAN/SP number). */
  key: string;
}

/** Outcome categories for a bank.send response. */
export type BankSendStatus =
  | 'accepted'
  | 'duplicate'
  | 'transient_error'
  | 'permanent_rejection';

export interface BankSendResponse {
  status: BankSendStatus;
  message?: string;
}

/** A settlement entry as reported by bank.getStatement(date). */
export interface Settlement {
  /** The txid we sent with the original payout. */
  txid: string;
  amount_minor_units: number;
  /** The bank's settlement timestamp. */
  settled_at: Date;
}

export interface BankClient {
  /**
   * Sends a payout instruction. May throw BankTransientError on transient
   * failures (network, 5xx) or BankPermanentError on permanent rejection (4xx).
   */
  send(req: BankSendRequest): Promise<BankSendResponse>;

  /**
   * Fetches the settlement statement for a calendar date. Publishes with up to
   * ~30 min of lag, so the caller must treat a statement as complete only after
   * the publishing lag has passed.
   */
  getStatement(date: Date): Promise<Settlement[]>;
}

/** Raised by BankClient.send() on transient failures (network, 5xx). */
export class BankTransientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BankTransientError';
  }
}

/** Raised by BankClient.send() on permanent rejection (4xx). */
export class BankPermanentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BankPermanentError';
  }
}
```
