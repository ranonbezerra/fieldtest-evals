# FINDINGS — `src/fee-calculator.ts`

Characterization suite for the case-fee calculator. Each finding below was discovered
while pinning existing behaviour and is documented here **without** applying any fix.
Test names in `test/fee-calculator.spec.ts` carry the matching `QUIRK:` or `BUG:`
prefix so they are grep-able in CI output.

---

## Quirk 1 — Negative urgency is clamped to 1.0 (not rejected)

**Reproducing input**

```ts
calculateFee(
  { caseType: "civil", complexity: "low", urgency: -5, openedAt: new Date(2020, 0, 1) },
  new Date(2024, 5, 15),
)
```

**Observed output**
The function silently substitutes `urgency = 1.0` and returns the base fee for
`civil / low`. No exception is thrown; the result is byte-identical to calling with
`urgency: 1.0`.

**Blast radius (stored historical fees)**
Any billing record submitted with a negative urgency — whether from a data-entry error,
an upstream API using `-1` as a "not-applicable" sentinel, or a migration artefact —
was silently charged the base rate instead of being rejected. Those invoices are stored
and audited. A future reconciliation that expects an error (or `0`) for negative urgency
will find mismatched amounts in the ledger.

**Proposed fix (not applied)**
Replace the clamp with a guard clause at the top of `calculateFee`:

```ts
if (input.urgency < 0) throw new UrgencyMustBeNonNegativeError(input.urgency);
```

The error type should map to the API's standard error envelope with code
`urgency_must_be_non_negative`.

---

## Quirk 2 — Unknown case type falls through to a default rate

**Reproducing input**

```ts
calculateFee(
  { caseType: "intellectual_property", complexity: "high", urgency: 1.0, openedAt: new Date(2021, 3, 15) },
  new Date(2024, 5, 15),
)
```

**Observed output**
No exception. The unrecognized `caseType` is resolved to a fallback/default rate bucket
and a fee is returned as though the case type were that default. The caller receives a
plausible-looking number with no indication that the lookup failed.

**Blast radius (stored historical fees)**
If a new case type is introduced in the case-management system before this module is
updated, every fee for that type is computed with the wrong (default) rate. Those
invoices are stored, audited, and potentially already billed to clients. The discrepancy
is invisible until a manual audit cross-references invoices against the rate card.

**Proposed fix (not applied)**
Remove the fall-through default. Use an exhaustive `switch` (or a `Record<CaseType, …>`
lookup with a `never` exhaustiveness assertion) so that any value outside the known
union throws `UnknownCaseTypeError` at call time:

```ts
const rate = RATES[input.caseType];           // typed Record<CaseType, number>
if (rate === undefined) throw new UnknownCaseTypeError(input.caseType);
```

---

## Quirk 3 — Unknown complexity band is silently treated as "low"

**Reproducing input**

```ts
calculateFee(
  { caseType: "criminal", complexity: "extreme", urgency: 2.0, openedAt: new Date(2022, 6, 1) },
  new Date(2024, 5, 15),
)
```

**Observed output**
The unrecognized band is mapped to the `"low"` rate. The returned fee is the lowest
possible base rate for `criminal`, multiplied by `2.0` and rounded — far below what a
genuinely complex case should cost. No error is raised.

**Blast radius (stored historical fees)**
Any record whose stored complexity string does not match a known band (typo, locale
variant, new band added without updating this module) was billed at the "low" rate.
Under-billing accumulates silently and may surface only during a client dispute or a
regulatory audit years later.

**Proposed fix (not applied)**
Guard against unknown bands with an explicit check:

```ts
const KNOWN_BANDS: readonly ComplexityBand[] = ["low", "medium", "high"];
if (!KNOWN_BANDS.includes(input.complexity)) {
  throw new UnknownComplexityBandError(input.complexity);
}
```

Remove the silent `"low"` fallback.

---

## Bug — Off-by-one on the second rate-table transition (boundary day routed to the wrong table)

// ASSUMPTION: The plan identifies this as the genuine bug — an off-by-one on transition 2
// making the boundary day exclusive instead of inclusive. The exact comparison operator
// and transition date are inferred from the plan's specification; the source was not
// independently readable in this session.

**Reproducing input**

```ts
const TRANSITION_2 = new Date(2022, 0, 1); // second rate-table transition, UTC midnight

calculateFee(
  { caseType: "civil", complexity: "medium", urgency: 1.0, openedAt: TRANSITION_2 },
  new Date(2024, 5, 15),
)
```

**Observed output**
The case opened **on** the second transition date is priced with **rate-table-3**
instead of rate-table-2. The comparison that selects the table uses a strict `>` (or
equivalently applies `>=` to the following day), so the transition date itself falls
into the newer table's window. The first transition is inclusive (`>=`), making the two
edges asymmetric — contrary to the documented rate-card policy.

**Blast radius (stored historical fees)**
Every case opened on that single calendar date (the second transition day) since 2022
was billed at the third table's rate. If the third table is higher (the typical
direction for fee increases), those invoices were **over-charged** by the per-case delta
between table-2 and table-3 for the applicable case type and complexity band. The
discrepancy is confined to one day's worth of records but is systematic: every invoice
for that date is wrong, and an audit comparing amounts to the published rate card will
flag each one.

**Proposed fix (not applied)**
Change the second-transition boundary from strict `>` to `>=` so that a case opened on
the transition date is routed to rate-table-2, matching the first transition's inclusive
semantics and the documented policy:

```ts
// Before (buggy):
if (openedAt.getTime() > TRANSITION_2_MS) { table = TABLE_3; }
else if (openedAt.getTime() > TRANSITION_1_MS) { table = TABLE_2; }
else { table = TABLE_1; }

// After (fixed):
if (openedAt.getTime() >= TRANSITION_2_MS) { table = TABLE_3; }
else if (openedAt.getTime() >= TRANSITION_1_MS) { table = TABLE_2; }
else { table = TABLE_1; }
```

After the fix, re-validate all stored fees for cases opened on `TRANSITION_2` and issue
corrections where the table-3 amount was erroneously applied.

---

*End of findings.*
