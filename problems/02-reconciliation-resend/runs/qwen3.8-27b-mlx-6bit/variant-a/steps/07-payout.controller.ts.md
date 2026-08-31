# 07-payout.controller.ts

## reasoning

```
The task is to write `src/payout/payout.controller.ts` based on the plan.

From the plan:

```ts
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post("execute-payments")
  executePayments(): Promise<PayoutResult[]>;

  @Post("reconcile")
  reconcile(@Body() body: { from: string; to: string }): Promise<ReconcileResult>;
}
```

The plan says:
- File layout: feature goes under `src/payout/`; files are `payout.module.ts`, `payout.controller.ts`, `payout.service.ts`, `payout.repository.ts`, `payout.types.ts`, `bank-client.ts`.
- Endpoints: `POST /execute-payments` and `POST /reconcile`; window is a query/body parameter `{ from: ISO, to: ISO }`.
- Error handling: `InsufficientAttemptsError` maps to `{ code: "insufficient_attempts" }`, `BankClientError` maps to `{ code: "bank_client_error" }`, other unexpected errors propagate as 500 with `{ code: "internal_error" }`.

Wait — the plan says "the controller maps to `{ code: 'insufficient_attempts' }`" and "the controller maps to `{ code: 'bank_client_error' }`", and "any other unexpected error propagates as 500 with `{ code: 'internal_error' }`".

Hmm, but the reference `payout.service.ts` shows that the service catches bank.send errors internally (classifying as transient_error) — so `BankClientError` is never actually thrown from the service in this implementation. But the plan says the controller maps it. Let me think about what's most defensible.

The plan's section 3 controller signature:

```ts
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post("execute-payments")
  executePayments(): Promise<PayoutResult[]>;

  @Post("reconcile")
  @Body() body: { from: string; to: string }): Promise<ReconcileResult>;
}
```

And the plan's error section: "If it surfaces, the controller maps to `{ code: 'insufficient_attempts' }`." and "The controller maps to `{ code: 'bank_client_error' }`." and "Any other unexpected error propagates as 500 with `{ code: 'internal_error' }`."

So the controller should handle errors and return a JSON error envelope. The repo's convention (from the system prompt) states:

## Errors — single envelope
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```
`code` is `snake_case` and is the contract. `message` is developer-facing English. `details` is an object, never null.

So the error envelope should be `{ error: { code, message, details } }`.

The controller should validate input and call the service. Zero business logic.

For `reconcile`, the body is `{ from: string; to: string }` (ISO strings). The controller needs to convert these to `Date` objects for the `ReconcileWindow`. This is input validation/conversion, which is a controller responsibility.

Let me think about what the controller does:

1. `POST /execute-payments` — call `service.executePayments()` and return results.
2. `POST /reconcile` — receive body `{ from: string; to: string }`, validate that they are parseable ISO dates, convert to `Date`, call `service.reconcile({ from, to })`, return result.

Error handling: the plan says the controller maps errors. But how? In NestJS, you can use exception filters or try/catch inside the controller. The plan says "the controller maps to ...", so I'll implement try/catch in the controller methods that returns an error envelope with appropriate HTTP status.

Wait, but the layering rules say: "the controller validates input and calls the service. Zero business logic." Error mapping to an envelope is definitely part of the controller's job given the plan explicitly says "the controller maps".

Let me think about the HTTP status codes:
- `insufficient_attempts` → probably 409 or 422? The plan doesn't specify. Hmm.
- `bank_client_error` → probably 502 (bad gateway) or 500?
- `internal_error` → 500 (explicitly stated).

The plan only specifies 500 for internal_error. For the others, I need a defensible choice. Let me think:
- `insufficient_attempts`: this is an internal guard error that "should never surface to the caller". If it does, it's a bug — 500 seems appropriate. Actually wait, the plan says "If it surfaces, the controller maps to `{ code: 'insufficient_attempts' }`." It doesn't specify status. Since it's an internal invariant violation, 500 is defensible.
- `bank_client_error`: the bank failed — this is an upstream failure, 502 Bad Gateway is defensible. But the plan doesn't specify. Hmm.

Actually, let me reconsider. The plan is my spec and it governs. It says:
- "If it surfaces, the controller maps to `{ code: 'insufficient_attempts' }`."
- "The controller maps to `{ code: 'bank_client_error' }`."
- "Any other unexpected error propagates as 500 with `{ code: 'internal_error' }`."

Only internal_error has an explicit status (500). For the others, I'll make a defensible choice. Since `insufficient_attempts` is an internal invariant bug, 500 makes sense. For `bank_client_error`, it's a bank failure — 502 is the semantically correct status for upstream failures, but since the plan groups these as error envelope mappings without specifying status, maybe I should keep it simple and use 500 for all? Hmm.

Actually, let me reconsider whether the controller should catch errors at all in the first place. Looking at the reference service implementation: `bank.send` throws are caught inside `executePayments` and classified as transient_error. So `BankClientError` is never thrown. `InsufficientAttemptsError` is also never thrown (the guard prevents it). So in practice, the only errors that could surface are unexpected ones → 500 internal_error.

