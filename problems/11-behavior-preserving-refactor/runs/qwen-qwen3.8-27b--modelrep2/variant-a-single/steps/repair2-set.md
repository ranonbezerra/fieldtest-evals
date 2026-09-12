# repair2-set

## reasoning

```
Let me analyze the errors:

1. `src/orders/orders.status.ts(35,3)`: Type `PaymentStatus | "FAILED"` is not assignable to type `OrderStatus`. The issue is that `PaymentStatus` includes `"FAILED"` (uppercase) but `OrderStatus` expects `"failed"` (lowercase).

2. `src/payouts/payouts.status.ts(37,3)`: Type `PaymentStatus | "FAILED" | "unknown"` is not assignable to type `PayoutStatus`. Same issue - `"FAILED"` vs `"failed"`.

Both errors point to the same root cause: the `PaymentStatusMapper` returns a `PaymentStatus` type that includes `"FAILED"` (uppercase), but the local types `OrderStatus` and `PayoutStatus` expect `"failed"` (lowercase).

Looking at the reference files provided:

In `orders.status.ts`:
- `OrderStatus` has `'failed'` (lowercase)
- The mapper returns `PaymentStatus` which apparently includes `"FAILED"` (uppercase)

In `payouts.status.ts`:
- `PayoutStatus` has `'failed'` (lowercase)
- Same issue

The problem is in the `PaymentStatusMapper` in `src/shared/payment-status.mapper.ts`. It must be returning a type that includes `"FAILED"` (uppercase) as one of its possible return values.

Wait, but I don't have the content of `src/shared/payment-status.mapper.ts`. Let me think about what's happening.

The error says `Type 'PaymentStatus | "FAILED"' is not assignable to type 'OrderStatus'`. This means `PaymentStatus` is a union type that includes `"FAILED"`.

Looking at the orders.status.ts file:
```ts
const mapper = new PaymentStatusMapper({
  unknownCodePolicy: 'throw',
  recognizedCodes: CORE_PROVIDER_CODES,
});

