# 03-payout.errors.ts

## reasoning

```
We need answer user's request: write exactly one file src/payout/payout.errors.ts complete inside one fenced block, nothing else. Need think in English? User request English, so analysis in English. Need infer exact content from PLAN.md. Need not reproduce plan but implement. Need ensure no extra exports/features beyond plan. File: PayoutError + ErrorCode, single error type. Plan says:

```ts
// src/payout/payout.errors.ts
export type ErrorCode =
  | 'insufficient_funds' | 'duplicate_idempotency_key'
  | 'resource_not_found' | 'invalid_request';

export class PayoutError extends Error {
  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>);
  code: ErrorCode;
  details: Record<string, unknown>; // always an object, never null
}
```

- `InsufficientFundsError` → code `insufficient_funds`, raised by `reserveFunds` when ...
- `DuplicateIdempotencyKeyError` → code `duplicate_idempotency_key`, raised by `createPayout` when key already exists (409).
- `ResourceNotFoundError` → code `resource_not_found`, raised when account or payout id does not exist.
- `InvalidRequestError` → code `invalid_request`, raised by controller for malformed body.

But file scope says "PayoutError + ErrorCode, the single error type". The plan lists specific named errors? It says Errors. All thrown as PayoutError (an Error subclass) carrying a code; controller maps them. Then bullets: InsufficientFundsError → code ... etc. Ambiguous whether to export subclasses or just PayoutError with factory? It says "the single error type" and "Do not add an export, a feature or a file the plan does not name." The manifest: "src/payout/payout.errors.ts | reads: - | PayoutError + ErrorCode, the single error type". So likely only export ErrorCode and PayoutError. But plan bullets name InsufficientFundsError etc. Could be conceptual, not actual classes? Need decide. If I add subclasses, that's extra exports not named in manifest? They are named in plan bullets. But "single error type" suggests no subclasses. Maybe use PayoutError with code values. The controller can map by code. If service needs raise insufficient funds, it can throw new PayoutError('insufficient_funds', ...). But plan says "InsufficientFundsError → code insufficient_funds". Could be just naming of error conditions. The file description explicitly: "This file: PayoutError + ErrorCode, the single error type". So implement only these two exports. Need ensure class details always object never null. In strict TS, property details: Record<string, unknown>; constructor param optional details? If optional, assign this.details = details ?? {}. Need set name? Probably super(message); Object.setPrototypeOf(this, new.target.prototype) for ES5? In NestJS/ESM maybe not necessary but good. Need readonly? Plan shows code: ErrorCode; details: Record<string, unknown>. Could make constructor(code, message, details = {}). But plan signature has details?: Record<string, unknown>. In TS, if property not optional, we can default. Need maybe `public readonly code: ErrorCode; public readonly details: Record<string, unknown>;` Is adding readonly a feature? fine. Need ensure instanceof works if target ES2015? Could include `Object.setPrototypeOf(this, PayoutError.prototype);` if super extends Error in older target. But maybe unnecessary. The plan doesn't specify. We can keep simple. Need no imports. Need one fenced block only. Could include comment? okay but not necessary. Need exact file content. Let's craft:

```ts
export type ErrorCode =
  | 'insufficient_funds'
  | 'duplicate_idempotency_key'
  | 'resource_not_found'
  | 'invalid_request';