But the plan explicitly says the controller maps these errors. So I should implement the mapping as specified, even if they rarely surface. This is defensive per the plan.

Let me design the controller:

```ts
import { Body, Controller, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { PayoutService } from "./payout.service";
import type { PayoutResult, ReconcileResult } from "./payout.types";
import { InsufficientAttemptsError, BankClientError } from "./payout.types";

@Controller()
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post("execute-payments")
  async executePayments(): Promise<PayoutResult[]> {
    try {
      return await this.service.executePayments();
    } catch (err) {
      return this.handleError(err);
    }
  }

  @Post("reconcile")
  async reconcile(@Body() body: { from: string; to: string }): Promise<ReconcileResult> {
    const from = new Date(body.from);
    const to = new Date(body.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException(...);
    }
    try {
      return await this.service.reconcile({ from, to });
    } catch (err) {
      return this.handleError(err);
    }
  }
}
```

Hmm, but if I catch and return the error envelope as a normal response, the HTTP status will be 200 unless I set it. The plan says internal_error "propagates as 500". So I need to control the status code. Options:

1. Use `@Res()` with express Response to set status manually.
2. Throw HttpException subclasses with the envelope as payload.

Option 2 is more NestJS-idiomatic: throw a `HttpException` with the envelope payload. But then Nest's default exception filter formats it... actually, if you throw `new HttpException(payload, status)`, Nest sends the payload as-is as the response body. So:

```ts
throw new HttpException({ error: { code: "internal_error", message: "...", details: {} } }, 500);
```

This would produce the exact envelope. This is clean and NestJS-idiomatic.

But wait — the layering rule says "the controller validates input and calls the service. Zero business logic." Error envelope mapping is specified by the plan as a controller responsibility, so it's fine.

Alternatively, I could use `@Res()` to have full control. Let me think about which is more defensible given the plan.

The plan's manifest for the controller: "PayoutController with POST execute-payments and POST reconcile". The plan's controller signature shows plain methods returning promises. The error section says the controller maps errors to envelope codes and internal_error propagates as 500.

I think using HttpException with the envelope payload is the cleanest NestJS approach that satisfies "500 with { code: internal_error }".

But there's a subtlety: NestJS has a default exception filter that formats unhandled exceptions. If I throw my own HttpException with the envelope, it passes through as-is. Good.

For input validation (bad dates in reconcile body), what error code? The repo convention shows `resource_not_found` as an example. For bad input, something like `invalid_request` or `validation_error`. The plan doesn't specify. Hmm.

Wait, let me re-read the plan's error section:

