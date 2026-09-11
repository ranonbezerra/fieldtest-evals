# FINDINGS — feeCalculator.ts

Companion to `test/fee-calculator.spec.ts`. That suite is a **characterization**
suite: it pins what `feeCalculator.ts` does *today*, including the behaviours
recorded below. **No fix has been applied in this issue; the production file
is untouched.**

Reading convention used by the suite: a test name beginning with
`pins (BUG):` or `pins (QUIRK):` deliberately asserts a surprising or
known-wrong value. When next month's change intentionally alters one of those
behaviours, exactly those tests go red — that redness is the change signal.
In the fix PR, re-pin them to the new intended value (and record the delta);
do not delete them.

## F-1 — (BUG) The 2022-07-01 revision boundary is exclusive: cases opened on the revision date bill at 2021 rates

Reproduction (pinned by "pins (BUG): 2022-07-01 exactly ..."):

    calculateFee({ type: 'STANDARD', complexity: 1, openedAt: '2022-07-01' }, '2024-01-15')
    // => { table: '2021', bandFee: 13500, urgencyFee: 0, expeditedFee: 0, total: 13500 }
    //    what "revision effective on 2022-07-01" would give:
    //    { table: '2022', bandFee: 15000, ... }

What the code does. `tableFor` uses two *different* comparators:

    if (openedAt >= REVISION_2021) {    // '2021-01-01', inclusive
      if (openedAt > REVISION_2022) {   // '2022-07-01', exclusive
        return RATE_TABLE_2022;
      }
      return RATE_TABLE_2021;
    }
    return RATE_TABLE_2019;

So a case opened exactly on `2021-01-01` takes the 2021 table, but a case
opened exactly on `2022-07-01` stays on the 2021 table; the 2022 table only
applies from `2022-07-02`. Two revisions of the same kind are handled
asymmetrically — the classic shape of a typo'd comparator.

Likely intent. Both revision dates inclusive (`>=` on both).

Blast radius.
- Every case whose `openedAt` is exactly `2022-07-01` has been billed at 2021
  rates since then — 1500–3500 cents under the 2022 schedule per band, and at
  the 15% urgency rate instead of 18%. Those stored numbers are in the annual
  audit record and would have to be adjusted as a data correction, not
  re-derived, if the fix changes future behaviour.
- The bug is still live: re-generating fees on those cases today reproduces
  the 2021 rates.
- The comparison is on the raw string, so the same calendar day can fall on
  both sides of the boundary depending on the stored format:
  `'2022-07-01T00:00:00'` sorts *after* `'2022-07-01'` and takes the 2022
  table (pinned). Two cases opened on the same day can be on different
  schedules.
- The same string comparison also sends non-date values to a table
  (`'garbage'` → 2022, `''` → 2019; both pinned). `tableFor` never parses a
  date at all.

Proposed fix (not applied). Change the inner test to
`openedAt >= REVISION_2022` — or, better, compare parsed dates. On
application, the pinned test fails exactly on `2022-07-01`; re-pin it to the
2022 values and raise the delta on the stored 2022-07-01 fees with billing.

## F-2 — (QUIRK) Urgency is a function of the billing call time — and an overdue deadline stays urgent forever

