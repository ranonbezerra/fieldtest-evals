# 08-payout.controller.ts

## reasoning

```
Let me analyze what's needed for `src/payout/payout.controller.ts`.

From the plan:
- The controller validates input only, maps to the service and error envelope.
- `@Post('payouts') create(@Body() body: CreatePayoutDto): Promise<PayoutView>;`
- Errors: `InvalidRequestError` → code `invalid_request`, raised by the controller for malformed bodies (missing fields, negative amounts).

Wait — in the plan, the error classes are described as:
- `InsufficientFundsError` → code `insufficient_funds`
- `DuplicateIdempotencyKeyError` → code `duplicate_idempotency_key`
- `ResourceNotFoundError` → code `resource_not_found`
- `InvalidRequestError` → code `invalid_request`

But the reference file `payout.errors.ts` only shows a single `PayoutError` class with an `ErrorCode` union. The plan says "all thrown as `PayoutError` (a subclass of `Error`) with a code attached, and the controller (or exception filter) maps to an envelope."

So in practice, errors are `PayoutError` instances with a code. The controller catches them and maps to the envelope:
```json
{ "error": { "code": "...", "message": "...", "details": {} } }
```

Controller responsibilities:
1. Validate input: `accountId`, `amount`, `destinationAddress`, `idempotencyKey` — missing fields, negative amount → `invalid_request` (400).
2. Call `service.createPayout(dto)`.
3. Map errors to the envelope.

Now, how do I return the error envelope in NestJS? Options:
- Throw a `PayoutError` and let an exception filter handle it — but the plan says "the controller (or exception filter) maps to the envelope," and the manifest says for the controller: "validates input, maps to service + error envelope." So the controller itself should map to the envelope.
- The controller can catch `PayoutError` and return a response object with an appropriate HTTP status. But in NestJS, to set the status code you need either `@Res()` or throw an exception.

Hmm. The plan says the controller "maps to service + error envelope." Cleanest approach in NestJS without an exception filter file (the plan doesn't specify an exception filter file — the manifest only lists these files: schema, migration, errors, provider.types, types, repository, service, controller, worker, module, test). No exception filter file. So the controller must handle the envelope itself.

Approach: use `@Res()` to have full control over the response? That bypasses Nest's pipeline, but it works. Alternatively, throw a custom HttpException with the envelope as payload. But the plan doesn't name an exception filter, and errors are `PayoutError` (not an HttpException).

Let me think about what's most defensible: the controller catches `PayoutError` and throws a NestJS `HttpException` with the envelope as payload and an appropriate status. But then Nest's default exception filter will serialize it… Actually, if you throw `new HttpException(envelope, status)`, Nest returns the envelope object directly as the response body with that status. That works and keeps things simple.

But wait — is `HttpException` allowed? The plan says errors are thrown as `PayoutError`, and the controller maps to the envelope. Using `HttpException` as a transport mechanism is reasonable. Alternatively, use `@Res()` and write the response directly.

Hmm, let me think about what's cleanest and most in line with the plan: "the controller (or exception filter) maps to an envelope." The manifest says for the controller: "validates input, maps to service + error envelope."

Let me go with this: the controller method validates, calls the service, catches `PayoutError`, and returns… but returning the envelope object from a controller method would always be HTTP 200. That's wrong for errors — `insufficient_funds` should probably be 409 or 422, and duplicate key is specified as 409.

The plan says: "`DuplicateIdempotencyKeyError` → code `duplicate_idempotency_key`, raised by `createPayout` when the key already exists (409)."

Wait, but in the plan's control flow §4: "Create (single tx): lookup idempotency key → if found, return existing (no reservation)." So a retry with the same key returns the existing payout — that's 200, not 409! Hmm, there's a contradiction in the plan: §1 says duplicate key is 409, but §4 says return existing.

Actually, re-reading: the requirement says "retrying with the same `idempotencyKey` must not create a second payout or double-reserve funds." The plan's §4 says return existing. And the test says "two `createPayout` with same key → one creates, other returns existing payout." So the behavior is: return existing (idempotent success). Then when is `duplicate_idempotency_key` raised? Maybe never in the happy path… The plan lists it as an error code with 409. Hmm.

This is a contradiction within the plan, but my file is only the controller. The controller just calls `service.createPayout(dto)` and maps the result/errors. If the service throws a `PayoutError` with code `duplicate_idempotency_key`, the controller maps it to 409. If the service returns an existing payout, the controller returns 201 or 200.

Let me not overthink this: the controller's job is to map `PayoutError.code` to a status code and envelope. Status mapping:
- `insufficient_funds` → 409 (conflict) or 422? Common choice: 409. Let me go with 409.
- `duplicate_idempotency_key` → 409 (plan explicitly says 409).
- `resource_not_found` → 404.
- `invalid_request` → 400.

Success: POST /payouts creates a resource → 201 Created. But for an idempotent retry returning existing, 201 is also acceptable (or 200). Let me keep it simple: return the view with 201. Hmm, but if returning an existing payout on retry, 200 would be more accurate. The controller can't easily distinguish… Actually it could — but the plan doesn't specify. Let me keep it simple: 201 for created. Since the service returns `PayoutView` either way, always return 201? Or 200?

The convention says endpoints are kebab-case plural: `POST /payouts`. The controller decorator is `@Controller('payouts')` and the method is `@Post()`.

Now, how do I set status codes? Two clean options:

Option A: Use `@Res()` and write the response manually.
```ts
@Post()
async create(@Body() body: unknown, @Res() res: Response): Promise<void> {
  try {
    const dto = this.validate(body);
    const view = await this.service.createPayout(dto);
    res.status(201).json(view);
  } catch (e) {
    ...
  }
}
```
But then JSON serialization of `bigint` — `res.json()` will throw on BigInt! `JSON.stringify` on bigint throws "Do not know how to serialize a BigInt." Hmm. That's a real concern: `PayoutView.amount` is `bigint`. NestJS's default JSON serialization also uses `JSON.stringify`, so it would throw too…

Wait, this is a real issue in the overall design, but my file only needs to handle what's specified. The plan says `PayoutView.amount: bigint`. NestJS's default response serialization would fail on bigint. But that's a service/view design issue, not something the controller should silently rewrite (e.g., converting to string would change the contract). Hmm.

Actually, should I worry? The task says "implement exactly what the plan specifies for this file." The plan says the controller returns `Promise<PayoutView>`. Let me do that — return the view and let Nest serialize it. The bigint serialization issue is a plan-level concern (maybe they'll add a global interceptor or use a custom serializer — not my file's job). I shouldn't add features not in the plan.

Option B: Return the view normally, and for errors throw a `PayoutError`-derived exception… but Nest's default filter would produce `{ message, error, statusCode }`, not our envelope. So we need mapping. The plan says the controller maps to the envelope.

Let me go with a hybrid: the controller method returns `Promise<PayoutView>` on success (Nest sets 201 for POST by default… actually, Nest's default for POST is 201? No — Nest's default status for a successful response is 201 for POST? Let me recall: NestJS's default: if the route is POST and no status is set, it returns 201 Created. Yes! NestJS automatically sets 201 for POST handlers if no explicit status is set. Correct: "By default, Nest sets the HTTP response code to 201 (Created) for POST requests." Actually let me verify: NestJS docs say the default status code is 201 for POST. Yes, that's right — when a controller method returns a value on a POST route, the response is 201. Hmm, I think that's correct: `@Post()` handlers default to 201.

For errors, the controller throws an `HttpException` with the envelope payload:
```ts
throw new HttpException({ error: { code, message, details } }, statusCode);
```
Nest's `BaseExceptionFilter` will send that object as the body with that status. This gives us the envelope exactly:
```json
{ "error": { "code": "...", "message": "...", "details": {} } }
```

That's clean, uses only NestJS core, no extra files. The plan says "the controller (or exception filter) maps to an envelope" — the controller is doing that mapping.

Now, validation: "validate input only." Body fields: `accountId` (string), `amount` (bigint — but it arrives as a number or string from JSON!), `destinationAddress` (string), `idempotencyKey` (string).

Important: JSON can't carry bigint. The client sends a number or string. The controller must validate and convert. The plan says `CreatePayoutDto.amount: bigint`. So the controller converts the incoming amount (number or string) to `bigint`, validating it's a non-negative integer.

Validation rules (from plan: "missing fields, negative amount" → `invalid_request`):
- body must be an object.
- `accountId`: non-empty string.
- `amount`: number (safe integer, >= 0? or > 0?) or numeric string → bigint. Negative → invalid. Non-integer → invalid.
- `destinationAddress`: non-empty string.
- `idempotencyKey`: non-empty string.

What about zero amount? The plan only says negative → invalid. Zero… probably allow (or reject?). The plan says "missing fields, negative amount" → invalid. Let me only reject negative and non-integer/non-finite. Zero — allow per the plan's letter (don't add rules not in the plan). Hmm, but is a zero payout nonsensical? The discipline says "do exactly what the task asks." The plan only specifies negative as invalid. Let me allow zero.

Amount parsing: accept a number that is an integer and within safe range, or a string of digits. Convert to BigInt. If number: `Number.isSafeInteger`? Or just `Number.isInteger` and >= 0. For large amounts, JSON numbers lose precision — a numeric string is better. Let me accept both:
- `typeof v === 'number'` && `Number.isInteger(v)` && `v >= 0` → `BigInt(v)`.
- `typeof v === 'string'` && `/^\d+$/.test(v.trim())` → `BigInt(v)`.
- Otherwise → invalid.

That's defensible validation in the controller layer.

Now, structure:

```ts
import { Body, Controller, HttpException, Post } from '@nestjs/common';
import { PayoutService } from './payout.service.js';
import { PayoutError } from './payout.errors.js';
import { CreatePayoutDto, PayoutView } from './payout.types.js';

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  async create(@Body() body: unknown): Promise<PayoutView> {
    const dto = this.validate(body);
    try {
      return await this.service.createPayout(dto);
    } catch (err) {
      if (err instanceof PayoutError) {
        throw this.toHttpException(err);
      }
      throw err; // hmm — or map to 500?
    }
  }
  ...
}
```

Wait — ESM with `"type": "module"`. Do imports need `.js` extensions? The convention says ESM. In NestJS with ESM, relative imports need the `.js` extension. The plan's manifest doesn't show import statements. Hmm. This is a judgment call. Since the stack says ESM `"type": "module"`, relative imports should use `.js` extensions. But many NestJS projects use CommonJS… The convention explicitly says ESM. Let me use `.js` extensions on relative imports. That's the defensible reading for ESM TypeScript.

Hmm, but wait — would that break if their tsconfig uses `module: commonjs`? The convention says ESM, so `.js` extensions are correct. Let me go with that.

Now, on unknown errors (non-PayoutError): what to do? The plan doesn't specify a 500 mapping. Options: rethrow (Nest's default filter produces its own envelope — not ours), or map to a 500 with a generic code. The error convention says one envelope, and `code` is the contract. A 500 with code `internal_error`? But that code isn't in the plan's `ErrorCode` union. Adding it would be adding something not in the plan… but rethrowing a raw error would produce non-envelope responses, violating "one envelope."

Hmm. The plan's `ErrorCode` union: `insufficient_funds | duplicate_idempotency_key | resource_not_found | invalid_request`. No `internal_error`. The controller "maps to service + error envelope." For unexpected errors, the most defensible thing is: map to 500 with a generic code. But that extends the union…

Actually, let me reconsider: maybe I should keep it minimal — only handle `PayoutError` explicitly, and rethrow everything else. Nest's default exception filter will produce `{ statusCode: 500, message: 'Internal server error' }` — not our envelope. That violates the convention, but the convention is about the error shape we define…

The instruction says: "If a symbol you need is truly missing from both the plan and the references, do not guess silently… write the file using the most defensible reading and mark it with a single `// ASSUMPTION:` comment."

