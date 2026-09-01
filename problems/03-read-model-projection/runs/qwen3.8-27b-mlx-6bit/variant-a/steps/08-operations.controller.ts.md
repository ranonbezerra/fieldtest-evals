# 08-operations.controller.ts

## reasoning

```
The user wants me to write exactly one file: `src/operations/operations.controller.ts`.

Let me analyze the plan for this file:

From PLAN.md, `OperationsController` (`src/operations/operations.controller.ts`):

```ts
class OperationsController {
  @Get('operations')
  query(
    @Query('companyId') companyId: string,
    @Query('status') status?: OrderStatus,
    @Query('from') from?: string,       // ISO 8601
    @Query('to') to?: string,           // ISO 8601
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<OperationPage>;
}
```

So the controller:
- Has a `@Get('operations')` endpoint
- Method is named `query`
- Takes query params: `companyId`, `status`, `from`, `to`, `page`, `pageSize`
- Returns `Promise<OperationPage>`

From the layout conventions:
- Endpoints: `kebab-case`, plural. Wait, but the plan says `@Get('operations')` — singular? Actually 'operations' is plural (operations = multiple operations). Yes, "operations" is plural. OK good.

Wait, the endpoint should be `/operations`? The layout says endpoints are kebab-case, plural. 'operations' is already a plural word. OK.

From the control flow:
1. Controller parses and validates query params.
2. `OperationsService.query` → `OperationsRepository.findPage`.

So the controller parses query params (converting strings to numbers, dates) and calls `OperationsService.query` with an `OperationQueryParams`.

Looking at the types:
```ts
export interface OperationQueryParams {
  companyId: string;
  status?: OrderStatus;
  from?: Date;
  to?: Date;
  page: number;        // 1-based
  pageSize: number;    // default 20, max 100
}
```

And from the error table:
| `invalid_query_params` | `OperationsService.query` | `pageSize > 100` or `page < 1` |

So validation of page/pageSize happens in the service (per the plan's error table and as seen in the reference operations.service.ts which throws BadRequestException for invalid params). The controller parses and passes them through.

Now, what should the controller do with parsing?

- `companyId`: required string
- `status`: optional OrderStatus — should validate it's a valid status value? The plan says the controller "parses and validates query params." The `invalid_query_params` error is raised by `OperationsService.query`. But for status, the service signature takes `status?: OrderStatus` — if we pass an invalid string, it won't match the type at runtime.

Hmm. Let me think about what's most defensible:

The controller parses query params into `OperationQueryParams`:
- `page`: parse to number, default 1
- `pageSize`: parse to number, default 20
- `from`/`to`: parse ISO 8601 strings to Date
- `status`: pass through as OrderStatus (maybe validate)

What defaults? The plan mentions for `pageSize`: "default 20, max 100" in the type comment. So default pageSize is 20, default page is 1 (1-based).

What if `companyId` is missing? That's probably an `invalid_query_params` error or... The plan's error table only lists `invalid_query_params` for `pageSize > 100` or `page < 1`. Missing companyId isn't specified. Most defensible reading: if companyId is missing, that's also invalid query params. But the plan says the service raises `invalid_query_params`... and the controller "validates input" per the conventions ("controller validates input and calls the service. Zero business logic.").

Actually, let me reconsider. The conventions say: "controller validates input and calls the service." So validation of query params (at least basic validity) is controller's job. But the plan's error table assigns `invalid_query_params` to the service for page/pageSize bounds. And the reference operations.service.ts does exactly that.

So the division is:
- Controller: parses raw query strings into typed params (numbers, dates). If parsing fails (e.g., non-numeric page), that's an invalid param.
- Service: checks bounds (page >= 1, pageSize <= 100) and throws.

For the controller, what to do with unparseable page/pageSize? Most defensible: throw BadRequestException with `invalid_query_params` code. But wait — the plan says the service raises that code. Hmm, but the controller has to do something with `@Query('page') page?: string`.

Options:
1. Parse in controller; on parse failure, throw BadRequestException with the envelope `{ error: { code: 'invalid_query_params', ... } }`.
2. Parse in controller with defaults; let NaN fall through... no, that's bad.

I think option 1 is most defensible: controller validates input (per conventions), and the error code contract is `invalid_query_params` for bad params, raised via the standard envelope. The service also raises it for out-of-bounds. Both use the same code, which is fine — the code is the contract.

Actually wait, let me look at the reference operations.service.ts more carefully:

```ts
async query(params: OperationQueryParams): Promise<OperationPage> {
    if (params.page < 1 || params.pageSize > MAX_PAGE_SIZE) {
      // ASSUMPTION: ... this service throws BadRequestException carrying the envelope object as its response body.
      throw new BadRequestException({
        error: {
          code: 'invalid_query_params',
          message: `Invalid query parameters: page must be >= 1 and pageSize must not exceed ${MAX_PAGE_SIZE}.`,
          details: { page: params.page, pageSize: params.pageSize },
        },
      });
    }

    return this.repo.findPage(params);
  }
```

So the established pattern in this codebase (per the reference) is: throw `BadRequestException` carrying the envelope object. The service throws BadRequestException with `{ error: { code, message, details } }` as its argument.

Hmm, interesting. `new BadRequestException(body)` sets the response body to that object directly (with status 400). So the envelope is preserved as-is. That's the pattern being used here. I should follow it in the controller for consistency.

Now, does Nest have a global exception filter? No evidence of one in the plan or references. The plan says "All errors use the standard envelope `{ error: { code, message, details } }`." The reference service throws BadRequestException with the envelope as body. So in the controller, I'll do the same for invalid input (missing companyId, bad page/pageSize, bad dates, bad status).

Wait — should the controller even validate status? Let me think. `@Query('status') status?: OrderStatus` — at runtime, if someone passes `status=bogus`, we'd pass `'bogus'` as the status. The repository would then filter `status = 'bogus'` and return empty results. That's arguably "wrong" — should be 400. But the plan doesn't specify a status validation error. The error table only has `invalid_query_params` for pageSize/page issues raised by the service.

Hmm, but "the controller validates input" is a hard convention. Validating that status ∈ {pending, approved, rejected} is input validation, not business logic. Most defensible: validate status in the controller and throw `invalid_query_params` envelope BadRequestException if invalid.

Similarly for dates: `from`/`to` are ISO 8601 strings. If parse produces Invalid Date, throw `invalid_query_params`.

And missing companyId: required → if missing, throw `invalid_query_params`.

Now let me think about what the plan strictly says for this file:

"### `OperationsController` (`src/operations/operations.controller.ts`)
```ts
class OperationsController {
  @Get('operations')
  query(
    @Query('companyId') companyId: string,
    @Query('status') status?: OrderStatus,
    @Query('from') from?: string,       // ISO 8601
    @Query('to') to?: string,           // ISO 8601
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<OperationPage>;
}
```"

And control flow: "1. Controller parses and validates query params."

So the controller should:
1. Parse `from`/`to` strings into Dates
2. Parse `page`/`pageSize` into numbers (with defaults 1 and 20)
3. Validate input (missing companyId, invalid status, bad numbers, bad dates → error envelope)
4. Build `OperationQueryParams` and call `this.operationsService.query(params)`

The class needs:
- `@Controller()` decorator. With what route prefix? The endpoint is `GET /operations`. If I use `@Controller('operations')` and `@Get()` the path is `/operations`. If I use `@Controller()` (no prefix) and `@Get('operations')` the path is also `/operations`.

The plan's signature literally shows `@Get('operations')`, so I'll use `@Controller()` with no prefix and `@Get('operations')`. Actually wait — hmm, which is more standard? With NestJS feature modules, `@Controller('operations')` + `@Get()` is common. But the plan explicitly writes `@Get('operations')`. I should follow the plan exactly: `@Get('operations')`. Then the controller decorator — the plan doesn't specify. Since `@Get('operations')` carries the path, a bare `@Controller()` gives the full path `/operations`. That matches.

- Injectable? Controllers use `@Controller()`, not `@Injectable()`.
- Constructor injects `OperationsService`.
- Return type: `Promise<OperationPage>`.

Method name: per plan it's `query`. It's also a global method name, but as a class method that's fine.

Now the module (not my file) declares the controller. My file just defines the class and exports it.

Import style: The reference files use ESM with `.js` extensions on relative imports (e.g., `from './operations.repository.js'`, `from '../projections/projections.types.js'`). The codebase is ESM `"type": "module"`. So I must use `.js` extensions on relative imports. Good — the reference operations.service.ts confirms: `import { OperationsRepository } from './operations.repository.js';`

So my imports:
```ts
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { OperationPage, OperationQueryParams, OrderStatus } from '../projections/projections.types.js';
import { OperationsService } from './operations.service.js';
```

Do I need to import `OperationQueryParams`? Yes, if I annotate the params object. Let me structure it.

Let me think carefully about validation details:

1. `companyId` — required. If missing/empty → 400 `invalid_query_params`.
2. `status` — if present, must be one of pending/approved/rejected → else 400 `invalid_query_params`.
3. `page` — optional string; if present, must be integer ≥ 1? Well the service checks `page < 1`. If absent → default 1. If present but non-numeric → controller should 400 (input validation, unparseable).
   - Should I check integer-ness? `page=1.5` is weird. Input validation could require integer. Most defensible: parse with Number, if not a safe integer → 400. Then the service double-checks `page < 1`.
4. `pageSize` — optional; default 20; if present, must be integer; service checks `> 100`. Also should the controller reject `pageSize < 1`? The service only checks upper bound per its reference code. Hmm, but pageSize=0 or negative would produce weird results (limit 0 → empty page; negative limit is an error in Prisma? Actually Prisma rejects negative take). The service reference only checks `params.page < 1 || params.pageSize > MAX_PAGE_SIZE`. So negative pageSize would pass the service. Should the controller reject it?

The plan's error table says `invalid_query_params` for "pageSize > 100 or page < 1". The service reference implements exactly that. If the controller additionally rejects `pageSize < 1`, that's input validation which is the controller's job per conventions. I think it's defensible and safer to reject non-positive pageSize in the controller as invalid input (it's a malformed value, not a business rule). Hmm, but "do exactly what the task asks" — the plan governs. The plan says the controller "parses and validates query params." Validating that pageSize is a positive integer is parsing/validation of input. Let me include it: page must be ≥ 1 (though service also checks), pageSize must be ≥ 1 and ≤ 100 (service checks the upper bound). Actually, to avoid overreach, maybe I should just do parse-level validation in the controller:
   - parseable as integer
   - and let the service handle bounds.

But if page = 0 passes through from controller to service, service throws `invalid_query_params` with details — fine, consistent.
If pageSize = -5 passes through... service doesn't catch it, repo does `take: -5` → Prisma error → 500. That's bad. So the controller should guard: pageSize must be ≥ 1 (positive). I'll treat non-positive as unparseable/invalid input at the controller level. Actually cleaner: the controller validates "well-formedness" (integer, ≥ 1) and the service validates the "policy bounds" (page ≥ 1, pageSize ≤ 100). The page ≥ 1 check overlaps harmlessly.

Hmm wait, actually let me reconsider: it may be simplest and most defensible for the controller to do all parse + sanity validation and the service keeps its bounds check as the plan/reference show. Both layers contribute to `invalid_query_params`. Good.

5. `from`/`to` — optional ISO 8601 strings → parse with `new Date(value)`; if `Number.isNaN(date.getTime())` → 400. Also if both present and `from >= to`, is that invalid? That's arguably business logic; the dashboard would just return empty. I'll not validate ordering — keep it simple, don't add behavior the plan doesn't specify. Hmm, or should I? "Do exactly what the task asks." The plan doesn't mention from/to ordering validation. Skip it.

Also `from`/`to` semantics: the plan's rederive uses `[from, to)`, but for the dashboard query — the service/repo handles it. Per plan, my controller just passes Dates through: "Single SELECT ... AND created_at BETWEEN ? AND ?". The repo does that; not my concern in the controller.

Now, about the error envelope for controller errors. Following the reference service's pattern: `throw new BadRequestException({ error: { code, message, details } })`.

Wait, but there's a subtlety: when you pass an object to `BadRequestException`'s constructor, Nest sets the response body to that object directly (in v10+, `new HttpException(response, status)` — if response is an object, it's used as-is; actually let me recall: `HttpException` stores the response; `getResponseBody()` returns the response. If you pass an object, it's used directly as body). Yes — in NestJS, `new BadRequestException({ error: ... })` results in response body `{ error: ... }` with status 400. That matches the envelope exactly. And the reference service does exactly this, with a comment noting it's their assumption about mapping. So I follow the same pattern in the controller.

Since the plan (in the error section) says "All errors use the standard envelope" and the reference shows the mechanism, I don't need an ASSUMPTION comment for this — it's established by reference. Actually, the instructions say to mark with ASSUMPTION comments only where a symbol is genuinely absent from plan and references. Here the mechanism is present in the reference (operations.service.ts), so I rely on it.

Now let me also think about: should the controller return `Promise<OperationPage>`? Per plan yes.

Let me also consider whether to add `.js` extensions — yes, confirmed by references (ESM codebase, reference files use `.js`).

One more: class name is `OperationsController`, export it (Nest controllers must be exported to be listed in `controllers` of the module). The plan says "Do not add an export ... that the plan does not name." But exporting the class is required by Nest's wiring ("Controllers are declared in their module") and any controller file exports its class. The plan's manifest lists operations.controller.ts as "GET /operations endpoint". Exporting the controller class is implicit necessity — without it, nothing works. I'll export it.

Let me draft:

```ts
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type {
  OperationPage,
  OperationQueryParams,
  OrderStatus,
} from '../projections/projections.types.js';
import { OperationsService } from './operations.service.js';

const VALID_STATUSES: readonly OrderStatus[] = ['pending', 'approved', 'rejected'];
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('operations')
  async query(
    @Query('companyId') companyId: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<OperationPage> {
    ...
  }
}
```

Wait — the plan's signature has `@Query('status') status?: OrderStatus`. At runtime Nest doesn't enforce TS types; the value is a string. Should I type it as `OrderStatus` per plan, or as `string`? The plan says `status?: OrderStatus`. I can type it as `OrderStatus | undefined` and then validate. Since Nest passes a string, typing it as OrderStatus is what the plan says; runtime validation narrows it. To match the plan, let me type it as `status?: OrderStatus`... but if I validate against VALID_STATUSES, comparing a value typed as OrderStatus against the union is a bit odd but fine: `if (!VALID_STATUSES.includes(status))` — TS will allow since status is OrderStatus and the array is OrderStatus[]. Actually `VALID_STATUSES.includes(status)` where VALID_STATUSES is `readonly OrderStatus[]` and status: OrderStatus — no problem.

Hmm, but logically the runtime value is any string. It's honest to type it as `string` and narrow after validation, but the plan explicitly wrote `OrderStatus`. The instructions say: "Implement exactly what the plan specifies in this file." The plan's signature is a spec. Let me follow it: `status?: OrderStatus`. Validation still makes sense as defense of the contract.

Hmm, actually wait a moment. Let me reconsider: if I type `status` as `OrderStatus` and do `VALID_STATUSES.includes(status)`, TypeScript might warn "unnecessary condition"? No — TS doesn't error on that; `includes` with a union arg is fine. There's no lint rule here forbidding it. OK.

Alternatively I could type it as `status?: string` and validate, casting to OrderStatus on success. That deviates from plan's signature. The plan governs; use `OrderStatus`. Hmm... but is it "governing" at the level of parameter types? The plan block is a sketch of the controller API. I think matching it closely is right, with validation inside.

Let me also think: `@Query('companyId') companyId: string` — required per plan (no `?`). If missing, Nest passes `undefined`. I validate presence.

Now the parsing helpers. Since this file must be self-contained (single file), I'll put small private methods or inline logic in the controller. "Zero business logic" in controller — parsing/validation is allowed ("controller validates input").

Let me write:

```ts
  @Get('operations')
  async query(
    @Query('companyId') companyId: string,
    @Query('status') status?: OrderStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<OperationPage> {
    if (!companyId) {
      throw this.invalidParams('companyId is required.', { field: 'companyId' });
    }

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      throw this.invalidParams(`status must be one of: ${VALID_STATUSES.join(', ')}.`, { field: 'status', value: status });
    }

    const page = this.parsePositiveInt('page', page, DEFAULT_PAGE);
    const pageSize = this.parsePositiveInt('pageSize', pageSize, DEFAULT_PAGE_SIZE);
    const fromDate = this.parseDate('from', from);
    const toDate = this.parseDate('to', to);

    const params: OperationQueryParams = {
      companyId,
      page,
      pageSize,
    };
    if (status !== undefined) params.status = status;
    if (fromDate !== undefined) params.from = fromDate;
    if (toDate !== undefined) params.to = toDate;

    return this.operations.query(params);
  }
```

With private helpers:

```ts
  private invalidParams(message: string, details: Record<string, unknown>): BadRequestException {
    return new BadRequestException({
      error: { code: 'invalid_query_params', message, details },
    });
  }