Reproduction (pinned by the "pins (QUIRK): urgency depends on the billing
call time" group):

    const c = { type: 'STANDARD', complexity: 1, openedAt: '2021-05-10', deadline: '2021-06-30' };
    calculateFee(c, '2021-05-10'); // 51 days out   => total 13500 (not urgent)
    calculateFee(c, '2021-06-23'); // 7 days out     => total 15525 (urgent, +2025)
    calculateFee(c, '2021-07-01'); // deadline passed => total 15525 (STILL urgent)

What the code does. The urgency rule is `daysBetween(now, deadline) <= 7`,
where `now` is the argument the caller passes (or the wall clock when
omitted). It is measured from the *billing moment*, not from anything in the
case, and every negative day count satisfies `<= 7`, so once the deadline
passes the urgency fee never switches off again. Related edges pinned: an
empty-string deadline is silently not urgent (falsy), and an unparseable
deadline makes `daysBetween` return `NaN`, and `NaN <= 7` is false — also
silently not urgent.

Likely intent. "Urgent" probably means "the case's deadline was near at some
business moment" — a property of the case (or of a stored as-of date), not of
the moment someone re-runs billing.

Blast radius.
- A stored fee is not a pure function of the case: re-generating fees for an
  old case yields a different number — and once the deadline has passed, the
  re-run is *guaranteed* to differ (urgency on, permanently).
- Combined with the wall-clock default (open question 1), calls without `now`
  are not reproducible at all.
- The audit trail mixes urgency evaluated at different billing dates with no
  field to tell them apart.

Proposed fix (not applied). Decide the as-of semantics (urgency against
`openedAt`, or against a stored "as of" date) and the overdue-deadline rule,
then pin the new rule in the suite.

## F-3 — (QUIRK) The expedited surcharge is compounded on (bandFee + urgencyFee) and rounded twice

Reproduction (pinned by "pins (QUIRK): expedited is compounded ..."):

    // 2019 table, STANDARD band 2, urgent + expedited
    // bandFee   18500
    // urgency   round(18500 * 15 / 100)          = 2775
    // expedited round((18500 + 2775) * 10 / 100) = round(2127.5) = 2128   // .5 rounds UP
    // total     23403

What the code does. `expeditedFee = pctOf(bandFee + urgencyFee,
expeditedPct)`: the expedited percentage is applied to a subtotal that
already contains the urgency surcharge, and `pctOf` rounds again. So
urgent+expedited fees are rounded twice, the second time on the already
rounded subtotal. `Math.round` is half-up: the 2019 table pins three `.5`
cases rounding up (2127.5 → 2128, 3622.5 → 3623, 4542.5 → 4543) and the 2022
table pins fractional round-downs (15434.4 → 15434, 11398.8 → 11399). Note
the urgency step itself is currently a rounding no-op on every shipped band
fee (each base fee divides exactly at 15%, 18%, and 12%); the only step that
today actually rounds a fraction is the expedited step.

Likely intent. Either surcharges stack additively on the base fee (no
compounding), or compounding is the accepted billing rule and the per-step
rounding is deliberate — the in-code comment says "billing reconciles
against these". Only billing can say which.

Blast radius. Every urgent+expedited fee since 2019 embeds the compounding
and the double rounding; the audit record has it.

Proposed fix (not applied). If non-compounding is intended, apply
`expeditedPct` to `bandFee` alone. Keep per-step rounding in either case —
reconciliation depends on it.

## F-4 — (QUIRK) Unknown case types silently bill at STANDARD rates

Reproduction (pinned by "pins (QUIRK): unknown case type ..."):

    calculateFee({ type: 'COMMRCIAL', complexity: 2, openedAt: '2021-05-10' }, '2024-01-15')
    // => { table: '2021', bandFee: 20500, ... }   // 2021 STANDARD band 2
    calculateFee({ type: 'standard', complexity: 1, openedAt: '2019-06-01' }, '2024-01-15')
    // => bandFee 12000                             // case not normalized; 'standard' is "unknown" too

What the code does. A miss on `table.base[c.type]` falls back to the
STANDARD row *of the same era table*. No error, no flag. The in-code comment
says this covers "rare imports from the old system".

Likely intent. A graceful default for the one-off legacy imports.

Blast radius. Any typo'd or case-mismatched type has been billed as STANDARD
since 2019 with no signal; a typo of a higher-value type (e.g. APPEAL) is
materially underbilled.

Proposed fix (not applied). Validate against the known set and throw/flag on
unknown types; run an audit query for unknown-type cases first so the error
does not retroactively change historical outputs.

## F-5 — (QUIRK) Falsy complexity (0, NaN) coerces to band 1; complexity above 4 clamps to 4

Reproduction (pinned by the "degenerate inputs" group):

    complexity: 0    -> band 1   // falsy branch, not an error
    complexity: -3   -> band 1
    complexity: NaN  -> band 1   // NaN is falsy
    complexity: 5    -> band 4   // upper clamp
    complexity: 42   -> band 4

What the code does. `if (!band || band < 1) band = 1; if (band > 4) band = 4;`
— silent normalization in both directions, never a rejection.

Likely intent. Defensively map bad data to a known band rather than failing.
Whether that is desirable is a business call.

Blast radius. Bad upstream data is billed at the wrong band (up to 3 bands
off) instead of surfacing.

Proposed fix (not applied). Explicit validation: reject non-integer
complexity outside 1..4 with a typed error.

## F-6 — (QUIRK) Fractional complexity slips past both clamps → `undefined` bandFee, `NaN` total

Reproduction (pinned by "pins (QUIRK): fractional complexity (2.5) ..."):

    calculateFee({ type: 'STANDARD', complexity: 2.5, openedAt: '2022-08-01' }, '2024-01-15')
    // => { table: '2022', bandFee: undefined, urgencyFee: 0, expeditedFee: 0, total: NaN }

What the code does. `2.5` passes `!band` (truthy), `band < 1` (false), and
`band > 4` (false), then indexes `bands[1.5]` → `undefined`; every subsequent
arithmetic becomes `NaN` (urgencyFee/expeditedFee too, if a deadline were
near). The TypeScript type claims `bandFee` is a number — the gap is
invisible to the compiler.

Likely intent. None to read; a hole in the validation.

Blast radius. A stored NaN/null fee would poison reconciliation. Upstream
appears to send integers, so exposure is likely low — but it was unpinned
until now.

Proposed fix (not applied). Same as F-5: integer validation.

## Open questions (not safely determinable from the code alone)

1. Wall-clock default. `calculateFee(c)` without `now` falls back to
   `new Date().toISOString().slice(0, 10)`. The suite never exercises that
   path — it is non-deterministic by definition. Whether production ever
   omits `now`, and hence whether any stored fee is wall-clock-dependent,
   cannot be answered from this file.
2. F-1 population. Whether any real case has `openedAt` exactly
   `2022-07-01` (or a datetime form of that day) requires a data query.
3. Offset-less datetimes. `daysBetween` parses with `new Date`; an ISO string
   with a time but no `Z`/offset is read in the machine's *local* timezone,
   which would make the day math timezone-dependent. The suite only uses
   date-only strings and `Z`-suffixed datetimes (both UTC-anchored in
   JavaScript), so the suite itself is timezone-independent; whether
   production data ever carries offset-less datetimes is unknown.
4. Business adjudication of F-3 (compounding) and F-4 (STANDARD fallback):
   both are pinned; neither is judged right or wrong here.

## Suite design notes

- Every call passes an explicit `now` — the module's existing optional
  parameter is the only clock seam used. Nothing is mocked, faked, or
  refactored; the production file is imported as-is.
- All expected values are literals derived by hand from the current
  implementation. The literals are the pin.
- Date-only ISO strings parse as UTC in JavaScript, so `daysBetween` is
  deterministic across timezones for the inputs the suite uses.
- No `new Date()`, no timers, no randomness anywhere in the suite: run it
  twice, on any machine, in any timezone — identical results.
