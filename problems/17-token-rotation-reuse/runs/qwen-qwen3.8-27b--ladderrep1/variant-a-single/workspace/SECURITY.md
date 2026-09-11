# Refresh rotation — security notes

Precedence: if both a `refreshToken` body field and a `refresh_token` cookie
are present, the **body wins** — it is the channel the caller deliberately
addressed. A body field that is present but not a usable string fails the
request as malformed; there is no silent fallback to the cookie.

Check order, and why it is this way round:
1. **Malformed, before any lookup** — garbage input is rejected without
   touching the database, so it cannot probe which token hashes exist.
2. **Reuse before expiry** — a retired token (or one from a revoked family)
   is a reuse event even if it is also expired; checking expiry first would
   turn a compromise into a routine log line. Reuse revokes every token in
   the family — everything descended from the same sign-in — in one write.
3. **Expiry, against the absolute deadline** — each token's `expires_at` is
   capped at the family's sign-in deadline, so a rotated token is always
   `min(now + ttl, family deadline)`; frequent rotation never extends a session.
4. **Concurrency** — rotation is one conditional update
   (`status = ACTIVE AND expires_at > now`); PostgreSQL serialises it with a
   row lock, so exactly one concurrent presenter rotates. The loser sees the
   token retired and is recorded as reuse: a raced retry and a stolen replay
   are, by design, the same event.
5. **One rejection face** — expired, retired, unknown and malformed all
   return the identical 401 body `refresh_token_invalid`; only the audit
   record distinguishes them, and it commits with the state change.
