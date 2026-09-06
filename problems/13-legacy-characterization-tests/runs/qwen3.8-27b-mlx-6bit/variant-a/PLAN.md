## 1. Assumptions

- The existing module `src/fee-calculator.ts` (the fixture) exports a single public function and any supporting types it defines internally; the test file imports from that path. I do not write or modify it.
- The function's signature includes an optional `now: Date` parameter as the clock-injection point; all tests pass a fixed `Date` instance.
- Case types and complexity bands are string-literal unions (or enums) defined in the module; the test file imports them as `type` aliases.
- The function returns a plain `number` (the fee in the smallest currency unit, e.g. cents).
- "Rounding at each step" means the module applies `Math.round` (or floor/ceil) after intermediate multiplications; tests assert exact integer output for inputs that would differ under a different rounding mode.
- The two rate-table transitions occurred on known fixed dates (readable from the source); tests use those exact dates plus ±1 day.
- Test file name follows repo convention: `test/fee-calculator.spec.ts`.
- `FINDINGS.md` lives at the repository root.
- No new source files are created; no schema changes, no migrations.

## 2. Data model

none

## 3. Types and signatures

The test file exports nothing public. It imports the following from `src/fee-calculator.ts` (names resolved against that file; listed here so the implementer knows what to expect):

| Symbol | Kind | Notes |
|---|---|---|
| `FeeInput` | type/interface | Fields: `caseType: CaseType`, `complexity: ComplexityBand`, `urgency: number`, `openedAt: Date` |
| `CaseType` | type (string-literal union) | e.g. `"civil" \| "criminal" \| "administrative" \| …` (full set in source) |
| `ComplexityBand` | type (string-literal union) | e.g. `"low" \| "medium" \| "high" \| …` |
| `calculateFee` | function | `(input: FeeInput, now?: Date) => number` |

The test file defines no exported types. Internally it may use a `CASE_TYPES: readonly CaseType[]` array and a `COMPLEXITY_BANDS: readonly ComplexityBand[]` array to drive combinatorial tests.

**Ordering rule:** every test constructs its `Date` arguments as `new Date(year, month, day)` (UTC midnight) so that boundary comparisons in the module are unambiguous. No test may depend on wall-clock time.

## 4. Control flow

There is no state machine, transaction, or concurrency concern. The control flow per test is:

1. Construct a fixed `Date` for `openedAt` and/or `now`.
2. Build a `FeeInput` object with explicit field values.
3. Call `calculateFee(input, fixedNow)`.
4. Assert the returned number equals the pinned expected value (exact equality, `toBe`).

No test mutates module state. No test calls the function without the `now` parameter (avoids real-clock dependency). The suite is a flat set of `describe` blocks; there are no shared mutable fixtures or `beforeAll` side-effects.

## 5. Tests

| # | Test name (one-line intent) | Proves |
|---|---|---|
| 1 | `returns the base fee for every case-type × complexity-band pair (no urgency, pre-transition-1 date)` | All base-rate table entries are pinned. |
| 2 | `applies the default urgency multiplier of 1.0 to leave the fee unchanged` | Identity urgency is a no-op. |
| 3 | `applies each documented urgency multiplier (1.5, 2.0, 3.0) and pins the product` | Multiplier arithmetic is correct for known values. |
| 4 | `uses rate-table-1 when openedAt is strictly before the first transition date` | Pre-boundary routing. |
| 5 | `uses rate-table-1 when openedAt equals the first transition date (inclusive edge)` | Inclusive/exclusive semantics at transition 1. |
| 6 | `uses rate-table-2 when openedAt is the day after the first transition date` | Post-boundary routing at transition 1. |
| 7 | `uses rate-table-2 when openedAt is strictly before the second transition date` | Middle-window routing. |
| 8 | `uses rate-table-2 when openedAt equals the second transition date (inclusive edge)` | Inclusive/exclusive semantics at transition 2. |
| 9 | `uses rate-table-3 when openedAt is the day after the second transition date` | Post-boundary routing at transition 2. |
| 10 | `rounds the final fee to an integer via [Math.round/floor/ceil] after the urgency multiplication` | Rounding mode and step are pinned. |
| 11 | `rounds intermediate per-step values before the next multiplication (e.g. base×complexity rounded, then ×urgency)` | Rounding granularity is per-step, not only at the end. |
| 12 | `returns 0 when urgency is 0` | Zero-multiplier degenerate case. |
| 13 | `QUIRK: clamps a negative urgency to the minimum of 1.0 instead of throwing` | Negative-urgency behaviour is clamped, not rejected. Flagged. |
| 14 | `QUIRK: an unknown caseType string falls through to a default rate instead of throwing` | No validation on caseType; silent default. Flagged. |
| 15 | `QUIRK: an unknown complexity band is treated as "low"` | No validation on complexity; silent default. Flagged. |
| 16 | `BUG: [describe the genuine bug discovered in source, e.g. off-by-one on transition 2 making it exclusive instead of inclusive]` | The bug's observable effect is pinned. Flagged with `BUG` prefix. |
| 17 | `returns the same result for openedAt on the day after NOW (future-dated case) as it does for a past date in the same window` | `now` is not used to reject future dates (or pins whatever it does). |
| 18 | `pins the exact integer output for a 2.5-urgency with a base fee of 133 (non-trivial rounding)` | Rounding direction at .5 boundary. |

Test names for items 13–16 begin with `QUIRK:` or `BUG:` so they are grep-able and self-documenting in CI output.

## 6. Manifest

<!-- manifest
test/fee-calculator.spec.ts | reads: - | characterization suite pinning every case-type × complexity, urgency multiplier, rate-table boundary, rounding step, and degenerate input of the fee calculator
FINDINGS.md | reads: - | documents each quirk and bug with reproducing input, observed output, likely blast radius on stored historical fees, and a proposed (unapplied) fix
-->