export class PayoutError extends Error {
  public readonly code: ErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PayoutError';
    this.code = code;
    this.details = details;
  }
}
```

Need consider if `details` should be optional in constructor? Plan signature has details?: Record<string, unknown>. Default parameter effectively optional. Good.

But there is potential issue: if details passed null? type disallows. But "never null". If someone passes null, TS error. Runtime could coerce? Not needed. Could do `this.details = details ?? {};` but if default already, null still could be passed at runtime. To enforce never null, use `this.details = details ?? {};` and type `details?: Record<string, unknown> | null`? But plan says details?: Record<string, unknown>. Adding null union maybe extra. Could do `details: Record<string, unknown> = {}` then `this.details = details ?? {};` redundant. In strict TS, default handles undefined, but not null if caller passes null despite type? Runtime JS can pass null; to be safe: `this.details = details ?? {};` with constructor param `details?: Record<string, unknown>` works? If type is optional not null, default parameter value {} means type includes undefined but not null. `details ?? {}` okay? TS: details type Record<string, unknown> (after default) not null, so ?? right operand never used? It may warn? no. If param `details?: Record<string, unknown>` without default, type is Record | undefined; ?? handles. But plan signature optional. Use `constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) { ... this.details = details ?? {}; }` matches plan exactly. This ensures runtime null becomes {} if passed? Actually `null ?? {}` returns {}, yes. But type doesn't allow null, but runtime safe. Good.

Need maybe `Object.setPrototypeOf(this, new.target.prototype);` for inheritance? If no subclasses, not needed. But if future subclasses? single type. Could include to be robust:
```
constructor(...) {
 super(message);
 Object.setPrototypeOf(this, new.target.prototype);
 ...
}
```
But this is extra not plan. Might be okay but unnecessary. Keep minimal.

Need ensure no named error subclasses. But what about plan bullets? If tests expect `InsufficientFundsError`? The task only asks this file. Other files may import PayoutError and code. If they expected subclasses, manifest contradicts. Need choose single error type. Could include factory functions? No extra exports.

Need final only fenced block. Ensure no explanation. Use TypeScript strict. Could add JSDoc? Not necessary. Maybe comments in English okay. But no extra.

Double-check conventions: ESM, type module. No imports. Class name PascalCase. Code snake_case. Error envelope code contract. details object never null. Good.

Potential issue: `this.name = 'PayoutError';` okay. Error's name property is string. Could be overwritten by subclasses? no.

Need maybe `readonly` not in plan but okay? It says code: ErrorCode; details: Record. Adding readonly is modifier, not feature. Fine. But to match exactly maybe no `public readonly`? In strict, public default. Use:
```
export class PayoutError extends Error {
  code: ErrorCode;
  details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PayoutError';
    this.code = code;
    this.details = details ?? {};
  }
}
```
This matches plan. But TS strict property initialization: code and details assigned in constructor, okay. If no `declare`. Good.

Need think about ES class extending built-in: In TS with target ES2015+ no problem. If target ES5, need setPrototypeOf. Project Node 20+, likely target ES2022? Not specified. Could avoid potential by not extending Error? But plan says extends Error. Include setPrototypeOf? It is a common pattern but extra. Does it violate "Do not add feature"? It's implementation detail for correctness. But if no subclasses, `instanceof PayoutError` works in ES2015. In TS target ES5, extending Error has issues with instanceof if not setPrototypeOf. NestJS usually target ES2021? Not sure. To be safe, include `Object.setPrototypeOf(this, PayoutError.prototype);` after super. But if using `new.target.prototype`, supports subclasses. This is a common robustness line. Is it an extra export? no. Could be considered not in plan but acceptable? The instruction: Implement exactly what plan specifies. Do not add an export, a feature or a file. A setPrototypeOf line isn't an export/feature. But maybe they want minimal. I'd include? Hmm.

Given codebase conventions strict, Node 20+, ESM. Modern target likely. Simpler is better. But "complete" maybe robust. I can include `Object.setPrototypeOf(this, new.target.prototype);` to ensure instanceof if compiled to ES5. However, with `new.target` in constructor of class extending Error, if someone does `instanceof`, okay. But if no subclasses, PayoutError.prototype. Could use `Object.setPrototypeOf(this, PayoutError.prototype);`. This line might be seen as unnecessary but not harmful. But if code uses TS `useDefineForClassFields`? no.

Need maybe make details frozen? No.

Potential hidden tests: They may import { PayoutError, ErrorCode } and check details default {}. If we don't include named errors, okay. If they expect `new PayoutError('insufficient_funds', 'msg').details` equals {}. Good.

Need final with one fenced block. No language? Use ```ts. They said inside one fenced block. Good.

Let's ensure no trailing explanation. Final:
```ts
export type ErrorCode = ...;

export class PayoutError extends Error {
  code: ErrorCode;
  details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PayoutError';
    this.code = code;
    this.details = details ?? {};
  }
}
```

Could include `Object.setPrototypeOf(this, PayoutError.prototype);`? Let's decide. The plan's snippet doesn't include. To implement exactly, omit. Modern TS target likely. If target ES5, instanceof issue but not specified. But Node 20+ and NestJS default tsconfig target ES2021? Probably. Omit for minimal.

Need consider strict property initialization with `details?: Record<string, unknown>` and `this.details = details ?? {};` okay. If `details` undefined, `{}`.

One more: Error message developer-facing English. The constructor takes message. Good.

No ASSUMPTION needed because plan sufficient. Final only code block.
```

## reply

```ts
export type ErrorCode =
  | 'insufficient_funds'
  | 'duplicate_idempotency_key'
  | 'resource_not_found'
  | 'invalid_request';

export class PayoutError extends Error {
  code: ErrorCode;
  details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PayoutError';
    this.code = code;
    this.details = details ?? {};
  }
}
```
