# Refresh token security

`POST /auth/refresh` rotates refresh tokens; the presented token is retired by the same call.
Check order, and why it is this way round:

1. **Malformed** (type/charset/length) first: the only check that needs no database, so junk and probing never reach Postgres.
2. **Unknown**: a lookup establishes whether the token belongs to any family at all.
3. **Retired (reuse) before expired**: a token that is both retired and expired is a compromise
   signal; checking expiry first would demote an attack to a routine log line.
4. **Expired**: benign, still audited with its family.
5. **Atomic rotate last**: a conditional `UPDATE ... WHERE revoked_at IS NULL` takes the row lock and
   is the serialization point; exactly one of N concurrent presentations retires the token, and a
   caller that gets 0 rows lost that race. Losing is indistinguishable from a replay, so it is reuse.

Consequences, by design:

- Any reuse, including the race loser, revokes the whole family (every token descended from the same
  sign-in) and writes a `refresh_reused` audit row.
- Every rejection returns the same 401 body (`invalid_refresh_token`); only the audit record
  distinguishes `refresh_malformed`, `refresh_unknown`, `refresh_expired`, `refresh_reused`.
- Rotation inherits the absolute deadline fixed at sign-in; it never extends it.
- The `refreshToken` body field wins over the `refresh_token` cookie when both are present; the
  cookie is set `HttpOnly; SameSite=Strict; Path=/`.