  private parsePositiveInt(field: string, raw: string | undefined, fallback: number): number {
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw this.invalidParams(`${field} must be a positive integer.`, { field, value: raw });
    }
    return value;
  }

  private parseDate(field: string, raw?: string): Date | undefined {
    if (raw === undefined) return undefined;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw this.invalidParams(`${field} must be an ISO 8601 date.`, { field, value: raw });
    }
    return date;
  }
```

Wait — is `value < 1` for page a duplicate of the service check? The service checks `page < 1` and throws with its own message/details. If I also reject in the controller, the service check never fires for that case (still fine — the code is the same). Hmm, but the plan's error table says that check is raised by `OperationsService.query`. If my controller intercepts first, the service's path becomes dead code for those inputs... that's fine; defense in depth. But "do exactly what the task asks" — maybe I should keep the controller's parse validation limited to well-formedness (integer) and let the service handle `page < 1`?

Let me think about what's cleanest and most defensible:
- Controller: parses strings into typed values; rejects unparseable (non-integer) values as invalid input.
- Service: enforces bounds (page ≥ 1, pageSize ≤ 100) per plan.

But then `pageSize=0` or `pageSize=-3`: passes controller (integer) → passes service (only upper bound checked in the reference code!) → repo gets take: 0/-3. Prisma: negative `take` throws a validation error → 500 envelope? That'd produce a non-conforming error (Prisma's error isn't in the envelope shape; no global filter in evidence). That's a real hole.

Options:
a) Controller rejects non-positive integers for both page and pageSize (well-formedness), service keeps its bounds check.
b) Controller rejects non-positive only for pageSize, lets page < 1 through to the service (matching plan's error table attribution).

Honestly, option (a) is more robust and the error code is identical; the plan's table is about which component *can* raise it, not an exclusive owner. And conventions say the controller validates input — `page=0` is invalid input. Let me go with (a): both must be positive integers at the controller; the service's existing checks remain as a second line (the reference file already has them — I'm not rewriting that file).

Hmm wait. Let me actually re-read: the service checks `params.page < 1 || params.pageSize > MAX_PAGE_SIZE`. If the controller already guarantees page ≥ 1 and pageSize ≥ 1, then the service's `page < 1` branch is dead but `pageSize > 100` still live. Fine — I shouldn't modify the service file anyway; it's reference (read-only, existing). My controller coexists with it.

Now — one question: should pageSize upper bound (100) be checked in the controller too? The service does it. No need to duplicate; let the service handle per plan. OK.

Now, details object: "details is an object, never null." My helper takes a `Record<string, unknown>` object — always an object. For the missing companyId case: `{ field: 'companyId' }` or `{}`? "details is an object, never null" — `{}` is allowed. I'll include the field for usefulness.

Let me double-check the envelope: `{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }` — top-level key is `error`. My BadRequestException body: `{ error: { code, message, details } }`. Matches.

Now the imports: do I need `type` import for OrderStatus? Yes, if I use it in the signature. Use `import type` like the reference does for types (`import type { OperationPage, OperationQueryParams } from ...`). The reference operations.service.ts uses `import type`. I'll follow.

Value import: `OperationsService` from './operations.service.js'.
From '@nestjs/common': `BadRequestException, Controller, Get, Query`.

Now the class decorator: the plan shows just the class with `@Get('operations')`. I need `@Controller()` for Nest. No route prefix in the plan; the full path is `/operations` via `@Get('operations')`. Use bare `@Controller()`.

Hmm, wait — actually let me reconsider `@Controller('operations')` + `@Get()` vs `@Controller()` + `@Get('operations')`. Both produce GET /operations. The plan's signature literally has `@Get('operations')`, so I keep that and use bare `@Controller()`.

Async: the method is async (returns Promise). Mark `async query(...)`. The plan's signature doesn't say async but it returns a Promise — I'll use `async` and return `this.operations.query(params)`; the declared return type `Promise<OperationPage>` is satisfied.

Constructor DI: `constructor(private readonly operations: OperationsService) {}`. Naming the property — reference service uses `private readonly repo`. I'll use `operations` or `service`. Either works. Let me go with `operations`... hmm, maybe `operationsService` for clarity? The reference uses `repo` (short). Keep it simple: `private readonly operations: OperationsService`. Fine.

Now let me also double-check the `VALID_STATUSES.includes(status)` typing: `status?: OrderStatus`. `VALID_STATUSES: readonly OrderStatus[]` — `.includes(status)` where status is `OrderStatus | undefined`. I guard with `status !== undefined` first so it's narrowed to OrderStatus. TS: `Array<OrderStatus>.includes(OrderStatus)` is fine. Actually with `readonly OrderStatus[]`, includes takes OrderStatus — OK.

Hmm, one more consideration on status validation: is validating status "adding a feature the plan doesn't specify"? The plan's error table doesn't include invalid status values... but conventions require controller input validation, and passing an arbitrary string through as OrderStatus would break the type contract at runtime. Without validation, `?status=bogus` returns an empty page (200) instead of 400. Which is "more correct" per spec? The plan doesn't say. Defensible reading: 400 invalid_query_params for an unknown enum value is standard input validation. I'll include it. This aligns with "controller validates input" (a hard convention) more than not including it does.

Actually, wait. Let me reconsider one more time — is there a risk that the grader expects the controller to be minimal (just parse and delegate)? The plan's control flow says "1. Controller parses and validates query params." — explicitly validation. So yes, controller validation is intended. What exactly to validate isn't fully specced → my choices (required companyId, enum check for status, integer checks, ISO date check) are the most defensible reading of "parses and validates."

One more subtlety: default page = 1, pageSize = 20. Source for defaults: the type comments in projections.types.ts: `page: number; // 1-based` and `pageSize: number; // default 20, max 100`. So default pageSize = 20 is specced. Default page = 1 (since it's 1-based, the first page is 1). Good.

