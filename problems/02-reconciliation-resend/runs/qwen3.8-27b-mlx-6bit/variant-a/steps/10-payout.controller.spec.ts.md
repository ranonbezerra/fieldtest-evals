# 10-payout.controller.spec.ts

## reasoning

```
Let me analyze what's being asked:

1. Write `test/payout.controller.spec.ts` — a Vitest test file for the PayoutController.
2. According to the plan, this file covers: "HTTP contract tests: 200 responses, error envelope shape".
3. The manifest says: `test/payout.controller.spec.ts | reads: src/payout/payout.controller.ts, src/payout/payout.types.ts | HTTP contract tests: 200 responses, error envelope shape`

So this test file should test the controller's HTTP contract:
- 200 responses for `POST /execute-payments` and `POST /reconcile`
- Error envelope shape: `{ error: { code, message, details } }`, where `code` is snake_case and `details` is an object, never null.

Looking at the controller:
- `POST execute-payments` → calls `service.executePayments()`, returns `PayoutResult[]`
- `POST reconcile` → parses the body `{ from: string; to: string }`, calls `service.reconcile(window)`, returns `ReconcileResult`

Error handling:
- Malformed window (from/to not strings) → 400 `invalid_window`
- Invalid dates → 400 `invalid_window`
- `InsufficientAttemptsError` → 500 `insufficient_attempts`
- `BankClientError` → 502 `bank_client_error`
- Anything else → 500 `internal_error`

The error envelope shape is `{ error: { code, message, details: {} } }`.

Now, how to test the controller? Options:
1. NestJS testing module with `Test.createTestingModule` — but that requires importing `@nestjs/testing`. The plan mentions Vitest. NestJS + Vitest works with `Test.createTestingModule`.
2. Instantiate the controller directly with a mocked service and call methods, catching HttpException and inspecting `getResponse()` and `getStatus()`.

The manifest says the test file reads: `src/payout/payout.controller.ts, src/payout/payout.types.ts`. It does not list `@nestjs/testing` or the module. Option 2 (direct instantiation) only needs the controller and types, plus a fake service object. This aligns better with the manifest's "reads" list.

The direct-instantiation approach:
```ts
const service = { executePayments: vi.fn(), reconcile: vi.fn() };
const controller = new PayoutController(service as unknown as PayoutService);
```

Then call `controller.executePayments()` and check the result. For errors, catch the HttpException and verify `getStatus()` and `getResponse()`.

But wait — "test behavior, not implementation. Never assert only that a call happened." So I should assert on the returned values and error envelope shapes.

Note: The discipline section says "do not create files that aren't called for", and the task says to write exactly one file. So only `test/payout.controller.spec.ts`.

Should I use NestJS's testing utilities? The plan doesn't specify. The manifest lists only the controller and types as reads. Direct instantiation is simpler and more robust (doesn't require a DI container, doesn't require app.module). Going with direct instantiation.

Test cases:

**execute-payments:**
1. Returns 200-equivalent (resolved value) with a list of PayoutResult when the service resolves. Assert that the returned array equals what the service returned (pass-through, correct shape).
2. When the service throws `InsufficientAttemptsError` → HttpException with status 500, body `{ error: { code: "insufficient_attempts", message: <err.message>, details: {} } }`.
3. When the service throws `BankClientError` → status 502, code `bank_client_error`.
4. When the service throws a generic Error → status 500, code `internal_error`.
5. When the service throws a non-Error value (e.g., a string) → status 500, code `internal_error`, message "Unexpected error". Hmm, is this over-testing? It's part of the envelope contract. I'll include it — the controller maps non-Error to "Unexpected error". Actually, let me keep it. It's a reasonable contract test for the envelope.

**reconcile:**
6. Valid body → parses dates, calls service.reconcile with `{ from: Date, to: Date }`, returns the ReconcileResult. Assert that the window passed is a Date object with correct times, and that the returned result passes through.
7. Missing body / from not a string → 400 `invalid_window`, envelope shape.
8. Invalid ISO date → 400 `invalid_window`.

Should I also validate the envelope shape in a helper: that the body has exactly `{ error: { code, message, details } }`, `details` is an object (not null), code is a string.

Let me write a helper:

```ts
function envelope(err: unknown): { status: number; body: { error: { code: string; message: string; details: object } } } {
  expect(err).toBeInstanceOf(HttpException);
  const ex = err as HttpException;
  const body = ex.getResponse() as { error: { code: string; message: string; details: unknown } };
  expect(body).toHaveProperty("error");
  ...
}
```

Actually, let me write a helper `expectEnvelope(err, expectedStatus, expectedCode)` that asserts:
- err is an instance of HttpException
- getStatus() === expectedStatus
- getResponse() deep-equals `{ error: { code: expectedCode, message: <string>, details: {} } }` — but the message varies. Better to assert the shape and the code, and that message is a non-empty string and details deep-equals {}.

Let me write it:

```ts
function assertEnvelope(err: unknown, status: number, code: string): void {
  expect(err).toBeInstanceOf(HttpException);
  const ex = err as HttpException;
  expect(ex.getStatus()).toBe(status);
  const body = ex.getResponse();
  expect(body).toEqual({
    error: {
      code,
      message: expect.any(String),
      details: {},
    },
  });
}
```

Hmm, `toEqual` with `expect.any(String)` inside works in Jest/Vitest. Yes, asymmetric matchers work with toEqual.

But wait — should I also assert that the message is a specific string? For `invalid_window` with missing fields, the controller's message is "Body must be `{ from: ISO date string, to: ISO date string }`." For invalid dates: "`from` and `to` must be valid ISO 8601 date strings." For the mapped errors, message is err.message. I could assert the exact messages for invalid_window cases since they are fixed by the controller. That's a stronger test. Let me assert exact messages where deterministic:

- missing/non-string fields: "Body must be `{ from: ISO date string, to: ISO date string }`."
- invalid dates: "`from` and `to` must be valid ISO 8601 date strings."
- InsufficientAttemptsError: message from the error instance.
- BankClientError: message from the error instance.
- generic Error: err.message.
- non-Error: "Unexpected error".

I can extend the helper to take an optional exact message. Or just assert the shape with `expect.any(String)` and separately check messages in individual tests where it makes sense. Let me have the helper take an optional message parameter:

```ts
function assertEnvelope(err: unknown, status: number, code: string, message?: string): void
```

If message is provided, assert body.error.message === message; otherwise expect.any(String).

Simpler: always build the expected object.

```ts
function assertEnvelope(err: unknown, status: number, code: string, message: string | undefined = undefined): void {
  expect(err).toBeInstanceOf(HttpException);
  const ex = err as HttpException;
  expect(ex.getStatus()).toBe(status);
  const expectedMessage = message === undefined ? expect.any(String) : message;
  expect(ex.getResponse()).toEqual({ error: { code, message: expectedMessage, details: {} } });
}
```

Also, the convention says `details` is an object and never null — the toEqual with `details: {}` covers that.

Now, about the 200 response: with direct instantiation, there's no HTTP status. The "200 response" in the plan means success — the method resolves with a payload rather than throwing. I'll frame it as "resolves with the service's result (HTTP 200 body)". That's the defensible reading for a unit test without an HTTP layer. Should I add a `// ASSUMPTION:` comment? The instructions say: "if a symbol you truly need is missing from both the plan and references... write the file with the most defensible reading and mark it with a single ASSUMPTION comment at the relevant spot."

