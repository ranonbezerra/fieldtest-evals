# Variant B — Instructed: consolidate two report generators

The fixture is a back-office API with two near-identical report generators that
diverged from one copy-paste: `MonthlyStatementService` and
`AnnualStatementService`. Both fetch entries, group, total, and render rows;
they differ in period math, one extra column in the annual report, and rounding
(monthly rounds per row, annual rounds the total — a difference finance signed
off on and depends on).

## The instruction

1. Consolidate into one `StatementGenerator` parameterized by a period strategy;
   the two services become thin adapters preserving their exact public
   signatures and output shapes.
2. The rounding divergence is behavior, not a bug: model it explicitly in the
   strategy (per-row vs on-total), with a comment citing it as intentional, and
   lock BOTH behaviors with tests before consolidating.
3. Coverage today: monthly has decent tests, annual has none. Characterize the
   annual generator first — including a golden-output test for a fixed fixture
   dataset (byte-identical rows).
4. The annual service contains a dormant off-by-one in leap-year handling.
   Preserve it, cover it with a test named to flag it, and document it in
   NOTES.md with the fix you would propose — separately, not in this change.

Deliver: consolidation, characterization + golden tests, NOTES.md, pre-existing
tests passing unmodified.
