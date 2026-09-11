# Refresh rotation — security notes

Check order in POST /auth/refresh, and why it is that way round:

1. Shape: non-string, empty, wrong-length or wrong-charset input is
   rejected before any lookup (audit reason `malformed`).
2. Lookup: tokens are stored as SHA-256 hashes only; a miss is `unknown`.
3. Dead before expired: a retired or revoked token is a **reuse** event.
   It is checked before expiry because a token that is both retired and
   expired is still a compromise — expiry-first would log an attack as
   routine.
4. Expiry: the absolute deadline is fixed at sign-in and copied verbatim
   into every rotated token; rotation never extends it.
5. Rotate: one conditional `UPDATE ... WHERE retired_at IS NULL AND
   revoked_at IS NULL AND expires_at > now`; only the caller whose update
   changed a row wins. The database serialises the race; the loser
   re-reads the row, sees it retired, and falls into step 3.

- A race loser is reuse: every token descended from the same sign-in is
  revoked in one `UPDATE ... WHERE family_id = $1`, and an event is
  written. Treating it as a benign retry makes rotation decorative.
- All rejections return the same 401 envelope; only the audit row
  (`refresh_rejected.reason` ∈ malformed|unknown|expired|reuse) differs.
- Body vs cookie: the body wins; a mixed request clears the cookie so a
  stale one cannot outlive the body channel.
