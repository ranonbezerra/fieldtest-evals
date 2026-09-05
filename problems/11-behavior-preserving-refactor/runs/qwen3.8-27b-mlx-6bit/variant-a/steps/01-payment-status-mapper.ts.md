# 01-payment-status-mapper.ts

## reasoning

```
Let me analyze the plan carefully to write `src/shared/payment-status-mapper.ts`.

From the plan:

1. **Types:**
   - `InternalStatus = 'pending' | 'completed' | 'failed' | 'refunded'`
   - `UnknownPolicy = 'throw' | 'fallback' | 'skip'`
   - `MapperOptions` interface with:
     - `unknownPolicy: UnknownPolicy`
     - `fallbackValue?: InternalStatus`
     - `legacyReportCasing?: boolean`

2. **Class: `PaymentStatusMapper`**
   - Constructor takes `MapperOptions`
   - Method `map(providerCode: string): InternalStatus | undefined`

3. **Mapping table (union of all provider codes):**
   - The plan mentions: `'pending'` → `'pending'`, `'completed'` → `'completed'`, `'failed'` → `'failed'`, `'refunded'` → `'refunded'`
   - Payouts extra codes: `'payout_initiated'` → `'pending'`, `'payout_settled'` → `'completed'`

4. **Behavior:**
   - `unknownPolicy: 'throw'` → throws `TypeError` for unknown codes
   - `unknownPolicy: 'fallback'` → returns `options.fallbackValue`
   - `unknownPolicy: 'skip'` → returns `undefined` for unknown codes

5. **Legacy report casing:**
   - When `legacyReportCasing` is true, the `'completed'` status is emitted as `'COMPLETED'`

6. **Constructor validation:**
   - If `unknownPolicy === 'fallback'` and `fallbackValue` is absent, throw `Error('fallbackValue required')`

7. **No I/O, no logging, no database access, no NestJS lifecycle hooks. Pure, synchronous, stateless class.**

Now, the return type is `InternalStatus | undefined`. But wait - when `legacyReportCasing` is true and the mapped status is `'completed'`, it returns `'COMPLETED'`. That's not in the `InternalStatus` type. So the return type needs to accommodate that. Let me re-read the plan...

The plan says:
```ts
map(providerCode: string): InternalStatus | undefined;
```

But the quirk says `'completed'` becomes `'COMPLETED'`. This is a type issue. The return type as specified in the plan is `InternalStatus | undefined`, but the quirk produces `'COMPLETED'` which isn't in that union.

I think the most defensible reading is that the return type should be `string | undefined` to accommodate the quirk, OR we keep `InternalStatus | undefined` and cast. But the plan explicitly states the return type as `InternalStatus | undefined`. 

Hmm, but the plan also says "When `legacyReportCasing` is true, the `'completed'` status is emitted as `'COMPLETED'` (uppercase)." This contradicts the return type `InternalStatus | undefined` since `'COMPLETED'` is not in that union.

I think the most defensible reading is to use `string | undefined` as the return type, since the quirk produces a value outside the `InternalStatus` union. Or I could keep the plan's signature and use a type assertion internally. But that's ugly.

Actually, re-reading: the plan says the return type is `InternalStatus | undefined`. But the behavior produces `'COMPLETED'`. I'll mark this with an ASSUMPTION comment and use `string | undefined` as the return type since it's the only way to be type-correct while preserving the quirk. Wait, but the plan explicitly says `InternalStatus | undefined`. Let me think again...

Actually, I think I should follow the plan's signature exactly: `map(providerCode: string): InternalStatus | undefined`. And internally, when the quirk applies, I return `'COMPLETED' as InternalStatus`. No, that's wrong too.

The most defensible reading: the return type should be `string | undefined` to correctly represent all possible outputs including the quirk. The plan's signature is slightly imprecise here. I'll use `string | undefined` and add an ASSUMPTION comment.

Wait, let me reconsider. The plan is my specification and it says `InternalStatus | undefined`. Maybe the intent is that the quirk is a display-layer concern and the type system doesn't capture it perfectly. In practice, TypeScript would need the return to be `string | undefined` for the `'COMPLETED'` case.

I'll go with `string | undefined` as the return type since it's the only type-correct option, and add an ASSUMPTION comment noting that the plan specified `InternalStatus | undefined` but the quirk necessitates a broader type.

Actually, wait. Let me re-read: "Write it complete... Implement exactly what the plan specifies for this file." The plan says `InternalStatus | undefined`. But that's type-incorrect given the quirk. The instruction also says: "If a symbol you need is genuinely absent from both the plan and the references, do not guess in silence... write the file using the most defensible reading and mark it with one ASSUMPTION comment."

The type `string | undefined` isn't a "symbol absent" - it's a type correctness issue. I think the most defensible reading is to use `string | undefined` because:
1. The quirk produces `'COMPLETED'` which is not in `InternalStatus`
2. TypeScript strict mode would reject returning `'COMPLETED'` from a function typed to return `InternalStatus | undefined`
3. The plan's intent is clearly that the quirk works

I'll use `string | undefined` and note it.

Let me write the file now:

```ts
/**
 * Pure, stateless mapper from raw provider payment-status codes to internal
 * status values.
 *
 * No I/O, no logging, no database access. Call sites instantiate this class
 * with the options that match their legacy behaviour.
 */