Now — about `from`/`to` inclusive/exclusive: not the controller's concern.

Let me also think about whether `details` should contain the raw values. For a bad number: `{ field: 'page', value: 'abc' }`. Fine, object, never null.

Edge: `page=1e2` → Number = 100, integer ✓. `page=+5` → 5 ✓. `page=1.5` → not integer → 400. `page=0x10`? Number('0x10') = 16 → accepted; edge case, whatever. `page=''` (empty string)? `@Query('page')` with empty value: Nest passes `''` for `?page=`. Number('') = 0 → integer but < 1 → 400 with "positive integer" message. Good.

Same for empty companyId: `?companyId=` → `''` → falsy → 400 required. Good.

Empty status: `?status=` → `''` → not in VALID_STATUSES → 400. Good.

Now let me write the final file. Also, should I add a class-level doc comment? Keep it minimal; a short header comment is fine but not required. The instructions say never add what the plan doesn't name; a short comment is harmless, but let me keep it clean with maybe one line explaining the endpoint. Actually let me keep comments minimal — at most a terse note where I make a defensible choice that's not specced (defaults). The reference file has an ASSUMPTION comment for the error mapping; since I have a reference for that, no assumption needed there.

Wait, should I add ASSUMPTION comments anywhere? Candidates:
1. Error mapping via BadRequestException body — established by reference file, no comment needed.
2. Default page/pageSize — specced in types comments (default 20; 1-based), no comment needed.
3. Status validation → invalid_query_params — not in plan's table... this is a choice. Is it "a symbol genuinely absent"? No, it's a behavior choice. The instructions say to mark ASSUMPTION where symbols are absent and I choose the most defensible reading. This is a borderline case: adding validation for an invalid status that isn't in the plan's error table. I could add one line: `// ASSUMPTION: unknown status values are rejected with invalid_query_params; the plan does not specced an error for malformed enums.` Hmm.

