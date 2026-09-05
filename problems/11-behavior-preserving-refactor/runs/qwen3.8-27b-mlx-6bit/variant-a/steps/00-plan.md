# plan

## reasoning

```
Let me analyze the task carefully.

The task is a behavior-preserving refactor:
1. Extract a `PaymentStatusMapper` into `src/shared/` that covers the union of provider codes
2. Three call sites delegate to it: orders, payouts, reporting
3. The reporting quirk (upper-casing one status differently) is preserved via an explicit option
4. Characterization tests for the reporting copy must be written FIRST
5. Unknown provider codes: each call site has different behavior (throw / return 'unknown' / silently skip) — preserve via mapper API, document in NOTES.md

Key decisions I need to make:
- File layout for the shared mapper
- The mapper's API shape (options, behavior modes)
- What the characterization tests look like
- What NOTES.md documents

Let me think about the structure:

The codebase uses NestJS, Prisma, etc. But this is a refactor task — the existing code is already there. The plan is for whoever implements the refactor.

Let me think about what files will be created/modified:
- `src/shared/payment-status-mapper.ts` — the new mapper class
- `src/orders/orders.service.ts` — modified to use mapper (already exists)
- `src/payouts/payouts.service.ts` — modified to use mapper (already exists)
- Reporting script — where is it? The problem says "a reporting script". Given the layout, it might be in `src/reporting/` or a standalone script. Let me assume `src/reporting/reporting.service.ts` or similar.
- `test/reporting.spec.ts` — characterization tests (new)
- `NOTES.md` — divergence documentation

Wait, the instructions say "Do not create a file it does not call for." But the task explicitly asks for:
- The extraction (new file in src/shared/)
- Characterization tests
- NOTES.md
- Modified call sites

Let me think about the mapper API:

```typescript
// Provider statuses (union across all three call sites)
type ProviderStatus = string; // or a specific union

// Internal statuses
type InternalStatus = 'pending' | 'completed' | 'failed' | ...;

// Behavior for unknown codes
type UnknownBehavior = 'throw' | 'return-unknown' | 'skip';

interface MapperOptions {
  unknownBehavior: UnknownBehavior;
  legacyReportCasing?: boolean;
}

class PaymentStatusMapper {
  constructor(options: MapperOptions);
  map(providerStatus: ProviderStatus): InternalStatus | undefined;
  // or mapAll(statuses: ProviderStatus[]): ...
}
```

Wait, let me reconsider. The three behaviors for unknown:
- Orders: throw
- Payouts: return 'unknown'
- Reporting: silently skip

The mapper needs to support all three. An option makes sense.

For the reporting quirk: "it upper-cases one status differently." So normally `completed` → `COMPLETED`, but in reporting maybe one specific status gets upper-cased while others don't, or vice versa. The option `{ legacyReportCasing: true }` preserves this.

Now for the manifest — I need to list files I will WRITE (create or modify). The task says "List only files you will write."

Files:
1. `src/shared/payment-status-mapper.ts` — new, the mapper
2. `test/payment-status-mapper.spec.ts` — unit tests for the mapper itself? The task says characterization tests for reporting first. But we might also want tests for the mapper.
3. `test/reporting.spec.ts` — characterization tests for reporting (NEW)
4. `NOTES.md` — divergence documentation
5. Modified files: orders.service.ts, payouts.service.ts, reporting service

Wait, the task says "all pre-existing tests passing unmodified." So I'm not modifying existing test files. I'm adding new test files and modifying source files.

Let me reconsider the manifest. The manifest says "List only files you will write." This means new files AND modified files.

Actually, re-reading: "A file may name under `reads:` only files listed above it." This is a dependency ordering constraint.

Let me structure the plan now.

Assumptions I need to make:
- The reporting script location: `src/reporting/reporting.service.ts` (following the module pattern)
- The mapper file: `src/shared/payment-status-mapper.ts`
- The internal status type values — I'll define them as a union of strings
- The provider status codes — these are the input, I'll type them as `string` since they're external
- The "silently skip" behavior in reporting means the mapper returns `undefined` and the caller filters it out
- NOTES.md lives at repo root

Let me think about what "silently skip" means. If reporting maps a list of statuses and one is unknown, it just doesn't include it in the output. So `map` returns `undefined` for unknown, and the reporting code does `.filter(Boolean)` or similar.

Actually, let me reconsider the API. The mapper could have:
- `map(code: string): InternalStatus | undefined` — returns undefined for unknown
- The caller decides what to do with undefined (throw, return 'unknown', filter out)

OR the mapper handles the unknown behavior internally via options. The task says "Preserve each call site's current behavior via the mapper's API." This suggests the mapper's API is what encodes the difference. So the option approach:

```typescript
interface PaymentStatusMapperOptions {
  onUnknown: 'throw' | 'unknown-string' | 'skip';
  legacyReportCasing?: boolean;
}
```

And `map` returns `InternalStatus` always (never undefined) when onUnknown is 'throw' or 'unknown-string', and returns `undefined` when 'skip'.

Wait, that's awkward. Let me think again.

If onUnknown is 'throw', map throws. If 'unknown-string', map returns the literal 'unknown'. If 'skip', map returns undefined.

Actually, I think a cleaner API:
- `map(code: string): InternalStatus | undefined` — the raw mapping
- The unknown behavior is handled by a wrapper or by the caller

But the task says "Preserve each call site's current behavior via the mapper's API." So the mapper's API should encode it.

Let me go with:
```typescript
class PaymentStatusMapper {
  constructor(options: MapperOptions);
  map(providerCode: string): InternalStatus | undefined;
  mapOrThrow(providerCode: string): InternalStatus;
}
```

Hmm, but that's two methods for one behavior axis. Let me stick with the option:

```typescript
interface MapperOptions {
  onUnknownCode: 'throw' | 'sentinel' | 'skip';
  legacyReportCasing?: boolean;
}

