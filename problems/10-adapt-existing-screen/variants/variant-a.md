# Variant A — Persistent active-session bar in a back-office

The scaffold is an operations back-office (React + TS + react-query + router):
login, a sessions list screen, a session detail screen. Today an operator opens
a session and works inside it; navigating away loses the sense of "what am I
working on".

## The feature (ported from another product where it tested well)

A persistent **active session bar**, visible on every authenticated screen:

1. Opening a session from the list makes it the active session; the bar shows
   its key fields (name, status, elapsed time ticking) on ALL screens.
2. The bar offers "resume" (navigate to detail) and "close session" (calls the
   existing close endpoint, with confirm; on success the bar empties).
3. Only one active session at a time; opening another replaces it (with
   confirm if the current one has unsaved notes — the detail screen already
   tracks a dirty flag).
4. Active session survives a full page refresh (the API exposes
   `GET /sessions/active`; use it as the source of truth — no client-only
   persistence of server facts).

## Existing behaviors that must not regress

List filtering/pagination; detail editing + dirty-flag warning on route change;
logout clearing all state; deep-linking directly to a detail URL.

Deliver the edit as a coherent diff + tests in the app's style.
