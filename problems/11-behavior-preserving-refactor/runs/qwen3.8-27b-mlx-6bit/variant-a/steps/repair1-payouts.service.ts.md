# repair1-payouts.service.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/payouts/payouts.service.ts`:

1. `src/payouts/payouts.service.ts(1,28): error TS2307: Cannot find module '@nestjs/common' or its corresponding type declarations.`
2. `src/payouts/payouts.service.ts(2,35): error TS2307: Cannot find module './payouts.repository' or its corresponding type declarations.`
3. `src/payouts/payouts.service.ts(3,37): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../shared/payment-status-mapper.js'?`

So I need to fix:
1. The `@nestjs/common` import - this module isn't found. This likely means the package isn't installed, but since I can't install packages, I need to think about what to do. Actually, looking at the error more carefully - it says "Cannot find module '@nestjs/common' or its corresponding type declarations." This could mean the package isn't installed in node_modules. But I can't fix that by changing the file. However, the instruction says "Change nothing the messages do not name." So I need to deal with this.

Wait, let me re-read the instructions: "Rewrite `src/payouts/payouts.service.ts` complete, fixing what these messages require of this file."

So I need to fix the errors IN this file. Let me think about each:

1. `Cannot find module '@nestjs/common'` - This means the package isn't available. Since I can't install it, and the plan uses NestJS decorators... Actually, looking at the other files (orders.service.ts and reporting.service.ts), they have the same error. This suggests `@nestjs/common` simply isn't installed. But the plan says to use NestJS conventions. 

Hmm, but the instruction says "Do not drop a requirement to silence an error." The plan specifies this is a NestJS service. But if `@nestjs/common` can't be found, maybe I should keep the import and add an ASSUMPTION comment? Or maybe the service doesn't actually need to use NestJS decorators - it could be a plain class that's provided by the module.

Wait, let me reconsider. The plan says:
- "Mapper location & file: `src/shared/payment-status-mapper.ts`, plain class (no Nest module)"
- The services use the mapper

Looking at the conventions: "A service, repository or processor is listed in its module's `providers`."

So the payouts service IS a NestJS service. But if `@nestjs/common` isn't available, I can't use `@Injectable()`. 

Actually, let me look at this differently. The error is about the module not being found. If the package truly isn't installed, no file can import it. But the task says to fix what the messages require of THIS file. 

Let me think about what I can actually do:
- For error 1 (`@nestjs/common`): I could remove the import if the service doesn't actually need decorators. But a NestJS service typically needs `@Injectable()`. However, if the package isn't installed, maybe I should just not use it and add an ASSUMPTION line.

Actually wait - looking more carefully at the problem. The other files (orders.service.ts, reporting.service.ts) have the same `@nestjs/common` error. This suggests it's a project-wide issue (package not installed). The instruction says "Change nothing the messages do not name." So I should only fix what's wrong in payouts.service.ts specifically.

But the `@nestjs/common` error IS named for this file. So I need to address it.

Let me think about what a payouts service looks like based on the plan:
- It's in `src/payouts/payouts.service.ts`
- It uses `PaymentStatusMapper` with `{ unknownPolicy: 'fallback', fallbackValue: ... }`
- It has a repository (based on error 2 about `./payouts.repository`)
- It's a NestJS service

For the `@nestjs/common` issue: Since the package can't be found, and I'm told not to drop plan requirements... The plan says this is a NestJS service. But if I can't import from `@nestjs/common`, I can't use `@Injectable()`. 

I think the right approach is:
- Keep the service as a class (it will still work as a provider in NestJS if registered properly)
- Add an `// ASSUMPTION:` line explaining that `@nestjs/common` is not available in the workspace

Actually, wait. Let me reconsider. In NestJS, a service doesn't strictly NEED `@Injectable()` if it doesn't use constructor injection. But typically services do use DI for their repository. 

Hmm, but if I can't import `@nestjs/common`, I can't use `@Injectable()` or `@Inject()`. 

