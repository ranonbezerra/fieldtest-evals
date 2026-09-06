# 02-retry.module.ts

## reasoning

```
The user wants me to write exactly one file: `src/retry/retry.module.ts`.

From the PLAN.md, the target state for `RetryModule` is:

```
providers: [RetryProcessor]
exports:   [RetryProcessor]
imports:   []
```

The file is `src/retry/retry.module.ts` and it declares `RetryProcessor` as provider and export.

I need to import:
- `Module` from `@nestjs/common`
- `RetryProcessor` from `./retry.processor`

The class is `RetryModule` (PascalCase), the file is `kebab-case.role.ts` → `retry.module.ts`.

The module has:
- providers: [RetryProcessor]
- exports: [RetryProcessor]
- imports: []

Since `imports` is empty, I can omit it (NestJS defaults to empty array). But the plan says `imports: []`. I'll include it for clarity... actually, looking at NestJS conventions, an empty `imports` is typically omitted. But the plan explicitly states `imports: []`. Let me just include it to be faithful to the plan.

Actually, let me reconsider. The plan shows:
```
providers: [RetryProcessor]
exports:   [RetryProcessor]
imports:   []
```

I'll write it with all three for completeness and to match the plan exactly.

The import path for RetryProcessor: since it's in `src/retry/retry.processor.ts`, the relative import from `src/retry/retry.module.ts` would be `./retry.processor`.

Let me write the complete file:

```typescript
import { Module } from '@nestjs/common';
import { RetryProcessor } from './retry.processor';

@Module({
  providers: [RetryProcessor],
  exports: [RetryProcessor],
  imports: [],
})
export class RetryModule {}
```

This is complete, matches the plan exactly, and follows all conventions (PascalCase class, kebab-case file, proper decorator).
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { RetryProcessor } from './retry.processor';

@Module({
  providers: [RetryProcessor],
  exports: [RetryProcessor],
  imports: [],
})
export class RetryModule {}
```
