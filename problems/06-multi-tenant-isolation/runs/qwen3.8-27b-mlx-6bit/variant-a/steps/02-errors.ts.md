# 02-errors.ts

## reasoning

```
Let me analyze the PLAN.md specification for `src/multi-tenant/errors.ts`:

From the plan:

```ts
export declare class TenantMismatchError extends HttpException {
  constructor();
}
// 403 { error: { code: "tenant_mismatch", message, details } }

export declare class UnknownTenantError extends HttpException {
  constructor();
}
// 401 { error: { code: "unknown_tenant", message, details } }

export declare class ResourceNotFoundError extends HttpException {
  constructor(resource: string);
}
// 404 { error: { code: "resource_not_found", message, details } }

export declare class TenantNotResolvedError extends Error {
  constructor();
}
// Internal invariant violation (500 if it leaks)

export declare class ConflictError extends HttpException {
  // implied from the plan: "the service catches it and rethrows a `ConflictError` → 409 `{ error: { code: "conflict", ... } }`"
}
```

The plan explicitly names these five classes:
1. `TenantMismatchError` - extends HttpException, 403, code "tenant_mismatch"
2. `UnknownTenantError` - extends HttpException, 401, code "unknown_tenant"
3. `ResourceNotFoundError` - extends HttpException, 404, code "resource_not_found", takes `resource: string`
4. `TenantNotResolvedError` - extends Error (NOT HttpException), internal invariant violation
5. `ConflictError` - extends HttpException, 409, code "conflict"

Now let me look at the error envelope convention:
```json
{ "error": { "code": "resource_not_found", "message": "...", "details": {} } }
```

- `code` is `snake_case`
- `message` is developer-facing English
- `details` is an object, never null

For the HttpException subclasses, I need to construct them with the proper status code and body. In NestJS, `HttpException` takes a `string | Record<string, unknown>` as the first argument and a number as the second.

Let me write each:

1. **TenantMismatchError**: 403, code "tenant_mismatch"
   - `super({ error: { code: 'tenant_mismatch', message: '...', details: {} } }, 403)`

2. **UnknownTenantError**: 401, code "unknown_tenant"
   - `super({ error: { code: 'unknown_tenant', message: '...', details: {} } }, 401)`

3. **ResourceNotFoundError**: 404, code "resource_not_found", constructor takes `resource: string`
   - `super({ error: { code: 'resource_not_found', message: '...', details: {} } }, 404)`
   - The `resource` param could go into details or message.

4. **TenantNotResolvedError**: extends Error (plain), not HttpException
   - Just a plain Error with a message.

5. **ConflictError**: 409, code "conflict"
   - `super({ error: { code: 'conflict', message: '...', details: {} } }, 409)`

The plan's manifest says this file has no reads (reads: -), so I only need to import from NestJS's `HttpException`.

Let me write the complete file. I'll use proper messages that are developer-facing English as per the convention.

For `ResourceNotFoundError`, the `resource` parameter should probably be included in the message or details. The plan says `constructor(resource: string)`. I'll put it in the message like `"${resource} not found"` and maybe in details.

Let me think about whether `details` should contain the resource name. The convention says `details` is an object, never null. I'll put `{ resource: resource }` in details for `ResourceNotFoundError`.

For the others, `details` can be `{}` (empty object, which satisfies "never null").

Let me write it out:
```

## reply

```ts
import { HttpException } from '@nestjs/common';

export class TenantMismatchError extends HttpException {
  constructor() {
    super(
      {
        error: {
          code: 'tenant_mismatch',
          message: 'The org claim in the token does not match the tenant resolved from the host.',
          details: {},
        },
      },
      403,
    );
  }
}

export class UnknownTenantError extends HttpException {
  constructor() {
    super(
      {
        error: {
          code: 'unknown_tenant',
          message: 'No tenant is registered for the requested domain.',
          details: {},
        },
      },
      401,
    );
  }
}

export class ResourceNotFoundError extends HttpException {
  constructor(resource: string) {
    super(
      {
        error: {
          code: 'resource_not_found',
          message: `${resource} not found.`,
          details: { resource },
        },
      },
      404,
    );
  }
}

export class TenantNotResolvedError extends Error {
  constructor() {
    super('Tenant context has not been resolved for the current request.');
    this.name = 'TenantNotResolvedError';
  }
}

export class ConflictError extends HttpException {
  constructor() {
    super(
      {
        error: {
          code: 'conflict',
          message: 'A resource with the same unique constraint already exists for this tenant.',
          details: {},
        },
      },
      409,
    );
  }
}
```