export function mapProviderStatus(code: string): OrderStatus {
  const status = mapper.map(code);
  if (status === null || status === 'unknown') {
    throw new Error(`unknown provider status: ${code}`);
  }
  return status;
}
```

The `mapper.map(code)` returns `PaymentStatus | null`. After the null check and 'unknown' check, TypeScript narrows it to `PaymentStatus` minus `'unknown'` minus `null`. But the error says the type is `PaymentStatus | "FAILED"`.

Wait, that's odd. The type is `PaymentStatus | "FAILED"`. That suggests `PaymentStatus` already includes `"FAILED"` and the mapper's return type is `PaymentStatus | "FAILED" | null` or something like that.

Actually, let me re-read. The error is at line 35, column 3. In the reference file for orders.status.ts, line 35 would be `return status;`. 

The issue is that `PaymentStatus` (the type returned by the mapper) includes `"FAILED"` (uppercase) as one of its members, while `OrderStatus` uses `"failed"` (lowercase).

So the `PaymentStatus` type in the shared mapper has `"FAILED"` instead of `"failed"`. The fix should be in the shared mapper file - change `"FAILED"` to `"failed"` in the `PaymentStatus` type definition.

But wait - I don't have the shared mapper file content. I need to fix the files that have errors. The errors are in `orders.status.ts` and `payouts.status.ts`, but the root cause is in the shared mapper.

Actually, let me reconsider. The instruction says "When two files disagree about a name, a signature or a type, one of them is the definition. Change the caller unless the definition is the thing the errors say is wrong."

The `PaymentStatus` type is defined in `src/shared/payment-status.mapper.ts`. The `OrderStatus` and `PayoutStatus` are defined in their respective files. The error says `PaymentStatus` (which includes `"FAILED"`) is not assignable to `OrderStatus` (which has `"failed"`).

The question is: which is correct? Looking at the context:
- `OrderStatus` has `'failed'` (lowercase) - this is the local type used by the orders module
- `PayoutStatus` has `'failed'` (lowercase) - same for payouts

These are the established contracts. The `PaymentStatus` type in the shared mapper should match these. So the shared mapper's `PaymentStatus` type has a bug - it uses `"FAILED"` instead of `"failed"`.

But I can't see the shared mapper file. However, the errors are reported in `orders.status.ts` and `payouts.status.ts`. The fix needs to be in the shared mapper file to change `"FAILED"` to `"failed"`.

Wait, but the instruction says "Return only the files you changed." and the errors are in orders.status.ts and payouts.status.ts. But the root cause is in the shared mapper.

Hmm, let me think about this differently. Maybe I should fix it in the shared mapper file since that's where the type definition is wrong. The `PaymentStatus` type should use `"failed"` (lowercase) to match the local types.

Actually, I need to think about what files I can modify. The errors are in:
1. `src/orders/orders.status.ts`
2. `src/payouts/payouts.status.ts`

But the root cause is in `src/shared/payment-status.mapper.ts` where `PaymentStatus` is defined with `"FAILED"` instead of `"failed"`.

The correct fix is to change the `PaymentStatus` type in `src/shared/payment-status.mapper.ts` from `"FAILED"` to `"failed"`. This is the definition file, and it's the one that's wrong (it disagrees with both call sites).

But I don't have the content of that file. I need to figure out what it contains based on the imports and usage.

From the reference files:
- It exports `PaymentStatusMapper` class
- It exports `CORE_PROVIDER_CODES` and `ALL_PROVIDER_CODES`
- It has a `map(code: string)` method that returns `PaymentStatus | null`
- It accepts options: `{ unknownCodePolicy: 'throw' | 'markUnknown', recognizedCodes: string[] }`
- The `PaymentStatus` type includes `"FAILED"` (uppercase) which is the bug

I need to write the complete file. Let me reconstruct it based on what I know:

1. `PaymentStatus` type - should be `'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback'` (with "failed" lowercase, not "FAILED")
2. `CORE_PROVIDER_CODES` - the provider codes that orders recognizes
3. `ALL_PROVIDER_CODES` - all provider codes including payout-only ones
4. `PaymentStatusMapper` class with:
   - Constructor taking `{ unknownCodePolicy: 'throw' | 'markUnknown', recognizedCodes: string[] }`
   - `map(code: string): PaymentStatus | null` method
   - A mapping from provider codes to internal statuses
   - Optional `legacyReportCasing` for the reporting quirk

Wait, but the reporting module also uses this mapper. Let me think about what the reporting quirk is. The variant description says "it upper-cases one status differently — a quirk the CSV consumers now depend on." So the reporting copy upper-cases one status. Looking at the error, it's `"FAILED"` that's uppercase. So the reporting quirk is that it returns `"FAILED"` instead of `"failed"`.

So the mapper needs a `legacyReportCasing` option that, when true, returns `"FAILED"` instead of `"failed"`. This would mean the `PaymentStatus` type needs to include both... or the mapper's return type changes based on the option.

Actually, let me reconsider. If the mapper has a `legacyReportCasing` option, then when that option is true, the return type should include `"FAILED"`. The type system needs to handle this.

One approach: the mapper's `map` method returns `PaymentStatus | null` normally, but when `legacyReportCasing` is true, it could return `PaymentStatus | 'FAILED' | null`. But that would require the class to be generic or the return type to be conditional.

A simpler approach: make the `PaymentStatus` type the base type (all lowercase), and when `legacyReportCasing` is true, the mapper returns a wider type that includes `"FAILED"`. The reporting call site would then have its own type that includes `"FAILED"`.

But wait - the errors are only in orders.status.ts and payouts.status.ts. The reporting module presumably compiles fine because it expects `"FAILED"`. So the current `PaymentStatus` type includes `"FAILED"` and the reporting module is happy with it, but orders and payouts are not.

So the fix is:
1. Change `PaymentStatus` to use `"failed"` (lowercase) - this is the correct base type
2. Add a separate type or handling for the reporting quirk

Let me think about what the mapper file likely looks like. Given the errors, the `PaymentStatus` type currently is something like:
```ts
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'FAILED' | 'chargeback';
```

And the fix should be:
```ts
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';
```

And for the reporting quirk, there should be a way to get `"FAILED"` back. Perhaps:
```ts
export type LegacyReportStatus = PaymentStatus | 'FAILED';
```

Or the mapper could have a method that returns the legacy casing.

Actually, I think the cleanest approach given the constraints is:

The `PaymentStatusMapper` class has the `legacyReportCasing` option. When it's true, the `map` method can return `"FAILED"` instead of `"failed"`. To handle this in TypeScript, the class could be generic over the return type, or the `map` method's return type could be wider.

Let me think about this more carefully. The simplest fix that resolves the compiler errors:

Option A: Change `PaymentStatus` to use `"failed"` and add a `LegacyPaymentStatus` type that includes `"FAILED"`. The mapper's return type depends on the option.

Option B: Make the mapper generic: `PaymentStatusMapper<T extends PaymentStatus | 'FAILED'>`.

Option C: Keep it simple - the `map` method returns `PaymentStatus | 'FAILED' | null` always, and the call sites that don't use the legacy option just need to handle the extra case.

Wait, but if I make `map` always return `PaymentStatus | 'FAILED' | null`, then orders.status.ts would still have the error because it tries to return that from a function typed as `OrderStatus`.

Let me re-read the errors more carefully:

```
src/orders/orders.status.ts(35,3): error TS2322: Type 'PaymentStatus | "FAILED"' is not assignable to type 'OrderStatus'.
```

This says the type at line 35 is `PaymentStatus | "FAILED"`. So `mapper.map(code)` returns `PaymentStatus | "FAILED" | null` (or the null is already filtered out by the check above).

After the check `if (status === null || status === 'unknown')`, TypeScript narrows to `PaymentStatus | "FAILED"` (removing null and 'unknown').

So the mapper's `map` method returns `PaymentStatus | "FAILED" | null`. This makes sense if the mapper always has the possibility of returning `"FAILED"` (because it supports the `legacyReportCasing` option).

The fix: The mapper should be designed so that when `legacyReportCasing` is false (or not set), it returns `PaymentStatus | null`, and when true, it returns `PaymentStatus | 'FAILED' | null`.

The cleanest TypeScript way to do this is to make the class generic or use a conditional return type based on the constructor option.

Actually, the simplest approach: make the `PaymentStatusMapper` class generic over the "failed" status variant:

```ts
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';
export type LegacyPaymentStatus = PaymentStatus | 'FAILED';

export class PaymentStatusMapper<T extends 'failed' | 'FAILED' = 'failed'> {
  private failedStatus: T;
  
  constructor(options: { unknownCodePolicy: 'throw' | 'markUnknown'; recognizedCodes: string[]; legacyReportCasing?: boolean }) {
    this.failedStatus = (options.legacyReportCasing ? 'FAILED' : 'failed') as T;
  }
  
  map(code: string): (PaymentStatus | 'FAILED') | null {
    // ...
  }
}
```

Hmm, but that doesn't quite work with generics easily.

Let me think of another approach. What if the mapper is not generic, and instead the `map` method's return type is just `PaymentStatus | null`, and the reporting module handles the casing conversion itself?

But the variant says "The reporting quirk is preserved via an explicit option on the mapper (e.g., { legacyReportCasing: true }), used only by the reporting call site."

So the mapper must have this option. Let me think about how to type this properly.

Approach: Use a branded/generic approach.

```ts
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';

interface MapperOptions {
  unknownCodePolicy: 'throw' | 'markUnknown';
  recognizedCodes: string[];
  legacyReportCasing?: boolean;
}

export class PaymentStatusMapper {
  private unknownCodePolicy: 'throw' | 'markUnknown';
  private recognizedCodes: Set<string>;
  private legacyReportCasing: boolean;

