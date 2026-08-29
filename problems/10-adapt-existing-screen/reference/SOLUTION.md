# Reference solution — annotated core

## The scaffold

Built, under `scaffold/`. Copy it into each run workspace, `pnpm install` there once,
and keep `node_modules` out of the artifact.

Verified: `tsc --noEmit` clean, and both example specs pass against MSW through the
real router and a real query client. A scaffold whose own tests do not run teaches the
model that the app's tests do not run.

It carries **both domains**, because the variants need different ones: `sessions`
(variants A and C) and `orders` (variant B). They share the primitives, as a real
back-office would.

The patterns a run is expected to match — and which judging diffs against:

| Pattern | Where |
|---|---|
| Targeted cache writes, never blanket invalidation | `features/sessions/queries.ts:patchLists` and `features/orders/queries.ts:patchOrder` — the server already returned the row, and a refetch flashes the screen back to stale data. **Variant B's item 5 is this function** |
| Query-key factories per feature | `sessionKeys`, `orderKeys` |
| The dirty flag | `SessionDetailScreen` — local draft vs cached server value, plus a router `useBlocker`, not a `beforeunload` hack |
| One confirmation component | `ui/ConfirmDialog`; nothing calls `window.confirm` |
| One tooltip, wrapping rather than cloning | `ui/Tooltip` — a disabled control fires no pointer events of its own, which is exactly **variant B's item 4** |
| Logout clears everything | `auth-context.tsx` calls `queryClient.clear()`, which is why no screen cleans up after itself |
| Deep links survive | `RequireAuth` renders nothing while `me()` is in flight instead of bouncing to `/login` |
| Server as source of truth for the active session | `GET /sessions/active` exists in the mock API. **Variant A's M3 is the temptation to mirror it in `localStorage`** — two sources of truth is the classic bug here |
| Tests render the app | `test/render.tsx` — through the real router against MSW, never with hooks mocked |

Regression surface every variant must not break, all exercised by the scaffold:
list filtering and pagination (filters reset the page to 1), row click navigation,
the dirty-flag warning, logout clearing state, and the list's empty state.

## Crux 1 (variant A): where the active session lives

```tsx
// Source of truth is the SERVER (GET /sessions/active) — refresh-proof by
// design. Client state is just react-query cache + a tiny context for actions.
export function useActiveSession() {
  return useQuery({ queryKey: ['sessions', 'active'], queryFn: fetchActive });
}

// Activating = server mutation + targeted cache update. No localStorage
// mirror of a server fact (M3): two sources of truth is the classic bug here.
const activate = useMutation({
  mutationFn: (id: string) => api.activateSession(id),
  onSuccess: (s) => qc.setQueryData(['sessions', 'active'], s),
});
```

Bar mounts once in the authenticated layout (right level: shared chrome, not
per-screen). Elapsed time ticks locally off `startedAt` — no polling for a
derivable value. Replace-with-confirm reuses the detail screen's existing dirty
flag via its existing context, not a new one.

## Crux 2 (variant B): the selection trap

Selection is UI state, keyed by page: `Record<pageKey, Set<id>>` in the list
component — NOT in react-query, NOT global. Bulk mutation with bounded
concurrency:

```ts
const results = await pMap(ids, id => api.approve(id), { concurrency: 4 });
// partial failure: keep failed ids selected, targeted setQueryData per success
```

Row click vs checkbox: `stopPropagation` on the checkbox cell — the regression
list exists because this exact interaction is what breaks.

## Crux 3 (variant C): the smallest honest flow

Good shape: `close` becomes `request review` (state `PENDING_REVIEW` shown as a
badge + banner on detail); reviewers get a `/review` route reusing the list
components filtered server-side; reject carries a comment shown to the
operator; dirty-flag flow untouched (review request requires saved state
first). ASSUMPTIONS.md records: assumed endpoints, role source, what rejected
sessions can do next. An elaborate multi-step workflow engine here is
over-engineering and scores down.

## Common wrong answers

- Rewriting the list/detail screens "cleaner" — M1; the diff is the artifact.
- localStorage as the active-session source — breaks refresh-from-another-tab,
  duplicates server truth.
- A second fetch layer (raw fetch/axios beside react-query) — M3.
- Bulk actions firing N unbounded parallel requests, or one fake "bulk" that
  refetches the whole list on success.
- Variant C: silently inventing the API contract without ASSUMPTIONS.md.