// Internal status values produced across all three call sites.
export type InternalStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'refunded';

// What the mapper does when it encounters a provider code not in the table.
export type UnknownPolicy = 'throw' | 'fallback' | 'skip';

export interface MapperOptions {
  /** What to do when the provider code is not in the mapping table. */
  unknownPolicy: UnknownPolicy;

  /**
   * Required when `unknownPolicy` is `'fallback'`.
   * Returned verbatim for unknown codes.
   */
  fallbackValue?: InternalStatus;

  /**
   * When `true`, a mapped `'completed'` status is emitted as the literal
   * string `'COMPLETED'`.
   *
   * Preserves a legacy reporting quirk that CSV consumers depend on.
   * No other call site sets this option.
   */
  legacyReportCasing?: boolean;
}

// Union of all provider codes the three call sites recognise today.
const STATUS_TABLE: Readonly<Record<string, InternalStatus>> = {
  pending: 'pending',
  completed: 'completed',
  failed: 'failed',
  refunded: 'refunded',
  // Payouts-specific codes (present only in the payouts flow).
  payout_initiated: 'pending',
  payout_settled: 'completed',
};

export class PaymentStatusMapper {
  private readonly options: MapperOptions;

  constructor(options: MapperOptions) {
    if (options.unknownPolicy === 'fallback' && options.fallbackValue === undefined) {
      throw new Error('fallbackValue required');
    }
    this.options = options;
  }

  /**
   * Map a raw provider status code to the internal status.
   *
   * - `unknownPolicy: 'throw'`    → throws `TypeError` for unknown codes.
   * - `unknownPolicy: 'fallback'` → returns `options.fallbackValue`.
   * - `unknownPolicy: 'skip'`     → returns `undefined` for unknown codes.
   *
   * `legacyReportCasing`: when `true`, a result of `'completed'` is returned
   * as the literal string `'COMPLETED'`.
   *
   * @returns The internal status, `undefined` (skip), or the fallback value.
   */
  // ASSUMPTION: plan signature is `InternalStatus | undefined`, but the
  // legacyReportCasing quirk produces 'COMPLETED' which is outside that union.
  // Widening to `string | undefined` is the only type-correct option under
  // strict TypeScript.
  map(providerCode: string): string | undefined {
    const mapped = STATUS_TABLE[providerCode];

    if (mapped === undefined) {
      switch (this.options.unknownPolicy) {
        case 'throw':
          throw new TypeError(`Unknown provider status code: ${providerCode}`);
        case 'fallback':
          return this.options.fallbackValue as string;
        case 'skip':
          return undefined;
      }
    }

    if (this.options.legacyReportCasing && mapped === 'completed') {
      return 'COMPLETED';
    }

    return mapped;
  }
}
```

Wait, I need to double-check: the plan says "No NestJS lifecycle hook" and it's a plain class. Good, no decorators.

Also checking: "A service, repository or processor is listed in its module's `providers`." But the plan explicitly says "plain class (no Nest module)" and "services instantiate it in their constructor." So no NestJS wiring needed.

Let me also verify the error for unknown policy 'throw': plan says "throws TypeError". Good.

The fallback value: the plan says payouts uses `fallbackValue: 'refunded'` as a placeholder but notes "the implementer reads the fixture to confirm." Since I'm only writing this file and not the call sites, I just need the mapper to accept whatever `InternalStatus` is passed. The call sites will set it correctly.

I think this is complete and correct. Let me finalize.
```