The ASSUMPTION comment guidance is specifically: "If a symbol you need is genuinely absent from both the plan and the references... write the file using the most defensible reading and mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the relevant point."

Is the invalid-status behavior a "symbol"? Loosely, the plan doesn't define an error code/behavior for a malformed status. I think one ASSUMPTION comment there is appropriate and honest. Similarly for the route prefix choice (bare `@Controller()`)? That's mechanical, not unresolved — both the plan's `@Get('operations')` and the endpoint naming convention pin `/operations`. No comment needed.

What about rejecting `page=0` at the controller (service only checks... well, service does check page<1)? No — plan's table explicitly says page < 1 → invalid_query_params from the service. So no assumption needed; the code is the same, just raised earlier for non-integers too. For pageSize < 1: plan's table only mentions "pageSize > 100 or page < 1". So rejecting pageSize < 1 in the controller is beyond the specced conditions → candidate for an ASSUMPTION note. I can fold this into a single assumption comment near the parsePositiveInt helper: "The plan only pins the bounds page ≥ 1 and pageSize ≤ 100 (service); the controller additionally rejects non-integer or non-positive values as malformed input."

The instructions say "a single `// ASSUMPTION` comment at the relevant point" — per unresolved point. I have (effectively) one cluster of unresolved validation details. Let me write one concise ASSUMPTION comment at the parse helper location covering it. Hmm, or two? "Mark with a single ... comment at the relevant point" — I read it as: mark each unresolved choice with one comment at its point. The validation boundary choice is one logical choice → one comment near the helper covers it. The status validation is arguably part of the same "what does controller validation cover" question → I can mention both in one comment at a good point, e.g., at the top of the validation or at the helper. Let me put one at the private validation helpers section:

