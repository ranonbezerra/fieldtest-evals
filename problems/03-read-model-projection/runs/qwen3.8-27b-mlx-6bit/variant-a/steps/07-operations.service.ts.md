# 07-operations.service.ts

## reasoning

```
Let's analyze what this file should be based on PLAN.md and the reference materials.

Plan regarding `OperationsService` (`src/operations/operations.service.ts`):

```ts
class OperationsService {
  constructor(repo: OperationsRepository);
  query(params: OperationQueryParams): Promise<OperationPage>;
}
```

And from section 4, the dashboard read path:
1. The controller parses and validates query parameters.
2. `OperationsService.query` → `OperationsRepository.findPage`.
3. A single `SELECT`...
4. Return the page.

Also, the errors section:
| `invalid_query_params` | `OperationsService.query` | when `pageSize > 100` or `page < 1` |

So the service should validate parameters: `pageSize > 100` or `page < 1` → throw an error with the code `invalid_query_params`. According to convention, errors use the envelope `{ error: { code, message, details } }`. NestJS exceptions: typically `BadRequestException` carries a message. However, the error envelope convention is... in this codebase's convention: "Errors — one envelope" with `code` being snake_case and being the contract. The service throws exceptions that presumably map to that envelope. The reference files do not show a specific exception class in this codebase, so the most defensible choice is: throw an HTTP exception (like `BadRequestException`) that conveys the code. But what is "most defensible"? The convention says errors use one envelope; `code` is the contract. Many NestJS projects implement a custom exception or an interceptor. Since we only have this file, what is needed is: throw an exception with code `invalid_query_params`.

Hmm — since there are no references to a shared error helper, the defensible choice is: throw `new BadRequestException({ code: 'invalid_query_params', message: ..., details: {...} })`. NestJS's `HttpException` takes a response body. Actually, the constructor of `BadRequestException`: `(response: string | Record<string, any>, description?: string)`. When passed an object, the body becomes that object. So the global interceptor would shape it... but I don't know whether there is an interceptor.

Given the constraint "do not add exports, features, or files that are not named in the plan" — I cannot create a shared error file. So within this file, the defensible reading is: throw `BadRequestException` with a body matching the error envelope. The convention states that `details` is an object and is never null, so it should include `details`.

Let's write the service:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  OperationPage,
  OperationQueryParams,
} from '../projections/projections.types.js';
import { OperationsRepository } from './operations.repository.js';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class OperationsService {
  constructor(private readonly operations: OperationsRepository) {}

  async query(params: OperationQueryParams): Promise<OperationPage> {
    this.validate(params);
    return this.operations.findPage({ ...params, pageSize: params.pageSize ?? DEFAULT_PAGE_SIZE });
  }

  private validate(params: OperationQueryParams): void {
    const problems: string[] = [];
    if (!Number.isInteger(params.page) || params.page < 1) {
      problems.push('page must be an integer >= 1');
    }
    if (!Number.isInteger(params.pageSize) || params.pageSize < 1 || params.pageSize > MAX_PAGE_SIZE) {
      problems.push('pageSize must be an integer between 1 and 100');
    }
    if (problems.length > 0) {
      throw new BadRequestException({
        error: {
          code: 'invalid_query_params',
          message: problems.join('; '),
          details: { page: params.page, pageSize: params.pageSize },
        },
      });
    }
  }
}
```

Wait — but the plan says `OperationQueryParams.pageSize: number; // default 20, max 100` — not optional. The types file shows `pageSize: number;` (required). But the comment says "default 20". And `page: number; // 1-based`. The controller parses the query parameters (strings) and probably applies defaults before calling the service? Hmm. The plan's controller signature: `query(... @Query('page') page?: string, @Query('pageSize') pageSize?: string ...)`. The controller "parses and validates query parameters" — so the controller applies the defaults. But the type `OperationQueryParams` requires `page: number; pageSize: number`. So the service receives values already defaulted? Yet "default 20" is noted in the types.

The task says: "This file: validates parameters and delegates to the repository." So the service's role is validation + delegation. The error table says `invalid_query_params` is thrown by `OperationsService.query` when `pageSize > 100` or `page < 1`. So the service validates those two conditions.

Should the service also apply the default pageSize of 20? The type has `pageSize: number` (non-optional). The controller, per the plan, parses query parameters; the controller is not our file. Since `pageSize` is a non-optional number in `OperationQueryParams`, the service cannot assume it might be undefined... but if the controller doesn't apply a default, it might pass `undefined`. Hmm.