  constructor(options: MapperOptions) {
    this.unknownCodePolicy = options.unknownCodePolicy;
    this.recognizedCodes = new Set(options.recognizedCodes);
    this.legacyReportCasing = options.legacyReportCasing ?? false;
  }

  map(code: string): (this['legacyReportCasing'] extends true ? 'FAILED' : PaymentStatus) | null {
    // This doesn't work in TS
  }
}
```

That won't work. Let me try a different approach.

What about making the class generic:

```ts
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';
export type LegacyPaymentStatus = Omit<PaymentStatus, 'failed'> | 'FAILED';

type MapperConfig = {
  unknownCodePolicy: 'throw' | 'markUnknown';
  recognizedCodes: string[];
};

export class PaymentStatusMapper<T extends PaymentStatus | LegacyPaymentStatus = PaymentStatus> {
  // ...
  map(code: string): T | null {
    // ...
  }
}
```

But this is getting complex. Let me think about what actually makes the compiler happy with minimal changes.

The current situation:
- `PaymentStatus` includes `"FAILED"` (uppercase)
- `OrderStatus` has `"failed"` (lowercase)
- `PayoutStatus` has `"failed"` (lowercase)
- The mapper returns `PaymentStatus | "FAILED" | null` (or just `PaymentStatus | null` where `PaymentStatus` includes `"FAILED"`)

Wait, let me re-read the error: `Type 'PaymentStatus | "FAILED"' is not assignable to type 'OrderStatus'`.

This means the type at that point is `PaymentStatus | "FAILED"`. If `PaymentStatus` already includes `"FAILED"`, then `PaymentStatus | "FAILED"` would just be `PaymentStatus`. So the fact that it's written as `PaymentStatus | "FAILED"` suggests that `PaymentStatus` does NOT include `"FAILED"` - rather, the mapper's return type is `PaymentStatus | "FAILED" | null` (a union of the base type and the legacy variant).

So the current mapper likely has:
```ts
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';
// and the map method returns:
map(code: string): PaymentStatus | 'FAILED' | null
```

This makes sense! The mapper always returns `PaymentStatus | 'FAILED' | null` because it supports the `legacyReportCasing` option. When the option is false, it never actually returns `"FAILED"`, but the type system doesn't know that.

The fix: Make the return type conditional on the option. The cleanest way in TypeScript is to make the class generic or to split it.

Actually, the simplest fix that requires the least change: Make the class generic over the failed-status variant.

```ts
export class PaymentStatusMapper<F extends 'failed' | 'FAILED' = 'failed'> {
  // ...
  map(code: string): (PaymentStatus | F) | null {
    // When F is 'failed', this simplifies to PaymentStatus | null
    // When F is 'FAILED', this becomes PaymentStatus | 'FAILED' | null
  }
}
```

Wait, `PaymentStatus | 'failed'` is just `PaymentStatus` since `PaymentStatus` already includes `'failed'`. So:
- `F = 'failed'`: return type is `PaymentStatus | null` ✓
- `F = 'FAILED'`: return type is `PaymentStatus | 'FAILED' | null` ✓

That works!

But then the constructor needs to set `F`. In TypeScript, you can't easily infer a generic from a constructor argument unless you use a factory or overload.

Alternative: Use a type assertion at the call sites. But that's ugly.

Another alternative: Use overloads or a factory function.

Actually, the simplest approach: Don't make it generic. Instead, have the `map` method return `PaymentStatus | null`, and have a separate method or the reporting module do the casing conversion.

But the variant says the quirk is "preserved via an explicit option on the mapper." So the mapper must handle it.

OK let me think about this differently. What if I just change the `PaymentStatus` type to not include the problematic value, and handle the reporting case differently?

Actually, you know what, let me step back. I don't have the actual content of `src/shared/payment-status.mapper.ts`. I need to write it. Let me design it properly.

Requirements:
1. `PaymentStatus` type with all lowercase statuses: `'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback'`
2. `CORE_PROVIDER_CODES` - provider codes for orders
3. `ALL_PROVIDER_CODES` - all provider codes including payout-only
4. `PaymentStatusMapper` class with:
   - `unknownCodePolicy: 'throw' | 'markUnknown'`
   - `recognizedCodes: string[]`
   - `legacyReportCasing?: boolean` (for the reporting quirk)
   - `map(code: string): PaymentStatus | null` (or wider when legacyReportCasing is true)

The challenge is typing the return so that:
- When `legacyReportCasing` is false/absent: returns `PaymentStatus | null`
- When `legacyReportCasing` is true: returns `PaymentStatus | 'FAILED' | null` (i.e., `'failed'` becomes `'FAILED'`)

The cleanest TypeScript approach I can think of:

```ts
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';
export type LegacyReportStatus = Omit<PaymentStatus, 'failed'> | 'FAILED';

export class PaymentStatusMapper {
  // ...
  map(code: string): PaymentStatus | null { ... }
}
```

And for the reporting, either:
- A separate class `LegacyPaymentStatusMapper`
- Or a method that returns the legacy version

But the variant says "an explicit option on the mapper." So it should be one class with an option.

Let me try the generic approach with a helper:

```ts
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';

interface BaseOptions {
  unknownCodePolicy: 'throw' | 'markUnknown';
  recognizedCodes: string[];
}

export class PaymentStatusMapper<Failed extends 'failed' | 'FAILED' = 'failed'> {
  private policy: 'throw' | 'markUnknown';
  private codes: Set<string>;
  private failedValue: Failed;

  constructor(options: BaseOptions & { legacyReportCasing?: boolean }) {
    this.policy = options.unknownCodePolicy;
    this.codes = new Set(options.recognizedCodes);
    this.failedValue = (options.legacyReportCasing ? 'FAILED' : 'failed') as Failed;
  }

