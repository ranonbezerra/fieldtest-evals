# repair1-payout.errors.ts

## reasoning

```
Let me analyze the compiler errors to understand what `src/payout/payout.errors.ts` needs to export.

From the error messages, I can see:

1. `src/payout/payout.repository.ts(5,62): error TS2307: Cannot find module './payout.errors'`
2. `test/payout.spec.ts(11,8): error TS2307: Cannot find module '../src/payout/payout.errors'`

So `payout.errors.ts` is imported by:
- `payout.repository.ts` (line 5, column 62)
- `test/payout.spec.ts` (line 11, column 8)

Now, what does `payout.errors.ts` need to export? Looking at the context:

The convention says errors use one envelope:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

`code` is `snake_case` and is the contract. `message` is developer-facing English. `details` is an object, never null.

From the variant requirements:
- Account must have sufficient available funds → "insufficient_funds" error
- Idempotency key handling → might need specific errors
- Resource not found (account not found) → "resource_not_found"

Looking at the repository import on line 5, column 62 - this is likely importing a specific error class or error code from `payout.errors.ts`.

Let me think about what errors a payout service would need:
- `resource_not_found` - when an account doesn't exist
- `insufficient_funds` - when the account doesn't have enough balance
- `invalid_amount` - maybe for validation (but that's controller territory)

Given the convention that errors have a specific shape with `code`, `message`, and `details`, and that the repository and tests import from this file, I should create error classes that conform to this envelope.

The typical pattern would be to export:
- Error classes (e.g., `ResourceNotFoundError`, `InsufficientFundsError`)
- Or a base error class with the envelope shape

Looking at the import in `payout.repository.ts` at line 5, column 62 - the column 62 suggests it's importing something specific (named import) from the module.

Let me think about what makes sense:

```typescript
export class PayoutError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export class ResourceNotFoundError extends PayoutError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('resource_not_found', message, details);
  }
}

export class InsufficientFundsError extends PayoutError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('insufficient_funds', message, details);
  }
}
```

Wait, but I need to be careful. The instructions say "Change nothing the messages do not name." So I should only fix what the error messages require of `payout.errors.ts`.

The messages that reference `payout.errors.ts` are:
1. `src/payout/payout.repository.ts(5,62): error TS2307: Cannot find module './payout.errors'`
2. `test/payout.spec.ts(11,8): error TS2307: Cannot find module '../src/payout/payout.errors'`

These just say the module can't be found. I don't know exactly what names are imported from it. But based on the domain:

- The repository would throw errors when an account is not found (`resource_not_found`) or when funds are insufficient (`insufficient_funds`).
- The test would import these to assert against them.

Given the convention for error envelope and the domain requirements, I'll create error classes that:
1. Extend `Error`
2. Have a `code` property (snake_case string)
3. Have a `message` property
4. Have a `details` property (object, never null)

The most common errors in this domain:
- `resource_not_found` - account not found
- `insufficient_funds` - not enough balance

Let me also consider if there might be other errors. Looking at the requirements:
- "Creates a payout if the account has sufficient available funds" → insufficient_funds
- Account lookup → resource_not_found

I think `ResourceNotFoundError` and `InsufficientFundsError` are the two main ones the repository would throw.

Let me write the file:
```

## reply

```typescript
export class PayoutError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ResourceNotFoundError extends PayoutError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('resource_not_found', message, details);
  }
}

export class InsufficientFundsError extends PayoutError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('insufficient_funds', message, details);
  }
}
```
