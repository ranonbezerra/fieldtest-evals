# Variant B — Status resolver with tangled date logic

The fixture is `statusResolver.ts` from an operations system: ~200 lines, zero
tests, deriving an entity's display status from raw flags + timestamps
(created, approved, expires, suspended windows, grace periods). Ops dashboards
and two batch jobs consume it; its outputs drive customer-visible states.

## The task

1. A characterization suite pinning current behavior across the full decision
   space: every flag combination that changes the outcome, every timestamp
   boundary (at, just-before, just-after each cutoff; grace-period edges),
   timezone-sensitive comparisons, and null/undefined timestamps.
2. Production code untouched. Time controlled via the module's existing
   `referenceDate` argument — no monkey-patching Date.
3. The module contains quirks and at least one real bug (the kind that only
   shows on a boundary). Pin them AS-IS with flagged test names; document each
   in FINDINGS.md (repro input, who is affected, proposed fix — not applied).
4. Deterministic; boundary values expressed as explicit ISO timestamps, not
   computed "now ± x" chains that hide the boundary being tested.

Deliver: the suite + FINDINGS.md. Judged on behavioral coverage and boundary
judgment, not percentage.
