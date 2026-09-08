# Security Considerations for Auth Endpoints

## Mechanism
Both **sign‑up** and **sign‑in** endpoints are written to be *constant‑time* with
respect to the existence of an e‑mail address.  
The implementation always:

1. Performs an Argon2id hash of the supplied password (identical cost factor).  
2. Verifies the password against a hash – the real user hash if the account
   exists, otherwise a pre‑computed *dummy* hash.  
3. Sends an e‑mail appropriate to the situation **after** the response has been
   prepared, so the caller never sees a timing difference caused by the mail
   dispatch.

Because the expensive cryptographic work is executed in every code path, an
observer measuring request latency cannot reliably distinguish whether an e‑mail
was known to the system.

## Why This Approach
* **Argon2id** provides strong resistance against GPU‑accelerated cracking while
  still offering a configurable work factor.  
* Using a dummy hash ensures that a missing user still triggers the same
  verification workload, avoiding the classic “user‑enumeration via timing”
  vector.  
* Performing the e‑mail notification *after* the generic response keeps the
  observable API surface identical for both branches.

## Limitations
* Network jitter and server load can still introduce variance; the test suite
  enforces a maximum acceptable average difference (≈ 50 ms) but an attacker
  with a high‑precision side channel could potentially gather additional data.
* The dummy hash is static; if the cost parameters change, the dummy must be
  regenerated to stay comparable.  
* This does **not** protect against credential stuffing, credential replay, or
  other attacks that target the password itself.  
* Rate‑limiting, IP blocking, and captcha are out of scope; they should be added
  separately to mitigate brute‑force attempts.  
* Email delivery failures are not reflected to the client, which may lead to
  silent loss of notifications.

Overall, the design satisfies the requirement that an attacker **cannot learn
whether an e‑mail address is registered** from either the API response content or
its timing, while still delivering the appropriate notifications to the account
owner.