Let me look at this from a different angle. The task says "fixing what these messages require of this file." The messages are:
1. Can't find `@nestjs/common` 
2. Can't find `./payouts.repository`
3. Need `.js` extension on relative imports

For #2: The file `./payouts.repository` doesn't exist (or the module can't be resolved). This is similar to #1 - it's a missing dependency. I should add an ASSUMPTION line.

For #3: This is straightforward - change `'../shared/payment-status-mapper'` to `'../shared/payment-status-mapper.js'`.

So my approach:
- Fix the `.js` extension issue (error 3) - this is a clear fix
- For errors 1 and 2 (missing modules), add ASSUMPTION lines since I can't create those files or install packages
- Keep the service structure as the plan dictates

Wait, but if I keep `import { Injectable } from '@nestjs/common'`, the error will persist. The instruction says "fixing what these messages require of this file." Does that mean I must eliminate the error, or just do my best?

Re-reading: "Rewrite `src/payouts/payouts.service.ts` complete, fixing what these messages require of this file."

I think "fixing what these messages require" means: do what you can to address them. For missing modules that I can't create, I add ASSUMPTION lines. For the extension issue, I fix it directly.

Actually, let me reconsider the `@nestjs/common` issue. What if I just don't use any NestJS decorators? The service can be a plain class. In NestJS, you can provide a class without `@Injectable()` - it just won't get DI. But if the service needs a repository injected...

Hmm, but looking at the plan more carefully: "Stateless; services instantiate it in their constructor." - this refers to the mapper. The service itself would need the repository.

Let me think about what the payouts service actually does based on the plan:
- It maps provider status codes to internal statuses
- It has a fallback policy (returns some value for unknown codes)
- It uses a repository (based on the import error)

Given that I can't resolve `@nestjs/common` or `./payouts.repository`, I'll:
1. Keep the import statements (they represent the intended design)
2. Add ASSUMPTION lines for the unresolved modules
3. Fix the `.js` extension on the shared import

Actually, I just realized - maybe I should NOT keep imports I can't resolve. The instruction says "fixing what these messages require." If the fix for "cannot find module" is to remove the import... but that would break the service logic.

Let me re-read the key constraint: "If satisfying the compiler seems to require abandoning something the plan specified, keep the plan and add one `// ASSUMPTION:` line saying what you could not reconcile."

So for `@nestjs/common`: The plan specifies NestJS conventions. I can't reconcile the missing package with the plan. I'll keep the import and add an ASSUMPTION line.

For `./payouts.repository`: The plan implies the service uses a repository (the layout shows `<feature>.repository.ts`). I can't create that file. I'll keep the import and add an ASSUMPTION line.

For the `.js` extension: I'll fix this directly.

Now let me write the payouts service. Based on the plan:
- It's a NestJS service with `@Injectable()`
- It injects a repository
- It uses `PaymentStatusMapper` with `{ unknownPolicy: 'fallback', fallbackValue: ... }`
- The fallback value is what the existing code returns for unknown codes

From the plan: "Payouts service calls a local private method `mapStatus(code)` → returns `'unknown'` on unknown."

Wait, but the plan also says: "the payouts fallback value is whatever string the existing code returns for unknown — the implementer reads the fixture to confirm; listed here as `'refunded'` as a placeholder matching the 'return unknown' description. If the fixture shows a different literal, use that."

And in the assumptions table: "Payouts extra codes: Two provider codes (`'payout_initiated'`, `'payout_settled'`) map to `'pending'` and `'completed'` respectively."

So the payouts service:
- Has a method that maps provider codes to internal statuses
- For unknown codes, returns some fallback value (the plan says it returns `'unknown'` based on the "Before" section)
- Has two extra provider codes beyond the base set

Wait, re-reading the plan's "Before" section: "Payouts service calls a local private method `mapStatus(code)` → returns `'unknown'` on unknown."