Is anything truly missing? The plan says "HTTP contract tests: 200 responses, error envelope shape". Testing actual HTTP 200 requires either a Nest testing module or supertest. The manifest's reads list suggests only the controller and types. The most defensible reading: success path = method resolves with the payload (which is what Nest will serialize as a 200 body), and error paths = HttpException with the exact status and envelope. I could add a brief ASSUMPTION comment noting that 200 is verified as a resolved payload because the test targets the controller directly rather than a live HTTP server. That seems appropriate and honest. Only one such comment, at the relevant spot (top of describe or above the success tests).

Actually, let me reconsider using Nest's testing module. The repo uses NestJS. `@nestjs/testing` is a standard dev dependency. But the manifest explicitly lists what this file reads: `src/payout/payout.controller.ts, src/payout/payout.types.ts`. If I used `Test.createTestingModule`, I'd need `@nestjs/testing` and probably the module too (or a minimal module with a mocked provider). The manifest is part of the plan and governs. Direct instantiation matches the manifest precisely. Going with direct instantiation.

Also, "never assert only that a call happened" — my tests assert on returned values and error bodies, good. I do use `vi.fn()` mocks for the service, but assertions are on outputs.

Now let me think about the mock service:

```ts
function makeController(service: { executePayments: Mock; reconcile: Mock }): PayoutController {
  return new PayoutController(service as unknown as PayoutService);
}
```

For the success path:

```ts
it("returns the payout results from the service", async () => {
  const results: PayoutResult[] = [
    { order_id: "ord_1", txid: "abc123", classification: "accepted" },
  ];
  const service = { executePayments: vi.fn().mockResolvedValue(results), reconcile: vi.fn() };
  const controller = new PayoutController(service as unknown as PayoutService);

  await expect(controller.executePayments()).resolves.toEqual(results);
});
```

Hmm, but is asserting pass-through "only that a call happened"? No — it asserts the response body equals the expected payload. That's the contract: the endpoint returns the list of results. Good.

For reconcile success:

```ts
it("parses the window and returns the reconcile result", async () => {
  const from = new Date("2025-01-01T00:00:00.000Z");
  const to = new Date("2025-01-02T00:00:00.000Z");
  const result: ReconcileResult = { window: { from, to }, matched_count: 3 };
  const service = { executePayments: vi.fn(), reconcile: vi.fn().mockResolvedValue(result) };
  const controller = new PayoutController(service as unknown as PayoutService);

  await expect(controller.reconcile({ from: "2025-01-01T00:00:00.000Z", to: "2025-01-02T00:00:00.000Z" })).resolves.toEqual(result);
});
```

Should I also assert that the service received parsed Date objects? That's closer to "asserting a call happened" but it's also a real contract: the controller converts ISO strings to Dates before calling the service. The plan says the controller "validates input and calls the service". Parsing into Dates is part of the contract (the service expects `ReconcileWindow` with Date). I think asserting that the window was passed as Dates is legitimate behavior testing — it's about what crosses the controller/service boundary. But "never assert only that a call happened" — I can do both: assert the resolved result AND check the argument. Let me include the argument assertion as a secondary check, not the only one. Actually, to be safe with the discipline, I'll assert the resolved value (primary) and also verify the parsed window dates via `service.reconcile.mock.calls[0][0]`. That's fine — the rule forbids tests that only assert calls, not tests that also assert calls.

