# Reference solution — annotated core

## Fixtures

Built. Each typechecks standalone (`_shims.d.ts` declares vitest; no
`node_modules` needed). Keep this file out of the model's context.

**`fixtures/mapper/` — variant A.** Three copies of the provider-status switch, and
the divergences are the point:

| Copy | Extra codes | Unknown code | Casing |
|---|---|---|---|
| `src/orders/orders.status.ts` | — | **throws** | all lower |
| `src/payouts/payouts.status.ts` | `PAYOUT_SETTLED`, `PAYOUT_REVERSED` | returns `'unknown'` | all lower |
| `scripts/reporting.ts` | — | returns `null`, row **skipped** | `DECLINED`/`EXPIRED` -> `'FAILED'` |

Orders and payouts have partial specs; reporting has none — so the characterization
step M3 asks for is the one with no safety net. A solution that unifies the three
unknown-code behaviours has broken three call sites while every existing test still
passes.

**`fixtures/statements/` — variant B.** `MonthlyStatementService` rounds tax **per
entry**; `AnnualStatementService` accumulates unrounded and rounds **per category**.
Annual also carries the extra `entryCount` column and different period math. Monthly
has four specs; annual has none.

The dormant leap-year off-by-one is `year % 4 === 0`, which ignores the century rule:
for 2100 the range end computes to `2101-01-01`. Verified dormant — it is correct for
every year the service has actually run. Preserve it, pin it with a test named to flag
it, and propose the fix in `NOTES.md` rather than applying it.

**`fixtures/scheduling/` — variant C.** Nothing is labelled. What is actually in there:

1. **Duplicated availability logic** — `listAvailable` and `countAvailable` repeat the
   same five filters, and they have already drifted: `listAvailable` releases an
   expired hold, `countAvailable` only ignores it.
2. **Persistence inside a domain rule** — `listAvailable` is a read that *writes*:
   it expires stale holds via `saveSlot` as a side effect of listing. The hold sweep
   is therefore "whoever lists first", which is a quirk callers depend on.
3. **Hidden temporal coupling** — `book()` requires `status === 'held'`, so `hold()`
   must precede it; and the daily-booking limit is enforced **only** in `hold()`, so
   the order carries a rule that neither signature mentions.
4. **A dead branch** — `describe()` is never called, and its `default` case handles a
   `'pending'` status the union no longer has.
5. **A latent bug worth reporting, not fixing** — `cancel()` sets `booking.cancelledAt`
   on an object it never persists.
6. **A quirk callers depend on** — booking ids are deterministic
   (`bk_${slotId}_${customerId}`), so a retried booking collides rather than
   duplicating.

Judging variant C is as much about what the model declined to change as what it
changed. Unifying (1) without preserving (2)'s side effect breaks the sweep.

## Crux 1: the order IS the method

```
read → characterize (pin current behavior) → move → verify (old tests + new)
```

A transcript that moves code first and writes tests after is testing the new
code against itself — that's the failure M3 exists to catch.

## Crux 2 (variant A): preserving divergence explicitly

```ts
// ONE mapper, divergence as API — visible, documented, chosen per call site:
mapStatus(code: string, opts?: { legacyReportCasing?: boolean;
                                 onUnknown?: 'throw' | 'unknown' | 'skip' })
```

Unifying unknown-code handling "while there" changes three behaviors at once —
the exact smuggled fix M2 forbids. The mapper makes the mess *explicit*; making
it *consistent* is a separate, deliberate future change (NOTES.md).

## Crux 3 (variant B): golden test before consolidation

```ts
// Byte-identical golden output for a fixed dataset pins EVERYTHING the
// refactor could silently change: ordering, formatting, rounding site.
expect(render(annual.generate(FIXTURE_2023))).toEqual(readGolden('annual-2023.txt'));
```

Rounding modeled as strategy (`roundPerRow` vs `roundTotal`), leap-year bug
covered by a test literally named
`preserves known leap-year off-by-one (see NOTES.md)`.

## Crux 4 (variant C): answer key for the open track

Planted, unlabeled: (1) availability computed in both `findSlots` and
`canBook` with drifted copies — the real dedup target; (2) Prisma calls inside
domain rule methods — extract repository seam; (3) temporal coupling:
`reserveSlot` only valid after `findSlots` warmed a private cache — must be
made explicit (pass the slot in) WITHOUT changing observable API behavior;
(4) dead branches from a removed feature — deletable, low value; (5) quirk:
slots returned in insertion order, not chronological — callers depend on it;
preserving it while refactoring is the judgment test. A strong run finds 1–3
and 5, plans them, and declines cosmetic churn; a weak run renames variables,
adds abstraction layers, and "fixes" 5.

## Common wrong answers

- Tests deleted/loosened to green the refactor (M6) — the spurious-solution
  pattern migration studies keep finding.
- Helper extracted but two of three call sites left duplicating (M4).
- Quirks silently repaired (M2) — behavior change wearing a refactor costume.
- Open track: abstraction festival (interfaces for everything) instead of the
  two real seams.