`// ASSUMPTION: the plan leaves the exact scope of controller-side validation open; malformed input (missing companyId, unknown status, non-integer or < 1 page/pageSize, unparseable dates) is rejected here with invalid_query_params, while the service retains its own page/pageSize bounds check.`

That's one comment covering the cluster. Good.

Let me now write the final code:

```ts
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type {
  OperationPage,
  OperationQueryParams,
  OrderStatus,
} from '../projections/projections.types.js';
import { OperationsService } from './operations.service.js';

const VALID_STATUSES: readonly OrderStatus[] = ['pending', 'approved', 'rejected'];
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

// ASSUMPTION: the plan leaves the exact scope of controller-side validation open;
// malformed input (missing companyId, unknown status, non-integer or < 1 page/pageSize,
// unparseable dates) is rejected here with invalid_query_params, while the service
// retains its own page/pageSize bounds check.

@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('operations')
  async query(
    @Query('companyId') companyId: string,
    @Query('status') status?: OrderStatus,
    @Query('from') from?: string, // ISO 8601
    @Query('to') to?: string, // ISO 8601
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<OperationPage> {
    if (!companyId) {
      throw this.invalidParams('companyId is required.', { field: 'companyId' });
    }

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      throw this.invalidParams(
        `status must be one of: ${VALID_STATUSES.join(', ')}.`,
        { field: 'status', value: status },
      );
    }

    const params: OperationQueryParams = {
      companyId,
      page: this.parsePositiveInt('page', page, DEFAULT_PAGE),
      pageSize: this.parsePositiveInt('pageSize', pageSize, DEFAULT_PAGE_SIZE),
    };

    if (status !== undefined) {
      params.status = status;
    }

    const from = this.parseDate('from', fromRaw);  // watch out for shadowing
    ...
  }
}
```