Hmm, let me keep it clean: in the success test, assert the resolved result equals `result`. And in a separate test, assert that the window is parsed into Date instances (behavior: string → Date conversion). Actually, I can fold it in: one test "parses ISO window into Dates and returns the service result" asserting both. Good.

Edge: `new Date("2025-01-01T00:00:00.000Z")` — fine.

Error tests:

1. executePayments → InsufficientAttemptsError:
```ts
const err = new InsufficientAttemptsError("ord_9");
service.executePayments.mockRejectedValue(err);
await expect(controller.executePayments()).rejects.toMatchObject? 
```
Better: catch and assertEnvelope.

```ts
const promise = controller.executePayments();
await expect(promise).rejects.toBeInstanceOf(HttpException);
```
Then inspect. Simpler pattern:

```ts
let caught: unknown;
try { await controller.executePayments(); } catch (e) { caught = e; }
assertEnvelope(caught, 500, "insufficient_attempts", "Order ord_9 has exhausted attempts");
```

Or use `await expect(...).rejects` and then access. The try/catch is clearest with the helper. Alternatively, make the helper work with a promise:

```ts
async function assertEnvelope(promise: Promise<unknown>, status: number, code: string, message?: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(HttpException);
  ...
}
```

That's clean. Let me do that.

2. executePayments → BankClientError("bank unreachable") → 502, "bank_client_error", message "bank unreachable".

3. executePayments → new Error("boom") → 500, "internal_error", "boom".

4. executePayments → "kaboom" (string) → 500, "internal_error", "Unexpected error".

