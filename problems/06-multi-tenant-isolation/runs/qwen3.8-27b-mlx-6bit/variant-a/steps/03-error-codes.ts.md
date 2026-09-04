# 03-error-codes.ts

## reasoning

```
The task is to write exactly one file: `src/errors/error-codes.ts`.

From the plan, this file should contain:
- `ErrorEnvelope` interface
- `ErrorCode` type

The plan specifies:

```ts
export interface ErrorEnvelope {
  error: { code: ErrorCode; message: string; details: Record<string, unknown> };
}
export type ErrorCode =
  | 'resource_not_found'
  | 'conflict'
  | 'validation_error'
  | 'unauthorized'
  | 'unknown_tenant'
  | 'tenant_mismatch'
  | 'tenant_context_missing';
```

That's exactly what's specified. Let me write it cleanly with the proper TypeScript syntax (semicolons, etc.).
```

## reply

```ts
export type ErrorCode =
  | 'resource_not_found'
  | 'conflict'
  | 'validation_error'
  | 'unauthorized'
  | 'unknown_tenant'
  | 'tenant_mismatch'
  | 'tenant_context_missing';

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details: Record<string, unknown>;
  };
}
```
