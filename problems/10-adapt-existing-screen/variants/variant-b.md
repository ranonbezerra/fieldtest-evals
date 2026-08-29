# Variant B — Bulk actions on an existing list screen

The scaffold is an admin panel (React + TS + react-query + router) with a
paginated, filterable orders list and an order detail screen with
approve/reject actions.

## The feature

Bring approve/reject to the list as **bulk actions**:

1. Row checkboxes + a "select all on this page" header checkbox
   (indeterminate state when partially selected); selection survives filter
   changes but clears on page change (deliberate — confirm this reads in your
   tests).
2. A bulk action bar appears when ≥1 selected: count, Approve, Reject.
3. Bulk approve/reject calls the existing single-order endpoints in parallel
   with a bounded concurrency of 4; per-row success/failure reported (partial
   failure leaves failed rows selected, with inline error).
4. Rows in a non-actionable status render their checkbox disabled with a
   tooltip reusing the app's tooltip primitive.
5. List cache updates without a full refetch on success (targeted react-query
   cache updates, matching how the detail screen already does it).

## Existing behaviors that must not regress

Filters + pagination; row click → detail navigation (must not toggle the
checkbox); single approve/reject from detail; the list's empty state.

Deliver the edit as a coherent diff + tests in the app's style.
