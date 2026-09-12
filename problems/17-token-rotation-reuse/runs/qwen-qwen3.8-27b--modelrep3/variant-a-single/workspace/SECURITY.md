# Refresh-token rotation — security notes

Check order in `AuthService.refresh`, and why it is that way round:

1. **Format** — reject tokens that are not 64 hex chars before any database access; cheapest check first,
   malformed input never reaches the store.
2. **Lookup** — tokens are matched by their SHA-256 hash; raw tokens are never persisted, so a database
   leak does not leak usable refresh tokens.
3. **Deadline** — a token is usable only inside the absolute deadline fixed at sign-in; rotation copies
   the deadline, it never extends it.
4. **Atomic claim** — retirement is one conditional `UPDATE ... WHERE status = 'ACTIVE' AND expires_at >
   now`; Postgres row locking makes exactly one of N concurrent presentations of the same token rotate.
5. **Grace, then verdict** — a retired token presented within `REFRESH_REUSE_GRACE_MS` (default 5 s) is an
   in-flight client retry: rejected, session untouched. Outside the window it is a stolen-token replay:
   every token descended from the same sign-in is invalidated and the event is written to `auth_audit_events`.

Why the ordering is that way round:

- Cheapest, side-effect-free checks first, and every rejection — malformed, unknown, expired, retired —
  returns the identical 401 body with `code: "refresh_rejected"`, so no response leaks which check failed;
  only `auth_audit_events` distinguishes the classes.
- The grace window is what separates aggressive retries (keep the session) from a delayed replay
  (invalidate the family); with no window, every legitimate retry would lock the user out.
- Body `refreshToken` beats the `refresh_token` cookie: explicit intent wins over an ambient value; every
  success re-issues the cookie (httpOnly, SameSite=Strict) so it never drifts from the session's current token.
