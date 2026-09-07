# Sign-up / sign-in enumeration resistance

## Mechanism
- `POST /auth/sign-up` and `POST /auth/sign-in` perform exactly one argon2id
  run (19 MiB, 2 passes) on every branch. Unknown addresses are checked
  against a precomputed "ghost" hash of a random secret, so a missing row
  costs the same CPU as a present one, without creating any account.
- Every response is held until a 250 ms floor has elapsed, so the residual
  delta (one branch inserts a row, the other does not) cannot show up in
  response time.
- The caller always sees byte-identical status, body, and headers (202 on
  sign-up, 401 on sign-in). The real outcome travels only through email,
  which is sent asynchronously so transport latency never reaches the caller.

## Why this over the alternatives
- Constant-time comparison of candidate hashes does not fix the leak: the
  leak is the *skipped* hash when the row is absent. Paying the full cost on
  both branches (dummy-hash / dummy-login pattern) is the standard fix.
- A fixed delay alone would still expose the hash-skip delta under load; the
  floor is kept only as a backstop. Creating dummy accounts for unknown
  addresses would let attackers mass-register and is avoided.

## What this does not protect against
- Enumeration through other channels: the owner-visible emails differ by
  design, sign-in still succeeds with valid credentials, and network/LB
  jitter, rate limiting, and account lockouts are out of scope.
