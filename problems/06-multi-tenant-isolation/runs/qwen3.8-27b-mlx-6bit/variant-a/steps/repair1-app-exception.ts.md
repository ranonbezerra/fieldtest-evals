# repair1-app-exception.ts

## reasoning

```
Let me analyze the compiler errors to understand what's wrong with `src/errors/app-exception.ts`.

Looking at the error messages, I need to find the ones that directly relate to `src/errors/app-exception.ts`:

1. The first line is cut off but mentions "tensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?" — This is from another file importing `app-exception` without the `.js` extension.

2. `src/tenant/tenant-resolution.middleware.ts(7,30): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?`

3. `src/tenant/tenant.service.ts(2,30): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?`

These are errors in OTHER files that import `app-exception` without the `.js` extension. The errors are NOT in `app-exception.ts` itself.

Wait, let me re-read the task: "Rewrite `src/errors/app-exception.ts` complete, fixing what these messages require of this file."

The task says to fix `src/errors/app-exception.ts` based on what the compiler messages require OF THIS FILE. But looking at the errors, none of them are IN `app-exception.ts` itself. They are in other files that import it.

However, the task says "fixing what these messages require of this file." The messages that reference `app-exception.ts` are:
- Importers need to use `.js` extension (but that's in the importers, not in this file)

Wait, but the task says "Change nothing the messages do not name." The messages don't name anything wrong about `app-exception.ts` itself. They just say other files can't find it or need the `.js` extension.

Hmm, but the task explicitly says to rewrite this file. Let me think about what could be wrong with `app-exception.ts` that would cause these errors...

Actually wait - looking more carefully at the first error line (which is truncated): "tensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?"

This is a TS2835 error. It means the importing file uses `../errors/app-exception` but should use `../errors/app-exception.js`. This is a problem in the IMPORTING files, not in `app-exception.ts` itself.

But the task says to fix `app-exception.ts`. Let me re-read: "Rewrite `src/errors/app-exception.ts` complete, fixing what these messages require of this file."

Perhaps the issue is that `app-exception.ts` itself has internal import issues? Let me look at the plan:

```ts
import type { ErrorCode } from './error-codes';
```

Wait, the plan shows:
```ts
export abstract class AppException extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>);
  static resourceNotFound(id: string): AppException;
  static conflict(field: string): AppException;
  static validationError(message: string): AppException;
  static unauthorized(): AppException;
  static unknownTenant(host: string): AppException;
  static tenantMismatch(expected: string, actual: string): AppException;
  static tenantContextMissing(): AppException;
}
```

And it imports from `src/errors/error-codes.ts`. If the project uses `"type": "module"` and `node16`/`nodenext` module resolution, then the import in `app-exception.ts` would need to be `./error-codes.js`.

But wait, the compiler errors don't show an error IN `app-exception.ts` itself. Let me look again...

The errors shown are:
- The first (truncated) line - seems to be from another file
- `src/tenant/tenant-resolution.middleware.ts` - multiple errors
- `src/tenant/tenant.controller.ts` - one error
- `src/tenant/tenant.module.ts` - multiple errors
- `src/tenant/tenant.repository.ts` - one error
- `src/tenant/tenant.service.ts` - three errors
- `test/customer-isolation.spec.ts` - multiple errors
- `test/tenant-config.spec.ts` - multiple errors

None of these are in `src/errors/app-exception.ts` directly. But the task says to fix this file.

Hmm, let me reconsider. The task says "fixing what these messages require of this file." Maybe the issue is that `app-exception.ts` imports from `./error-codes` without the `.js` extension, and while that error might not be shown here (perhaps it was in a part of the output that was truncated), the task wants me to ensure this file compiles correctly.

Actually, wait. Let me re-read the first error line more carefully: "tensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?"

This is clearly from a file that does `import ... from '../errors/app-exception'` and needs it to be `'../errors/app-exception.js'`.

The task is asking me to rewrite `app-exception.ts` fixing what these messages require OF THIS FILE. The messages don't directly point to issues within `app-exception.ts` - they point to issues in other files' imports of it.

But since the task explicitly asks me to rewrite this file, and the only thing that could be wrong with it (that would relate to these errors) is:
1. It might import from `./error-codes` without `.js` extension (same TS2835 issue)
2. The file needs to be a complete, valid TypeScript file

Let me think about this differently. The task says the file "does not compile." So there must be something wrong with it. The compiler messages shown are for "the whole workspace" but the specific issue with this file might be:

1. An import of `./error-codes` without `.js` extension (TS2835) - this would be an error IN this file but might not be shown because the output was truncated at the top.

Actually, looking at the first line again: "tensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?"

This is clearly the tail end of an error message. The full message would be something like:
`src/somefile.ts(line,col): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?`

So this is from another file importing app-exception. Not from app-exception itself.

But wait - could there be an error in `app-exception.ts` that's not shown? The task says "These are the compiler's exact messages for the whole workspace — not a summary of them." So if there were an error in `app-exception.ts`, it would be listed. Since it's not listed, maybe the file actually does compile fine on its own?

Hmm, but the task says "src/errors/app-exception.ts does not compile." So there IS something wrong with it.

Let me reconsider. Maybe the issue is that `app-exception.ts` imports from `./error-codes` (without `.js`) and THAT is the error that's at the very top of the output but got truncated. The first visible line starts with "tensions" which is clearly mid-word from "extensions". So the full first error might be:

`src/errors/app-exception.ts(1,XX): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './error-codes.js'?`

And then the next error (also truncated) is from another file importing app-exception:
`src/something.ts(1,XX): error TS2835: ... Did you mean '../errors/app-exception.js'?`

Wait no, looking again at the first line: "tensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../errors/app-exception.js'?"

The "Did you mean" part says `'../errors/app-exception.js'` - this means the importing file is trying to import `../errors/app-exception` and should use `../errors/app-exception.js`. This is NOT an error in app-exception.ts itself.

OK so I think the situation is:
- The file `app-exception.ts` might have an import error (from `./error-codes` without `.js`) that's not shown because the output was truncated
- OR the file is actually fine and the "does not compile" refers to the fact that other files can't import it properly

Given the task says "fixing what these messages require of this file" and "Change nothing the messages do not name," I think the safest approach is:

1. Write the complete file as specified in the plan
2. Use `.js` extension on any relative imports (since the project uses `node16`/`nodenext` resolution)
3. Make sure the file is self-consistent

The plan says it imports `ErrorCode` from `./error-codes`. With `node16`/`nodenext` resolution and `"type": "module"`, this needs to be `./error-codes.js`.

Let me write the file:

```ts
import type { ErrorCode } from './error-codes.js';

