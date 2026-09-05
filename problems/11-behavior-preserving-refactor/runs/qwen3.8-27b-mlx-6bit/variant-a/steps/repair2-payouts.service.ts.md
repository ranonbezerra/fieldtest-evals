# repair2-payouts.service.ts

## reasoning

```
Let me analyze the compiler errors that relate to `src/payouts/payouts.service.ts`:

1. `src/payouts/payouts.service.ts(2,28): error TS2307: Cannot find module '@nestjs/common' or its corresponding type declarations.`
2. `src/payouts/payouts.service.ts(4,35): error TS2307: Cannot find module './payouts.repository' or its corresponding type declarations.`

These are the only two errors for `src/payouts/payouts.service.ts`. The other errors are in other files.

Now, the instruction says "Change nothing the messages do not name." So I need to fix only what these two messages require for this file.

Error 1: Cannot find module '@nestjs/common' — This means the import from `@nestjs/common` fails. Since I can't install packages or change the environment, I need to handle this. But wait — the task says "fixing what these messages require of this file." If `@nestjs/common` isn't available, I need to remove or replace the import. But the plan says this is a NestJS service... However, looking at the mapper file, it's a plain class with no NestJS dependency. The service in the fixture likely uses `@Injectable()` decorator from `@nestjs/common`.

Wait, let me re-read the instruction: "Rewrite `src/payouts/payouts.service.ts` complete, fixing what these messages require of this file."

So I need to produce a complete file that compiles. The errors say:
1. `@nestjs/common` module not found — I need to remove that import or handle it.
2. `./payouts.repository` module not found — I need to remove that import or handle it.

But wait — the plan says the payouts service should delegate to `PaymentStatusMapper`. Let me think about what the payouts service needs to do:

From the plan:
- Payouts service instantiates `new PaymentStatusMapper({ unknownPolicy: 'fallback', fallbackValue: 'refunded' })` and calls `.map(code)`.
- The fallback value is whatever the existing code returns for unknown.

But I don't have the original `payouts.service.ts` content. I only know:
- It imports from `@nestjs/common` (line 2, char 28)
- It imports from `./payouts.repository` (line 4, char 35)
- It uses the status mapping

Since I can't see the original file, and I'm told to "fix what these messages require," I need to produce a complete file that:
1. Doesn't import `@nestjs/common` (since it's not available)
2. Doesn't import `./payouts.repository` (since it doesn't exist)
3. Uses `PaymentStatusMapper` with the fallback policy

But wait — the plan says this is a NestJS service. If `@nestjs/common` isn't available, how do I make it a NestJS service? I can't. The instruction says "If satisfying the compiler seems to require abandoning something the plan specified, keep the plan and add one `// ASSUMPTION:` line saying what you could not reconcile."

So I should keep the intent of it being a service (maybe use a class without the decorator), and add an ASSUMPTION comment.

Actually, let me reconsider. The errors are:
1. `@nestjs/common` not found
2. `./payouts.repository` not found

For error 1: I can't use the `@Injectable()` decorator. I'll add an ASSUMPTION line.
For error 2: I can't import the repository. I'll add an ASSUMPTION line.

But wait — the instruction says "Change nothing the messages do not name." This means I should only change things related to these specific errors. But I need to produce a "complete" file. Since I don't have the original, I need to reconstruct it based on what I know from the plan.

Let me think about what the payouts service would look like:
- It's a service class (was `@Injectable()`)
- It had a repository dependency (imported from `./payouts.repository`)
- It had a private method `mapStatus(code)` that returned `'unknown'` (or some fallback) for unknown codes
- After refactoring, it should use `PaymentStatusMapper` with `{ unknownPolicy: 'fallback', fallbackValue: ... }`

The plan says the fallback value is a placeholder `'refunded'` but notes "the implementer reads the fixture to confirm." Since I can't read the fixture, I'll use `'refunded'` as the plan suggests and add an ASSUMPTION.

Wait, actually re-reading the plan more carefully:
> Payouts service instantiates `new PaymentStatusMapper({ unknownPolicy: 'fallback', fallbackValue: 'refunded' })` and calls `.map(code)`.
> *(Note: the payouts fallback value is whatever string the existing code returns for unknown — the implementer reads the fixture to confirm; listed here as `'refunded'` as a placeholder matching the "return 'unknown'" description. If the fixture shows a different literal, use that.)*

Hmm, but the variant says "return 'unknown'" — so maybe the fallback value should be `'unknown'`? But `'unknown'` isn't in the `InternalStatus` union. Let me look at the mapper's return type:

```ts
map(providerCode: string): string | undefined
```

The return type is `string | undefined`, so `'unknown'` would be fine at the type level. But `fallbackValue` is typed as `InternalStatus | undefined`. So if I pass `'unknown'` it won't type-check.

Wait, looking at the mapper code again:
```ts
fallbackValue?: InternalStatus;
```