And the "After" section: "Payouts service instantiates `new PaymentStatusMapper({ unknownPolicy: 'fallback', fallbackValue: 'refunded' })`"

There's a contradiction. The "Before" says it returns `'unknown'` but the "After" uses `fallbackValue: 'refunded'`. The plan's assumption table notes this: "listed here as `'refunded'` as a placeholder matching the 'return unknown' description. If the fixture shows a different literal, use that."

Since I don't have access to the fixture, and the plan explicitly says the fallback should match what the existing code returns (which is `'unknown'` per the Before section), I'll use `'unknown'` as the fallback value. But wait, `'unknown'` isn't in the `InternalStatus` type union (`'pending' | 'completed' | 'failed' | 'refunded'`).

Hmm, this is tricky. The plan says `InternalStatus = 'pending' | 'completed' | 'failed' | 'refunded'`. But the payouts service returns `'unknown'` for unknown codes. That doesn't fit the type.

I think I need to add an ASSUMPTION here too. The fallback value for payouts is `'unknown'` which doesn't match the `InternalStatus` type. I'll note this.

Actually, looking at this more carefully - the `MapperOptions` interface has `fallbackValue?: InternalStatus`. If the payouts service needs to return `'unknown'`, that's a type mismatch. 

Let me just use what makes sense: the plan says the payouts service returns `'unknown'` for unknown codes. I'll use that as the fallback value and add an ASSUMPTION about the type mismatch.

Wait, actually let me re-read the plan's type definition:

```ts
export interface MapperOptions {
  unknownPolicy: UnknownPolicy;
  fallbackValue?: InternalStatus;
  legacyReportCasing?: boolean;
}
```

And `InternalStatus = 'pending' | 'completed' | 'failed' | 'refunded'`

So `'unknown'` isn't a valid `InternalStatus`. This is a genuine conflict between the plan's type system and the plan's description of payouts behavior.

I'll go with `'unknown'` as the fallback value since the plan explicitly describes the behavior, and add an ASSUMPTION line about the type.

Actually, you know what, let me step back. I'm overthinking this. The task is to fix the compiler errors in `src/payouts/payouts.service.ts`. Let me focus on that:

1. Error: `Cannot find module '@nestjs/common'` → ASSUMPTION line, keep import
2. Error: `Cannot find module './payouts.repository'` → ASSUMPTION line, keep import  
3. Error: Need `.js` extension → Fix the import path

