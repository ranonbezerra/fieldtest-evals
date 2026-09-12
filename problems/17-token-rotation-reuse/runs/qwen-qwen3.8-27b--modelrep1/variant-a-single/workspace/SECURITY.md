# Refresh rotation — security notes

## Check order on `POST /auth/refresh`

1. **Shape** — reject anything that is not a 32–256 char base64url string.
   First because it needs no database access, and because junk must never
   reach the token lookup.
2. **Existence** — SHA-256 digest lookup; a miss is "unknown". Only the
   digest is stored, so a leaked row is not a leaked credential.
3. **Retirement** — a retired token is evidence of compromise, checked
   *before* expiry so a replay of a stolen token is never downgraded to a
   routine "expired". Carve-out: within `REFRESH_REUSE_GRACE_SECONDS`
   (default 5 s) of retirement the presentation is read as a benign
   in-flight retry — what makes aggressive client retries survivable.
4. **Absolute deadline** — `sessions.expires_at` is fixed at sign-in;
   rotation mints the next token in the *same* session, so it can never
   extend the deadline.
5. **Rotate** — retire-and-mint is one compare-and-swap
   (`UPDATE ... WHERE status = 'active'`) in one transaction; concurrent
   presentations serialize on the row lock and exactly one can win. The
   compromise sweep is a compare-and-swap too, so a rotation and a sweep
   can never both claim the same token.

Every rejection (malformed, unknown, expired, retired) is the same 401 envelope;
only `token_audit_events` distinguishes them.
