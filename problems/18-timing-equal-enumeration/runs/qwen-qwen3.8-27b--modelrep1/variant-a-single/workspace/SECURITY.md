# Timing-equal enumeration resistance

## Mechanism
Every request runs exactly one argon2id KDF (default 192 MiB / 4 iters)
before responding, on every branch: new sign-up hashes the password,
repeat sign-up verifies it against the stored hash, unknown sign-in
verifies against a boot-time decoy hash. Hash and verify cost the same
KDF, so CPU time cannot identify the branch; both sign-up outcomes
return the same 201 body and headers, both sign-in failures the same
401. The outcome email does not block the response and a unique-index
race folds into the same 201, so SMTP latency and parallel requests
cannot oracle the branch.

## Why this over the alternatives
A fixed sleep drifts with hardware and load; doing the genuine work in
every branch keeps latency distributions aligned. Distinct generic
bodies leak by content; byte-identical bodies leave only timing, which
the KDF equalization closes. argon2id beats bcrypt (memory-hard, no 72-byte input truncation).

## What this does not protect against
- The owner still gets the "someone tried to sign up" notice: the
  feature, but it confirms the address exists to the owner.
- No rate limiting: sign-in remains a brute-force target.
- Latency outside the request path is out of scope; pre-raise hashes
  verify faster than new ones until re-hashed.