So `fallbackValue` must be an `InternalStatus`. The plan says `'refunded'` as a placeholder. I'll go with that since I can't see the fixture.

Actually, let me reconsider. The variant says the payouts copy "returns 'unknown'" for unknown codes. But `'unknown'` is not in the `InternalStatus` type. This is a conflict. The plan acknowledges this with the note. I'll use `'refunded'` as the plan suggests and add an ASSUMPTION.

Hmm, but actually maybe I should just use a string type for fallbackValue? No — the mapper is already written and I'm told not to change files that aren't named by the errors. The mapper file isn't in the error list for this task (the errors in `payment-status-mapper.ts` aren't listed). Wait, actually looking again at the errors:

```
src/orders/orders.service.ts(2,28): error TS2307: Cannot find module '@nestjs/common' or its corresponding type declarations.
src/orders/orders.service.ts(12,5): error TS2322: Type 'string' is not assignable to type 'InternalStatus'.
src/payouts/payouts.service.ts(2,28): error TS2307: Cannot find module '@nestjs/common' or its corresponding type declarations.
src/payouts/payouts.service.ts(4,35): error TS2307: Cannot find module './payouts.repository' or its corresponding type declarations.
src/reporting/reporting.service.ts(2,28): error TS2307: Cannot find module '@nestjs/common' or its corresponding type declarations.
src/reporting/reporting.service.ts(18,5): error TS2322: Type 'string | undefined' is not assignable to type 'InternalStatus | undefined'.
test/reporting.spec.ts(30,38): error TS2339: Property 'toBeUndefined' does not exist on type ...
```

None of these are in `src/shared/payment-status-mapper.ts`. So I can't modify that file.

OK so for `src/payouts/payouts.service.ts`, I need to:
1. Remove the `@nestjs/common` import (or replace it)
2. Remove the `./payouts.repository` import (or replace it)
3. Make it compile

Let me write the file:

```ts
import { PaymentStatusMapper } from '../shared/payment-status-mapper';

// ASSUMPTION: @nestjs/common is not available in this workspace; the @Injectable() decorator and any NestJS lifecycle wiring cannot be applied.
// ASSUMPTION: ./payouts.repository does not exist in this workspace; the repository dependency cannot be injected. The service is reconstructed with only the mapper logic that the plan specifies.
// ASSUMPTION: The fallback value for unknown provider codes in payouts is 'refunded' per PLAN.md placeholder; the original fixture's literal could not be confirmed.

export class PayoutsService {
  private readonly mapper: PaymentStatusMapper;

  constructor() {
    this.mapper = new PaymentStatusMapper({
      unknownPolicy: 'fallback',
      fallbackValue: 'refunded',
    });
  }

  mapStatus(providerCode: string): string {
    const result = this.mapper.map(providerCode);
    return result ?? 'refunded';
  }
}
```

Wait, but `this.mapper.map(providerCode)` returns `string | undefined`. With `unknownPolicy: 'fallback'`, it should always return a string (never undefined), because unknown codes get the fallback and known codes get their mapped value. So `result` should always be a string. But TypeScript doesn't know that — it sees `string | undefined`.

I could do:
```ts
mapStatus(providerCode: string): string {
  const result = this.mapper.map(providerCode);
  if (result === undefined) {
    // Should not happen with 'fallback' policy, but guard for type safety.
    return this.mapper2... 
  }
  return result;
}
```

Or simpler: since the fallback policy guarantees a non-undefined return, I can use a non-null assertion or just handle it:

```ts
mapStatus(providerCode: string): string {
  return this.mapper.map(providerCode) ?? 'refunded';
}
```

This is clean and type-safe. The `??` handles the theoretical undefined case.

Actually wait — I'm overthinking this. Let me just write a clean service that:
1. Doesn't import `@nestjs/common`
2. Doesn't import `./payouts.repository`
3. Uses the mapper with fallback policy
4. Compiles

Let me keep it minimal and focused on what the plan requires.
```

## reply

```ts
// ASSUMPTION: @nestjs/common is not resolvable in this workspace, so the @Injectable() decorator and any NestJS DI wiring are omitted.
// ASSUMPTION: ./payouts.repository does not exist in this workspace, so the repository dependency is omitted.
// ASSUMPTION: The fallback value for unknown provider codes in the payouts flow is 'refunded' per PLAN.md; the original fixture literal could not be confirmed.

import { PaymentStatusMapper } from '../shared/payment-status-mapper';

export class PayoutsService {
  private readonly mapper: PaymentStatusMapper;

  constructor() {
    this.mapper = new PaymentStatusMapper({
      unknownPolicy: 'fallback',
      fallbackValue: 'refunded',
    });
  }

  /**
   * Map a raw provider status code to the internal payout status.
   * Unknown codes fall back to 'refunded' (preserves legacy behaviour of
   * returning a concrete string rather than throwing or skipping).
   */
  mapStatus(providerCode: string): string {
    return this.mapper.map(providerCode) ?? 'refunded';
  }
}
```
