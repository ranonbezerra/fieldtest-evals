# Verdict — 10 Adapt an existing screen (hosted, single request)

```yaml
verdict:      FAIL
condition:    {runner: api, spec: model, shape: single,
               provider: openrouter, model: qwen/qwen3.8-27b,
               reasoning_effort: model default, max_tokens: provider maximum}

plan_gate:    n/a — this shape has no plan phase
gate:         [M1 ✗, M2 ✗, M3 ✓, M4 ~, M5 ✓, M6 ✗]

graded:       {component_placement: 2, state_management: 3, regression_care: 0,
               test_quality: 2, quality: 1, process: n/a}

typecheck:    failed after 22 repairs. 33 errors with the scaffold restored, and
              every one of them is in a scaffold file the model did not write.
tests:        not run

failure_mode: decision_overload
              # Asked to add a bar to an existing app, it built a second application
              # beside it — `src/pages/`, `src/routes.tsx`, `src/app-layout.tsx`,
              # `src/auth/auth.tsx` — repointed `main.tsx` at its own, and rewrote the
              # shared API types the existing app depends on.

revisions:    {self_repairs: 22, dropped_a_requirement: yes}
cost:         {wall_minutes: —, output_tokens: —, requests: 21, usd: —}
host:         {n/a — the model is not on this machine}

harness_note: |
  Two defects distorted this run's original result, both now fixed. `ft-run` wrote an
  unfenced reply over `src/auth/auth-context.tsx` and over the scaffold's
  `SessionDetailScreen.tsx`, producing 189 phantom syntax errors. And `ft-go` scoped
  the gate to every file in the workspace rather than to the 29 paths the reply
  carried, so 22 repair rounds rewrote thirteen scaffold files. All restored; the
  numbers above are from a fresh typecheck of what the model actually delivered.

would_merge:  no
headline:     The bar is good work. It is bolted to an application the model wrote
              from scratch beside the one it was asked to edit, and the shared types
              it rewrote on the way took the orders feature down with them.

notes: |
  M3 is the best part: the active session goes through react-query exactly as the app
  does — `useQuery` against `GET /sessions/active` as the source of truth, no
  client-only persistence, `useMutation` for close, cache invalidated on the way out.
  That is requirement 4 of the variant honoured precisely. M5 the bar renders an
  error with `role="alert"`. Six spec files, including one for the bar itself.
  M1, M2 and M6 fail together and for one reason.
```

## It wrote a second application

Of the 29 paths in its reply, 21 are new files and 8 overwrite the scaffold. The new
ones are not additions to the app — they are a replacement for it:

    src/routes.tsx          against the scaffold's  src/app/router.tsx
    src/app-layout.tsx                              src/app/AppLayout.tsx
    src/auth/auth.tsx                               src/auth/auth-context.tsx
    src/pages/login-page.tsx                        src/app/LoginScreen.tsx
    src/pages/session-list-page.tsx                 src/features/sessions/SessionsListScreen.tsx
    src/pages/session-detail-page.tsx               src/features/sessions/SessionDetailScreen.tsx

and `src/main.tsx` — one of the eight it overwrote — now mounts its own:

    import { AuthProvider } from './auth/auth';
    import { routes } from './routes';

The scaffold's router, layout, screens and auth context are still on disk and are
reachable from nothing. `src/features/` and `src/app/` are orphaned wholesale, and the
MSW dev bootstrap the scaffold's `main.tsx` carried is gone.

The variant asks for a bar "visible on every authenticated screen" and closes with
`Deliver the edit as a coherent diff`. This is not a diff.

## And it changed the shared types under the app it left behind

`src/api/types.ts` is the module every feature imports. The model rewrote it:

    - export type SessionStatus = 'open' | 'paused' | 'closed';
    + export type SessionStatus = 'open' | 'closed';
    -   operator: string;
    -   startedAt: string;
    -   closedAt: string | null;
    +   started_at: string;
    - export type OrderStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
    -   Order, PagedOrders, AuthUser …                        (all removed)

A status value dropped from an enum. A field renamed from camelCase to snake_case.
Four exported types deleted. And in `src/api/client.ts`, the `api` export that every
existing query module imports.

All 33 remaining errors are downstream of that, in files the model never opened:

    src/auth/auth-context.tsx    Module '"../api/client"' has no exported member 'api'
    src/features/orders/queries  Module '"../../api/types"' has no exported member 'Order'

M2 lists what must not regress — "list filtering/pagination; detail editing + dirty-flag
warning; logout clearing all state; deep-linking". Every one of those lives in a file
that no longer compiles or is no longer routed to. **The regression list was not
checked against; it was made unreachable.**

## The shape of this failure

Problems 04, 05, 06 and 09 showed the model disagreeing with itself across files inside
one reply. This is the same defect at the scale of an architecture: it read a working
application, decided on a structure it preferred, and wrote that instead — while
editing just enough of the original (`types.ts`, `client.ts`, `main.tsx`) to break it.

`decision_overload` was named in the local campaign for a model that answers a larger
question than the one asked. Given room to answer in full, in one request, with no
ceiling forcing it to stop, it answered a much larger one.
