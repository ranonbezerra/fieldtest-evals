# Variant A — Case fee calculator (running since 2019)

The fixture is `feeCalculator.ts` from a case-management system: ~250 lines,
zero tests, computing procedural fees from case type, complexity band, urgency
multipliers, and date-dependent rate tables (rates changed twice over the
years; the code selects the table by case opening date). It is used by billing;
its historical outputs are stored and audited.

## The task

The team wants to modify this module next month. First, make it safe to touch:

1. A characterization suite pinning current behavior: every case type ×
   complexity band, urgency multipliers, the rate-table date boundaries
   (inclusive/exclusive edges on both transitions), rounding at each step,
   and degenerate inputs (zero, negative, unknown case type).
2. Production code untouched. A fake clock may be injected ONLY via the
   module's existing optional `now` parameter.
3. The module contains quirks and at least one genuine bug. Pin them AS THEY
   ARE, with test names that flag them, and document each in FINDINGS.md with
   reproducing input, likely blast radius (stored historical fees!), and the
   fix you would propose — not applied.
4. Deterministic suite; no real dates, no randomness.

Deliver: the suite + FINDINGS.md. Coverage is judged behaviorally — a
high-percentage suite with hollow assertions fails.