Safest reading: the type declares required numbers; validation per the plan is only `pageSize > 100` or `page < 1`. The service should validate exactly that (plus minimally: non-positive pageSize?) and delegate. Let's not over-engineer.

Should I still apply `pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE`? But the type says it's required. Adding default handling contradicts the non-optional type. Let me just do validation and delegation, no more.

But wait — `OperationQueryParams` also has `from?: Date; to?: Date`. Those are presumably parsed by the controller. No problem.

The type of `status`: in the types file, it's `'pending' | 'approved' | 'rejected'`. But Prisma generates its own `OrderStatus` type. The projection table uses the enum `OrderStatus`. The type in operations.repository.ts imports `OperationQueryParams` from the types file, and the `status` field of the type is a string union — Prisma accepts the string literal as an enum. No problem, not our concern.

Next, error envelope: `{ "error": { "code": ..., "message": ..., "details": {} } }`. When throwing `BadRequestException` with an object body in NestJS, the HTTP response is exactly that object (if no global interceptor transforms it). So `throw new BadRequestException({ error: { code: 'invalid_query_params', message: '...', details: {...} } })` produces the envelope directly. That seems like the most defensible approach given we cannot create a shared exception file (the plan does not name such a file).

Alternative: create an HttpException subclass locally within the service file — but that adds surface area; the plan says the file "validates parameters and delegates to the repository." A small private class is still within the file. But simpler: throw `BadRequestException` with an envelope object as the body. Hmm, though note: when passing an object to `new BadRequestException(obj)`, NestJS sets the response body to that object. Good.

Message: developer-facing English. E.g., 'Invalid query parameters'. details: an object with problematic fields and values, or a list of issues. Let's put the received values in details: `{ page: params.page, pageSize: params.pageSize }`. This is an object, never null.

Now, validation details: the plan says `pageSize > 100` or `page < 1`. Should I also check `pageSize < 1`? The plan only lists those two. Strictly, "implement exactly what the plan specifies." The error condition: `pageSize > 100` or `page < 1`. Hmm, but `pageSize` of 0 or negative is also invalid; yet if I strictly follow the plan, only those two conditions trigger `invalid_query_params`. But what if the controller passes an invalid pageSize? The plan says the controller parses; the service validates per the error table. Let me implement exactly: `page < 1` or `pageSize > 100` → error. But should I also treat `pageSize < 1`? The types note says "default 20, max 100" — min not stated. Since the convention says don't add features beyond what is asked... The test in plan section 5 mentions "Pagination arithmetic" but not validation. Let me follow the error table literally: `pageSize > 100` or `page < 1`.

Hmm, but a pageSize of 0 with skip (page-1)*0=0, take: 0 → an empty page. A negative pageSize would break it. But per discipline, let's not add extra validation beyond the plan... actually wait, let me re-read: "implement exactly what this file specifies in the plan. Do not add exports, features, or files that are not named in the plan." Adding a `pageSize < 1` check is a minor robustness check, but it is extra behavior. The error table defines exactly when the error is thrown: "when `pageSize > 100` or `page < 1`". Let me implement exactly that.

Non-integer check? Not in the plan. Skip.

So:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  OperationPage,
  OperationQueryParams,
} from '../projections/projections.types.js';
import { OperationsRepository } from './operations.repository.js';

@Injectable()
export class OperationsService {
  constructor(private readonly operationsRepository: OperationsRepository) {}

  async query(params: OperationQueryParams): Promise<OperationPage> {
    if (params.page < 1 || params.pageSize > 100) {
      throw new BadRequestException({
        error: {
          code: 'invalid_query_params',
          message: `page must be >= 1 and pageSize must be <= 100 (got page=${params.page}, pageSize=${params.pageSize})`,
          details: { page: params.page, pageSize: params.pageSize },
        },
      });
    }

    return this.operationsRepository.findPage(params);
  }
}
```

Is `100` a magic number? I can name it as `const MAX_PAGE_SIZE = 100`. That is fine, and not "extra". A module-level constant.

Should the message be developer-facing English? Yes: e.g., 'Invalid query parameters: page must be >= 1 and pageSize must not exceed 100'.

Now — one subtlety: the envelope. `BadRequestException` with a body object `{ error: {...} }`: NestJS's `HttpException` will send it as-is (status 400). With no interceptor mentioned, this is the best I can do within this file. But is there a risk that the expected convention is a custom exception thrown from the service, with a global filter formatting it into the envelope? The references only contain the repository and types files — no exception utilities, no interceptor. So the most defensible reading is: throw an HTTP exception whose body is the envelope itself. I don't think a `// ASSUMPTION` comment is needed — actually, the instructions say: if a symbol you need is truly missing from both plan and references, do not silently guess; write the file with the most defensible reading and mark it with a single ASSUMPTION comment at the point where it matters.