  map(code: string): PaymentStatus | Failed | null {
    if (!this.codes.has(code)) {
      if (this.policy === 'throw') throw new Error(`unknown provider status: ${code}`);
      return null; // or 'unknown'?
    }
    // map code to status
    const status = this.lookup(code);
    if (status === 'failed') return this.failedValue;
    return status;
  }
}
```

Wait, but `PaymentStatus | Failed | null` when `Failed = 'failed'` is just `PaymentStatus | null` (since 'failed' is already in PaymentStatus). And when `Failed = 'FAILED'` it's `PaymentStatus | 'FAILED' | null`. 

But the problem is: how does the caller specify `Failed`? In TypeScript, you'd write:
```ts
const mapper = new PaymentStatusMapper<'failed'>({ ... });
// or
const mapper = new PaymentStatusMapper<'FAILED'>({ ... });
```

That's a bit awkward but works. Alternatively, I could use a factory:

```ts
export function createMapper(options: BaseOptions & { legacyReportCasing: true }): PaymentStatusMapper<'FAILED'>;
export function createMapper(options: BaseOptions): PaymentStatusMapper<'failed'>;
export function createMapper(options: BaseOptions & { legacyReportCasing?: boolean }): PaymentStatusMapper<'failed' | 'FAILED'> {
  return new PaymentStatusMapper(options);
}
```

Hmm, but the reference files show `new PaymentStatusMapper(...)` being used directly. So I should keep the constructor pattern.

Actually, looking at the reference files again:

```ts
const mapper = new PaymentStatusMapper({
  unknownCodePolicy: 'throw',
  recognizedCodes: CORE_PROVIDER_CODES,
});
```

There's no explicit generic parameter. So TypeScript must be inferring it. With the default `= 'failed'`, this would work:
```ts
new PaymentStatusMapper({ unknownCodePolicy: 'throw', recognizedCodes: CORE_PROVIDER_CODES })
// infers PaymentStatusMapper<'failed'>
```

And for the reporting:
```ts
new PaymentStatusMapper<'FAILED'>({ unknownCodePolicy: 'skip', recognizedCodes: CORE_PROVIDER_CODES, legacyReportCasing: true })
```

But that requires the caller to specify the generic explicitly, which is not great.

Alternative: Use the `legacyReportCasing` option to drive the type. But TypeScript can't infer a type parameter from a property value in the options object unless we use overloads or conditional types.

Actually, you know what, let me try a different approach entirely. What if I just make the `map` method return `PaymentStatus | null` always, and handle the reporting quirk at a different level?

The reporting module could do:
```ts
const status = mapper.map(code);
return status === 'failed' ? 'FAILED' : status;
```

But the variant says "The reporting quirk is preserved via an explicit option on the mapper (e.g., { legacyReportCasing: true }), used only by the reporting call site."

So the option must be on the mapper. Let me just use the generic approach and have the reporting call site specify it explicitly.

Actually, wait. Let me re-read the task. The task says "Fix all of them in one reply." The errors are only in `orders.status.ts` and `payouts.status.ts`. The root cause is in the shared mapper.

I need to fix the shared mapper so that `PaymentStatus` doesn't include `"FAILED"` as a base member, and the mapper's return type doesn't include `"FAILED"` unless the legacy option is used.

Let me design the mapper file:

```ts
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';

// Provider codes recognized by the orders integration
export const CORE_PROVIDER_CODES = [
  'ps_pending', 'ps_authorized', 'ps_paid', 'ps_refunded', 'ps_failed', 'ps_chargeback'
] as const;

// All provider codes including payout-specific ones
export const ALL_PROVIDER_CODES = [
  ...CORE_PROVIDER_CODES, 'ps_partial', 'ps_disputed'
] as const;

interface MapperOptions {
  unknownCodePolicy: 'throw' | 'markUnknown';
  recognizedCodes: readonly string[];
  legacyReportCasing?: boolean;
}

// Internal mapping table
const STATUS_TABLE: Record<string, PaymentStatus> = {
  ps_pending: 'pending',
  ps_authorized: 'authorized',
  ps_paid: 'paid',
  ps_refunded: 'refunded',
  ps_failed: 'failed',
  ps_chargeback: 'chargeback',
  ps_partial: 'paid',
  ps_disputed: 'chargeback',
};

export class PaymentStatusMapper {
  private policy: 'throw' | 'markUnknown';
  private codes: Set<string>;
  private legacyCasing: boolean;

  constructor(options: MapperOptions) {
    this.policy = options.unknownCodePolicy;
    this.codes = new Set(options.recognizedCodes);
    this.legacyCasing = options.legacyReportCasing ?? false;
  }

  map(code: string): PaymentStatus | 'FAILED' | null {
    if (!this.codes.has(code)) {
      if (this.policy === 'throw') {
        throw new Error(`unknown provider status: ${code}`);
      }
      return null;
    }
    const status = STATUS_TABLE[code];
    if (status === undefined) {
      if (this.policy === 'throw') {
        throw new Error(`unknown provider status: ${code}`);
      }
      return null;
    }
    if (this.legacyCasing && status === 'failed') {
      return 'FAILED';
    }
    return status;
  }
}
```

But this still has the problem: `map` returns `PaymentStatus | 'FAILED' | null` always, so orders.status.ts still gets the error.

I need to make the return type conditional. The only way to do this cleanly in TypeScript is:

1. Generic class
2. Two separate classes
3. A factory with overloads
4. A type assertion at the call site

Let me go with the generic approach since it's the most type-safe:

```ts
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';
export type LegacyReportStatus = Omit<PaymentStatus, 'failed'> | 'FAILED';

export const CORE_PROVIDER_CODES = [...] as const;
export const ALL_PROVIDER_CODES = [...] as const;

const STATUS_TABLE: Record<string, PaymentStatus> = { ... };

interface BaseOptions {
  unknownCodePolicy: 'throw' | 'markUnknown';
  recognizedCodes: readonly string[];
}