A 500 code for unexpected errors is truly missing. The most defensible reading: wrap unexpected errors in the envelope with code `internal_error` and 500, marked with an ASSUMPTION comment. That preserves "one envelope" (a core convention that always holds) without inventing behavior beyond a minimal catch-all. The conventions section (which "always holds") mandates the envelope shape, so a catch-all 500 with `code: 'internal_error'` is the most defensible. Let me add one ASSUMPTION comment there.

Hmm, but "do not add exports, features, or files the plan doesn't name." A catch-all isn't a new feature/export; it's error mapping, which is the controller's job. Let me include it with an ASSUMPTION comment.

Now, status code mapping:
- `invalid_request` → 400
- `resource_not_found` → 404
- `insufficient_funds` → 409
- `duplicate_idempotency_key` → 409

The plan explicitly says duplicate is 409. For insufficient_funds, 409 (conflict with current account state) is the natural REST choice. Let me use 409.

Envelope construction:
```ts
private envelope(err: PayoutError) {
  return { error: { code: err.code, message: err.message, details: err.details } };
}
```
`details` is always an object (guaranteed by PayoutError's constructor).

Now, validation details. Let me write a `validate` method:

```ts
private validate(body: unknown): CreatePayoutDto {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new PayoutError('invalid_request', 'Request body must be a JSON object');
  }
  const raw = body as Record<string, unknown>;

  const accountId = this.requireString(raw.accountId, 'accountId');
  const destinationAddress = this.requireString(raw.destinationAddress, 'destinationAddress');
  const idempotencyKey = this.requireString(raw.idempotencyKey, 'idempotencyKey');
  const amount = this.parseAmount(raw.amount);

  return { accountId, amount, destinationAddress, idempotencyKey };
}
```

`requireString`: if `typeof v !== 'string' || v.trim() === ''` → throw invalid_request with a message naming the field.

Should I trim? Probably just check non-empty after trim, but return as-is? Or return trimmed? Keep it simple: reject if not a string or empty/whitespace-only; return the original value. Hmm, actually returning as-is is fine.

`parseAmount`:
```ts
private parseAmount(value: unknown): bigint {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return BigInt(trimmed);
  }
  throw new PayoutError('invalid_request', 'amount must be a non-negative integer in minor units');
}
```

Note: `Number.isInteger(NaN)` is false, `Number.isInteger(Infinity)` is false — good. Negative numbers are rejected by `value >= 0`. Floating point like 10.5 → not integer → rejected.

Now, should validation throw `PayoutError` directly, or an `InvalidRequestError` subclass? The reference `payout.errors.ts` only has `PayoutError`. The plan's §3 says errors are "all thrown as PayoutError (a subclass of Error) with a code attached," and the bullet points describe which code each scenario uses (the names like `InsufficientFundsError` read like scenario names, but the reference file confirms a single class). So I'll throw `new PayoutError('invalid_request', ...)`.

Then the catch in `create`: validation throws PayoutError before the service call — I can wrap the whole thing:

```ts
@Post()
async create(@Body() body: unknown): Promise<PayoutView> {
  try {
    const dto = this.validate(body);
    return await this.service.createPayout(dto);
  } catch (err) {
    throw this.toHttpException(err);
  }
}

private toHttpException(err: unknown): HttpException {
  if (err instanceof PayoutError) {
    const status = STATUS_BY_CODE[err.code];
    return new HttpException(this.envelope(err), status);
  }
  // ASSUMPTION: ...
  return new HttpException({ error: { code: 'internal_error', message: 'Unexpected internal error', details: {} } }, 500);
}
```

Wait, but should the validation error be caught by the same handler? Yes — simpler: one try/catch around both validate and service call. The controller "validates input and calls the service," then maps errors to the envelope.

Hmm, one subtlety: `throw this.toHttpException(err)` — for non-PayoutError I'm converting to a 500 envelope. That's the ASSUMPTION point.

Now, `STATUS_BY_CODE` — a private const map:
```ts
const PAYOUT_ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  resource_not_found: 404,
  insufficient_funds: 409,
  duplicate_idempotency_key: 409,
};
```
Need to import `ErrorCode` from errors. That's fine — it's in the reference file.

Now, success response: return `PayoutView`. Nest will serialize with JSON.stringify → BigInt throws. Ugh, again the bigint issue. Should I convert `amount` to a string in the response? The plan's `PayoutView.amount: bigint`, and the controller returns `Promise<PayoutView>`. If I convert, I'm deviating from the plan's signature. The reference workspace files show the types with bigint. The plan governs; let me return the view as-is. The serialization concern is out of scope for this file (maybe there's a global interceptor in main.ts — not my file).