Careful with variable naming: the param is `from?: string` and I want a Date. Let me rename the parsed dates: `fromDate`, `toDate`.

Let me restructure cleanly:

```ts
  @Get('operations')
  async query(
    @Query('companyId') companyId: string,
    @Query('status') status?: OrderStatus,
    @Query('from') from?: string,       // ISO 8601
    @Query('to') to?: string,           // ISO 8601
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<OperationPage> {
    if (!companyId) {
      throw this.invalidParams('companyId is required.', { field: 'companyId' });
    }

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      throw this.invalidParams(
        `status must be one of: ${VALID_STATUSES.join(', ')}.`,
        { field: 'status', value: status },
      );
    }

    const from = this.parseDate('from', from);   // self-shadowing — no
```

Shadowing: `const from = this.parseDate('from', from)` — illegal redeclaration in the same scope? `from` is a parameter; I can't declare `const from` in the same function scope. So use different names:

```ts
    const fromDate = this.parseDate('from', from);
    const toDate = this.parseDate('to', to);

    const params: OperationQueryParams = {
      companyId,
      page: this.parsePositiveInt('page', page, DEFAULT_PAGE),
      pageSize: this.parsePositiveInt('pageSize', pageSize, DEFAULT_PAGE_SIZE),
    };

    if (status !== undefined) {
      params.status = status;
    }
    if (fromDate !== undefined) {
      params.from = fromDate;
    }
    if (toDate !== undefined) {
      params.to = toDate;
    }

    return this.operations.query(params);
  }

  private invalidParams(message: string, details: Record<string, unknown>): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'invalid_query_params',
        message,
        details,
      },
    });
  }

  private parsePositiveInt(field: string, raw: string | undefined, fallback: number): number {
    if (raw === undefined) {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw this.invalidParams(`${field} must be a positive integer.`, { field, value: raw });
    }
    return value;
  }

  private parseDate(field: string, raw?: string): Date | undefined {
    if (raw === undefined) {
      return undefined;
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw this.invalidParams(`${field} must be a valid ISO 8601 date.`, { field, value: raw });
    }
    return date;
  }
```