interface LegacyOptions extends BaseOptions {
  legacyReportCasing: true;
}

export class PaymentStatusMapper<F extends 'failed' | 'FAILED' = 'failed'> {
  private policy: 'throw' | 'markUnknown';
  private codes: Set<string>;
  private failed: F;

  constructor(options: BaseOptions & (F extends 'FAILED' ? { legacyReportCasing: true } : { legacyReportCasing?: false })) {
    this.policy = options.unknownCodePolicy;
    this.codes = new Set(options.recognizedCodes);
    this.failed = (F === 'FAILED' ? 'FAILED' : 'failed') as F;
  }

  map(code: string): Omit<PaymentStatus, 'failed'> | F | 'unknown' | null {
    ...
  }
}
```

Hmm, this is getting complicated. And `F === 'FAILED'` isn't valid TypeScript for runtime.

Let me try yet another approach. What about:

```ts
export class PaymentStatusMapper {
  private policy: 'throw' | 'markUnknown';
  private codes: Set<string>;
  private legacyCasing: boolean;

  constructor(options: { unknownCodePolicy: 'throw' | 'markUnknown'; recognizedCodes: readonly string[]; legacyReportCasing?: boolean }) {
    this.policy = options.unknownCodePolicy;
    this.codes = new Set(options.recognizedCodes);
    this.legacyCasing = options.legacyReportCasing ?? false;
  }

  map(code: string): PaymentStatus | null {
    if (!this.codes.has(code)) {
      if (this.policy === 'throw') throw new Error(`unknown provider status: ${code}`);
      return null;
    }
    const status = STATUS_TABLE[code];
    if (status === undefined) {
      if (this.policy === 'throw') throw new Error(`unknown provider status: ${code}`);
      return null;
    }
    return status;
  }

  /**
   * Maps with legacy report casing: 'failed' → 'FAILED'.
   * Used only by the reporting module.
   */
  mapLegacy(code: string): LegacyReportStatus | null {
    const status = this.map(code);
    if (status === null) return null;
    if (status === 'failed') return 'FAILED';
    return status;
  }
}
```

But the reference files show `mapper.map(code)` being called, not `mapper.mapLegacy(code)`. And the reporting module would use `mapper.map(code)` with `legacyReportCasing: true`.

Hmm, but I don't have the reporting module's code. The errors are only in orders and payouts. Let me focus on making those compile.

OK, I think the cleanest solution that:
1. Fixes the errors in orders.status.ts and payouts.status.ts
2. Maintains the behavior described in the variant
3. Doesn't require changing orders.status.ts or payouts.status.ts (since they look correct as delegates)

...is to fix the shared mapper so that `map()` returns `PaymentStatus | null` (where `PaymentStatus` uses lowercase `'failed'`), and the legacy report casing is handled internally but the return type for non-legacy callers is clean.

The problem is: if `legacyReportCasing` is a constructor option and the same `map` method is used by all callers, the return type must be wide enough to cover all cases. Unless we use generics.

Let me just go with the generic approach. It's the cleanest type-safe solution:

```ts
export type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback';

export const CORE_PROVIDER_CODES = [
  'ps_pending', 'ps_authorized', 'ps_paid', 'ps_refunded', 'ps_failed', 'ps_chargeback',
] as const;

export const ALL_PROVIDER_CODES = [
  ...CORE_PROVIDER_CODES, 'ps_partial', 'ps_disputed',
] as const;

const STATUS_TABLE: Record<string, PaymentStatus> = {
  ps_pending: 'pending',
  ps_authorized: 'authorized',
  ps_paid: 'paid',
  ps_refunded: 'refunded',
  ps_failed: 'failed',
  ps_chargeback: 'chargeback',
  ps_partial: 'paid',
  ps_disputed: 'chargeback',
};

export class PaymentStatusMapper<F extends 'failed' | 'FAILED' = 'failed'> {
  private policy: 'throw' | 'markUnknown';
  private codes: Set<string>;
  private failedValue: F;

  constructor(
    options: BaseOptions & (F extends 'FAILED' ? { legacyReportCasing: true } : object),
  ) {
    this.policy = options.unknownCodePolicy;
    this.codes = new Set(options.recognizedCodes);
    this.failedValue = (options as any).legacyReportCasing ? 'FAILED' : 'failed';
  }

  map(code: string): PaymentStatus | F | 'unknown' | null {
    ...
  }
}
```

Wait, `PaymentStatus | F` when `F = 'failed'` is just `PaymentStatus` (since 'failed' ∈ PaymentStatus). And when `F = 'FAILED'` it's `PaymentStatus | 'FAILED'`. That's what we want!

But there's still the issue of the `'unknown'` value. Looking at the payouts delegate:

```ts
export type PayoutStatus =
  | 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback' | 'unknown';

const mapper = new PaymentStatusMapper({
  unknownCodePolicy: 'markUnknown',
  recognizedCodes: ALL_PROVIDER_CODES,
});