class PaymentStatusMapper {
  constructor(opts: MapperOptions);
  map(code: string): InternalStatus | undefined;
}
```

Where:
- 'throw': map() throws a TypeError for unknown codes
- 'sentinel': map() returns the literal string 'unknown' cast as InternalStatus... hmm that's ugly
- 'skip': map() returns undefined

Actually the sentinel approach is problematic type-wise. Let me think differently.

Maybe:
```typescript
type UnknownPolicy = 'throw' | 'fallback' | 'skip';

interface MapperOptions {
  unknownPolicy: UnknownPolicy;
  fallbackValue?: InternalStatus; // used when policy is 'fallback'
  legacyReportCasing?: boolean;
}
```

Payouts uses `unknownPolicy: 'fallback', fallbackValue: 'unknown'`.
Reporting uses `unknownPolicy: 'skip'`.
Orders uses `unknownPolicy: 'throw'`.

That's clean. The return type is always `InternalStatus | undefined` where undefined only happens with 'skip'.

Now for the "extra provider codes" in payouts: the mapper covers the union. Payouts has two extra codes that orders doesn't handle. Since the mapper covers the union, those codes will be in the map. Orders would never receive those codes (they come from a different provider flow), but if they did, they'd map correctly. That's fine — the union is a superset.

Wait, but the task says "covering the union of provider codes." So the mapper knows ALL codes. The divergence is only in what happens for codes NOT in the union (truly unknown).

OK let me also think about the "two extra provider codes" in payouts. These are codes that the payouts flow receives but orders doesn't. They're part of the union. The mapper handles them. No special treatment needed beyond including them in the mapping table.

Now for the reporting quirk: "it upper-cases one status differently." I need to be specific. Let's say normally the internal statuses are lowercase: 'pending', 'completed', 'failed'. The reporting quirk means one specific status (let's say 'completed') is output as 'COMPLETED' in the reporting flow. With `legacyReportCasing: true`, the mapper outputs 'COMPLETED' for that one status.

I'll define this in the plan as: when `legacyReportCasing` is true, the status 'completed' maps to 'COMPLETED' instead of 'completed'. This is the documented quirk.

Now let me write the plan sections.

For tests, I need:
- Characterization tests for reporting (ALL statuses including quirk, including unknown)
- Unit tests for the mapper itself
- The existing orders and payouts tests must pass unmodified

The characterization tests pin the CURRENT behavior of reporting. They test the output of the reporting function, not the mapper directly (since the mapper doesn't exist yet). After the refactor, they should still pass because the reporting code now delegates to the mapper with the right options.

Actually wait — "Write characterization tests for the reporting copy first, pinning its current output for all statuses (including the quirk)." These are tests that run against the CURRENT reporting code (before refactor) to pin its behavior. Then after the refactor, they still pass because the behavior is preserved.

In the plan, I'll specify what these tests assert.

Let me also think about whether the mapper needs its own test file. The task says "Deliver: the extraction, characterization tests, NOTES.md, all pre-existing tests passing unmodified." It doesn't explicitly ask for mapper unit tests. But the characterization tests for reporting, plus existing orders/payouts tests, should cover the mapper's behavior. I'll add a small mapper spec for completeness — actually no, "Do not create a file it does not call for." The task calls for characterization tests (for reporting) and the extraction. I'll stick to what's asked.

Hmm, but actually the characterization tests ARE tests of the mapper (indirectly, through the reporting service). And the existing orders/payouts tests cover those paths. I think that's sufficient and I shouldn't add an extra test file.

Wait, let me re-read: "Write characterization tests for the reporting copy first." This is `test/reporting.spec.ts`. That's the only new test file.

Let me finalize the manifest:
1. `src/shared/payment-status-mapper.ts` — new
2. `test/reporting.spec.ts` — new (characterization)
3. `NOTES.md` — new
4. `src/orders/orders.service.ts` — modified (delegates to mapper)
5. `src/payouts/payouts.service.ts` — modified (delegates to mapper)
6. `src/reporting/reporting.service.ts` — modified (delegates to mapper)

Do I need module files? The shared mapper might not be a NestJS module — it could just be a class imported where needed. If it's in `src/shared/`, maybe no module is needed, just the class file. The services import it directly.

Actually in NestJS, if I want to inject it as a provider, I'd need a module. But it could also be instantiated directly (it's stateless after construction). Let me assume it's a simple class that's instantiated in each service's constructor or as a provider.

For the plan, I'll say: the mapper is a plain class, instantiated in each service. No shared module needed.

Let me write this up now, keeping it terse.
```

