# 07-payout.controller.ts

## reasoning

```
Let me carefully analyze what's needed for `src/payout/payout.controller.ts`.

From the plan:
- `POST /payouts` — body: `{ accountId, amount, destinationAddress, idempotencyKey }`
- The controller validates the input and calls the service. Zero business logic.
- `CreatePayoutDto`: `{ accountId: string; amount: string; destinationAddress: string; idempotencyKey: string }` — `amount` is a decimal string parsed to `bigint` in the controller (no float).
- Error envelope: the controller catches subclasses of `PayoutError` and returns `{ error: { code, message, details } }` with the appropriate HTTP status (409 for duplicate/insufficient balance, 404 for not found). Anything other than `PayoutError` → 500 with `code: "internal_error"`.
- The controller is declared by the module.

From the plan's signature:
```ts
@Controller('payouts')
export class PayoutController {
  constructor(service: PayoutService);

  @Post()
  create(@Body() body: CreatePayoutDto): Promise<{ payoutId: string }>;
}
```

The service throws `PayoutError` subclasses:
- `InsufficientFundsError` — code "insufficient_funds" → 409
- `DuplicatePayoutError` — code "duplicate_payout" → 409
- `PayoutNotFoundError` — code "resource_not_found" → 404

The error envelope format:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

Now, the plan says the controller "catches subclasses of `PayoutError` and returns `{ error: { code, message, details } }` with the appropriate HTTP status."

Two approaches:
1. A try/catch inside the controller method that returns a response with status manually set (using `@HttpCode` or returning an object with the status).
2. A NestJS exception filter.

The plan says "error envelope is raised by the controller, translating typed errors thrown by the service." So the translation happens in the controller. The cleanest way in NestJS to return a specific HTTP status from a controller is either:
- Throwing an `HttpException` with the envelope body, or
- Using a response parameter and setting the status.

Actually, the most idiomatic NestJS way to control both status code and body from a controller is to throw an `HttpException` with the envelope object as the response. Or use `@Res()` — but that's uglier.

Wait, let me think about what "translate" means here. The controller catches `PayoutError` and maps it to HTTP status + envelope body. Throwing an `HttpException` with the exact envelope body is a clean approach:

```ts
throw new HttpException(
  { error: { code, message, details } },
  status,
);
```

This produces exactly that JSON body with that status. This is a common pattern.

Alternatively, the controller method could return `Promise<{ payoutId: string } | { error: ... }>` and set the status with `@Res({ passthrough: true })`. That's more cumbersome.

Let me go with the try/catch + HttpException approach. It fits "the controller validates input and calls the service" and "error envelope is raised by the controller."

Next, input validation. The plan says:
- `CreatePayoutDto`: `{ accountId: string; amount: string; destinationAddress: string; idempotencyKey: string }` — `amount` is a decimal string parsed to `bigint` in the controller (no float).

The controller must validate the input. What validation? The plan doesn't specify a class-validator decorator. Hmm. The plan says "controller validates input and calls the service. Zero business logic." Parsing `amount` from string to bigint is in the controller per the plan.

What validation is defensible?
- All four fields must be present and non-empty strings.
- `amount` must be a valid decimal string of a non-negative integer (parse to bigint; reject float/NaN/negative).

Should I use class-validator? The plan's manifest only lists the controller file for this feature; there's no mention of a `validation-pipe` or class-validator in the plan. The plan's DTO is a plain TS interface: `{ accountId: string; amount: string; destinationAddress: string; idempotencyKey: string }`. Since the plan doesn't name class-validator, I shouldn't add it. I'll do manual validation in the controller: check that fields are present, parse amount to bigint with strict regex `/^\d+$/` (decimal string of minor units), reject empty/invalid.

If validation fails, what error? The plan doesn't specify an error code for invalid input. Hmm. The error envelope contract: `code` is snake_case and is the contract. For invalid input, a defensible code would be `invalid_input` or `validation_error`. The plan doesn't name it. The instructions say: "If a symbol you truly need is missing from both the plan and the references, don't guess silently... write the file with the most defensible reading and mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters."

So I'll use `invalid_input` (snake_case) with 400 status, and mark it with an ASSUMPTION comment.

Let me also think about the status mapping:
- `insufficient_funds` → 409 (plan says 409 for duplicate/insufficient)
- `duplicate_payout` → 409
- `resource_not_found` → 404
- other `PayoutError` codes → what status? The plan says "anything other than `PayoutError` → 500 with code 'internal_error'." For a `PayoutError` with an unknown code, the most defensible is probably 500? Or map by code. I'll map known codes and default `PayoutError` to 500 with its own code. Actually wait — the plan says anything other than PayoutError → 500 with `code: "internal_error"`. For a PayoutError with an unrecognized code, keeping its code and using 500 is defensible. Let me do that.

Next, the success response: `Promise<{ payoutId: string }>`. What HTTP status for creation? The plan doesn't specify. `POST /payouts` creates a resource — 201 Created is idiomatic. The plan's signature just says `Promise<{ payoutId: string }>`. Hmm, should I add `@HttpCode(201)`? That's a small defensible addition. But "do not add exports, features, or files the plan doesn't name" — `@HttpCode(201)` is not an export or feature, it's standard REST. The plan says "endpoint: kebab-case, plural" — `payouts` fits. I think 201 is the right call for a create endpoint; it's standard NestJS convention. I'll add `@HttpCode(HttpStatus.CREATED)`.

Hmm, but strictly, the plan says implement exactly what the plan specifies. The plan doesn't mention 201. The default for POST in NestJS is 201 anyway! Actually yes — NestJS's `@Post()` decorator defaults to 201 Created. So I don't even need the decorator; it's implicit. Good, I'll skip `@HttpCode` to keep minimal... actually, being explicit is fine, but the default already gives 201. To avoid adding anything not in the plan, I'll rely on the default. Hmm, but explicit is better for readability. The instruction is "implement exactly what the plan specifies for this file. Do not add exports, features, or files the plan doesn't name." A decorator isn't an export/feature/file. Either is fine. I'll leave it as plain `@Post()` since the default is 201 — minimal.

Wait, actually let me reconsider: should I be explicit? Many reviewers prefer explicitness. But the discipline says do exactly what's asked. The plan's signature block shows:

```ts
@Post()
create(@Body() body: CreatePayoutDto): Promise<{ payoutId: string }>;
```

I'll match that exactly.

Next, the DTO. The plan says `CreatePayoutDto` with those four string fields. I'll define it as an interface (or type) in the controller file. The plan's manifest says "PayoutController: POST /payouts; CreatePayoutDto; error envelope translation" — all in the controller file. So I define `CreatePayoutDto` in this file.

Should it be exported? The plan says "do not add exports... the plan doesn't name." The DTO is named in the plan as part of this file. Exporting it from the controller file — is that "adding an export"? The plan's signature shows `create(@Body() body: CreatePayoutDto)`. For NestJS, the DTO doesn't strictly need to be exported if it's only used in this file. But exporting is conventional so tests/modules can reference it. Hmm. The plan's section 3 shows:

```ts
**`CreatePayoutDto`**: `{ accountId: string; amount: string; destinationAddress: string; idempotencyKey: string }`
```

It's listed as part of the controller file's contents. I'll export it — it's named in the plan, and exporting a named type isn't "adding an export the plan doesn't name." The plan names `CreatePayoutDto`. Exporting makes it usable. I think exporting is the most defensible reading.

Next, parsing amount: `amount` is a decimal string parsed to `bigint` in the controller. Strict parse: must match `/^\d+$/` (non-negative integer, no leading sign, no decimal point, no exponent). Then `BigInt(amount)`. Should I reject zero or negative? Zero payout — the plan doesn't say. Negative can't be represented in this format (no minus sign allowed). Zero: defensible to reject (a payout of 0 minor units is meaningless), but the plan doesn't specify. Hmm. Rejecting zero adds behavior not in the plan. Accepting zero is also fine since the service/repository will handle it (0 <= available, so it would succeed). I'll only validate format (non-negative integer string) and not add a zero check — no wait, let me think. "The controller validates the input" — what's the minimum defensible validation? Presence of all fields as strings, and amount being a valid decimal integer string. I'll stick to that. Actually, should I reject empty strings for the others? Yes — an empty accountId is invalid input. Non-empty string check is basic validation.

Hmm, but be careful: over-validation could break tests? The tests listed in the plan are service/worker level (test/payout.spec.ts tests concurrent creation, duplicate message delivery, retry exhaustion). The plan's test list doesn't include controller tests. So the controller's exact validation behavior is low-risk. I'll keep it simple and defensible.

Next, the error envelope translation. Let me write it:

```ts
private toHttpException(err: PayoutError): HttpException {
  const status =
    err.code === 'insufficient_funds' || err.code === 'duplicate_payout'
      ? HttpStatus.CONFLICT
      : err.code === 'resource_not_found'
        ? HttpStatus.NOT_FOUND
        : HttpStatus.INTERNAL_SERVER_ERROR;

  return new HttpException(
    { error: { code: err.code, message: err.message, details: err.details } },
    status,
  );
}
```

And in `create`:

```ts
@Post()
async create(@Body() body: CreatePayoutDto): Promise<{ payoutId: string }> {
  const input = this.toServiceInput(body); // validates + parses amount
  try {
    return await this.service.createPayout(input);
  } catch (err) {
    if (err instanceof PayoutError) {
      throw this.toHttpException(err);
    }
    throw new HttpException(
      { error: { code: 'internal_error', message: 'Internal server error', details: {} } },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
```

Wait — for non-PayoutError, should I re-throw as a 500 envelope? The plan says: "anything other than `PayoutError` → 500 with `code: "internal_error"`." So yes, translate to the envelope too. Alternatively, I could let NestJS's default exception handler produce a 500 — but that body wouldn't match the envelope. The plan explicitly says the envelope is one contract, so I'll produce it.

Hmm, but there's a subtlety: if I throw an `HttpException` with the envelope body, NestJS will serialize it as-is. Good.

For input validation failure (before calling the service), I'll throw a 400 with the envelope:

```ts
throw new HttpException(
  { error: { code: 'invalid_input', message: ..., details: { field } } },
  HttpStatus.BAD_REQUEST,
);
```

With an ASSUMPTION comment for the `invalid_input` code.

Let me also double-check the `PayoutError` shape from the reference service file:
- `code: string` readonly
- `details: Record<string, unknown>` readonly (defaults to `{}`)
- `message` from Error.

Good — the envelope needs `details` to be an object, never null; `PayoutError.details` is always an object.

Next, validation details. Let me write a private method:

```ts
private parseCreateInput(body: unknown): {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
} {
  ...
}
```

Wait — the signature in the plan is `create(@Body() body: CreatePayoutDto)`. I should keep that signature. The body is typed as `CreatePayoutDto`, but at runtime it could be anything (NestJS without a validation pipe passes whatever JSON came in). So I'll validate at runtime inside the method.

Let me write it:

```ts
@Post()
async create(@Body() body: CreatePayoutDto): Promise<{ payoutId: string }> {
  const input = this.toInput(body);
  try {
    return await this.payoutService.createPayout(input);
  } catch (err) {
    throw this.toHttpException(err);
  }
}
```

And `toHttpException` handles both PayoutError and unknown:

```ts
private toHttpException(err: unknown): HttpException {
  if (err instanceof PayoutError) {
    const status = this.statusForCode(err.code);
    return new HttpException(
      { error: { code: err.code, message: err.message, details: err.details } },
      status,
    );
  }
  return new HttpException(
    { error: { code: 'internal_error', message: 'Unexpected internal error', details: {} } },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
```

Hmm wait, for non-PayoutError, should the message be derived from err? "message is developer-facing English." For internal errors, echoing the raw error message could leak internals; a generic message is safer. The plan doesn't specify. I'll use a generic "Internal server error."

Next, `toInput`:

```ts
private toInput(body: CreatePayoutDto): {
  accountId: string;
  amount: bigint;
  destinationAddress: string;
  idempotencyKey: string;
} {
  const fields: Array<['accountId' | 'destinationAddress' | 'idempotencyKey', unknown]> = [
    ['accountId', body?.accountId],
    ['destinationAddress', body?.destinationAddress],
    ['idempotencyKey', body?.idempotencyKey],
  ];
  for (const [name, value] of fields) {
    if (typeof value !== 'string' || value.length === 0) {
      throw this.invalidInput(`Field "${name}" must be a non-empty string`, name);
    }
  }
  if (typeof body.amount !== 'string' || !/^\d+$/.test(body.amount)) {
    throw this.invalidInput('Field "amount" must be a decimal string of minor units', 'amount');
  }
  return {
    accountId: body.accountId,
    amount: BigInt(body.amount),
    destinationAddress: body.destinationAddress,
    idempotencyKey: body.idempotencyKey,
  };
}
```

Hmm, `body?.accountId` — body is typed as `CreatePayoutDto`, so `body?.` would trigger a TS warning? No, optional chaining on a non-nullable type is allowed (no error, maybe lint). Actually in strict mode, `body?.accountId` when body is `CreatePayoutDto` (non-nullable) — TypeScript allows optional chaining on non-nullable types without error. But it's cleaner to handle `body` being undefined/null at runtime: `if (!body || typeof body !== 'object')`. Let me do that.

Actually, let me simplify. I'll write:

```ts
private toInput(body: CreatePayoutDto): PayoutServiceInput {
  if (typeof body !== 'object' || body === null) {
    throw this.invalidInput('Request body must be a JSON object', 'body');
  }
  ...
}
```

Wait, but the parameter is typed `CreatePayoutDto`; doing a runtime check against that type is fine (TS won't complain about `typeof body !== 'object'` since CreatePayoutDto is an object type — actually TS might narrow it... `typeof body !== 'object'` when body: CreatePayoutDto — the comparison is allowed, and in the true branch TS narrows to `never`. That's fine, no error. Hmm, actually would TS complain "This comparison appears to be unintentional because the types have no overlap"? For `typeof body !== 'object'` where body is an object type — typeof checks are always allowed against any type. `typeof x === 'string'` where x: number gives the "no overlap" error, but `typeof x !== 'object'` where x is an object type... let me think. TS rule: the "This condition will always return 'true' since the types have no overlap" error applies to === comparisons between non-overlapping types. For typeof guards, `typeof body !== 'object'` where body is an object type — I believe TS allows this without error since typeof narrowing is a special case. Hmm, actually I recall that `typeof x === 'string'` when x is a known object type does produce error TS2367. To be safe, I'll type the check differently.

Alternative: accept `body` as typed `CreatePayoutDto` but cast internally: `const raw = body as unknown;` then check. That's safe and compiles cleanly.

Actually, simpler: since NestJS without a validation pipe passes the raw parsed JSON, the runtime shape could be anything. I'll do:

```ts
const raw: unknown = body;
if (typeof raw !== 'object' || raw === null) { throw ... }
const candidate = raw as Record<string, unknown>;
```

That's clean and compiles.

Now — is this over-engineering? The plan says the controller validates input. Minimal validation: presence/type of 4 fields + amount parseability. I think the above is reasonable and not excessive.

Let me reconsider whether to reject `amount` = "0". The plan is silent. I'll allow it (format-only validation). Hmm, actually... a zero-amount payout would create a payout and reserve 0. That's harmless. I'll leave it allowed.

What about very large amounts exceeding bigint? `BigInt("99999999999999999999")` is fine (bigint is arbitrary precision). The DB column is BIGINT (64-bit); overflow would fail at the DB level. Out of scope for the controller.

Next, imports:
- `Controller`, `Post`, `Body` from `@nestjs/common`
- `HttpException`, `HttpStatus` from `@nestjs/common`
- `PayoutService`, `PayoutError` from `./payout.service`

The plan's signature: `constructor(service: PayoutService)`. I'll name it `private readonly service: PayoutService` — hmm, the plan shows `constructor(service: PayoutService)`. I'll use a private readonly parameter property. That matches the plan's intent.

Now, one question: should the controller use `@Injectable()`? Controllers in NestJS don't strictly need `@Injectable()` (the `@Controller` decorator makes it instantiable by the DI framework). The plan's signature block doesn't show `@Injectable()` on the controller. I'll omit it to match the plan exactly.

Let me also double-check the envelope: `{ "error": { "code", "message", "details" } }` — details is an object, never null. `PayoutError.details` is `Record<string, unknown>` defaulting to `{}`. Good.

For invalid input, details: I'll include the offending field name, e.g. `{ field: 'amount' }`. That's an object, good.

Now let me also think about: should `create` catch errors thrown by `toInput`? No — `toInput` throws HttpException directly, which propagates. That's fine.

One more consideration: the plan says "409 for duplicate/insufficient, 404 for not found." Note: `createPayout` only throws `InsufficientFundsError` or `DuplicatePayoutError` (per the service signature). `PayoutNotFoundError` exists in the service for completeness (maybe for a future GET endpoint), but the plan only names POST /payouts. Still, my `statusForCode` handles it generically.

Let me write the status mapping:

```ts
private statusForCode(code: string): HttpStatus {
  switch (code) {
    case 'insufficient_funds':
    case 'duplicate_payout':
      return HttpStatus.CONFLICT;
    case 'resource_not_found':
      return HttpStatus.NOT_FOUND;
    default:
      return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}
```

Good.

Now the full file:

```ts
import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
import { PayoutError, PayoutService } from './payout.service';

export interface CreatePayoutDto {
  accountId: string;
  amount: string;
  destinationAddress: string;
  idempotencyKey: string;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  async create(@Body() body: CreatePayoutDto): Promise<{ payoutId: string }> {
    const input = this.toInput(body);

    try {
      return await this.service.createPayout(input);
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  private toInput(body: CreatePayoutDto): {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  } {
    const raw: unknown = body;
    if (typeof raw !== 'object' || raw === null) {
      throw this.invalidInput('Request body must be a JSON object', 'body');
    }

    const candidate = raw as Record<string, unknown>;

    for (const field of ['accountId', 'destinationAddress', 'idempotencyKey'] as const) {
      if (typeof candidate[field] !== 'string' || candidate[field].length === 0) {
        throw this.invalidInput(`Field "${field}" must be a non-empty string`, field);
      }
    }

    if (typeof candidate.amount !== 'string' || !/^\d+$/.test(candidate.amount)) {
      throw this.invalidInput(
        'Field "amount" must be a decimal string of whole minor units',
        'amount',
      );
    }

    return {
      accountId: candidate.accountId as string,
      amount: BigInt(candidate.amount as string),
      destinationAddress: candidate.destinationAddress as string,
      idempotencyKey: candidate.idempotencyKey as string,
    };
  }

  private invalidInput(message: string, field: string): HttpException {
    // ASSUMPTION: the plan does not name an error code for invalid request input; "invalid_input" is the most defensible snake_case choice.
    return new HttpException(
      { error: { code: 'invalid_input', message, details: { field } } },
      HttpStatus.BAD_REQUEST,
    );
  }

  private toHttpException(err: unknown): HttpException {
    if (err instanceof PayoutError) {
      return new HttpException(
        { error: { code: err.code, message: err.message, details: err.details } },
        this.statusForCode(err.code),
      );
    }

    return new HttpException(
      { error: { code: 'internal_error', message: 'Internal server error', details: {} } },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private statusForCode(code: string): HttpStatus {
    switch (code) {
      case 'insufficient_funds':
      case 'duplicate_payout':
        return HttpStatus.CONFLICT;
      case 'resource_not_found':
        return HttpStatus.NOT_FOUND;
      default:
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }
  }
}
```

Wait — one issue: `candidate[field]` with field from `as const` array — TS will type `candidate[field]` as `unknown`. Fine.

`BigInt(candidate.amount as string)` — after the regex check, it's safe.

Let me double-check TS strictness: `for (const field of ['accountId', 'destinationAddress', 'idempotencyKey'] as const)` — fine.

`details: { field }` — an object, good.

Now, is there any concern about the ASSUMPTION comment placement? The instructions say: "mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters." I have exactly one ASSUMPTION comment, at the `invalidInput` method where the code is used. Good.

Hmm wait, let me reconsider whether input validation with a 400 is even in scope. The plan says the controller "validates input" (from the layering convention: "the controller validates input and calls the service. Zero business logic."). And the plan says `amount` is parsed to bigint in the controller. Parsing implies validation of the parse (a bad string must be rejected somehow — you can't produce a bigint from garbage). So yes, input validation belongs here, and a 400 with the envelope is the only consistent way to report it. The code name is the only unresolved part → one ASSUMPTION comment.

Should I also consider: what if `body.amount` is a number in the JSON (e.g. `{"amount": 100}`)? My check requires a string → 400. That's defensible: the plan explicitly types `amount` as a string in the DTO ("amount is a decimal string"). Good — this also enforces "no float for money."

Let me reconsider the success status code. NestJS `@Post()` defaults to 201. The plan doesn't mention it; I'll leave the default.

One more check — imports from `@nestjs/common`: `Body`, `Controller`, `HttpException`, `HttpStatus`, `Post`. All exist.

Importing `PayoutError` from `./payout.service` — the reference file exports it. Good. `PayoutService` is also exported. Good.

Do I need to import `MessageRow` or anything from the repository? No — the controller only talks to the service.

Let me also verify I'm not adding anything the plan doesn't name:
- `CreatePayoutDto` — named. ✓
- `PayoutController` with `create` — named. ✓
- Error envelope translation — named. ✓
- Private helper methods — implementation detail, fine.

I think the file is complete and correct. Let me also make sure the first line is an import (no leading comment) and it's complete from first to last line.

One more stylistic point: the plan shows `constructor(service: PayoutService);` — I'll use `private readonly service: PayoutService`. That's the standard NestJS parameter property and matches how the reference service uses `private readonly repo`. Good.

Also, should `create` be explicitly async? Yes, since it awaits. The plan's signature shows a return type `Promise<{ payoutId: string }>`; an async method satisfies that.

Final check on the regex `/^\d+$/` — in JS, `\d` is ASCII digits only (without the `u` flag... actually even with the `u` flag, `\d` is [0-9]). It matches "0", "123", rejects "", "1.5", "-1", "1e3", " 12". Good.

I'm confident in this file. Let me write it out.
```

## reply

```ts
import { Body, Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
import { PayoutError, PayoutService } from './payout.service';

export interface CreatePayoutDto {
  accountId: string;
  amount: string;
  destinationAddress: string;
  idempotencyKey: string;
}

@Controller('payouts')
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post()
  async create(@Body() body: CreatePayoutDto): Promise<{ payoutId: string }> {
    const input = this.toInput(body);

    try {
      return await this.service.createPayout(input);
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  private toInput(body: CreatePayoutDto): {
    accountId: string;
    amount: bigint;
    destinationAddress: string;
    idempotencyKey: string;
  } {
    const raw: unknown = body;
    if (typeof raw !== 'object' || raw === null) {
      throw this.invalidInput('Request body must be a JSON object', 'body');
    }

    const candidate = raw as Record<string, unknown>;

    for (const field of ['accountId', 'destinationAddress', 'idempotencyKey'] as const) {
      if (typeof candidate[field] !== 'string' || candidate[field].length === 0) {
        throw this.invalidInput(`Field "${field}" must be a non-empty string`, field);
      }
    }

    if (typeof candidate.amount !== 'string' || !/^\d+$/.test(candidate.amount)) {
      throw this.invalidInput(
        'Field "amount" must be a decimal string of whole minor units',
        'amount',
      );
    }

    return {
      accountId: candidate.accountId as string,
      amount: BigInt(candidate.amount as string),
      destinationAddress: candidate.destinationAddress as string,
      idempotencyKey: candidate.idempotencyKey as string,
    };
  }

  private invalidInput(message: string, field: string): HttpException {
    // ASSUMPTION: the plan does not name an error code for invalid request input; "invalid_input" is the most defensible snake_case choice.
    return new HttpException(
      { error: { code: 'invalid_input', message, details: { field } } },
      HttpStatus.BAD_REQUEST,
    );
  }

  private toHttpException(err: unknown): HttpException {
    if (err instanceof PayoutError) {
      return new HttpException(
        { error: { code: err.code, message: err.message, details: err.details } },
        this.statusForCode(err.code),
      );
    }

    return new HttpException(
      { error: { code: 'internal_error', message: 'Internal server error', details: {} } },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private statusForCode(code: string): HttpStatus {
    switch (code) {
      case 'insufficient_funds':
      case 'duplicate_payout':
        return HttpStatus.CONFLICT;
      case 'resource_not_found':
        return HttpStatus.NOT_FOUND;
      default:
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }
  }
}
```