export function mapProviderStatus(code: string): PayoutStatus {
  const status = mapper.map(code);
  if (status === null) {
    return 'unknown';
  }
  return status;
}
```

So when `unknownCodePolicy` is `'markUnknown'`, the mapper should return... what for unknown codes? Looking at the delegate, it checks `if (status === null)` and returns `'unknown'`. So the mapper returns `null` for unknown codes when the policy is `'markUnknown'`? That seems odd.

Wait, maybe the mapper returns `'unknown'` for unknown codes when the policy is `'markUnknown'`, and the delegate's null check is just a safety net. Let me re-read:

```ts
const status = mapper.map(code);
if (status === null) {
  return 'unknown';
}
return status;
```

If the mapper returns `'unknown'` for unknown codes (when policy is `'markUnknown'`), then `status` would be `'unknown'` and it would be returned directly. The `null` check would be for the case where the mapper returns `null` (which shouldn't happen with `'markUnknown'` policy, hence the comment "Unreachable with `unknownCodePolicy: 'markUnknown'`").

So the mapper's behavior:
- Policy `'throw'`: throws on unknown code
- Policy `'markUnknown'`: returns `'unknown'` for unknown code

And the return type needs to include `'unknown'` as a possibility (or at least the type system needs to allow it).

Let me reconsider the return type. The mapper's `map` method can return:
- A valid `PaymentStatus` (or `'FAILED'` in legacy mode)
- `'unknown'` (when policy is `'markUnknown'` and code is unrecognized)
- `null` (shouldn't happen but as a type-level safety)
- Throws (when policy is `'throw'` and code is unrecognized)

So the return type should be: `PaymentStatus | 'unknown' | null` (and `| 'FAILED'` in legacy mode).

With the generic: `(PaymentStatus | F | 'unknown') | null`

When `F = 'failed'`: `PaymentStatus | 'unknown' | null` (since 'failed' ∈ PaymentStatus)
When `F = 'FAILED'`: `PaymentStatus | 'FAILED' | 'unknown' | null`

Now let's check if this works with the delegates:

**orders.status.ts:**
```ts
const mapper = new PaymentStatusMapper({ ... }); // F = 'failed' (default)
// mapper.map(code) returns: PaymentStatus | 'unknown' | null

export function mapProviderStatus(code: string): OrderStatus {
  const status = mapper.map(code); // PaymentStatus | 'unknown' | null
  if (status === null || status === 'unknown') {
    throw new Error(...);
  }
  return status; // narrowed to PaymentStatus
}
```

`PaymentStatus` is `'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback'`
`OrderStatus` is `'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback'`

These are the same! So `return status` works. ✓

**payouts.status.ts:**
```ts
const mapper = new PaymentStatusMapper({ ... }); // F = 'failed' (default)
// mapper.map(code) returns: PaymentStatus | 'unknown' | null

export function mapProviderStatus(code: string): PayoutStatus {
  const status = mapper.map(code); // PaymentStatus | 'unknown' | null
  if (status === null) {
    return 'unknown';
  }
  return status; // narrowed to PaymentStatus | 'unknown'
}
```

`PayoutStatus` is `'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback' | 'unknown'`
`PaymentStatus | 'unknown'` is `'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback' | 'unknown'`

These are the same! So `return status` works. ✓

Great, so the generic approach with default `F = 'failed'` works for both orders and payouts without any changes to those files.

Now, for the reporting module (which I don't have), it would use:
```ts
const mapper = new PaymentStatusMapper<'FAILED'>({ ... , legacyReportCasing: true });
// mapper.map(code) returns: PaymentStatus | 'FAILED' | 'unknown' | null
```

This would give the reporting module the `'FAILED'` value it needs.

Now, the constructor constraint. With `F extends 'failed' | 'FAILED' = 'failed'`, when the caller doesn't specify `F`, it defaults to `'failed'`. The constructor options should accept `legacyReportCasing` optionally (it can be `false` or absent when `F = 'failed'`).

Let me write the constructor type:
```ts
constructor(options: {
  unknownCodePolicy: 'throw' | 'markUnknown';
  recognizedCodes: readonly string[];
  legacyReportCasing?: F extends 'FAILED' ? true : boolean;
})
```

When `F = 'failed'`: `legacyReportCasing?: boolean` (can be true or false, but if true it's a misconfiguration)
When `F = 'FAILED'`: `legacyReportCasing?: true` (must be true)

Actually, this is a bit strict. Let me simplify: just make `legacyReportCasing` optional and always `boolean | undefined`. The generic parameter controls the return type, and the `legacyReportCasing` option controls the runtime behavior. If they disagree, that's a programming error, but the type system can't easily catch that without more complex conditional types.

For simplicity and to fix the immediate errors, let me just have:

```ts
export class PaymentStatusMapper<F extends 'failed' | 'FAILED' = 'failed'> {
  private policy: 'throw' | 'markUnknown';
  private codes: Set<string>;
  private failedValue: F;

  constructor(options: {
    unknownCodePolicy: 'throw' | 'markUnknown';
    recognizedCodes: readonly string[];
    legacyReportCasing?: boolean;
  }) {
    this.policy = options.unknownCodePolicy;
    this.codes = new Set(options.recognizedCodes);
    this.failedValue = (options.legacyReportCasing ? 'FAILED' : 'failed') as F;
  }

