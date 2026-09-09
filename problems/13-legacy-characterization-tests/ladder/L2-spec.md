# Issue #611 — Make `feeCalculator.ts` safe to modify

**Repo:** `case-management` · **Labels:** `tech-debt` `billing`
**Reported by:** billing · **Diagnosed by:** platform

---

## Context

`feeCalculator.ts` is about 250 lines, has run in production since 2019, and has **zero
tests**. It computes procedural fees from case type, complexity band, urgency
multipliers, and rate tables that changed twice over the years — the code picks the
table from the case's opening date.

Billing calls it once per case at fee generation. **Every output is stored and feeds
the annual audit**, so historical outputs are part of the record and any change to what
this function returns is a change to numbers someone already signed off.

The team needs to modify it next month. Before that happens it needs a net.

## What we need

A characterization suite that pins **what the code does**, not what it should do.

That distinction is the whole task. If you find behaviour that looks wrong, the test
asserts the wrong value and says so in its name. We are not fixing anything in this
issue — we are making it possible to fix things in the next one and know what moved.

### Coverage we need

- **every case type × every complexity band** — the full matrix, not a sample
- **urgency multipliers**, including whatever boundary decides urgent from not
- **both rate-table transitions**, and specifically the **inclusive/exclusive edge at
  each one**. A case opened exactly on a transition date is the input most likely to be
  wrong and least likely to be exercised.
- **rounding at each step** — where it happens, and whether it happens more than once
- **degenerate inputs**: zero, negative, unknown case type, missing complexity

### Production code untouched

Not one line. If the module needs a clock, it already takes an optional `now` — use
that and nothing else. No refactor to make it testable, no extracted helper, no
injected seam.

### Pin the quirks, name them, do not fix them

There are behaviours in here that are surprising, and at least one that is a genuine
bug. When you find one:

- **assert its current output**, exactly
- **name the test so a reader knows** — something a person scanning the suite reads as
  "this is pinned deliberately, not because it is right"
- record it in `FINDINGS.md` with the reproducing input, what the code does, what it
  probably intended, the **blast radius** — remember the stored historical fees — and
  the fix you would propose

**Do not apply the fix.** A `FINDINGS.md` entry that says "corrected" is the failure
mode for this issue.

### Deterministic

No `new Date()`, no randomness, no dependence on the machine's timezone. Run it twice,
run it in CI, run it in two years — same result.

## Acceptance

- The full case-type × band matrix is asserted
- Both rate-table boundaries are tested on both sides of the edge
- Degenerate inputs are covered and their current behaviour is pinned
- Production code is byte-identical to what it is now
- `FINDINGS.md` exists, with reproducing inputs and proposed-not-applied fixes
- The suite passes, twice, with no clock or randomness in it

## Notes

TypeScript, vitest. If something cannot be determined safely from reading the code,
say so in `FINDINGS.md` as an open question rather than guessing — an honest gap is
worth more here than a confident assertion that happens to be wrong.