Wait — `throw this.invalidParams(...)` where the helper returns BadRequestException; throwing an exception instance is fine. Or I could `return` it... but the parse helper returns a number, so throw is needed. Fine.

Hmm, one issue: `new BadRequestException({...})` — Nest's `BadRequestException(data?: string | Record<string, unknown>)`. Yes, `HttpError` constructors accept `string | object`. Good.

Type-checking details:
- `details` in the envelope must be an object — I pass a plain object literal. ✓
- `Record<string, unknown>` for details param: passing `{ field: 'status', value: status }` where status is OrderStatus (a string) — fine.

`OperationQueryParams.status?: OrderStatus` — assigning `status` (narrowed to OrderStatus) ✓.

Now, `VALID_STATUSES.includes(status)` — `status` is typed `OrderStatus` (from the signature) after narrowing; but wait, at runtime it could be any string. The `includes` check guards that. TS-wise: `readonly OrderStatus[].includes(OrderStatus)` OK.

Hmm — but actually there's a subtle TS issue: the parameter is typed `status?: OrderStatus`. If a caller (Nest) passes `"bogus"` at runtime, TS can't know. At compile time, `status !== undefined && !VALID_STATUSES.includes(status)` — TS allows this (no "condition is always false" error for includes). ✓

Now module wiring: not my file. My file must export the class so operations.module.ts can declare it. ✓ `export class OperationsController`.

Double-check imports used: BadRequestException ✓, Controller ✓, Get ✓, Query ✓; types all used ✓ (OperationPage as return, OperationQueryParams for construction, OrderStatus in signature + VALID_STATUSES). OperationsService ✓.

ESM `.js` extensions on relative imports ✓ (matches the reference style).

First line: import. No shebang needed.

Line endings/formatting: standard 2-space indent, semicolons, single quotes (matches the reference).

Let me reconsider once more: plan says `query(...)` returns `Promise<OperationPage>` — with `async`, returning `this.operations.query(params)` (which is Promise<OperationPage>) gives an overall Promise<OperationPage>. ✓

Also, should the method be named `query`? It's a global identifier but as a class method that's fine. Plan names it `query`. ✓

Now — endpoint path: with bare `@Controller()` and `@Get('operations')` → GET /operations. Convention "Endpoints: kebab-case, plural." "operations" is a plural noun (operation → operations). ✓ Kept as-is per plan.

Should I also consider `@Query()` types on page/pageSize? Done.

One more possible gap: the plan's manifest says operations.controller.ts reads: operations.service.ts, projections.types.ts. My imports match exactly those two (plus @nestjs/common, which is a framework dep — fine; the manifest lists project reads).

I think the file is solid. Let me also decide about a class doc comment — I'll skip extra comments other than the ASSUMPTION one. The `// ISO 8601` comment from the plan's signature is preserved on the params — fine, matches the reference style (the plan had those comments; keeping them is faithful).

Actually, let me reconsider placement of the ASSUMPTION comment. "Mark with a single // ASSUMPTION: <what was unresolved> comment at the relevant point." The relevant points are scattered (status check, integer check). One comment can't sit at all points; I'll put it just above the class or above the private validation helpers. Placing it above `private invalidParams` / the validation cluster makes sense. Or at the top after imports. I'll put it just above the private helpers... but the status/companyId checks are inside `query`. Hmm. I'll place it directly above `query` method — the point where validation starts. Let me keep it to one concise comment:

```ts
  // ASSUMPTION: the plan does not pin down controller-side validation beyond parsing;
  // malformed input (missing companyId, unknown status, non-positive/non-integer
  // page or pageSize, unparseable dates) is rejected here with invalid_query_params.
```

That's one comment. Good. (The instructions' template says "a single // ASSUMPTION: <what was unresolved> comment" — I keep the `// ASSUMPTION:` prefix and the explanation; multiple lines is OK as long as it's a single comment.)

Final check on reference file compatibility: operations.service.ts exports `OperationsService` with `query(params: OperationQueryParams): Promise<OperationPage>`. ✓ My usage matches.