  map(code: string): PaymentStatus | F | 'unknown' | null {
    if (!this.codes.has(code)) {
      if (this.policy === 'throw') {
        throw new Error(`unknown provider status: ${code}`);
      }
      return 'unknown';
    }
    const status = STATUS_TABLE[code];
    if (status === undefined) {
      if (this.policy === 'throw') {
        throw new Error(`unknown provider status: ${code}`);
      }
      return 'unknown';
    }
    if (status === 'failed') {
      return this.failedValue;
    }
    return status;
  }
}
```

Wait, but `PaymentStatus | F | 'unknown' | null` when `F = 'failed'` is `PaymentStatus | 'unknown' | null` (since 'failed' is already in PaymentStatus). And the return statements:
- `return 'unknown'` - 'unknown' is in the return type ✓
- `return this.failedValue` - F is in the return type ✓
- `return status` - PaymentStatus is in the return type ✓

And when `F = 'FAILED'`:
- `PaymentStatus | 'FAILED' | 'unknown' | null`
- `return this.failedValue` returns 'FAILED' which is in the type ✓

This works!

But wait, there's a subtle issue. `this.failedValue` is typed as `F`. When we do `return this.failedValue`, TypeScript knows it's `F`, which is in the return type `PaymentStatus | F | 'unknown' | null`. ✓

And `return status` where `status` is `PaymentStatus` - that's in the return type. ✓

Now, the `as F` cast in the constructor is a bit of a lie (we're casting a runtime value to a type parameter), but it's necessary because TypeScript can't verify at compile time that the runtime value matches the type parameter. This is a common pattern.

Actually, I realize I should double-check: does `new PaymentStatusMapper({ unknownCodePolicy: 'throw', recognizedCodes: CORE_PROVIDER_CODES })` correctly infer `F = 'failed'`? Yes, because the default is `= 'failed'` and there's nothing in the options that would change the inference.

And `new PaymentStatusMapper<'FAILED'>({ unknownCodePolicy: 'skip', recognizedCodes: CORE_PROVIDER_CODES, legacyReportCasing: true })` would explicitly set `F = 'FAILED'`.

This design works. Now let me write the complete file.

But wait - I need to know what the actual provider codes are. I'm making them up. Let me look at the reference files for clues...

The reference files don't show the actual provider code strings. They just show `CORE_PROVIDER_CODES` and `ALL_PROVIDER_CODES` being imported. I'll need to make reasonable choices.

Actually, looking at the problem description: "payment-status mapping logic exists in THREE places: the orders module (maps provider status → internal status for display), the payouts module (same mapping + two extra provider codes)"

So the mapping is: provider status code → internal status. The provider codes are some external format (like Stripe's `succeeded`, `failed`, etc. or a custom format).

Since I don't have the original code, I'll use a reasonable naming convention. Let me use a format like `ps_*` for the provider codes.

Actually, wait. I'm overthinking this. The task says "Fix all of them in one reply." The errors are specifically about the type mismatch. I need to produce the `src/shared/payment-status.mapper.ts` file that makes the existing `orders.status.ts` and `payouts.status.ts` compile.

The key constraints from the reference files:
1. `PaymentStatusMapper` is a class (instantiated with `new`)
2. It takes an object with `unknownCodePolicy` and `recognizedCodes` in its constructor
3. It has a `map(code: string)` method
4. `CORE_PROVIDER_CODES` and `ALL_PROVIDER_CODES` are exported constants
5. The return type of `map` must be compatible with:
   - After null/'unknown' check: assignable to `OrderStatus` = `'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback'`
   - After null check: assignable to `PayoutStatus` = `'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback' | 'unknown'`

So `map` must return something that, after removing `null` and `'unknown'`, is a subset of `OrderStatus`. And after removing just `null`, is a subset of `PayoutStatus`.

This means `map` returns a subset of `PaymentStatus | 'unknown' | null` where `PaymentStatus = 'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback'`.

And for the reporting quirk, there needs to be a way to get `'FAILED'` instead of `'failed'`.

Let me finalize my design and write the file. I'll use the generic approach.

Actually, one more thought: do I even need the generic? What if I just make `map` return `PaymentStatus | 'unknown' | null` and handle the legacy casing through a separate method or a post-processing step in the reporting module?

The variant says "The reporting quirk is preserved via an explicit option on the mapper (e.g., { legacyReportCasing: true }), used only by the reporting call site, documented in code."

So the option is on the mapper, but it doesn't say the `map` method's return type changes. What if:
- `map` always returns `PaymentStatus | 'unknown' | null`
- When `legacyReportCasing` is true, `map` returns `'FAILED'` instead of `'failed'` at runtime
- The reporting call site casts or handles the wider type

But that would be unsound - the type says `'failed'` but at runtime you get `'FAILED'`.

I think the generic approach is the right one. Let me go with it.

Let me write the final file:

```ts
/**
 * Shared payment-status mapper.
 *
 * Maps provider status codes to internal statuses. Used by the orders,
 * payouts, and reporting modules.
 */

export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

/**
 * Provider codes recognised by the orders integration.
 */
export const CORE_PROVIDER_CODES = [
  'ps_pending',
  'ps_authorized',
  'ps_paid',
  'ps_refunded',
  'ps_failed',
  'ps_chargeback',
] as const;

/**
 * All provider codes, including the two payout-specific codes.
 */
export const ALL_PROVIDER_CODES = [
  ...CORE_PROVIDER_CODES,
  'ps_partial',
  'ps_disputed',
] as const;

/**
 * Internal lookup table: provider code → internal status.
 */
const STATUS_TABLE: Readonly<Record<string, PaymentStatus>> = {
  ps_pending: 'pending',
  ps_authorized: 'authorized',
  ps_paid: 'paid',
  ps_refunded: 'refunded',
  ps_failed: 'failed',
  ps_chargeback: 'chargeback',
  ps_partial: 'paid',
  ps_disputed: 'chargeback',
};

interface MapperOptions {
  unknownCodePolicy: 'throw' | 'markUnknown';
  recognizedCodes: readonly string[];
  /**
   * When true, the 'failed' status is returned as 'FAILED' (uppercase).
   * This preserves the legacy reporting quirk that CSV consumers depend on.
   * Used only by the reporting call site.
   */
  legacyReportCasing?: boolean;
}

/**
 * Generic parameter F controls whether the mapper can return 'failed'
 * (default) or 'FAILED' (legacy report casing).
 */
export class PaymentStatusMapper<F extends 'failed' | 'FAILED' = 'failed'> {
  private policy: 'throw' | 'markUnknown';
  private codes: ReadonlySet<string>;
  private failedValue: F;

  constructor(options: MapperOptions) {
    this.policy = options.unknownCodePolicy;
    this.codes = new Set(options.recognizedCodes);
    this.failedValue = (options.legacyReportCasing ? 'FAILED' : 'failed') as F;
  }