Actually wait, let me reconsider. Is it possible the intended design serializes bigint as a string in the view? The plan explicitly types `PayoutView.amount: bigint` and the controller returns `Promise<PayoutView>`. Let me follow the plan. No conversion.

Route: `@Controller('payouts')` + `@Post()`. Convention: "endpoints: kebab-case, plural" → `/payouts`. Good.

Imports from `@nestjs/common`: `Body, Controller, HttpException, Post`.

Now, the class name: `PayoutController` (PascalCase). File: `src/payout/payout.controller.ts`.

Let me also double-check the plan's controller signature:
```ts
export class PayoutController {
  constructor(service: PayoutService);
  @Post('payouts') create(@Body() body: CreatePayoutDto): Promise<PayoutView>;
}
```

Interesting — the plan shows `@Post('payouts')` and `body: CreatePayoutDto`. If the controller is `@Controller('payouts')` with `@Post()`, that's `/payouts`. Or `@Controller()` with `@Post('payouts')`. The plan's snippet shows `@Post('payouts')`, suggesting the controller decorator might be `@Controller()` with no path? Hmm, but conventionally… The plan snippet is a sketch. Either produces `POST /payouts`.

Which to pick? The plan literally writes `@Post('payouts')`. If I use `@Controller('payouts')` + `@Post()`, the endpoint is identical. But "implement exactly what the plan specifies" — the plan specifies `@Post('payouts')`. Hmm, but with `@Controller('payouts')` and `@Post('payouts')` it would be `/payouts/payouts` — wrong. So I have to pick one of the two placements.