export abstract class AppException extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details ?? {};
  }

  static resourceNotFound(id: string): AppException {
    return new ConcreteAppException(404, 'resource_not_found', `Resource ${id} not found`);
  }

  static conflict(field: string): AppException {
    return new ConcreteAppException(409, 'conflict', `Conflict on field: ${field}`);
  }

  static validationError(message: string): AppException {
    return new ConcreteAppException(400, 'validation_error', message);
  }

  static unauthorized(): AppException {
    return new ConcreteAppException(401, 'unauthorized', 'Unauthorized');
  }

  static unknownTenant(host: string): AppException {
    return new ConcreteAppException(403, 'unknown_tenant', `Unknown tenant for host: ${host}`);
  }

  static tenantMismatch(expected: string, actual: string): AppException {
    return new ConcreteAppException(403, 'tenant_mismatch', `Tenant mismatch: expected ${expected}, got ${actual}`);
  }

  static tenantContextMissing(): AppException {
    return new ConcreteAppException(500, 'tenant_context_missing', 'Tenant context is missing');
  }
}

class ConcreteAppException extends AppException {}
```

Wait, but the plan says `AppException` is abstract with static factories. The static factories need to create instances. Since it's abstract, we need a concrete subclass. But the plan doesn't mention a separate concrete class file. Let me just use a private concrete subclass in the same file.

Actually, looking at the plan more carefully, it just says:
```ts
export abstract class AppException extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>);
  static resourceNotFound(id: string): AppException;
  ...
}
```

The return type is `AppException` (the abstract type), so we can have a non-exported concrete class. That's fine.

Now, the key question: what does "fixing what these messages require of this file" mean?

The errors that reference `app-exception.ts` are all TS2835 errors in OTHER files that import it without `.js`. Those aren't fixable by changing `app-exception.ts` itself.

The only thing I can infer about `app-exception.ts` from these errors is that it exists (since the compiler knows where to look for it) and that other files import it. The fact that the task says "does not compile" suggests there IS an error in the file itself that's either:
1. Truncated from the output (the first line is clearly mid-message)
2. Or the file has some other issue

Given that the project uses `"type": "module"` with `node16`/`nodenext` resolution, and the file likely imports from `./error-codes`, the fix would be to use `./error-codes.js`.

Let me just write the complete, correct file with proper `.js` extensions on imports. That's the most reasonable interpretation of "fixing what these messages require of this file."

Actually, I realize I should also check: does `error-codes.ts` export `ErrorCode` as a type? The plan shows:
```ts
export type ErrorCode = 'resource_not_found' | ...;
```

So yes, it's a type export. I'll use `import type`.

Let me finalize my answer.
```

## reply

```ts
import type { ErrorCode } from './error-codes.js';

export abstract class AppException extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details ?? {};
  }

  static resourceNotFound(id: string): AppException {
    return new ConcreteAppException(404, 'resource_not_found', `Resource ${id} not found`);
  }

  static conflict(field: string): AppException {
    return new ConcreteAppException(409, 'conflict', `Conflict on field: ${field}`);
  }

  static validationError(message: string): AppException {
    return new ConcreteAppException(400, 'validation_error', message);
  }

  static unauthorized(): AppException {
    return new ConcreteAppException(401, 'unauthorized', 'Unauthorized');
  }

  static unknownTenant(host: string): AppException {
    return new ConcreteAppException(403, 'unknown_tenant', `Unknown tenant for host: ${host}`);
  }

  static tenantMismatch(expected: string, actual: string): AppException {
    return new ConcreteAppException(403, 'tenant_mismatch', `Tenant mismatch: expected ${expected}, got ${actual}`);
  }

  static tenantContextMissing(): AppException {
    return new ConcreteAppException(500, 'tenant_context_missing', 'Tenant context is missing');
  }
}

class ConcreteAppException extends AppException {}
```