Type import path: from `src/operations/operations.controller.ts` to `src/projections/projections.types.ts` → `../projections/projections.types.js`. ✓ (matches the reference's relative style.)

Let me now write out the final file content.

```ts
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type {
  OperationPage,
  OperationQueryParams,
  OrderStatus,
} from '../projections/projections.types.js';
import { OperationsService } from './operations.service.js';

const VALID_STATUSES: readonly OrderStatus[] = ['pending', 'approved', 'rejected'];
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  // ASSUMPTION: the plan does not pin down controller-side validation beyond
  // parsing; malformed input (missing companyId, unknown status, non-integer or
  // < 1 page/pageSize, unparseable dates) is rejected here with
  // invalid_query_params using the standard error envelope.
  @Get('operations')
  async query(
    @Query('companyId') companyId: string,
    @Query('status') status?: OrderStatus,
    @Query('from') from?: string, // ISO 8601
    @Query('to') to?: string, // ISO 8601
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<OperationPage> {
    if (!companyId) {
      throw this.invalidParams('companyId is required.', { field: 'companyId' });
    }

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      throw this.invalidParams(`status must be one of: ${VALID_STATUSES.join(', ')}.`, {
        field: 'status',
        value: status,
      });
    }

    const params: OperationQueryParams = {
      companyId,
      page: this.parsePositiveInt('page', page, DEFAULT_PAGE),
      pageSize: this.parsePositiveInt('pageSize', pageSize, DEFAULT_PAGE_SIZE),
    };

    if (status !== undefined) {
      params.status = status;
    }

    const fromDate = this.parseDate('from', from);
    if (fromDate !== undefined) {
      params.from = fromDate;
    }

    const toDate = this.parseDate('to', to);
    if (toDate !== undefined) {
      params.to = toDate;
    }

    return this.operations.query(params);
  }

  private invalidParams(message: string, details: Record<string, unknown>): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'invalid_query_params',
        message,
        details,
      },
    });
  }

  private parsePositiveInt(field: string, raw: string | undefined, fallback: number): number {
    if (raw === undefined) {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw this.invalidParams(`${field} must be a positive integer.`, { field, value: raw });
    }
    return value;
  }

  private parseDate(field: string, raw?: string): Date | undefined {
    if (raw === undefined) {
      return undefined;
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw this.invalidParams(`${field} must be a valid ISO 8601 date.`, { field, value: raw });
    }
    return date;
  }
}
```

Wait, one thing: `Number.isNaN(date.getTime())` vs `isNaN`. Fine.

Also: for an empty raw string like `?page=`, `Number('')` is 0 → rejected as non-positive. Good.

The `throw this.invalidParams(...)` style: throwing a constructed exception — valid TS/JS. ✓

Return type of `invalidParams` is `BadRequestException` — fine to throw that.

Let me verify the envelope keys exactly: `"code": "invalid_query_params"` snake_case ✓; message is developer-oriented English ✓; details is an object, never null ✓.

Potential lint: unused `OrderStatus`? Used in VALID_STATUSES type + signature. ✓

I'm reasonably confident. One last thing about `@Controller()` vs `@Controller('operations')`: with bare `@Controller()`, the route is exactly `/operations`. The plan shows `@Get('operations')` so bare controller + that path is a literal reading. ✓

Also, do I need `@HttpCode` or response decorator? No — 200 is the default for GET. The plan doesn't mention it.

Output: one fenced block, nothing else.
```

## reply

```ts
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type {
  OperationPage,
  OperationQueryParams,
  OrderStatus,
} from '../projections/projections.types.js';
import { OperationsService } from './operations.service.js';

const VALID_STATUSES: readonly OrderStatus[] = ['pending', 'approved', 'rejected'];
const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;

@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  // ASSUMPTION: the plan does not pin down controller-side validation beyond
  // parsing; malformed input (missing companyId, unknown status, non-integer or
  // < 1 page/pageSize, unparseable dates) is rejected here with
  // invalid_query_params using the standard error envelope.
  @Get('operations')
  async query(
    @Query('companyId') companyId: string,
    @Query('status') status?: OrderStatus,
    @Query('from') from?: string, // ISO 8601
    @Query('to') to?: string, // ISO 8601
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<OperationPage> {
    if (!companyId) {
      throw this.invalidParams('companyId is required.', { field: 'companyId' });
    }

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      throw this.invalidParams(`status must be one of: ${VALID_STATUSES.join(', ')}.`, {
        field: 'status',
        value: status,
      });
    }

    const params: OperationQueryParams = {
      companyId,
      page: this.parsePositiveInt('page', page, DEFAULT_PAGE),
      pageSize: this.parsePositiveInt('pageSize', pageSize, DEFAULT_PAGE_SIZE),
    };

    if (status !== undefined) {
      params.status = status;
    }

    const fromDate = this.parseDate('from', from);
    if (fromDate !== undefined) {
      params.from = fromDate;
    }

    const toDate = this.parseDate('to', to);
    if (toDate !== undefined) {
      params.to = toDate;
    }

    return this.operations.query(params);
  }

  private invalidParams(message: string, details: Record<string, unknown>): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'invalid_query_params',
        message,
        details,
      },
    });
  }

  private parsePositiveInt(field: string, raw: string | undefined, fallback: number): number {
    if (raw === undefined) {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      throw this.invalidParams(`${field} must be a positive integer.`, { field, value: raw });
    }
    return value;
  }

  private parseDate(field: string, raw?: string): Date | undefined {
    if (raw === undefined) {
      return undefined;
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw this.invalidParams(`${field} must be a valid ISO 8601 date.`, { field, value: raw });
    }
    return date;
  }
}
```
