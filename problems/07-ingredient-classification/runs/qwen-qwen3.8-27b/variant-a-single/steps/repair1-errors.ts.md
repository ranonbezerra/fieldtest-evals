# repair1-errors.ts

## reasoning

```
Let me analyze the compiler errors to understand what `src/common/errors.ts` needs to export.

From the reference files, I can see:
1. `classification.ts` imports `{ Errors }` from `'../common/errors.js'` and uses:
   - `Errors.notFound('Product', { productId
```

## reply

})`
   - `Errors.invalidState('No active methodology version published.')`

2. `methodology.service.ts` imports `{ Errors }` from `'../common/errors.js'` and uses:
   - `Errors.notFound('Methodology version', { version })`

Now let me look at the compiler errors to see if any directly reference `errors.ts`:

Looking at the error list... none of the errors are in `src/common/errors.ts` directly. The errors are in:
- `src/profiles/profile.repository.ts`
- `src/profiles/profile.service.ts`
- `test/classifications.spec.ts`
- `test/methodologies.spec.ts`

Wait, but the task says "Rewrite `src/common/errors.ts` complete, fixing what these messages require of this file."

Let me re-read the errors more carefully. The errors mention:
- `src/profiles/profile.service.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Severity'.`

This is about importing `Severity` from `@prisma/client`, not from `errors.ts`.

Hmm, but wait. Let me look at what `profile.service.ts` might be importing from `errors.ts`. The reference file `classification.ts` shows that `Errors` is imported from `'../common/errors.js'`. The `methodology.service.ts` also imports from `'../common/errors.js'`.

But the task says to fix `src/common/errors.ts` based on the compiler messages. Let me look at all the messages again to see if any of them would be resolved by fixing `errors.ts`.

Actually, wait. Let me re-read the task: "Rewrite `src/common/errors.ts` complete, fixing what these messages require of this file."

The key insight is: "Change nothing the messages do not name." So I need to figure out what the messages require of `errors.ts` specifically.

Looking at the errors again, none of them are directly in `errors.ts`. But the task says to rewrite it. Let me think about what the errors imply about `errors.ts`...

Actually, I think the key issue is this: the `Errors` class/object in `errors.ts` is used by `classification.ts` and `methodology.service.ts` which we can see in the reference. The errors in those files aren't listed (they compile fine), so `errors.ts` must already be providing what they need. But the task says to rewrite it.

Wait, let me re-read the task more carefully. It says "Rewrite `src/common/errors.ts` complete, fixing what these messages require of this file."

The messages don't directly name `errors.ts`, but the task is asking me to produce it. The constraint is "Change nothing the messages do not name" - meaning I should only include what the errors require.

Let me look at what's used from `errors.ts` in the reference files:
1. `Errors.notFound(resource, details)` - used in `classification.ts` and `methodology.service.ts`
2. `Errors.invalidState(message)` - used in `classification.ts`

And the error envelope format is:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

So `Errors` needs to produce objects with that envelope shape.

Now, looking at the test errors:
- `test/classifications.spec.ts(106,51): error TS2322: Type 'number' is not assignable to type 'string'.`
- `test/classifications.spec.ts(106,60): error TS2322: Type 'string' is not assignable to type 'number'.`

These are about type mismatches in the test, not about `errors.ts`.

The `src/profiles/profile.service.ts(2,10)` error is about importing `Severity` from `@prisma/client`, not from `errors.ts`.

Hmm, but wait. Let me reconsider. The task says these are "the compiler's exact messages for the whole workspace." If `errors.ts` had a compilation error, it would show up here. Since it doesn't, maybe `errors.ts` currently exists and compiles, but the task is asking me to rewrite it to fix issues in OTHER files that stem from how `errors.ts` is structured?

Actually no, re-reading: "Rewrite `src/common/errors.ts` complete, fixing what these messages require of this file." This means: look at all the messages, determine what they require of `errors.ts`, and produce a complete file that satisfies those requirements.

The messages that are relevant to `errors.ts`:
- None directly name `errors.ts`
- But the usage in `classification.ts` and `methodology.service.ts` shows the API: `Errors.notFound(name, details)` and `Errors.invalidState(message)`

Since the other files that use `Errors` don't have compilation errors (they're not in the error list), the current `errors.ts` must already satisfy their usage. But the task asks me to rewrite it.

Let me think about this differently. The task says "fixing what these messages require of this file." If no message requires anything of `errors.ts`, then I just need to produce a correct `errors.ts` that matches the conventions (error envelope) and the usage seen in the reference files.

The conventions say:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```
`code` is `snake_case` and is the contract. `message` is developer-facing English. `details` is an object, never null.

So `Errors` should be an object (or class) with static methods that return HttpException-like objects (or just objects matching the envelope). In NestJS, you'd typically throw an `HttpException` with a custom body.

Looking at the usage:
- `throw Errors.notFound('Product', { productId })` - creates a "resource_not_found" error
- `throw Errors.invalidState('No active methodology version published.')` - creates some invalid state error

The error code for notFound should be `resource_not_found` (snake_case).
For invalidState, it should be something like `invalid_state`.

Let me write the file:

```typescript
import { HttpException, HttpStatus } from '@nestjs/common';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

export class Errors {
  static notFound(resource: string, details: Record<string, unknown> = {}): HttpException {
    const body: ErrorBody = {
      error: {
        code: 'resource_not_found',
        message: `${resource} not found.`,
        details,
      },
    };
    return new HttpException(body, HttpStatus.NOT_FOUND);
  }

  static invalidState(message: string): HttpException {
    const body: ErrorBody = {
      error: {
        code: 'invalid_state',
        message,
        details: {},
      },
    };
    return new HttpException(body, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
```

Wait, but I need to be careful. The task says "Change nothing the messages do not name." So I should only include what's needed. Let me check if there are other error methods used anywhere...

From the reference files, I only see `Errors.notFound` and `Errors.invalidState`. The task says to not create things not called for. So I'll stick with just these two.

Actually, let me reconsider the `details` parameter. In `classification.ts`:
- `Errors.notFound('Product', { productId })` - details has a `productId` key
- `Errors.invalidState('No active methodology version published.')` - no details

In `methodology.service.ts`:
- `Errors.notFound('Methodology version', { version })` - details has a `version` key

So `notFound` takes a resource name and an optional details object. `invalidState` takes just a message.

The convention says `details` is an object, never null. So for `invalidState`, it should be `{}`.

Let me finalize this. I think this is correct and minimal.
</think>

```typescript
import { HttpException, HttpStatus } from '@nestjs/common';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

export class Errors {
  static notFound(resource: string, details: Record<string, unknown> = {}): HttpException {
    const body: ErrorBody = {
      error: {
        code: 'resource_not_found',
        message: `${resource} not found.`,
        details,
      },
    };
    return new HttpException(body, HttpStatus.NOT_FOUND);
  }

  static invalidState(message: string): HttpException {
    const body: ErrorBody = {
      error: {
        code: 'invalid_state',
        message,
        details: {},
      },
    };
    return new HttpException(body, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}
```