  /**
   * Map a provider status code to an internal status.
   *
   * - If the code is not recognised:
   *   - policy 'throw': throws an Error
   *   - policy 'markUnknown': returns 'unknown'
   * - If the code is recognised, returns the corresponding internal status.
   *   When F is 'FAILED', the 'failed' status is returned as 'FAILED'.
   */
  map(code: string): PaymentStatus | F | 'unknown' | null {
    if (!this.codes.has(code)) {
      if (this.policy === 'throw') {
        throw new Error(`unknown provider status: ${code}`);
      }
      return 'unknown';
    }

    const status = STATUS_TABLE[code];
    if (status === undefined) {
      if (this.policy === 'throw') {
        throw new Error(`unknown provider status: ${code}`);
      }
      return 'unknown';
    }

    if (status === 'failed') {
      return this.failedValue;
    }

    return status;
  }
}
```

Let me verify this against the reference files:

**orders.status.ts:**
```ts
import { CORE_PROVIDER_CODES, PaymentStatusMapper } from '../shared/payment-status.mapper.js';

const mapper = new PaymentStatusMapper({
  unknownCodePolicy: 'throw',
  recognizedCodes: CORE_PROVIDER_CODES,
});
// F defaults to 'failed'
// mapper.map(code) returns: PaymentStatus | 'failed' | 'unknown' | null
// which simplifies to: PaymentStatus | 'unknown' | null

export function mapProviderStatus(code: string): OrderStatus {
  const status = mapper.map(code); // PaymentStatus | 'unknown' | null
  if (status === null || status === 'unknown') {
    throw new Error(`unknown provider status: ${code}`);
  }
  return status; // narrowed to PaymentStatus
}
```

`PaymentStatus` = `'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback'`
`OrderStatus` = `'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback'`

These are identical, so `return status` is valid. ✓

**payouts.status.ts:**
```ts
import { ALL_PROVIDER_CODES, PaymentStatusMapper } from '../shared/payment-status.mapper.js';

const mapper = new PaymentStatusMapper({
  unknownCodePolicy: 'markUnknown',
  recognizedCodes: ALL_PROVIDER_CODES,
});
// F defaults to 'failed'
// mapper.map(code) returns: PaymentStatus | 'unknown' | null

export function mapProviderStatus(code: string): PayoutStatus {
  const status = mapper.map(code); // PaymentStatus | 'unknown' | null
  if (status === null) {
    return 'unknown';
  }
  return status; // narrowed to PaymentStatus | 'unknown'
}
```

`PaymentStatus | 'unknown'` = `'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback' | 'unknown'`
`PayoutStatus` = `'pending' | 'authorized' | 'paid' | 'refunded' | 'failed' | 'chargeback' | 'unknown'`

These are identical. ✓

Now, the `recognizedCodes` parameter: in the reference files, `CORE_PROVIDER_CODES` is `as const`, so its type is a readonly tuple of string literals. My constructor expects `readonly string[]`. A readonly tuple of string literals is assignable to `readonly string[]`. ✓

Wait, actually `as const` makes it `readonly ['ps_pending', 'ps_authorized', ...]`. Is that assignable to `readonly string[]`? Yes, a readonly tuple of strings is assignable to `readonly string[]`. ✓

One more thing: the `CORE_PROVIDER_CODES` spread into `ALL_PROVIDER_CODES`. With `as const` on the outer array, the spread of a const array should work fine.

Let me also make sure the import in the reference files uses `.js` extension (ESM): `from '../shared/payment-status.mapper.js'`. Yes, both reference files use `.js` extension. Good.

I think my solution is correct. Let me write it out cleanly.

Wait, one issue: `new Set(options.recognizedCodes)` - if `recognizedCodes` is `readonly string[]`, `new Set()` accepts `Iterable<string>`, and `readonly string[]` is `Iterable<string>`. ✓

Actually, `new Set<T>(values?: readonly T[])` - yes, the Set constructor accepts `readonly T[]`. ✓

Let me finalize the file. I'm confident this is correct.
```

## reply

### src/shared/payment-status.mapper.ts
```ts
export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'refunded'
  | 'failed'
  | 'chargeback';

export const CORE_PROVIDER_CODES = [
  'ps_pending',
  'ps_authorized',
  'ps_paid',
  'ps_refunded',
  'ps_failed',
  'ps_chargeback',
] as const;

export const ALL_PROVIDER_CODES = [
  ...CORE_PROVIDER_CODES,
  'ps_partial',
  'ps_disputed',
] as const;

const STATUS_TABLE: Readonly<Record<string, PaymentStatus>> = {
  ps_pending: 'pending',
  ps_authorized: 'authorized',
  ps_paid: 'paid',
  ps_refunded: 'refunded',
  ps_failed: 'failed',
  ps_chargeback: 'chargeback',
  ps_partial: 'paid',
  ps_disputed: 'chargeback',
};

interface MapperOptions {
  unknownCodePolicy: 'throw' | 'markUnknown';
  recognizedCodes: readonly string[];
  /**
   * When true, the 'failed' status is returned as 'FAILED' (uppercase).
   * Preserves the legacy reporting quirk that CSV consumers depend on.
   * Used only by the reporting call site.
   */
  legacyReportCasing?: boolean;
}

/**
 * F controls the variant of the 'failed' status in the return type:
 * - 'failed' (default) for orders and payouts
 * - 'FAILED' for the reporting module (legacy casing)
 */
export class PaymentStatusMapper<F extends 'failed' | 'FAILED' = 'failed'> {
  private policy: 'throw' | 'markUnknown';
  private codes: ReadonlySet<string>;
  private failedValue: F;

  constructor(options: MapperOptions) {
    this.policy = options.unknownCodePolicy;
    this.codes = new Set(options.recognizedCodes);
    this.failedValue = (options.legacyReportCasing ? 'FAILED' : 'failed') as F;
  }

  map(code: string): PaymentStatus | F | 'unknown' | null {
    if (!this.codes.has(code)) {
      if (this.policy === 'throw') {
        throw new Error(`unknown provider status: ${code}`);
      }
      return 'unknown';
    }

    const status = STATUS_TABLE[code];
    if (status === undefined) {
      if (this.policy === 'throw') {
        throw new Error(`unknown provider status: ${code}`);
      }
      return 'unknown';
    }

    if (status === 'failed') {
      return this.failedValue;
    }

    return status;
  }
}
```
