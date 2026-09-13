# Refresh‑Token Rotation – Security Rationale

1. **Reuse detection precedes expiry checks.**  
   A token that has been retired (revoked) but is also past its absolute deadline must be treated as a *reuse* event. Detecting revocation first prevents an attacker who presents a stolen token after its natural expiry from being logged merely as an expired token, which would hide a compromise.

2. **Atomic retirement of the presented token.**  
   The rotation logic performs a single `UPDATE … WHERE revoked = false` statement. This guarantees that only the first concurrent request can successfully retire the token; any subsequent request sees the token already revoked and is classified as a replay.

3. **Family‑wide invalidation on reuse.**  
   When a retired token is presented again, the whole token family (all descendants of the original sign‑in) is revoked in one operation. This removes any window for an attacker who may have captured a token that was previously rotated.

4. **Absolute session deadline is immutable.**  
   The `expires_at` timestamp is stored on the token family and copied unchanged to every newly issued refresh token. Refresh operations never extend this deadline, guaranteeing that a session eventually terminates even under aggressive rotation.

5. **Uniform error surface.**  
   All failure modes—malformed, unknown, expired, or reused tokens—produce the same HTTP status and JSON envelope (`invalid_refresh_token`). This prevents information leakage that could aid an attacker while the internal audit log records the precise cause for forensic analysis.

6. **Deterministic precedence of token sources.**  
   If a client supplies a token both in the JSON body (`refreshToken`) and in the `refresh_token` cookie, the body value wins. This deterministic rule eliminates ambiguity and aligns with the principle of explicit over implicit data.

These checks are ordered and implemented exactly as described to ensure that token rotation remains both secure against replay attacks and reliable for legitimate clients.
