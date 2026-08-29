# Variant A — Instructed: extract the triplicated status mapper

The fixture is a marketplace API where payment-status mapping logic exists in
THREE places: the orders module (maps provider status → internal status for
display), the payouts module (same mapping + two extra provider codes), and a
reporting script (same mapping, but it upper-cases one status differently — a
quirk the CSV consumers now depend on).

## The instruction (this track measures discipline, not discovery)

1. Extract a single `PaymentStatusMapper` into `src/shared/`, covering the
   union of provider codes; the three call sites delegate to it.
2. The reporting quirk is preserved via an explicit option on the mapper
   (e.g., `{ legacyReportCasing: true }`), used only by the reporting call
   site, documented in code.
3. Before moving anything: the orders and payouts copies have partial tests;
   the reporting copy has none. Write characterization tests for the reporting
   copy first, pinning its current output for all statuses (including the
   quirk).
4. Unknown provider codes: today each copy behaves differently (throw / return
   'unknown' / silently skip). Preserve each call site's current behavior via
   the mapper's API; document the divergence in NOTES.md — do NOT unify it.

Deliver: the extraction, characterization tests, NOTES.md, all pre-existing
tests passing unmodified.