## reply

```ts
/**
 * Pure, stateless mapper from raw provider payment-status codes to internal
 * status values.
 *
 * No I/O, no logging, no database access, no NestJS lifecycle hooks.
 * Call sites instantiate this class with the options that match their
 * legacy behaviour.
 */

// Internal status values produced across all three call sites.
export type InternalStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'refunded';

// What the mapper does when it encounters a provider code not in the table.
export type UnknownPolicy = 'throw' | 'fallback' | 'skip';

export interface MapperOptions {
  /** What to do when the provider code is not in the mapping table. */
  unknownPolicy: UnknownPolicy;

  /**
   * Required when `unknownPolicy` is `'fallback'`.
   * Returned verbatim for unknown codes.
   */
  fallbackValue?: InternalStatus;

  /**
   * When `true`, a mapped `'completed'` status is emitted as the literal
   * string `'COMPLETED'`.
   *
   * Preserves a legacy reporting quirk that CSV consumers depend on.
   * No other call site sets this option.
   */
  legacyReportCasing?: boolean;
}

// Union of all provider codes the three call sites recognise today.
const STATUS_TABLE: Readonly<Record<string, InternalStatus>> = {
  pending: 'pending',
  completed: 'completed',
  failed: 'failed',
  refunded: 'refunded',
  // Payouts-specific codes (present only in the payouts flow).
  payout_initiated: 'pending',
  payout_settled: 'completed',
};

export class PaymentStatusMapper {
  private readonly options: MapperOptions;

  constructor(options: MapperOptions) {
    if (options.unknownPolicy === 'fallback' && options.fallbackValue === undefined) {
      throw new Error('fallbackValue required');
    }
    this.options = options;
  }

  /**
   * Map a raw provider status code to the internal status.
   *
   * - `unknownPolicy: 'throw'`    → throws `TypeError` for unknown codes.
   * - `unknownPolicy: 'fallback'` → returns `options.fallbackValue`.
   * - `unknownPolicy: 'skip'`     → returns `undefined` for unknown codes.
   *
   * `legacyReportCasing`: when `true`, a result of `'completed'` is returned
   * as the literal string `'COMPLETED'`.
   *
   * @returns The internal status, `undefined` (skip), or the fallback value.
   */
  // ASSUMPTION: plan signature is `InternalStatus | undefined`, but the
  // legacyReportCasing quirk produces 'COMPLETED' which is outside that union.
  // Widening to `string | undefined` is the only type-correct option under
  // strict TypeScript.
  map(providerCode: string): string | undefined {
    const mapped = STATUS_TABLE[providerCode];

    if (mapped === undefined) {
      switch (this.options.unknownPolicy) {
        case 'throw':
          throw new TypeError(`Unknown provider status code: ${providerCode}`);
        case 'fallback':
          return this.options.fallbackValue as string;
        case 'skip':
          return undefined;
      }
    }

    if (this.options.legacyReportCasing && mapped === 'completed') {
      return 'COMPLETED';
    }

    return mapped;
  }
}
```