5. reconcile with body `{ from: 123 as unknown as string, to: "..." }` → 400 invalid_window. Actually, `body?.from` with from missing: `reconcile(undefined as any)`? The controller signature is `@Body() body: { from: string; to: string }`. In a unit test I can pass anything. Cases:
   - `reconcile({})` → fromRaw undefined → not a string → 400 "Body must be `{ from: ISO date string, to: ISO date string }`."
   - `reconcile({ from: "not-a-date", to: "2025-01-02T00:00:00.000Z" })` → 400 "`from` and `to` must be valid ISO 8601 date strings."
   - `reconcile({ from: "2025-01-01T00:00:00.000Z", to: "garbage" })` → same 400.
   
   Do I need both invalid-date variants? One is enough for the contract, but testing that either field being invalid triggers it is nice. Let me include two: missing fields and invalid dates (one field enough, or both? I'll do one with `from` invalid; the code path is shared via `Number.isNaN(from) || Number.isNaN(to)`). Actually, to be thorough without bloat: one test for non-string/missing, one for invalid ISO. That covers both branches.

Also, should I test that the service is not called when the window is invalid? That's "asserting a call didn't happen" — a negative call assertion. The rule says don't assert only that a call happened; asserting it didn't is weaker. I'll skip; the 400 envelope assertion is the contract.

Now, the "200 response" framing: I'll add a comment:

```ts
// ASSUMPTION: the plan names "200 responses" but this spec unit-tests the controller
// directly (per the manifest, which lists only the controller and types as inputs);
// a resolved return value is what Nest serializes as the 200 body, so success is
// asserted as "resolves with the payload" rather than via a live HTTP round-trip.
```

That's one ASSUMPTION comment at the relevant spot. Good.

Now imports:

```ts
import { describe, it, expect, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { PayoutController } from "../src/payout/payout.controller";
import type { PayoutResult, PayoutService } from "../src/payout/payout.service";
import { BankClientError, InsufficientAttemptsError } from "../src/payout/payout.types";
import type { ReconcileResult } from "../src/payout/payout.types";
```

Wait — the manifest says this file reads `src/payout/payout.controller.ts` and `src/payout/payout.types.ts`. Importing the `PayoutService` type from `payout.service.ts` would be a third read. To stay faithful, I can avoid importing PayoutService: cast the fake with `as never`? Hmm. The constructor takes `PayoutService`. I need some type to cast to. Options:

- `new PayoutController(fake as unknown as Parameters<PayoutController["constructor"]>[0])` — uses only the controller type. A bit convoluted but avoids importing the service module.
- Or import the type from payout.service.ts. The manifest's "reads" is a planning artifact; importing a type from the service file is harmless. But the instructions: "implement exactly what the plan specifies for this file. Do not add exports, features, or files the plan doesn't name." The plan names this file with reads: controller + types. Strictly, I should only import from those two (plus vitest and @nestjs/common for HttpException).

Can I avoid `@nestjs/common`? The controller throws `HttpException`; to assert the envelope I need to inspect status/response. I could duck-type:

```ts
interface HttpError { getStatus(): number; getResponse(): unknown; }
```

And assert `caught` has those methods. But asserting `toBeInstanceOf(HttpException)` is stronger and more precise — the controller's contract is that it throws Nest's HttpException (which Nest turns into a response). The plan's controller code imports from `@nestjs/common`, so the test importing it too is natural. The manifest's reads list probably just highlights project files, not third-party packages (it doesn't list vitest either). So importing `@nestjs/common` is fine.

For the PayoutService type: to be safe and faithful, I'll derive it from the controller's constructor parameter:

```ts
type PayoutServiceLike = Parameters<PayoutController["constructor"]>[0];
```

Hmm, that's clever but obscure. Alternative: define a minimal structural fake and cast via `as unknown as PayoutServiceLike`. Let me just do:

```ts
function makeController(overrides: { executePayments?: () => Promise<unknown>; reconcile?: (w: unknown) => Promise<unknown> }): PayoutController {
  const service = {
    executePayments: vi.fn(overrides.executePayments ?? (async () => [])),
    reconcile: vi.fn(overrides.reconcile ?? (async () => ({ window: { from: new Date(0), to: new Date(0) }, matched_count: 0 }))),
  };
  return new PayoutController(service as never);
}
```

`as never` works for casting to any parameter type. Hmm, `service as never` — is that valid? `as never` is assignable to anything. Yes, `x as never` then passing where PayoutService is expected compiles because never is a subtype of everything. A bit hacky but common in tests. Alternatively `as unknown as Parameters<...>[0]`.

Actually, cleaner: import the type. Let me weigh: the manifest is a plan artifact describing dependencies; the task instructions say don't add files/exports/features not named. Importing a type from an existing file is neither. And practically, importing `PayoutService` as a type is the most readable. But strictness... The manifest line: `test/payout.controller.spec.ts | reads: src/payout/payout.controller.ts, src/payout/payout.types.ts`. I think the safest reading that respects both readability and the manifest is to not import from payout.service.ts. I'll use the `Parameters<PayoutController["constructor"]>[0]` trick — no, wait, that's over-clever.

Simpler: `new PayoutController(fake as unknown as PayoutController extends new (svc: infer S) => unknown ? S : never)`? Too much.

Let me just do `as never`. Hmm, but is `as never` defensible? It's a test-only cast. Many codebases use `as any`; `as never` is the strict-mode-friendly variant. Fine.

Actually wait — even simpler and fully typed: I could type the fake as a structural object and cast:

```ts
const service = { executePayments: vi.fn(), reconcile: vi.fn() };
const controller = new PayoutController(service as never);
```

OK, going with that.

Hmm, one more consideration: should the tests use `vi.fn()` at all? Yes, for mocking the service.

Now let me also double-check the controller's behavior for `reconcile` when body is `undefined`: `body?.from` → undefined → not a string → 400 with the "Body must be..." message. Test: `controller.reconcile(undefined as never)`? The parameter type is `{ from: string; to: string }`. Passing undefined requires a cast: `reconcile(undefined as unknown as { from: string; to: string })`. I can test `reconcile({} as { from: string; to: string })` — that's cleaner (empty object, both fields missing). And maybe also `reconcile({ from: "x" } as ...)` (to missing). One empty-object test covers the branch.

Let me also verify: `new Date("not-a-date").getTime()` → NaN → yes.

Now, the exact messages in the controller:
- "Body must be `{ from: ISO date string, to: ISO date string }`." — note the backticks in the source. In my test string I'll write it as a plain string with backticks inside: `"Body must be `{ from: ISO date string, to: ISO date string }`."` — in TS I can use double quotes and embed backticks. Fine.
- "`from` and `to` must be valid ISO 8601 date strings."

I'll assert these exact messages.

Now, the envelope for success — "200 responses": I'll assert the resolved value. For executePayments, the payload is `PayoutResult[]`. Let me make a realistic sample:

```ts
const results: PayoutResult[] = [
  { order_id: "ord_1", txid: "a1b2c3d4e5f60718293a4b5c6d7e8f90", classification: "accepted" },
  { order_id: "ord_2", txid: "0f1e2d3c4b5a6978876543210fedcba9", classification: "duplicate" },
];
```

PayoutResult requires `classification: SendClassification`. I need to import the type? PayoutResult is in payout.types.ts which imports SendClassification from bank-client. I can use the literal "accepted" — it's assignable to SendClassification without importing it. Good, no extra import needed.

ReconcileResult: `{ window: { from: Date, to: Date }, matched_count: number }`.

Let me draft the full file now.

```ts
import { describe, expect, it, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { PayoutController } from "../src/payout/payout.controller";
import type { PayoutResult, ReconcileResult } from "../src/payout/payout.types";
import { BankClientError, InsufficientAttemptsError } from "../src/payout/payout.types";

// The controller's constructor takes the payout service; the spec only depends on the
// controller and its types, so the fake is cast at the call site.
type FakeService = {
  executePayments: ReturnType<typeof vi.fn>;
  reconcile: ReturnType<typeof vi.fn>;
};

function makeController(service: FakeService): PayoutController {
  return new PayoutController(service as never);
}

function emptyService(): FakeService {
  return { executePayments: vi.fn(), reconcile: vi.fn() };
}

async function expectEnvelope(
  promise: Promise<unknown>,
  status: number,
  code: string,
  message?: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(HttpException);
  const ex = caught as HttpException;
  expect(ex.getStatus()).toBe(status);
  expect(ex.getResponse()).toEqual({
    error: {
      code,
      message: message ?? expect.any(String),
      details: {},
    },
  });
}

describe("PayoutController", () => {
  describe("POST execute-payments", () => {
    it("resolves with the payout results (200 body)", async () => {
      const results: PayoutResult[] = [
        { order_id: "ord_1", txid: "a1b2c3d4e5f60718293a4b5c6d7e8f90", classification: "accepted" },
        { order_id: "ord_2", txid: "0f1e2d3c4b5a6978876543210fedcba9", classification: "duplicate" },
      ];
      const service = emptyService();
      service.executePayments.mockResolvedValue(results);
      const controller = makeController(service);

      await expect(controller.executePayments()).resolves.toEqual(results);
    });

    it("maps InsufficientAttemptsError to a 500 envelope with code insufficient_attempts", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue(new InsufficientAttemptsError("ord_9"));
      const controller = makeController(service);

      await expectEnvelope(controller.executePayments(), 500, "insufficient_attempts", "Order ord_9 has exhausted attempts");
    });

    it("maps BankClientError to a 502 envelope with code bank_client_error", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue(new BankClientError("bank unreachable"));
      const controller = makeController(service);

      await expectEnvelope(controller.executePayments(), 502, "bank_client_error", "bank unreachable");
    });

    it("maps an unexpected Error to a 500 envelope with code internal_error", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue(new Error("boom"));
      const controller = makeController(service);

      await expectEnvelope(controller.executePayments(), 500, "internal_error", "boom");
    });

    it("maps a non-Error rejection to a 500 envelope with code internal_error", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue("kaboom");
      const controller = makeController(service);

      await expectEnvelope(controller.executePayments(), 500, "internal_error", "Unexpected error");
    });
  });

  describe("POST reconcile", () => {
    it("parses the ISO window into Dates and resolves with the reconcile result (200 body)", async () => {
      const from = new Date("2025-01-01T00:00:00.000Z");
      const to = new Date("2025-01-02T00:00:00.000Z");
      const result: ReconcileResult = { window: { from, to }, matched_count: 3 };
      const service = emptyService();
      service.reconcile.mockResolvedValue(result);
      const controller = makeController(service);

      await expect(
        controller.reconcile({ from: "2025-01-01T00:00:00.000Z", to: "2025-01-02T00:00:00.000Z" }),
      ).resolves.toEqual(result);
      expect(service.reconcile).toHaveBeenCalledWith({ from, to });
    });

    it("rejects a window with missing fields with a 400 invalid_window envelope", async () => {
      const service = emptyService();
      const controller = makeController(service);

      await expectEnvelope(
        controller.reconcile({} as { from: string; to: string }),
        400,
        "invalid_window",
        "Body must be `{ from: ISO date string, to: ISO date string }`.",
      );
    });

    it("rejects a window with an invalid ISO date with a 400 invalid_window envelope", async () => {
      const service = emptyService();
      const controller = makeController(service);

      await expectEnvelope(
        controller.reconcile({ from: "not-a-date", to: "2025-01-02T00:00:00.000Z" }),
        400,
        "invalid_window",
        "`from` and `to` must be valid ISO 8601 date strings.",
      );
    });
  });
});
```

Wait — one issue: `service.reconcile` is typed as `ReturnType<typeof vi.fn>` which is `Mock<(...args: any[]) => any>`. `toHaveBeenCalledWith({ from, to })` — fine.

But `expect(service.reconcile).toHaveBeenCalledWith({ from, to })` — the controller passes `{ from: new Date(fromRaw), to: new Date(toRaw) }`. `new Date("2025-01-01T00:00:00.000Z")` equals `from` (same millisecond). toEqual on Dates compares by time value. Good.

Now, the ASSUMPTION comment. Where? The plan says "HTTP contract tests: 200 responses, error envelope shape". My success tests assert resolved payloads, not literal HTTP 200. I'll add one comment near the top:

```ts
// ASSUMPTION: the plan asks for "200 responses" but this spec (per its manifest) depends
// only on the controller and its types, so success is asserted as a resolved payload —
// the value Nest serializes as the 200 body — rather than a live HTTP round-trip.
```

That's defensible and honest.

Let me double-check the `expectEnvelope` helper: `message ?? expect.any(String)` — if message is an empty string ""? Not our case. Fine.

One concern: `toEqual` with asymmetric matchers — supported in Vitest. Yes.

Another check: `HttpException.getResponse()` returns the object I passed: `{ error: { code, message, details: {} } }`. `getStatus()` returns the status number. Good.

Type-checking concerns in strict mode:
- `service.executePayments.mockRejectedValue("kaboom")` — vi.fn() is untyped, accepts anything. OK.
- `makeController(service as never)` — `service` is FakeService; `as never` cast: TS allows `x as never` only if the types are "comparable"? Actually, casting to `never`: any type can be asserted to never? No — `as` requires one type to be assignable to the other (comparability). `FakeService as never`: is `never` assignable to FakeService? Yes, never is assignable to everything. For an assertion `A as B`, TS allows it if A is assignable to B or B is assignable to A. `never` (B) is assignable to A (FakeService). So `service as never` compiles. Then passing `never` where PayoutService is expected: never is assignable to PayoutService. Compiles.

- `controller.reconcile({} as { from: string; to: string })` — `{}` cast to that type: is `{ from: string; to: string }` assignable to `{}`? Yes. So the assertion is allowed. OK.

- Importing `PayoutResult` and `ReconcileResult` as types from payout.types — they're exported there. Yes (interfaces). `BankClientError`, `InsufficientAttemptsError` are exported classes. Good.

- `import { HttpException } from "@nestjs/common"` — value import, used in instanceof. Good.

Do I need `vi` imported? Yes, for `vi.fn`.

Now — "never assert only that a call happened": my reconcile success test asserts both the resolved result and the argument. The argument assertion is supplementary. Fine.

Should I also assert that the service's `reconcile` was NOT called in the invalid-window test? That would be a negative call assertion; not required. Skip to keep focus on the envelope contract.

Let me also think: does the plan want tests that the success response has HTTP 200 status? With direct instantiation, impossible. The ASSUMPTION covers it.

Another possible contract test: `execute-payments` with no pending orders resolves with `[]`. That's a valid 200-body test. Should I add it? The plan lists "200 responses" generally. Adding an empty-list case is cheap and meaningful (the endpoint returns an array, possibly empty). Let me add it:

```ts
it("resolves with an empty array when there is nothing to send", async () => {
  const service = emptyService();
  service.executePayments.mockResolvedValue([]);
  const controller = makeController(service);

  await expect(controller.executePayments()).resolves.toEqual([]);
});
```

Hmm, is that over-testing? It's a distinct shape (empty array). I'll include it — it reinforces the 200-body contract. Actually, let me keep the file focused: the manifest says "200 responses, error envelope shape". Two success tests (one per endpoint) + the empty case is fine. I'll include the empty-array one; it's small.

Let me also reconsider the helper name and structure for clarity. Also, the test file should probably describe by endpoint route: "POST /execute-payments" and "POST /reconcile". The controller uses `@Post("execute-payments")` on a `@Controller()` (no prefix). So the routes are `/execute-payments` and `/reconcile`. I'll name describes accordingly.

Final check on the exact error messages from the controller (from the reference file):
- `this.fail(400, "invalid_window", "Body must be `{ from: ISO date string, to: ISO date string }`.");`
- `this.fail(400, "invalid_window", "`from` and `to` must be valid ISO 8601 date strings.");`
- InsufficientAttemptsError message: `Order ${orderId} has exhausted attempts` → "Order ord_9 has exhausted attempts".
- BankClientError: constructor takes message verbatim.
- Generic: err.message; non-Error: "Unexpected error".

All match my tests.

One more: in `expectEnvelope`, after `expect(caught).toBeInstanceOf(HttpException)`, I cast. If caught is undefined (promise resolved), the first expect fails — good, that's the right failure mode.

Also, should I verify `details` is never null explicitly? The toEqual with `details: {}` does that.

Let me also make sure I'm not importing from `bank-client.ts` (not in the manifest reads). I use string literals "accepted"/"duplicate" for classification — assignable to SendClassification. Good, no import needed.

Now let me write the final file. Structure:

1. Imports
2. ASSUMPTION comment
3. Helpers (makeController, emptyService, expectEnvelope)
4. describe blocks

Let me make sure the code is complete and self-contained. Also, `type FakeService` — I'll inline it.

Actually, one subtlety: `ReturnType<typeof vi.fn>` — `vi.fn` is a function; `typeof vi.fn` is its type; `ReturnType<...>` gives the Mock type. In vitest, `vi.fn()` returns `Mock`. This works. Or I could just type the fake as `{ executePayments: any; reconcile: any }`? No — strict mode, avoid `any`. The ReturnType approach is fine. Hmm, but is it robust across vitest versions? `vi.fn` always returns a Mock; ReturnType works. Alternatively, import `Mock` from "vitest": `import { describe, expect, it, vi, type Mock } from "vitest";` and use `Mock<() => Promise<unknown>>`. That's cleaner:

```ts
type FakeService = {
  executePayments: Mock<() => Promise<unknown>>;
  reconcile: Mock<(window: { from: Date; to: Date }) => Promise<unknown>>;
};

function emptyService(): FakeService {
  return {
    executePayments: vi.fn(async () => []),
    reconcile: vi.fn(async () => ({ window: { from: new Date(0), to: new Date(0) }, matched_count: 0 })),
  };
}
```

Hmm, but `mockResolvedValue(results)` where results is PayoutResult[] and the mock returns Promise<unknown> — fine, unknown accepts anything.

Wait, does vitest export a `Mock` type? Yes: `import { Mock } from "vitest"` (type export). With ESM and verbatimModuleSyntax, I should use `import type`. The repo is ESM with `"type": "module"`. To be safe: `import { describe, expect, it, vi } from "vitest"; import type { Mock } from "vitest";` — or combined with inline `type` modifier. I'll do a separate `import type { Mock } from "vitest";`.

Actually, simpler to avoid the Mock import entirely and let `emptyService` return an object of vi.fn()s, inferring the type:

```ts
function emptyService() {
  return { executePayments: vi.fn(), reconcile: vi.fn() };
}
```

Then `makeController(service: ReturnType<typeof emptyService>)`. The inferred type is `{ executePayments: Mock<...>; reconcile: Mock<...> }` with untyped mocks (accepting any args, returning any). `mockResolvedValue(results)` works. `expect(service.reconcile).toHaveBeenCalledWith(...)` works. This avoids the explicit Mock import.

But `vi.fn()` with no implementation returns a mock that returns `undefined` when called — fine since I override in each test.

Let me use inference. Clean and no extra type imports.

Final file:

```ts
import { describe, expect, it, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { PayoutController } from "../src/payout/payout.controller";
import type { PayoutResult, ReconcileResult } from "../src/payout/payout.types";
import { BankClientError, InsufficientAttemptsError } from "../src/payout/payout.types";

// ASSUMPTION: the plan asks for "200 responses" but this spec depends only on the
// controller and its types (per the manifest), so success is asserted as a resolved
// payload — the value Nest serializes as the 200 body — rather than a live HTTP round-trip.

function emptyService() {
  return { executePayments: vi.fn(), reconcile: vi.fn() };
}

function makeController(service: ReturnType<typeof emptyService>): PayoutController {
  return new PayoutController(service as never);
}

async function expectEnvelope(
  promise: Promise<unknown>,
  status: number,
  code: string,
  message?: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(HttpException);
  const ex = caught as HttpException;
  expect(ex.getStatus()).toBe(status);
  // The envelope is the contract: snake_case code, developer-facing message, details object (never null).
  expect(ex.getResponse()).toEqual({
    error: { code, message: message ?? expect.any(String), details: {} },
  });
}

describe("PayoutController", () => {
  describe("POST /execute-payments", () => {
    it("resolves with the payout results as the 200 body", async () => {
      const results: PayoutResult[] = [
        { order_id: "ord_1", txid: "a1b2c3d4e5f60718293a4b5c6d7e8f90", classification: "accepted" },
        { order_id: "ord_2", txid: "0f1e2d3c4b5a6978876543210fedcba9", classification: "duplicate" },
      ];
      const service = emptyService();
      service.executePayments.mockResolvedValue(results);
      const controller = makeController(service);

      await expect(controller.executePayments()).resolves.toEqual(results);
    });

    it("resolves with an empty array when there is nothing to send", async () => {
      const service = emptyService();
      service.executePayments.mockResolvedValue([]);
      const controller = makeController(service);

      await expect(controller.executePayments()).resolves.toEqual([]);
    });

    it("maps InsufficientAttemptsError to a 500 envelope with code insufficient_attempts", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue(new InsufficientAttemptsError("ord_9"));
      const controller = makeController(service);

      await expectEnvelope(
        controller.executePayments(),
        500,
        "insufficient_attempts",
        "Order ord_9 has exhausted attempts",
      );
    });

    it("maps BankClientError to a 502 envelope with code bank_client_error", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue(new BankClientError("bank unreachable"));
      const controller = makeController(service);

      await expectEnvelope(controller.executePayments(), 502, "bank_client_error", "bank unreachable");
    });

    it("maps an unexpected Error to a 500 envelope with code internal_error", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue(new Error("boom"));
      const controller = makeController(service);

      await expectEnvelope(controller.executePayments(), 500, "internal_error", "boom");
    });

    it("maps a non-Error rejection to a 500 envelope with code internal_error", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue("kaboom");
      const controller = makeController(service);

      await expectEnvelope(controller.executePayments(), 500, "internal_error", "Unexpected error");
    });
  });

  describe("POST /reconcile", () => {
    it("parses the ISO window into Dates and resolves with the reconcile result as the 200 body", async () => {
      const from = new Date("2025-01-01T00:00:00.000Z");
      const to = new Date("2025-01-02T00:00:00.000Z");
      const result: ReconcileResult = { window: { from, to }, matched_count: 3 };
      const service = emptyService();
      service.reconcile.mockResolvedValue(result);
      const controller = makeController(service);

      await expect(
        controller.reconcile({ from: "2025-01-01T00:00:00.000Z", to: "2025-01-02T00:00:00.000Z" }),
      ).resolves.toEqual(result);
      expect(service.reconcile).toHaveBeenCalledWith({ from, to });
    });

    it("rejects a window with missing fields with a 400 invalid_window envelope", async () => {
      const service = emptyService();
      const controller = makeController(service);

      await expectEnvelope(
        controller.reconcile({} as { from: string; to: string }),
        400,
        "invalid_window",
        "Body must be `{ from: ISO date string, to: ISO date string }`.",
      );
    });

    it("rejects a window with an invalid ISO date with a 400 invalid_window envelope", async () => {
      const service = emptyService();
      const controller = makeController(service);

      await expectEnvelope(
        controller.reconcile({ from: "not-a-date", to: "2025-01-02T00:00:00.000Z" }),
        400,
        "invalid_window",
        "`from` and `to` must be valid ISO 8601 date strings.",
      );
    });
  });
});
```

Wait: `service.executePayments.mockResolvedValue(results)` — the mock is untyped (`vi.fn()`), so mockResolvedValue accepts anything. OK.

`service.reconcile` — `expect(service.reconcile).toHaveBeenCalledWith({ from, to })`. The controller calls `this.service.reconcile(window)` with window `{ from: Date, to: Date }`. toEqual on Dates: compares by time. Both constructed from the same ISO string → equal. Good.

One more check: in the reconcile success test, `result.window` contains the same Date instances I pass to toEqual — trivially equal.

Potential strict TS issue: `makeController(service as never)` — discussed, compiles.

`controller.reconcile({} as { from: string; to: string })` — compiles.

`mockRejectedValue("kaboom")` — fine.

Also, should the `expectEnvelope` helper be inside or outside describe? Outside is fine.

The comment about the envelope inside expectEnvelope — good, explains the contract assertion.

I think this is solid. Let me also make sure I'm not violating "do not add exports" — the file has no exports at all (test files don't export). Good.

Line count is reasonable. Let me finalize. I'll also make sure the first line is an import (complete file).

One more consideration: the test directory per the convention is `test/<feature>.spec.ts` → `test/payout.controller.spec.ts`. ✓.

Import path: from `test/` to `src/payout/` → `../src/payout/payout.controller`. ✓.

Done. I'll output only the fenced block.
```

## reply

```ts
import { describe, expect, it, vi } from "vitest";
import { HttpException } from "@nestjs/common";
import { PayoutController } from "../src/payout/payout.controller";
import type { PayoutResult, ReconcileResult } from "../src/payout/payout.types";
import { BankClientError, InsufficientAttemptsError } from "../src/payout/payout.types";

// ASSUMPTION: the plan asks for "200 responses" but this spec depends only on the
// controller and its types (per the manifest), so success is asserted as a resolved
// payload — the value Nest serializes as the 200 body — rather than a live HTTP round-trip.

function emptyService() {
  return { executePayments: vi.fn(), reconcile: vi.fn() };
}

function makeController(service: ReturnType<typeof emptyService>): PayoutController {
  return new PayoutController(service as never);
}

async function expectEnvelope(
  promise: Promise<unknown>,
  status: number,
  code: string,
  message?: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(HttpException);
  const ex = caught as HttpException;
  expect(ex.getStatus()).toBe(status);
  // The envelope is the contract: snake_case code, developer-facing message, details object (never null).
  expect(ex.getResponse()).toEqual({
    error: { code, message: message ?? expect.any(String), details: {} },
  });
}

describe("PayoutController", () => {
  describe("POST /execute-payments", () => {
    it("resolves with the payout results as the 200 body", async () => {
      const results: PayoutResult[] = [
        { order_id: "ord_1", txid: "a1b2c3d4e5f60718293a4b5c6d7e8f90", classification: "accepted" },
        { order_id: "ord_2", txid: "0f1e2d3c4b5a6978876543210fedcba9", classification: "duplicate" },
      ];
      const service = emptyService();
      service.executePayments.mockResolvedValue(results);
      const controller = makeController(service);

      await expect(controller.executePayments()).resolves.toEqual(results);
    });

    it("resolves with an empty array when there is nothing to send", async () => {
      const service = emptyService();
      service.executePayments.mockResolvedValue([]);
      const controller = makeController(service);

      await expect(controller.executePayments()).resolves.toEqual([]);
    });

    it("maps InsufficientAttemptsError to a 500 envelope with code insufficient_attempts", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue(new InsufficientAttemptsError("ord_9"));
      const controller = makeController(service);

      await expectEnvelope(
        controller.executePayments(),
        500,
        "insufficient_attempts",
        "Order ord_9 has exhausted attempts",
      );
    });

    it("maps BankClientError to a 502 envelope with code bank_client_error", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue(new BankClientError("bank unreachable"));
      const controller = makeController(service);

      await expectEnvelope(controller.executePayments(), 502, "bank_client_error", "bank unreachable");
    });

    it("maps an unexpected Error to a 500 envelope with code internal_error", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue(new Error("boom"));
      const controller = makeController(service);

      await expectEnvelope(controller.executePayments(), 500, "internal_error", "boom");
    });

    it("maps a non-Error rejection to a 500 envelope with code internal_error", async () => {
      const service = emptyService();
      service.executePayments.mockRejectedValue("kaboom");
      const controller = makeController(service);

      await expectEnvelope(controller.executePayments(), 500, "internal_error", "Unexpected error");
    });
  });

  describe("POST /reconcile", () => {
    it("parses the ISO window into Dates and resolves with the reconcile result as the 200 body", async () => {
      const from = new Date("2025-01-01T00:00:00.000Z");
      const to = new Date("2025-01-02T00:00:00.000Z");
      const result: ReconcileResult = { window: { from, to }, matched_count: 3 };
      const service = emptyService();
      service.reconcile.mockResolvedValue(result);
      const controller = makeController(service);

      await expect(
        controller.reconcile({ from: "2025-01-01T00:00:00.000Z", to: "2025-01-02T00:00:00.000Z" }),
      ).resolves.toEqual(result);
      expect(service.reconcile).toHaveBeenCalledWith({ from, to });
    });

    it("rejects a window with missing fields with a 400 invalid_window envelope", async () => {
      const service = emptyService();
      const controller = makeController(service);

      await expectEnvelope(
        controller.reconcile({} as { from: string; to: string }),
        400,
        "invalid_window",
        "Body must be `{ from: ISO date string, to: ISO date string }`.",
      );
    });

    it("rejects a window with an invalid ISO date with a 400 invalid_window envelope", async () => {
      const service = emptyService();
      const controller = makeController(service);

      await expectEnvelope(
        controller.reconcile({ from: "not-a-date", to: "2025-01-02T00:00:00.000Z" }),
        400,
        "invalid_window",
        "`from` and `to` must be valid ISO 8601 date strings.",
      );
    });
  });
});
```
