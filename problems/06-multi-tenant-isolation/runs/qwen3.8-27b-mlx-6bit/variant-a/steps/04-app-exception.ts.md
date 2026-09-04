# 04-app-exception.ts

## reasoning

```
Let me analyze the plan for `src/errors/app-exception.ts`:

```ts
export abstract class AppException extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>);
  static resourceNotFound(id: string): AppException;          // 404 resource_not_found
  static conflict(field: string): AppException;               // 409 conflict
  static validationError(message: string): AppException;      // 400 validation_error
  static unauthorized(): AppException;                        // 401 unauthorized
  static unknownTenant(host: string): AppException;           // 403 unknown_tenant
  static tenantMismatch(expected: string, actual: string): AppException; // 403
  static tenantContextMissing(): AppException;                // 500 fail-closed
}
```

I need to import `ErrorCode` from `./error-codes.ts`.

Let me write the complete file:

- Constructor takes status, code, message, and optional details (defaults to `{}`).
- Static factories:
  - `resourceNotFound(id)` → 404, `resource_not_found`, message includes the id, details `{ id }`
  - `conflict(field)` → 409, `conflict`, message about field conflict, details `{ field }`
  - `validationError(message)` → 400, `validation_error`, message, details `{}`
  - `unauthorized()` → 401, `unauthorized`, message, details `{}`
  - `unknownTenant(host)` → 403, `unknown_tenant`, message includes host, details `{ host }`
  - `tenantMismatch(expected, actual)` → 403, `tenant_mismatch`, message about mismatch, details `{ expected, actual }`
  - `tenantContextMissing()` → 500, `tenant_context_missing`, message, details `{}`

The plan says "message is developer-facing English". Let me write reasonable messages.

Since it's an abstract class, I can't directly instantiate it without a subclass. But the static methods need to return instances of `AppException`. Since it's abstract, I'll need a private/concrete subclass or I can just use the class itself. Wait - if it's abstract, you can't do `new AppException(...)`. But static methods are on the class itself. So I need a way to create instances.

Looking more carefully: the static methods return `AppException`. If the class is abstract, I can't instantiate it directly. I'll need a private helper or a non-exported concrete subclass.

Actually, let me re-read the plan. It says `export abstract class AppException extends Error`. The static methods return `AppException`. For this to work with an abstract class, I need a concrete implementation. The simplest approach is to create a private concrete subclass or just use the constructor in a non-abstract way.

Wait, actually in TypeScript, you CAN call `new` on a class from a static method even if it's abstract... no you can't. Abstract classes cannot be instantiated.

So I'll create a private/internal concrete class that extends AppException, or I can make the static methods use a helper. Let me think about what's cleanest and matches the plan.

The plan says the class is abstract with those static factories. The most defensible approach is to have a private concrete subclass that the static methods instantiate:

```ts
class ConcreteAppException extends AppException {}
```

Then static methods do `return new ConcreteAppException(...)`.

This is the standard pattern. Let me write it out.
```

## reply

```ts
import type { ErrorCode } from './error-codes';

export abstract class AppException extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppException';
    this.status = status;
    this.code = code;
    this.details = details ?? {};
  }

  static resourceNotFound(id: string): AppException {
    return new ConcreteAppException(
      404,
      'resource_not_found',
      `Resource with id "${id}" was not found`,
      { id },
    );
  }

  static conflict(field: string): AppException {
    return new ConcreteAppException(
      409,
      'conflict',
      `A record with the same ${field} already exists`,
      { field },
    );
  }

  static validationError(message: string): AppException {
    return new ConcreteAppException(400, 'validation_error', message, {});
  }

  static unauthorized(): AppException {
    return new ConcreteAppException(
      401,
      'unauthorized',
      'Missing or invalid authentication token',
      {},
    );
  }

  static unknownTenant(host: string): AppException {
    return new ConcreteAppException(
      403,
      'unknown_tenant',
      `No tenant registered for host "${host}"`,
      { host },
    );
  }

  static tenantMismatch(expected: string, actual: string): AppException {
    return new ConcreteAppException(
      403,
      'tenant_mismatch',
      `Token org "${actual}" does not match resolved tenant "${expected}"`,
      { expected, actual },
    );
  }

  static tenantContextMissing(): AppException {
    return new ConcreteAppException(
      500,
      'tenant_context_missing',
      'No tenant context is available for this request',
      {},
    );
  }
}

class ConcreteAppException extends AppException {}
```
