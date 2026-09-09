# Issue #402 — The payment-status mapping exists three times and they have drifted

**Repo:** `marketplace-api` · **Labels:** `tech-debt` `refactor`
**Reported by:** platform · **Diagnosed by:** platform

---

## What we found

Provider status → internal status is mapped in three places:

- **orders** — the base mapping, for display
- **payouts** — the same mapping plus two provider codes orders does not know
- **the reporting script** — the same mapping, except it upper-cases one status
  differently. The CSV consumers depend on that casing. It is not a bug to us any
  more; it is the format.

They also disagree on unknown provider codes: one throws, one returns `'unknown'`, one
skips silently. Nobody decided that — it accumulated.

Coverage is uneven. Orders and payouts have partial tests. **The reporting script has
none**, and it is the copy with the quirk the consumers depend on.

## What we need

This is a refactor with the design already settled. The work is discipline, not
discovery — the risk is not that you cannot see how to extract it, it is that the
extraction quietly changes one of the three behaviours.

### 1. Characterize the reporting copy first

Before moving anything, write tests that pin the reporting script's **current output
for every status**, including the casing quirk. That copy is the one with no safety
net and the one whose behaviour is load-bearing downstream.

Do this first, not alongside. A characterization test written after the move pins what
the move produced.

### 2. Extract one `PaymentStatusMapper` into `src/shared/`

Covering the **union** of provider codes across all three call sites. All three
delegate to it. When you are done, `grep` for the mapping's `switch` or table should
find one.

### 3. The quirk becomes an explicit option

Something like `{ legacyReportCasing: true }`, passed by the reporting call site only,
with a comment saying what it is and why it exists. Do not normalise it away; do not
make it the default; do not leave it implicit in a branch.

### 4. Preserve the divergence on unknown codes — do not unify it

Each call site keeps the behaviour it has today, through the mapper's API. Throwing,
returning `'unknown'` and skipping are three different contracts with three different
callers, and unifying them is a behaviour change wearing a cleanup's clothes.

Document the divergence in `NOTES.md`, with a line saying it is deliberate and what
would have to be checked before anyone unifies it.

### 5. Nothing else moves

The pre-existing tests pass **unmodified**. If one needs editing to accommodate the
refactor, the refactor changed behaviour and the edit is the evidence.

## Acceptance

- One mapper in `src/shared/`; all three call sites delegate to it
- The reporting quirk reproduces exactly, through the option, and is tested
- Unknown-code behaviour is unchanged at each of the three call sites
- Characterization tests for the reporting copy exist and were written before the move
- All pre-existing tests pass without modification
- `NOTES.md` records the three copies, the quirk, and the deliberate divergence

## Notes

TypeScript. The fixture is ten files; the change should be visible in a diff of a few.