The service content should follow the plan. Let me write a reasonable payouts service that:
- Is a NestJS injectable service
- Has a repository dependency
- Uses PaymentStatusMapper with fallback policy
- Has the two extra payout-specific codes handled by the mapper (per plan: they're in the union table)

Let me write it now:

```ts
// ASSUMPTION: '@nestjs/common' is not resolvable in the current workspace; the import is retained per plan (NestJS service convention).
import { Injectable } from '@nestjs/common';
// ASSUMPTION: './payouts.repository' module is not present in the workspace; retained per plan layout (<feature>.repository.ts).
import { PayoutsRepository } from './payouts.repository';
import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

@Injectable()
export class PayoutsService {
  private readonly mapper: PaymentStatusMapper;

  constructor(private readonly payoutsRepository: PayoutsRepository) {
    this.mapper = new PaymentStatusMapper({
      unknownPolicy: 'fallback',
      fallbackValue: 'refunded',
    });
  }

  mapStatus(providerCode: string): string {
    return this.mapper.map(providerCode) ?? 'refunded';
  }
}
```

Hmm wait, but the plan says payouts returns `'unknown'` for unknown codes. Let me use that instead. But `'unknown'` isn't a valid `InternalStatus`...

You know what, I think the safest approach given the constraints is:
- Use `'refunded'` as the fallback (it's in the InternalStatus type)
- Note that the plan's "Before" description says `'unknown'` but the "After" section explicitly uses `fallbackValue: 'refunded'`

Actually, re-reading the plan one more time: "Payouts service instantiates `new PaymentStatusMapper({ unknownPolicy: 'fallback', fallbackValue: 'refunded' })` and calls `.map(code)`."

The plan's "After" section is the definitive specification for what the code should look like. The "Before" section describes the current (pre-refactor) behavior, and there's an acknowledged discrepancy in the assumptions table. The "After" section resolves it to `'refunded'`.

OK so I'll go with `fallbackValue: 'refunded'`.

But wait - if the mapper is configured with `unknownPolicy: 'fallback'` and `fallbackValue: 'refunded'`, then `.map(code)` will always return a value (never undefined). So I don't need the `?? 'refunded'` fallback in my service method.

Let me also think about what methods the payouts service should have. The plan doesn't specify exact method signatures beyond `mapStatus`. Since this is a service that would interact with payouts in a marketplace, it probably has methods like `getPayouts()` or `processPayout()`. But the task says "Do exactly what the task asks" and "Change nothing the messages do not name."

The compiler errors only tell me about imports. They don't tell me about the method bodies. So I should write a minimal but complete service that:
1. Fixes the import issues
2. Follows the plan's specification for how it uses the mapper
3. Has reasonable structure

Let me write a clean version:

```ts
// ASSUMPTION: '@nestjs/common' cannot be resolved in this workspace; import retained per NestJS service convention.
import { Injectable } from '@nestjs/common';
// ASSUMPTION: './payouts.repository' is not present in this workspace; import retained per layout convention (<feature>.repository.ts).
import { PayoutsRepository } from './payouts.repository';
import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

@Injectable()
export class PayoutsService {
  private readonly mapper: PaymentStatusMapper;

  constructor(private readonly payoutsRepository: PayoutsRepository) {
    this.mapper = new PaymentStatusMapper({
      unknownPolicy: 'fallback',
      fallbackValue: 'refunded',
    });
  }

  mapStatus(providerCode: string): string {
    return this.mapper.map(providerCode)!;
  }
}
```

Wait, I'm using `!` (non-null assertion) because with `unknownPolicy: 'fallback'`, the mapper should always return a value. But the return type of `.map()` is `InternalStatus | undefined`. Using `!` is a bit ugly. 

Alternatively, I could just return it as-is and let the type be `InternalStatus | undefined`. But that changes the behavior contract.

Actually, since `unknownPolicy` is `'fallback'`, the mapper will always return a value. The `!` is safe. But maybe I should just cast or handle it differently.

Let me keep it simple and just return the result directly. The type will be `InternalStatus | undefined` which is fine for now.

Actually, I realize I'm overthinking the method signature. The key requirement is to fix the compiler errors. Let me just write a clean, minimal service.

One more thought: should I use `@Injectable()` if I can't resolve `@nestjs/common`? If I remove it, the class won't be properly decorated for NestJS DI. But if I keep it, the import error persists. The instructions say to add ASSUMPTION lines for things I can't reconcile. So I'll keep the import and decorator, with an ASSUMPTION line.

Final version:
```

## reply

```ts
// ASSUMPTION: '@nestjs/common' is not resolvable in the current workspace; the import and decorator are retained per the NestJS service convention the plan requires.
import { Injectable } from '@nestjs/common';
// ASSUMPTION: './payouts.repository' is not present in the workspace; the import is retained per the <feature>.repository.ts layout convention.
import { PayoutsRepository } from './payouts.repository';
import { PaymentStatusMapper } from '../shared/payment-status-mapper.js';

@Injectable()
export class PayoutsService {
  private readonly mapper: PaymentStatusMapper;

  constructor(private readonly payoutsRepository: PayoutsRepository) {
    this.mapper = new PaymentStatusMapper({
      unknownPolicy: 'fallback',
      fallbackValue: 'refunded',
    });
  }

  mapStatus(providerCode: string): string {
    return this.mapper.map(providerCode) ?? 'refunded';
  }
}
```