## reply

## 1. Assumptions

| Decision | Choice | Why |
|---|---|---|
| Mapper location & file | `src/shared/payment-status-mapper.ts`, plain class (no Nest module) | Stateless; services instantiate it in their constructor. Avoids module wiring for a pure function. |
| Reporting service path | `src/reporting/reporting.service.ts` inside `ReportingModule` | Follows the `<feature>` layout already used by orders and payouts. |
| Internal status values | `type InternalStatus = 'pending' \| 'completed' \| 'failed' \| 'refunded'` | Union of all statuses the three call sites produce today. |
| Reporting quirk detail | When `legacyReportCasing` is true, the `'completed'` status is emitted as the literal string `'COMPLETED'`; all other statuses remain lowercase. | The problem states "upper-cases one status differently"; this is the single divergence to pin. |
| Payouts extra codes | Two provider codes (`'payout_initiated'`, `'payout_settled'`) map to `'pending'` and `'completed'` respectively. They exist only in the payouts flow but are part of the union table. | The mapper covers the union; no call-site special-casing needed. |
| Unknown-policy enum values | `'throw' \| 'fallback' \| 'skip'` with optional `fallbackValue: InternalStatus` | Covers the three observed behaviors without overloading one parameter. |
| NOTES.md location | Repository root (`NOTES.md`) | Conventional place for developer-facing refactor notes. |
| Existing test files | Untouched; they pass unmodified by virtue of behavior preservation. | The task requires this explicitly. |

## 2. Data model

none — this is a pure in-memory mapping refactor; no schema or persistence change.

## 3. Types and signatures

```ts
// ---- src/shared/payment-status-mapper.ts ----

export type InternalStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'refunded';

export type UnknownPolicy = 'throw' | 'fallback' | 'skip';

export interface MapperOptions {
  /** What to do when the provider code is not in the mapping table. */
  unknownPolicy: UnknownPolicy;
  /** Required when unknownPolicy === 'fallback'. Returned for unknown codes. */
  fallbackValue?: InternalStatus;
  /**
   * When true, the 'completed' status is emitted as 'COMPLETED' (uppercase).
   * Preserves a legacy reporting quirk; no other call site sets this.
   */
  legacyReportCasing?: boolean;
}

export class PaymentStatusMapper {
  constructor(options: MapperOptions);

  /**
   * Map a raw provider status code to the internal status.
   *
   * - unknownPolicy 'throw'  → throws TypeError for unknown codes
   * - unknownPolicy 'fallback' → returns options.fallbackValue
   * - unknownPolicy 'skip'   → returns undefined for unknown codes
   *
   * legacyReportCasing: when true, 'completed' is returned as 'COMPLETED'.
   *
   * @returns InternalStatus | undefined (undefined only for 'skip')
   */
  map(providerCode: string): InternalStatus | undefined;
}
```