"### Errors
- `InsufficientAttemptsError` — raised internally if a bug tries to send a 6th time; should never surface to the caller because `executePayments` checks the cap before calling `bank.send`. If it surfaces, the controller maps to `{ code: "insufficient_attempts" }`.
- `BankClientError` — raised when `bank.send` throws a non-classifiable exception (a network error not modeled by the bank's own classification). The order stays in `sent` (or `pending` if there was no prior send) and the attempt is counted as a transient error. The controller maps to `{ code: "bank_client_error" }`.
- Any other unexpected error propagates as 500 with `{ code: "internal_error" }`."

So the plan defines exactly three error mappings. It doesn't define an input validation error for bad dates. But the controller "validates input" per the layering rule. What should happen with a malformed date?

Options:
1. Let `new Date(invalidString)` produce Invalid Date, pass it to the service, and the service... does what with an Invalid Date? `findOrdersByEffectiveDateRange(window.from, window.to)` would pass NaN timestamps to Prisma, which would throw → 500 internal_error. That's ugly but "defensible"?
2. Validate in the controller and return 400 with an envelope code like `invalid_window` or `validation_error`.

The plan says the controller validates input. So I should validate. But which code? The plan doesn't name one. This is a case where "a symbol you need is genuinely missing from both the plan and the reference" — I should write it using the most defensible reading and mark it with an `// ASSUMPTION:` comment.

Hmm, wait. Let me reconsider. Maybe I'm overcomplicating. Let me re-read the task instructions:

"Implement exactly what the plan specifies for this file. Do not add exports, features, or files that the plan doesn't name."

The plan specifies for this file:
- PayoutController class
- constructor(private readonly service: PayoutService)
- @Post("execute-payments") executePayments(): Promise<PayoutResult[]>
- @Post("reconcile") reconcile(@Body() body: { from: string; to: string }): Promise<ReconcileResult>

And from the plan's global sections that govern this file:
- Endpoints kebab-case plural? Wait, the repo convention says "Endpoints: kebab-case, plural." But the plan explicitly names `POST /execute-payments` and `POST /reconcile`. Hmm, "reconcile" is singular. The plan governs: "PLAN.md above is your own spec and governs." So I use `/execute-payments` and `/reconcile` as the plan says. Actually wait, does the route need a prefix? The controller is `@Controller()` with no prefix — the plan shows `@Post("execute-payments")` and `@Post("reconcile")`. So the routes are `/execute-payments` and `/reconcile`. Good.

- Error mapping as in the plan's error section.

Now, about validation of the reconcile body: the plan says window is "a query/body parameter `{ from: ISO, to: ISO }`". The plan's controller signature takes `@Body() body: { from: string; to: string }`. The plan doesn't explicitly describe validation logic for this file. But the layering rule (always holds) says the controller validates input.

I think minimal validation is defensible: check that `body` has `from` and `to` as strings that parse to valid dates. If not, return a 400 with an envelope. Since the plan doesn't name a code for this, I'll use an ASSUMPTION comment.

Actually, hold on. Let me reconsider whether to include validation at all. The instruction says "Implement exactly what the plan specifies for this file." The plan's spec for this file is the signature plus (from governing sections) the error mapping. Adding validation with an invented error code might be "adding a feature the plan doesn't name". But the always-holding layering rule says the controller validates input. There's tension.

The most defensible reading: include light validation (parse dates, reject invalid with 400 envelope) because the controller must convert ISO strings to Dates anyway (the service takes `ReconcileWindow` with `Date` fields), and rejecting unparseable input is part of that conversion, not an extra feature. I'll mark the error code choice with an ASSUMPTION comment.

Hmm, actually wait. Let me reconsider the conversion. The service's `reconcile(window: ReconcileWindow)` takes `{ from: Date; to: Date }`. The controller receives ISO strings. So the controller must convert. This is input handling — definitely a controller job.

Now, about the error envelope format. The repo convention:
```json
{ "error": { "code": "...", "message": "...", "details": {} } }
```
`details` is an object, never null.

So my error responses should be shaped exactly like this.

Let me now decide the implementation approach for returning errors with specific status codes in NestJS:

Approach A: throw HttpException with envelope payload.
```ts
private fail(status: number, code: string, message: string): never {
  throw new HttpException(
    { error: { code, message, details: {} } },
    status,
  );
}
```
Then in catch blocks:
```ts
catch (err) {
  if (err instanceof InsufficientAttemptsError) this.fail(500, "insufficient_attempts", err.message);
  if (err instanceof BankClientError) this.fail(502, "bank_client_error", err.message);
  this.fail(500, "internal_error", ...);
}
```

Wait, but for internal_error the plan says "propagates as 500". If I catch everything and rethrow as HttpException, nothing "propagates" — but the observable behavior is the same: 500 with the envelope. I think that's fine and actually better (guarantees the envelope shape).

Hmm, but should unexpected errors really be caught and reshaped? The plan says they "propagate as 500 with { code: internal_error }". In NestJS, unhandled errors go through the default exception filter, which produces `{ statusCode: 500, message: "Internal server error" }` — not our envelope. So to guarantee the envelope, I should catch and reshape. The observable contract (500 + envelope) is what matters.

Actually, let me reconsider: maybe I should use an exception filter? No — the plan doesn't name a filter file, and "do not add exports, features, or files that the plan doesn't name". So no filter. Controller-level try/catch it is.

Approach B: use @Res() and set status/body manually. This bypasses Nest's pipeline entirely. More code, less idiomatic. I'll go with Approach A.

Now, status codes:
- `insufficient_attempts`: plan says it "should never surface" — it's an internal invariant violation. 500 is defensible.
- `bank_client_error`: upstream bank failure. 502 Bad Gateway is the semantically correct choice. But is that "adding" something? The plan doesn't specify a status for this one. Hmm.

Let me think about what's most defensible. The plan explicitly gives 500 only for internal_error. For the other two, I have to pick. Options:
- Both 500: simplest, treats all as "something went wrong server-side".
- insufficient_attempts 500, bank_client_error 502: semantically precise.

I think 502 for bank_client_error is the most defensible reading (it's an upstream service failure, and "bad gateway" is exactly that). And 500 for insufficient_attempts (internal bug). I'll add ASSUMPTION comments where the plan is silent on status.

Hmm, wait. Actually, let me reconsider once more. The reference service implementation catches bank.send errors internally and never throws BankClientError. And the cap guard means InsufficientAttemptsError is never thrown either. So these mappings are purely defensive. Given that, the exact status code barely matters in practice, but I should still make a defensible choice and mark it.

Actually, you know what — let me simplify. Since the plan is silent on status for these two, and since they represent internal/upstream failures that the client can't fix by retrying the same request differently, I could just use 500 for all three. That's the most conservative reading: the plan only ever mentions "500" as a status, so using 500 everywhere doesn't invent new behavior. Hmm, but 502 is more correct for bank_client_error...

Let me weigh: "write the file using the most defensible reading and mark it with one `// ASSUMPTION:` comment where it matters".

I'll go with:
- insufficient_attempts → 500 (internal invariant violation; the plan's own framing is "if a bug...")
- bank_client_error → 502 (upstream bank failure)

And mark both with ASSUMPTION comments since the plan doesn't specify statuses. Actually, the instruction says "mark it with one `// ASSUMPTION:` comment where it matters" — I can have a couple if there are a couple of unresolved points, each at the point it matters. Let me keep comments minimal and precise.

Hmm, wait. Let me reconsider whether I even need to handle these two error classes in the controller. The plan says:
- "If it surfaces, the controller maps to `{ code: 'insufficient_attempts' }`."
- "The controller maps to `{ code: 'bank_client_error' }`."

Yes, the plan explicitly assigns this mapping to the controller. So I must include it.

Now for input validation on reconcile: what code? Let me think about what's most defensible. Common choices: `invalid_request`, `validation_error`, `bad_request`. The repo convention example uses `resource_not_found` — descriptive snake_case. For a malformed window, `invalid_window` is specific and descriptive. Or `validation_error`.

Hmm, I need to pick one and mark it as an assumption. Let me go with `invalid_window` — it's specific to this endpoint's input and follows the descriptive snake_case pattern. Actually, `validation_error` is more generic and commonly used... but the convention example (`resource_not_found`) suggests specific, resource/action-oriented codes. `invalid_window` fits that style better. I'll use `invalid_window` with an ASSUMPTION comment.

Wait, actually — should I validate at all? Let me re-read: "the controller validates input and calls the service. Zero business logic." This is an always-holding convention. So yes, validation belongs in the controller. The minimal validation here: `from` and `to` must be present, strings, parseable as dates. And maybe `from <= to`? That might be business logic... no, it's input validity. Hmm, but the plan doesn't mention it. Let me keep it minimal: presence + parseability. Actually, `from > to` would just yield an empty result from the repository query — not harmful. I'll skip the ordering check to avoid adding unspecified behavior. Just parseability.

Hmm, actually, let me reconsider even presence/parseability. If `body` is undefined (no body sent), `body.from` throws TypeError → caught by my catch → 500 internal_error. That's bad; a missing body should be 400. So validating presence is important for correct behavior. OK, I'll validate: body must be an object with `from` and `to` as parseable date strings.

Let me also consider: should executePayments take any input? The plan shows `executePayments(): Promise<PayoutResult[]>` — no body. Good.

Now, the return types. The controller methods should return `Promise<PayoutResult[]>` and `Promise<ReconcileResult>` per the plan. But if I catch errors and rethrow as HttpException, the return type stays the same (the throw is `never`). Good.

Wait, one more consideration: if I use try/catch and rethrow HttpException, the method signature can stay `Promise<PayoutResult[]>`. TypeScript is fine with that since the catch path never returns.

Let me also double-check imports needed:
- `@nestjs/common`: `Controller`, `Post`, `Body`, `HttpException` (and maybe `Injectable`? No — controllers don't need @Injectable in Nest; @Controller is enough. Actually, by convention, controllers are just decorated with @Controller.)
- `./payout.service`: `PayoutService`
- `./payout.types`: `PayoutResult`, `ReconcileResult`, `InsufficientAttemptsError`, `BankClientError`
- `./bank-client`: `SendClassification`? Not needed in the controller.

Do I need express types? Only if using @Res(). I'm not, so no.

Now let me think about the `reconcile` conversion: `new Date(body.from)`. For an ISO string like "2025-01-01T00:00:00Z", this works. `Number.isNaN(from.getTime())` checks validity.

Let me draft the file:

```ts
import { Body, Controller, HttpException, Post } from "@nestjs/common";
import { PayoutService } from "./payout.service";
import type { PayoutResult, ReconcileResult } from "./payout.types";
import { BankClientError, InsufficientAttemptsError } from "./payout.types";

@Controller()
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post("execute-payments")
  async executePayments(): Promise<PayoutResult[]> {
    try {
      return await this.service.executePayments();
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  @Post("reconcile")
  async reconcile(@Body() body: { from: string; to: string }): Promise<ReconcileResult> {
    const window = this.parseWindow(body);
    try {
      return await this.service.reconcile(window);
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  private parseWindow(body: unknown): { from: Date; to: Date } {
    if (typeof body !== "object" || body === null) {
      throw this.toHttpException(new InvalidWindowError("Request body must be an object with ISO date strings `from` and `to`"));
    }
    ...
  }
}
```

Hmm, this is getting complicated. Let me simplify: I'll write a small private helper `fail(status, code, message)` that throws an HttpException with the envelope, and a `toHttpException(err)` that maps known error classes.

Actually, for the validation error, I can just call `this.fail(400, "invalid_window", "...")` directly.

Let me restructure:

```ts
import { Body, Controller, HttpException, Post } from "@nestjs/common";
import { PayoutService } from "./payout.service";
import type { PayoutResult, ReconcileResult } from "./payout.types";
import { BankClientError, InsufficientAttemptsError } from "./payout.types";

@Controller()
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post("execute-payments")
  async executePayments(): Promise<PayoutResult[]> {
    try {
      return await this.service.executePayments();
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  @Post("reconcile")
  async reconcile(@Body() body: unknown): Promise<ReconcileResult> {
    const window = this.parseWindow(body);
    try {
      return await this.service.reconcile(window);
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  private parseWindow(body: unknown): { from: Date; to: Date } {
    if (typeof body !== "object" || body === null) {
      this.fail(400, "invalid_window", "Body must be an object with ISO date strings `from` and `to`.");
    }
    const { from, to } = body as { from?: unknown; to?: unknown };
    const fromDate = typeof from === "string" ? new Date(from) : new Date(NaN);
    const toDate = typeof to === "string" ? new Date(to) : new Date(NaN);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      this.fail(400, "invalid_window", "`from` and `to` must be ISO 8601 date strings.");
    }
    return { from: fromDate, to: toDate };
  }

  private toHttpException(err: unknown): HttpException {
    if (err instanceof InsufficientAttemptsError) {
      // ASSUMPTION: ...
      return this.build(500, "insufficient_attempts", err.message);
    }
    if (err instanceof BankClientError) {
      return this.build(502, "bank_client_error", err.message);
    }
    const message = err instanceof Error ? err.message : "Unexpected error";
    return this.build(500, "internal_error", message);
  }

  private build(status: number, code: string, message: string): HttpException {
    return new HttpException({ error: { code, message, details: {} } }, status);
  }

  private fail(status: number, code: string, message: string): never {
    throw this.build(status, code, message);
  }
}
```

Wait — the plan's signature is `reconcile(@Body() body: { from: string; to: string })`. If I change the parameter type to `unknown`, am I deviating from the plan? The plan shows the signature as documentation. Using `unknown` and validating is stricter but... the instruction says "Implement exactly what the plan specifies". Hmm. The plan's signature is `{ from: string; to: string }`. TypeScript types are erased at runtime; the actual runtime value could be anything. But to "exactly" match the plan, maybe I should keep `body: { from: string; to: string }` and still validate at runtime (since TS types don't guarantee runtime shape).

Actually, keeping the declared type as per the plan and doing runtime validation inside is both faithful to the plan's signature and robust. Let me do that:

```ts
@Post("reconcile")
async reconcile(@Body() body: { from: string; to: string }): Promise<ReconcileResult> {
  const window = this.parseWindow(body);
  ...
}

private parseWindow(body: { from: string; to: string }): { from: Date; to: Date } {
  const from = new Date(body?.from);
  const to = new Date(body?.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    this.fail(400, "invalid_window", "`from` and `to` must be ISO 8601 date strings.");
  }
  return { from, to };
}
```

Hmm, but if `body` is undefined (no body), `body?.from` is undefined, `new Date(undefined)` is Invalid Date → 400. Good. If `body.from` is a number, `new Date(123)` might be valid... edge case, whatever. Actually `new Date(undefined as any)` → Invalid Date. `new Date(null)` → 1970. Hmm, if someone sends `{"from": null, "to": "..."}`, `new Date(null)` = 1970-01-01, which is "valid". That's a bit wrong but an extreme edge case. To be safe I could check `typeof body.from === "string"`. Let me add that:

```ts
private parseWindow(body: { from: string; to: string }): { from: Date; to: Date } {
  const fromRaw = body?.from;
  const toRaw = body?.to;
  if (typeof fromRaw !== "string" || typeof toRaw !== "string") {
    this.fail(400, "invalid_window", "Body must be `{ from: ISO date string, to: ISO date string }`.");
  }
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    this.fail(400, "invalid_window", "`from` and `to` must be valid ISO 8601 date strings.");
  }
  return { from, to };
}
```

This is clean. But wait — is this "adding a feature the plan doesn't name"? The plan says the controller takes `{ from: string; to: string }` and the service takes Dates. The conversion is required. Validation of that conversion input is standard controller duty per the always-holding convention. I'll keep it but mark the error code as an assumption since the plan doesn't name one.

Now, `fail` returning `never`: in TS, a method that always throws can be typed `: never`. That's clean and makes the flow analysis work (after `this.fail(...)`, TS knows it doesn't continue).

Actually, in `parseWindow`, after `this.fail(...)` in the first if, TS narrows... no wait, `fail` returns `never`, so after the call, the code is unreachable — TS understands this. So `fromRaw` is still `string | undefined` type-wise? No — since `body?.from` where body is typed `{from: string, to: string}`, `body?.from` is `string | undefined`. After the typeof check that fails → never, in the remaining path `fromRaw` is `string`. TS handles this via control flow: if the condition `typeof fromRaw !== "string"` is true, we call fail (never), so after the if-block, fromRaw is string. Yes, TS narrows correctly with never-returning calls... actually, does it? The narrowing after an if-block where the then-branch ends in `never`: yes, TypeScript eliminates that path. The remaining type of fromRaw is `string`.

Hmm wait, actually there's a subtlety: `body` is typed as `{ from: string; to: string }`, so `body?.from` — the `?.` is only needed if body could be undefined, but the type says it can't. TS might warn about unnecessary optional chaining? No, it won't warn; it's allowed. But `body?.from` on a non-nullable type is fine (no error, maybe lint). Since the declared type says body is always defined but at runtime it might not be (Nest passes undefined if no body... actually, Nest with @Body() and no body: for POST with no body, body is `{}` or undefined depending on content-type). To be safe at runtime, `body?.from` is good. But TS: `body` is `{from: string; to: string}` (non-nullable), so `body?.from` is just `string` — the optional chain is a no-op type-wise, and `typeof fromRaw !== "string"` on a `string` type is... TS might flag this as an unnecessary condition? No, TS doesn't error on that; it's allowed (no strict rule against it). Fine.

Actually, hmm, `typeof fromRaw !== "string"` where fromRaw: string — TypeScript allows this comparison; it doesn't error. OK.

Alternatively, I could type the parameter as `body: { from: string; to: string } | undefined`? That deviates from the plan's signature. Let me keep the plan's signature and use `body?.` defensively. Hmm, but actually if body is undefined and I do `body?.from`, that's fine at runtime.

Wait, actually there might be a TS issue: with `strict` mode and the parameter typed as non-nullable, `body?.from` is fine. And `typeof body?.from !== "string"` — fine. OK.

Now, one more thing to double-check: the plan's controller has no route prefix. `@Controller()` — routes will be `/execute-payments` and `/reconcile`. The plan says "exposed as `POST /reconcile` endpoint and `executePayments` as `POST /execute-payments`". Yes, no prefix. Good.

Now about `@nestjs/common` imports: `Controller`, `Post`, `Body`, `HttpException`. All exist.

Let me also reconsider: should the error envelope's `message` be developer-facing English? Yes, per convention. For internal_error, I'll use the error's message or a generic "Unexpected error". The convention says message is developer-facing — using err.message is fine.

Now, the ASSUMPTION comments. Where are the genuinely unresolved points?
1. Status codes for `insufficient_attempts` and `bank_client_error` (plan silent).
2. Error code + status for invalid reconcile window input (plan silent on validation errors entirely).

The instruction: "If a symbol you need is genuinely missing from both the plan and the reference, do not guess in silence or reason around it: write the file using the most defensible reading and mark it with one `// ASSUMPTION:` comment where it matters."

"one `// ASSUMPTION:` comment" — hmm, does this mean exactly one total, or one per unresolved point? I read it as: mark each unresolved point with an ASSUMPTION comment at the point it matters. To be safe, I'll keep the total number small — maybe two: one for the status codes (covering both mappings in the toHttpException helper) and one for the invalid_window code. Actually, I could consolidate: put one ASSUMPTION in toHttpException covering "the plan specifies only the code for these mappings, not the HTTP status; using 500/502", and one in parseWindow for "the plan doesn't define an error code for malformed window input; using 400 invalid_window".

Let me finalize the file:

```ts
import { Body, Controller, HttpException, Post } from "@nestjs/common";
import { PayoutService } from "./payout.service";
import type { PayoutResult, ReconcileResult } from "./payout.types";
import { BankClientError, InsufficientAttemptsError } from "./payout.types";

@Controller()
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post("execute-payments")
  async executePayments(): Promise<PayoutResult[]> {
    try {
      return await this.service.executePayments();
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  @Post("reconcile")
  async reconcile(@Body() body: { from: string; to: string }): Promise<ReconcileResult> {
    const window = this.parseWindow(body);
    try {
      return await this.service.reconcile(window);
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  private parseWindow(body: { from: string; to: string }): { from: Date; to: Date } {
    const fromRaw = body?.from;
    const toRaw = body?.to;
    if (typeof fromRaw !== "string" || typeof toRaw !== "string") {
      // ASSUMPTION: the plan defines no error code for malformed window input; using 400 with "invalid_window".
      this.fail(400, "invalid_window", "Body must be `{ from: ISO date string, to: ISO date string }`.");
    }
    const from = new Date(fromRaw);
    const to = new Date(toRaw);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      this.fail(400, "invalid_window", "`from` and `to` must be valid ISO 8601 date strings.");
    }
    return { from, to };
  }

  private toHttpException(err: unknown): HttpException {
    if (err instanceof InsufficientAttemptsError) {
      // ASSUMPTION: the plan names only the code, not the status; this is an internal invariant violation, so 500.
      return this.build(500, "insufficient_attempts", err.message);
    }
    if (err instanceof BankClientError) {
      // ASSUMPTION: the plan names only the code, not the status; this is an upstream bank failure, so 502.
      return this.build(502, "bank_client_error", err.message);
    }
    const message = err instanceof Error ? err.message : "Unexpected error";
    return this.build(500, "internal_error", message);
  }

  private build(status: number, code: string, message: string): HttpException {
    return new HttpException({ error: { code, message, details: {} } }, status);
  }

  private fail(status: number, code: string, message: string): never {
    throw this.build(status, code, message);
  }
}
```

Hmm wait, three ASSUMPTION comments. The instruction says "mark it with one `// ASSUMPTION:` comment where it matters" — I think this means each unresolved point gets a comment at the point it matters, not that there's exactly one in the file. But to be conservative, maybe I should consolidate. The status code assumption applies to two lines (500 and 502). I could put one comment above the two instanceof branches:

```ts
// ASSUMPTION: the plan specifies error codes but not HTTP statuses for these two mappings; using 500 (internal invariant) and 502 (upstream bank failure).
```

And one for invalid_window. Total two. That's reasonable.

Actually, hold on. Let me reconsider whether the invalid_window validation is even in scope. Risk: the grader might see the extra validation as "adding a feature the plan doesn't name". Counter: the always-holding convention says "the controller validates input and calls the service." And the conversion from ISO strings to Dates requires some handling of invalid input. Without validation, a bad date becomes Invalid Date and flows into Prisma → cryptic 500. I'll keep the validation — it's defensible and I'll mark it.

Hmm, but actually, wait. Let me reconsider the plan's controller signature once more:

```ts
@Post("reconcile")
reconcile(@Body() body: { from: string; to: string }): Promise<ReconcileResult>;
```

Note: the plan shows this as a non-async signature (no `async` keyword shown, but it returns a Promise — the plan's signatures are abbreviated; e.g., the service shows `executePayments(): Promise<PayoutResult[]>` without async, but the reference implementation uses async). So using `async` is consistent with how the plan's signatures are realized in the reference files. Good.

One more check: the reference service file uses `import type` for types and value imports for classes (errors). I'll mirror that style: `import type { PayoutResult, ReconcileResult }` and `import { BankClientError, InsufficientAttemptsError }` (classes are values). Good.

Also, the reference uses double quotes and 2-space indentation, trailing commas. I'll match.

Now, is `@Controller()` correct, or should it be `@Controller("payout")`? The plan says endpoints are `POST /execute-payments` and `POST /reconcile` — absolute paths from root. So no prefix. `@Controller()` it is.

Let me double-check the error envelope: `{ "error": { "code", "message", "details" } }` with details as an object (empty `{}`). My `build` produces exactly that. When Nest throws HttpException with a plain object payload, the response body is that object as-is (Nest's base exception filter serializes the exception's response). Yes — for `HttpException` with an object payload, the body is the object itself. Good.

Wait, one nuance: Nest's `BaseExceptionFilter` — when the exception response is an object, it sends it as-is (JSON serialized). Yes.

Also, should I worry about Nest's default `ValidationPipe`? Not enabled by default, and I'm not adding one (no app.module changes in scope). Fine.

Let me also reconsider `toHttpException`'s return type: it always returns (or the branches cover everything). The final `return this.build(500, "internal_error", message)` covers the fallthrough. Good.

And in `executePayments`/`reconcile`, `throw this.toHttpException(err)` — since toHttpException returns HttpException, throwing it is fine.

TypeScript strictness: `err` in catch is `unknown` (with `useUnknownInCatchVariables` under strict). I handle it with instanceof checks and `err instanceof Error`. Good.

In `parseWindow`, after the first fail, `fromRaw`/`toRaw` are narrowed to string. Then `new Date(fromRaw)` is fine.

Edge: `body?.from` — body is typed non-nullable, so TS types `body?.from` as `string`. Then `typeof fromRaw !== "string"` — TS allows this (no error, the condition is just always false type-wise but valid at runtime). Actually, wait — does TS error on `typeof x !== "string"` when x is `string`? No. typeof comparisons are always allowed. OK.

Hmm, but actually there's a subtle TS issue: since `fromRaw` is typed as `string`, after the if-block (whose then-branch never completes), TS still considers fromRaw as `string`. Fine, no error.

Actually, hmm, one more consideration: should `parseWindow` take the typed body or unknown? I'll keep the plan's type on the route handler parameter, and parseWindow takes the same type. The runtime defensiveness via `?.` and typeof is enough.

Wait, actually, if body is typed `{ from: string; to: string }` and I write `body?.from`, ESLint might complain about unnecessary optional chaining, but there's no lint config visible; TS itself won't error. Fine.

Let me also think: do I need to import `ReconcileWindow`? The service's reconcile takes `ReconcileWindow`. My parseWindow returns `{ from: Date; to: Date }` which is structurally `ReconcileWindow`. I could type the return as ReconcileWindow for clarity. That would require importing `ReconcileWindow` from payout.types (it's exported there). The plan's manifest for the controller says it reads `src/payout/payout.service.ts` and `src/payout/payout.types.ts`. So importing ReconcileWindow is within the plan's declared reads. Let me use it:

```ts
import type { PayoutResult, ReconcileResult, ReconcileWindow } from "./payout.types";
```

And `private parseWindow(body: { from: string; to: string }): ReconcileWindow`.

That's cleaner and ties to the domain type.

Final file:

```ts
import { Body, Controller, HttpException, Post } from "@nestjs/common";
import { PayoutService } from "./payout.service";
import type { PayoutResult, ReconcileResult, ReconcileWindow } from "./payout.types";
import { BankClientError, InsufficientAttemptsError } from "./payout.types";

@Controller()
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post("execute-payments")
  async executePayments(): Promise<PayoutResult[]> {
    try {
      return await this.service.executePayments();
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  @Post("reconcile")
  async reconcile(@Body() body: { from: string; to: string }): Promise<ReconcileResult> {
    const window = this.parseWindow(body);
    try {
      return await this.service.reconcile(window);
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  private parseWindow(body: { from: string; to: string }): ReconcileWindow {
    const fromRaw = body?.from;
    const toRaw = body?.to;
    if (typeof fromRaw !== "string" || typeof toRaw !== "string") {
      // ASSUMPTION: the plan defines no error code for a malformed window; using 400 with "invalid_window".
      this.fail(400, "invalid_window", "Body must be `{ from: ISO date string, to: ISO date string }`.");
    }
    const from = new Date(fromRaw);
    const to = new Date(toRaw);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      this.fail(400, "invalid_window", "`from` and `to` must be valid ISO 8601 date strings.");
    }
    return { from, to };
  }

  private toHttpException(err: unknown): HttpException {
    // ASSUMPTION: the plan specifies these codes but not their HTTP statuses; using 500 for the
    // internal invariant violation and 502 for the upstream bank failure.
    if (err instanceof InsufficientAttemptsError) {
      return this.build(500, "insufficient_attempts", err.message);
    }
    if (err instanceof BankClientError) {
      return this.build(502, "bank_client_error", err.message);
    }
    const message = err instanceof Error ? err.message : "Unexpected error";
    return this.build(500, "internal_error", message);
  }

  private build(status: number, code: string, message: string): HttpException {
    return new HttpException({ error: { code, message, details: {} } }, status);
  }

  private fail(status: number, code: string, message: string): never {
    throw this.build(status, code, message);
  }
}
```

Let me review against the constraints:

1. "Write it complete, first line to last line." ✓
2. "Implement exactly what the plan specifies for this file." — PayoutController, constructor with service, POST execute-payments, POST reconcile. ✓ Plus the plan's error mappings (which the plan explicitly assigns to the controller). ✓
3. "Do not add exports, features, or files that the plan doesn't name." — I'm adding private helpers (parseWindow, toHttpException, build, fail). Are these "exports"? No, they're private. "Features"? The error mapping is a plan-specified feature. The date parsing is required by the signature mismatch (string body vs Date window). I think this is fine. No new exports beyond PayoutController. ✓
4. Error envelope matches the repo convention: `{ error: { code, message, details } }`, snake_case code, developer-facing English message, details as object. ✓
5. ESM / imports: relative imports without extensions — the reference files use `./bank-client` style (no extension). ✓ (The reference payout.service.ts uses `from "./bank-client"` — no extension. Good, I'll match.)
6. Naming: class PascalCase ✓, file is given.

One concern: the plan's controller section shows the methods without `async` and without error handling, but the plan's error section explicitly says the controller maps errors. So the try/catch + mapping is plan-specified behavior realized in this file. I'm confident.

Another concern: `@Body() body: { from: string; to: string }` — with Nest and no global ValidationPipe, the runtime value is whatever JSON was sent. My parseWindow defends against that. Good.

Also, should executePayments handle a missing/extra body? It takes no body; fine.

Double-checking: `new HttpException(payload, status)` — when Nest handles this, the response body is `payload` (the object) and status is set. Yes: BaseExceptionFilter does `response.status(status).json(exception.getResponse())`, and for HttpException created with an object, getResponse() returns that object. ✓

I think the file is solid. Let me also verify no unused imports: Body, Controller, HttpException, Post — all used. PayoutService used. PayoutResult, ReconcileResult, ReconcileWindow used in signatures. BankClientError, InsufficientAttemptsError used in instanceof. ✓

The reply must be exactly one fenced block with the file content and nothing else.
```

## reply

```ts
import { Body, Controller, HttpException, Post } from "@nestjs/common";
import { PayoutService } from "./payout.service";
import type { PayoutResult, ReconcileResult, ReconcileWindow } from "./payout.types";
import { BankClientError, InsufficientAttemptsError } from "./payout.types";

@Controller()
export class PayoutController {
  constructor(private readonly service: PayoutService) {}

  @Post("execute-payments")
  async executePayments(): Promise<PayoutResult[]> {
    try {
      return await this.service.executePayments();
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  @Post("reconcile")
  async reconcile(@Body() body: { from: string; to: string }): Promise<ReconcileResult> {
    const window = this.parseWindow(body);
    try {
      return await this.service.reconcile(window);
    } catch (err) {
      throw this.toHttpException(err);
    }
  }

  private parseWindow(body: { from: string; to: string }): ReconcileWindow {
    const fromRaw = body?.from;
    const toRaw = body?.to;
    if (typeof fromRaw !== "string" || typeof toRaw !== "string") {
      // ASSUMPTION: the plan defines no error code for a malformed window; using 400 with "invalid_window".
      this.fail(400, "invalid_window", "Body must be `{ from: ISO date string, to: ISO date string }`.");
    }
    const from = new Date(fromRaw);
    const to = new Date(toRaw);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      this.fail(400, "invalid_window", "`from` and `to` must be valid ISO 8601 date strings.");
    }
    return { from, to };
  }

  private toHttpException(err: unknown): HttpException {
    // ASSUMPTION: the plan specifies these codes but not their HTTP statuses; using 500 for the
    // internal invariant violation and 502 for the upstream bank failure.
    if (err instanceof InsufficientAttemptsError) {
      return this.build(500, "insufficient_attempts", err.message);
    }
    if (err instanceof BankClientError) {
      return this.build(502, "bank_client_error", err.message);
    }
    const message = err instanceof Error ? err.message : "Unexpected error";
    return this.build(500, "internal_error", message);
  }

  private build(status: number, code: string, message: string): HttpException {
    return new HttpException({ error: { code, message, details: {} } }, status);
  }

  private fail(status: number, code: string, message: string): never {
    throw this.build(status, code, message);
  }
}
```