The missing symbol here: the error mechanism (how to produce the envelope). The plan gives me code and when to throw; references don't show any error class. So I should mark with a single `// ASSUMPTION` comment where I throw, stating that we are throwing BadRequestException with the envelope as the HTTP body.

Where to put the comment: "at the point where it matters" — above the throw. One comment.

Let me double-check the import path style too: ESM, and references use `.js` extension in imports (e.g., `../projections/projections.types.js`). Good, follow that: `./operations.repository.js`.

Type-only imports: reference repository uses `import type { ... } from '../projections/projections.types.js';`. Follow.

Class name: `OperationsService`, per plan. Injectable decorator. Constructor parameter name: plan says `constructor(repo: OperationsRepository)`. To match the plan exactly, name the parameter `repo`? In NestJS, parameter names are not relevant for DI (it's type-based). Let me match the plan signature: `constructor(private readonly repo: OperationsRepository)`. Hmm, but for readability... the plan's signature is `constructor(repo: OperationsRepository)`. Let me use `repo`.

Method: `async query(params: OperationQueryParams): Promise<OperationPage>`.

Let me also confirm whether validation belongs before the delegation: yes, "validates parameters and delegates to the repository".

One more consideration: `details` is never null — an object. `{ page, pageSize }` fine.

Should I include both conditions in details, or only problematic ones? Keep it simple: received values.

Let me write the final file:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  OperationPage,
  OperationQueryParams,
} from '../projections/projections.types.js';
import { OperationsRepository } from './operations.repository.js';

const MAX_PAGE_SIZE = 100;

@Injectable()
export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  async query(params: OperationQueryParams): Promise<OperationPage> {
    if (params.page < 1 || params.pageSize > MAX_PAGE_SIZE) {
      // ASSUMPTION: no shared exception helper exists in the codebase references; the envelope is
      // produced by throwing BadRequestException with the error object as its HTTP body.
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
}
```

Wait: "mark with a single `// ASSUMPTION: <what was unresolved>` comment" — my comment should start with exactly `// ASSUMPTION:`. Let me reshape it:

```ts
      // ASSUMPTION: how to surface the error envelope is not specified by the plan or references;
      // BadRequestException carries the envelope object as its response body.
```

Hmm, one comment — two-line comments count as one comment but let's keep it concise, could be one line. Instruction: "mark with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters." One comment; let me make it one or two lines but with only the `//` prefix. Fine.

Actually — is an ASSUMPTION even warranted? The plan gives code and when to throw; the codebase convention gives the envelope. The missing part is truly how the exception maps to the envelope (interceptor or body). This is a genuine ambiguity. The convention block says "Errors — one envelope" with JSON shape, but doesn't say how it's produced (global filter?). Since the references include no app.module or interceptor, throwing with the body as envelope is the most defensible. Yes, include the ASSUMPTION comment.

Also double-checking: does NestJS's `BadRequestException` accept an object? Yes: `constructor(response: string | Record<string, any>, description?: string)`. When an object is passed, the message property of the exception is... actually it stores `response`; `getResponse()` returns the object. The built-in exceptions filter sends `{ statusCode: 400, message: ..., error: ... }`? No — for a custom object response, the filter sends the object as-is. Correct: `ExceptionsHandler` does `response.status(status).json(exception.getResponse())`. So body = our envelope object.

One more: should validation also happen in the controller? The plan says "controller parses and validates query parameters," and the error table attributes `invalid_query_params` to `OperationsService.query`. So it's possible both: controller parses strings → numbers; service enforces bounds. Fine — I implement only the service part.

Edge case: `params.pageSize > MAX_PAGE_SIZE` with `pageSize` being a number. Good.

Final check for "complete, from the first line to the last": yes, full file.

Reply with a single fenced block and nothing else.
```

## reply

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  OperationPage,
  OperationQueryParams,
} from '../projections/projections.types.js';
import { OperationsRepository } from './operations.repository.js';

const MAX_PAGE_SIZE = 100;

@Injectable()
export class OperationsService {
  constructor(private readonly repo: OperationsRepository) {}

  async query(params: OperationQueryParams): Promise<OperationPage> {
    if (params.page < 1 || params.pageSize > MAX_PAGE_SIZE) {
      // ASSUMPTION: neither the plan nor the references show how errors are mapped to the standard envelope; this service throws BadRequestException carrying the envelope object as its response body.
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
}
```
