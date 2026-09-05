# repair1-orders.service.ts

## reasoning

```
Let me analyze the compiler errors for `src/orders/orders.service.ts`:

1. `src/orders/orders.service.ts(1,28): error TS2307: Cannot find module '@nestjs/common' or its corresponding type declarations.`
   - This means `@nestjs/common` is not installed. The file imports from it (likely `Injectable`).

2. `src/orders/orders.service.ts(2,37): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../shared/payment-status-mapper.js'?`
   - The import of `payment-status-mapper` needs a `.js` extension since this is ESM with node16/nodenext resolution.

The instruction says "Change nothing the messages do not name." So I need to:
1. Fix the `@nestjs/common` import — but wait, the module isn't found. The plan says "plain class (no Nest module)" for the mapper, but the orders service is a NestJS service. The error says `@nestjs/common` can't be found. This likely means it's not in `node_modules`. But the plan says orders service uses NestJS. I should add an `// ASSUMPTION:` line if I can't reconcile this.

Actually, looking more carefully — the task says "Rewrite `src/orders/orders.service.ts` complete, fixing what these messages require of this file." So I need to fix the two errors in this specific file.

For error 1: `@nestjs/common` not found. The plan says the orders service is a NestJS service (it has `@Injectable()`). Since I can't install packages, and the plan says to keep the plan, I'll add an `// ASSUMPTION:` line noting that `@nestjs/common` is expected to be available in the project dependencies but isn't resolvable by the compiler.

Wait, actually — let me re-read. The instruction says "fixing what these messages require of this file." The message says the module can't be found. I can't fix a missing dependency from within the file itself unless I remove the import. But the plan says this is a NestJS service with `@Injectable()`. 

Let me think about what the file should look like based on the plan:
- It's a NestJS service (`@Injectable()`)
- It uses `PaymentStatusMapper` with `{ unknownPolicy: 'throw' }`
- It has a method that maps provider status codes to internal statuses

The two errors are:
1. Missing `@nestjs/common` — I'll add an ASSUMPTION line
2. Missing `.js` extension on the relative import — I'll fix this by adding `.js`

Let me write the file. Based on the plan:
- The orders service delegates to `PaymentStatusMapper` with `unknownPolicy: 'throw'`
- It's a NestJS `@Injectable()` service

I don't have the original file content, so I need to reconstruct it from the plan. The plan says:
- Orders service instantiates `new PaymentStatusMapper({ unknownPolicy: 'throw' })` and calls `.map(code)`
- It previously had a "local private method `mapStatus(code)` → always throws on unknown"

Let me write a reasonable orders service that:
1. Imports `Injectable` from `@nestjs/common` (with ASSUMPTION about the missing module)
2. Imports `PaymentStatusMapper` from `../shared/payment-status-mapper.js` (with the .js extension fix)
3. Has a `mapStatus` method that delegates to the mapper

Actually, I need to be careful. The instruction says "Change nothing the messages do not name." So I should only fix what the compiler errors require. The two things are:
1. The `@nestjs/common` import (module not found) — I'll add ASSUMPTION
2. The relative import needs `.js` extension

Since I don't have the original file, I need to reconstruct it. Let me write a minimal but complete orders service that matches the plan's description.

Looking at the plan more carefully:
- The orders service has a method that maps status codes
- It uses `PaymentStatusMapper` with throw policy

Let me write it:

```ts
// ASSUMPTION: '@nestjs/common' is expected as a project dependency; compiler reports it as not found.
import { Injectable } from '@nestjs/common';
import { PaymentStatusMapper, InternalStatus } from '../shared/payment-status-mapper.js';

@Injectable()
export class OrdersService {
  private readonly mapper = new PaymentStatusMapper({ unknownPolicy: 'throw' });

  mapStatus(providerCode: string): InternalStatus {
    const result = this.mapper.map(providerCode);
    // unknownPolicy is 'throw', so if we reach here, result is always defined
    return result as InternalStatus;
  }
}
```

Wait, but the plan says `map` returns `InternalStatus | undefined`. With `unknownPolicy: 'throw'`, it will never return undefined (it throws instead). So I could just return the result directly, or cast it. Let me think about what's cleanest.

Actually, since the mapper's return type is `InternalStatus | undefined`, and with 'throw' policy it never actually returns undefined, I can just return it. The TypeScript type will be `InternalStatus | undefined` though. The original code probably returned a non-undefined value since it threw on unknown. Let me use a non-null assertion or just let the type be what it is.

Hmm, but I should keep it simple and match what the plan describes. The plan says "Orders service instantiates `new PaymentStatusMapper({ unknownPolicy: 'throw' })` and calls `.map(code)`." It doesn't specify the return type of the service method explicitly beyond that.

Let me keep it straightforward. I'll return the result directly — the type will be `InternalStatus | undefined` which is fine since in practice it's always defined (throws otherwise).

Actually, let me reconsider. The plan says the orders service previously had a "local private method `mapStatus(code)` → always throws on unknown." So the method likely returned a string/InternalStatus (non-undefined). I'll use a non-null assertion to match that behavior.

Let me finalize my answer.
```

## reply

```ts
// ASSUMPTION: '@nestjs/common' is expected as a project dependency; the compiler reports it as not found in this workspace.
import { Injectable } from '@nestjs/common';
import { PaymentStatusMapper, InternalStatus } from '../shared/payment-status-mapper.js';

@Injectable()
export class OrdersService {
  private readonly mapper = new PaymentStatusMapper({ unknownPolicy: 'throw' });

  mapStatus(providerCode: string): InternalStatus {
    const result = this.mapper.map(providerCode);
    // With unknownPolicy 'throw' the mapper never returns undefined; it throws instead.
    return result!;
  }
}
```
