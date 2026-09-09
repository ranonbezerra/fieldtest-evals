# Issue #91 — Operators lose track of which session they are working in

**Repo:** `ops-backoffice` · **Labels:** `feature` `ux`
**Reported by:** operations · **Diagnosed by:** platform

---

## Context

The app is a React + TypeScript back-office on react-query and the router: login, a
sessions list, a session detail screen. An operator opens a session, works in it,
navigates away for something else, and loses the thread of what they had open.

This shipped in another product of ours and tested well. We are porting the behaviour,
not the code.

## The feature

A persistent **active session bar**, visible on every authenticated screen.

1. Opening a session from the list makes it active. The bar shows its name, status and
   an elapsed time that ticks.
2. The bar offers **resume** — navigate to the detail — and **close session**, which
   calls the existing close endpoint behind a confirm and empties the bar on success.
3. **One active session at a time.** Opening another replaces it, with a confirm first
   if the current one has unsaved notes. The detail screen already tracks a dirty flag;
   use it rather than adding a second source of truth for the same fact.
4. The active session **survives a full page refresh**. The API exposes
   `GET /sessions/active` and that is the source of truth. Do not mirror it into
   localStorage or a client store that outlives the query cache — a server fact cached
   on the client goes stale in exactly the situation this feature exists to handle.

## How it should be built

This is an **edit to an existing application**, not a feature built beside it. The bar
belongs in the layout that already wraps authenticated screens. Server state goes
through react-query, as everything else in this app does. Reuse the existing confirm
dialog rather than writing a second one.

Handle pending and error on the active-session query. A failed fetch must not render as
"no active session" — those are different states and the operator can tell them apart
even when the code cannot.

## Must not regress

- list filtering and pagination
- detail editing and the dirty-flag warning on route change
- logout clearing all state, including the bar
- deep-linking straight to a detail URL

## Acceptance

- The bar appears on every authenticated screen and nowhere else
- Elapsed time ticks; resume navigates; close calls the endpoint behind a confirm
- Opening a second session while the first has unsaved notes → confirm before replacing
- Full page refresh → the bar comes back from `GET /sessions/active`
- The existing suite still passes, unmodified
- Tests for the new behaviour, in the style the repo already uses

## Scope

A coherent diff. Shared types and API modules are used, not rewritten — every screen
in the app depends on them, and a change there is a change to all of them.