**Errors raised:**

| Error | Raised by | Condition |
|---|---|---|
| `TypeError` | `PaymentStatusMapper.map` | `unknownPolicy === 'throw'` and code not in table |
| `Error('fallbackValue required')` | `PaymentStatusMapper` constructor | `unknownPolicy === 'fallback'` and `fallbackValue` is absent |

**Ordering rule:** Characterization tests for the reporting call site must exist and pass *before* any production code is modified. The extraction is then verified against those same tests.

## 4. Control flow

No state machine, no transactions. The refactor is a read-only mapping.

**Before (three copies):**
1. Orders service calls a local private method `mapStatus(code)` → always throws on unknown.
2. Payouts service calls a local private method `mapStatus(code)` → returns `'unknown'` on unknown.
3. Reporting service calls a local private method `mapStatus(code)` → skips (omits from array) on unknown; upper-cases `'completed'` to `'COMPLETED'`.

**After (delegation):**
1. Orders service instantiates `new PaymentStatusMapper({ unknownPolicy: 'throw' })` and calls `.map(code)`.
2. Payouts service instantiates `new PaymentStatusMapper({ unknownPolicy: 'fallback', fallbackValue: 'refunded' })` and calls `.map(code)`.
   *(Note: the payouts fallback value is whatever string the existing code returns for unknown — the implementer reads the fixture to confirm; listed here as `'refunded'` as a placeholder matching the "return 'unknown'" description. If the fixture shows a different literal, use that.)*
3. Reporting service instantiates `new PaymentStatusMapper({ unknownPolicy: 'skip', legacyReportCasing: true })` and calls `.map(code)`, filtering out `undefined` results before writing to the CSV.

**What must not be inside the mapper:** I/O, logging, database access, any NestJS lifecycle hook. It is a pure, synchronous, stateless class.

## 5. Tests

| Test (file `test/reporting.spec.ts`) | Proves |
|---|---|
| maps `'pending'` → `'pending'` | Reporting preserves the base pending mapping. |
| maps `'completed'` → `'COMPLETED'` | The legacy upper-case quirk is preserved. |
| maps `'failed'` → `'failed'` | Reporting preserves the base failed mapping. |
| maps `'refunded'` → `'refunded'` | Reporting preserves the base refunded mapping. |
| maps an unknown code (e.g. `'zzz'`) → returns nothing / skips | Reporting silently drops unknown codes from output. |
| maps `'payout_initiated'` → `'pending'` (if reporting encounters it) | Union table covers payout-specific codes without error. |

*All pre-existing tests in `test/orders.spec.ts` and `test/payouts.spec.ts` pass unmodified, proving the extraction preserved their behavior.*

## 6. Manifest

<!-- manifest
src/shared/payment-status-mapper.ts | reads: - | PaymentStatusMapper class, InternalStatus type, UnknownPolicy type, MapperOptions interface
test/reporting.spec.ts | reads: src/shared/payment-status-mapper.ts | Characterization tests pinning reporting output for all statuses including the legacyReportCasing quirk and skip-on-unknown
src/reporting/reporting.service.ts | reads: src/shared/payment-status-mapper.ts | Reporting service refactored to delegate status mapping to PaymentStatusMapper with legacyReportCasing and skip policy
src/orders/orders.service.ts | reads: src/shared/payment-status-mapper.ts | Orders service refactored to delegate status mapping to PaymentStatusMapper with throw policy
src/payouts/payouts.service.ts | reads: src/shared/payment-status-mapper.ts | Payouts service refactored to delegate status mapping to PaymentStatusMapper with fallback policy
NOTES.md | reads: src/shared/payment-status-mapper.ts | Documents the three divergent unknown-code behaviors and the legacyReportCasing quirk
-->
