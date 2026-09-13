# Security Overview – Timing‑Equal Enumeration for Auth Endpoints

**Mechanism**  
Both `sign‑up` and `sign‑in` always perform a full Argon2id password hash (or
verification) regardless of whether the supplied e‑mail exists.  
For `sign‑up` we hash the password first, then conditionally create a user; the
hashing work is identical for new and existing addresses.  
For `sign‑in` we fetch the user (if any) and verify the password against the real
hash or a pre‑computed dummy hash generated at startup.  The verification step
costs the same amount of CPU time in either case.

**Why this over alternatives**  
*Simple response‑code changes* leak the existence of an account.  
*Random artificial delays* add variance but do not remove the mean‑time
difference, allowing an attacker to recover the signal with enough samples.
Performing the same cryptographic work eliminates the timing side‑channel at
its source, requiring no guesswork about network jitter.

**What it does not protect against**  
- Offline dictionary attacks on leaked password hashes.  
- Correlation attacks that combine timing data with other side‑channels (e.g.
CPU load, cache effects).  
- Enumeration through other API surfaces (password‑reset, profile lookup, etc.).  
- Denial‑of‑service attempts that flood the service, because each request still
incurs the full hashing cost.

**Operational notes**  
Email delivery is fire‑and‑forget; failures are ignored to keep the observable
behaviour unchanged.  The dummy hash is generated once during module init with
the same Argon2 parameters as real hashes, guaranteeing comparable verification
time.  All error responses use a uniform envelope:

```json
{ "error": { "code": "invalid_credentials", "message": "...", "details": {} } }
```

This design satisfies the requirement that an attacker cannot infer account
existence from either the content or the timing of authentication‑related
responses.