The plan's sketch: `@Post('payouts') create(...)`. Let me follow the sketch literally: `@Controller()` … hmm, an empty `@Controller()` is a bit unusual. Alternatively, `@Controller('payouts')` + `@Post()`.

The endpoint contract is `POST /payouts` (requirement #1). Both satisfy it. The plan's sketch is more specific about the decorator: `@Post('payouts')`. Let me go with `@Controller()` + `@Post('payouts')`? That looks weird. Or `@Controller('payouts')` + `@Post()`.

Honestly, `@Controller('payouts')` + `@Post()` is more idiomatic NestJS and matches the convention "endpoints: kebab-case, plural" (path segment `payouts`). The plan's sketch is a loose signature listing. Both are defensible; the resulting route is identical. Let me go with `@Controller('payouts')` + `@Post()` — cleaner, and the route matches the requirement exactly.

Hmm wait, but "implement exactly what the plan specifies for this file." The plan specifies `@Post('payouts')`. If a grader checks for that literal… The plan also says the controller "validates input only, maps to service + error envelope." The `@Post('payouts')` in the sketch, combined with an unspecified `@Controller(...)`, is ambiguous. Given the ambiguity, either is a "most defensible reading." Let me pick `@Controller('payouts')` + `@Post()` as the idiomatic form. Actually…

Let me reconsider once more. The sketch in the plan:
```ts
export class PayoutController {
  constructor(service: PayoutService);
  @Post('payouts') create(@Body() body: CreatePayoutDto): Promise<PayoutView>;
}
```
No `@Controller` line shown at all. So the plan doesn't fix the controller path. The endpoint must be `/payouts`. `@Controller('payouts')` + `@Post()` gives that. Let me go with that. No ASSUMPTION comment needed since the route is fully determined by the requirement.

Body type: the plan says `@Body() body: CreatePayoutDto`, but we need to validate raw input, so the type must be `unknown` (or a loose record). Typing it as `CreatePayoutDto` would be a lie since the raw body might be anything. The plan's sketch is loose; validation requires `unknown`. Let me use `unknown` — that's the defensible reading for "validate input." No ASSUMPTION comment needed; it's standard.

Now, the 500 catch-all: let me write it carefully.

```ts
private toHttpException(err: unknown): HttpException {
  if (err instanceof PayoutError) {
    return new HttpException(
      { error: { code: err.code, message: err.message, details: err.details } },
      ERROR_STATUS[err.code],
    );
  }
  // ASSUMPTION: the plan defines no code for unexpected errors; the one-envelope
  // convention still requires a snake_case code, so map them to 500 internal_error.
  return new HttpException(
    { error: { code: 'internal_error', message: 'Unexpected internal error', details: {} } },
    500,
  );
}
```

The instructions say "mark with a single `// ASSUMPTION: <what was unresolved>` comment at the relevant location." So one comment. Let me keep it concise: `// ASSUMPTION: plan defines no error code for unexpected failures; the one-envelope convention requires a snake_case code, so map them to 500 internal_error.`

Now, let me write the full file:

```ts
import { Body, Controller, HttpException, Post } from '@nestjs/common';
import { ErrorCode, PayoutError } from './payout.errors.js';
import { CreatePayoutDto, PayoutView } from './payout.types.js';
import { PayoutService } from './payout.service.js';

const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  resource_not_found: 404,
  insufficient_funds: 409,
  duplicate_idempotency_key: 409,
};

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  async create(@Body() body: unknown): Promise<PayoutView> {
    try {
      const dto = this.validate(body);
      return await this.service.createPayout(dto);
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  private validate(body: unknown): CreatePayoutDto {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new PayoutError('invalid_request', 'Request body must be a JSON object');
    }
    const raw = body as Record<string, unknown>;
    return {
      accountId: this.requireString(raw.accountId, 'accountId'),
      amount: this.parseAmount(raw.amount),
      destinationAddress: this.requireString(raw.destinationAddress, 'destinationAddress'),
      idempotencyKey: this.requireString(raw.idempotencyKey, 'idempotencyKey'),
    };
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new PayoutError('invalid_request', `${field} must be a non-empty string`);
    }
    return value;
  }

  private parseAmount(value: unknown): bigint {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return BigInt(value);
    }
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      return BigInt(value.trim());
    }
    throw new PayoutError(
      'invalid_request',
      'amount must be a non-negative integer in minor units (number or numeric string)',
    );
  }

  private toHttpException(err: unknown): HttpException {
    if (err instanceof PayoutError) {
      return new HttpException(
        { error: { code: err.code, message: err.message, details: err.details } },
        ERROR_STATUS[err.code],
      );
    }
    // ASSUMPTION: the plan defines no code for unexpected failures, but the one-envelope
    // convention requires a snake_case code, so they are mapped to 500 internal_error.
    return new HttpException(
      { error: { code: 'internal_error', message: 'Unexpected internal error', details: {} } },
      500,
    );
  }
}
```

Wait — `details: err.details` — the type is `Record<string, unknown>`, good, never null.

One concern: the `details` in the envelope must be "an object, never null" — `PayoutError.details` defaults to `{}`. Good.

Now, about the `.js` import extensions: the convention says ESM `"type": "module"`. In ESM TypeScript, relative imports need explicit extensions (typically `.js` when using NodeNext, or `.ts` with allowImportingTsExtensions). Most defensible: `.js`. Let me use `.js`.

Hmm, but is there any evidence in the references? The manifest lists file paths without extensions. The stack says ESM. Let me go with `.js` extensions — standard for NodeNext ESM TS.

Let me double-check the `HttpException` usage: `new HttpException(body, status)` — Nest's base exception filter will send `body` as the response with `status`. If body is an object, it's JSON-serialized. So the response will be exactly `{ "error": { ... } }` with the correct status.

Also, should I use `res.status(...)` via `@Res()` instead? No — throwing HttpException is cleaner and keeps Nest's pipeline (logging, interceptors).

Another consideration: `@HttpCode(201)` — Nest's default for POST is… let me verify my memory. NestJS docs: "By default, Nest sets the HTTP response code to 201 (Created) for POST requests and 200 (OK) for all other requests." Yes, I'm fairly confident POST defaults to 201 in Nest. So no explicit `@HttpCode` needed. Should I add it explicitly for clarity? The plan doesn't mention it. Adding `@HttpCode(201)` would be explicit and harmless… but "do not add features the plan doesn't name" — a status code decorator is borderline. Since POST defaults to 201 in Nest, let me omit it. Hmm, actually, is that default real? Let me think harder.

NestJS exception/filter docs: "By default, Nest sets the HTTP response code to 201 (Created) for POST requests and 200 (OK) for all other requests." — yes, that's from the NestJS docs on controllers/exception filters. I'm confident. Omit `@HttpCode`.

Now — the plan says the controller "validates input only. Zero business logic." My validate method is input validation, which is allowed ("controller validates input"). Converting amount to bigint is part of input parsing/validation. Fine.

Edge: `amount` as a number above 2^53 — JSON parsing has already lost precision; can't fix that in the controller. Accepting integer numbers is fine.

Edge: string with leading zeros "007" → `/^\d+$/` passes, `BigInt("007")` = 7n. Fine.

Edge: negative string "-5" → regex fails (no `-` allowed) → invalid. Good.

Should I also reject `amount: true` (boolean)? `typeof true === 'boolean'` → falls through to throw. Good.

Now, one more thing about the try/catch wrapping validate: if validate throws PayoutError, it's caught and mapped to a 400 envelope. Good — the controller "maps to an envelope" for its own validation errors too, satisfying the one-envelope convention.

Also, should the catch rethrow non-PayoutError as-is instead of a 500 envelope? I decided on the 500 envelope with ASSUMPTION. Let me reconsider: the convention "errors — one envelope" always holds. A raw rethrow would produce Nest's default `{ statusCode, message }` shape for unexpected errors — violating the convention. So the 500 envelope is more defensible. Keep it with one ASSUMPTION comment.

Let me also double-check imports: `ErrorCode` is exported from payout.errors.ts (yes: `export type ErrorCode`). `PayoutError` is exported. `CreatePayoutDto`, `PayoutView` from payout.types.ts (yes). `PayoutService` from payout.service.ts (per plan, yes — the class `PayoutService` with `createPayout(dto: CreatePayoutDto): Promise<PayoutView>`).

Method name: `createPayout` per plan. Good.

Let me also think about whether the `create` method should be named `create` — the plan shows `create`. Yes.

Final check on the response type: `Promise<PayoutView>` — matches the plan.

I think the file is solid. Let me also make sure there are no unused imports. `ErrorCode` is used in the Record type. All good.

Formatting: let me keep it clean, English comments only where needed (the ASSUMPTION one). Maybe a short header comment? No — keep it minimal.

One more thought on `@Controller('payouts')` vs the plan's `@Post('payouts')`: I keep going back and forth. The requirement fixes the endpoint as `POST /payouts`. Both forms satisfy it. The plan's sketch literally has `@Post('payouts')` and no `@Controller` decorator shown. If I write `@Controller()` (no path) + `@Post('payouts')`, that matches the sketch most literally. An empty `@Controller()` is valid NestJS. Hmm.

Which is "most defensible"? The plan's sketch is authoritative for this file: it says `@Post('payouts')`. Let me honor that literally: `@Controller()` … but an empty controller decorator looks odd to a reviewer. Alternatively, the sketch might just be indicating the route path `payouts` without committing to which decorator carries it.

Decision: use `@Controller('payouts')` + `@Post()`. Reasoning: idiomatic NestJS, the route is exactly `/payouts`, and the sketch's `@Post('payouts')` + missing `@Controller` line is ambiguous (if both carried the path it would double up). The convention "endpoints: kebab-case, plural" is about the final path. This is a judgment call on an ambiguous sketch; no ASSUMPTION comment needed since the endpoint contract is unambiguous. Hmm, actually — should I mark it? The instructions say to mark when "a symbol you need is truly missing." A decorator placement isn't a missing symbol; the endpoint is fully specified. No comment.

Let me finalize the file content.

Actually, one more consideration on `details` typing in the envelope: `err.details` is `Record<string, unknown>` — fine.

And the 500 message: "Unexpected internal error" — developer-facing English, fine.

Also, should I log the unexpected error? The plan doesn't mention logging in the controller. Omit (discipline).

Final file:

```ts
import { Body, Controller, HttpException, Post } from '@nestjs/common';
import { ErrorCode, PayoutError } from './payout.errors.js';
import { CreatePayoutDto, PayoutView } from './payout.types.js';
import { PayoutService } from './payout.service.js';

const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  resource_not_found: 404,
  insufficient_funds: 409,
  duplicate_idempotency_key: 409,
};

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  async create(@Body() body: unknown): Promise<PayoutView> {
    try {
      const dto = this.validate(body);
      return await this.service.createPayout(dto);
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  private validate(body: unknown): CreatePayoutDto {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new PayoutError('invalid_request', 'Request body must be a JSON object');
    }

    const raw = body as Record<string, unknown>;

    return {
      accountId: this.requireString(raw.accountId, 'accountId'),
      amount: this.parseAmount(raw.amount),
      destinationAddress: this.requireString(raw.destinationAddress, 'destinationAddress'),
      idempotencyKey: this.requireString(raw.idempotencyKey, 'idempotencyKey'),
    };
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new PayoutError('invalid_request', `${field} must be a non-empty string`);
    }
    return value;
  }

  private parseAmount(value: unknown): bigint {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return BigInt(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d+$/.test(trimmed)) {
        return BigInt(trimmed);
      }
    }
    throw new PayoutError(
      'invalid_request',
      'amount must be a non-negative integer in minor units (number or numeric string)',
    );
  }

  private toHttpException(err: unknown): HttpException {
    if (err instanceof PayoutError) {
      return new HttpException(
        { error: { code: err.code, message: err.message, details: err.details } },
        ERROR_STATUS[err.code],
      );
    }
    // ASSUMPTION: the plan defines no code for unexpected failures, but the one-envelope
    // convention requires a snake_case code, so they are mapped to 500 internal_error.
    return new HttpException(
      { error: { code: 'internal_error', message: 'Unexpected internal error', details: {} } },
      500,
    );
  }
}
```

That's complete. The reply should be just a fenced block with the file content, nothing else.
```

## reply

```ts
import { Body, Controller, HttpException, Post } from '@nestjs/common';
import { ErrorCode, PayoutError } from './payout.errors.js';
import { CreatePayoutDto, PayoutView } from './payout.types.js';
import { PayoutService } from './payout.service.js';

const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  resource_not_found: 404,
  insufficient_funds: 409,
  duplicate_idempotency_key: 409,
};

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  async create(@Body() body: unknown): Promise<PayoutView> {
    try {
      const dto = this.validate(body);
      return await this.service.createPayout(dto);
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  private validate(body: unknown): CreatePayoutDto {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new PayoutError('invalid_request', 'Request body must be a JSON object');
    }

    const raw = body as Record<string, unknown>;

    return {
      accountId: this.requireString(raw.accountId, 'accountId'),
      amount: this.parseAmount(raw.amount),
      destinationAddress: this.requireString(raw.destinationAddress, 'destinationAddress'),
      idempotencyKey: this.requireString(raw.idempotencyKey, 'idempotencyKey'),
    };
  }

  private requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new PayoutError('invalid_request', `${field} must be a non-empty string`);
    }
    return value;
  }

  private parseAmount(value: unknown): bigint {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return BigInt(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d+$/.test(trimmed)) {
        return BigInt(trimmed);
      }
    }
    throw new PayoutError(
      'invalid_request',
      'amount must be a non-negative integer in minor units (number or numeric string)',
    );
  }

  private toHttpException(err: unknown): HttpException {
    if (err instanceof PayoutError) {
      return new HttpException(
        { error: { code: err.code, message: err.message, details: err.details } },
        ERROR_STATUS[err.code],
      );
    }
    // ASSUMPTION: the plan defines no code for unexpected failures, but the one-envelope
    // convention requires a snake_case code, so they are mapped to 500 internal_error.
    return new HttpException(
      { error: { code: 'internal_error', message: 'Unexpected internal error', details: {} } },
      500,
    );
  }
}
```
