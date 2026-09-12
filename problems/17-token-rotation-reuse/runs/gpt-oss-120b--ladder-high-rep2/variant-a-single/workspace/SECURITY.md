# Security considerations for refresh token rotation

1. **Reuse check precedes expiry check** – A token that has been retired (e.g. replayed) is treated as a compromise even if it is also expired. Detecting reuse first prevents an attacker from being logged as a harmless expiry event.

2. **Atomic retirement** – The rotation uses a single `UPDATE … WHERE retired_at IS NULL` operation. This guarantees that only one concurrent request can retire a given token, eliminating race conditions where multiple refreshes could succeed.

3. **Family invalidation on reuse** – When a retired token is presented again, all tokens that share the same original sign‑in (`root_id`) are retired in one `UPDATE` statement. This cuts off any stolen sibling tokens immediately.

4. **Fixed absolute session deadline** – The `expires_at` timestamp is copied from the original token to every rotated token. No rotation can extend the session lifetime, preserving the intended session expiry window.

5. **Single generic error envelope** – All failure modes (malformed, unknown, expired, reuse) return the same HTTP status and JSON body. This prevents information leakage that could aid an attacker while detailed audit logs retain the specific cause.

6. **Audit logging** – Every validation step records an audit entry (`RefreshTokenAudit`) with the event type and relevant details. This provides a reliable forensic trail without exposing details to the client.

7. **Cookie precedence** – If both a `refresh_token` cookie and a `refreshToken` body field are present, the cookie value is used. Cookies are less prone to accidental leakage in logs and are the preferred transport for refresh tokens.

8. **Stateless access token issuance** – The access token is issued via `issueAccessToken(userId)` and is unrelated to the refresh token rotation logic, ensuring separation of concerns.

9. **Secure token generation** – New refresh tokens are generated with `crypto.randomUUID()`, providing sufficient entropy for unpredictability.

10. **No session extension** – Rotation does not modify `expires_at`, guaranteeing that long‑lived sessions eventually terminate regardless of refresh frequency.
