# Enumeration protection for /auth/sign-up and /auth/sign-in

## Mechanism
Every sign-up performs exactly one argon2id hash (32 MiB, 2 passes,
parallelism 1) before any database access: a new address stores it, an
existing address discards it. Every sign-in performs exactly one argon2id
verify: against the stored hash for a known address, or against a
precomputed dummy hash with identical parameters for an unknown one. Both
branches of both endpoints return the same status, body, and headers; the
only per-branch side effect (verification vs "attempted" email) is fired
without being awaited, so it changes neither the response nor its timing.

## Why this, and not the alternatives
- Early-return on a found address is the naive fix and is the leak itself.
- Random delay padding adds variance, not equivalence: the branch means
  still differ, and enough samples recover the signal.
- A constant sleep floor sits on top of the unremoved work difference and
  taxes every request; equalising the work removes it at the source.

## What this does not protect against
- Enumeration through other surfaces (password reset, account deletion,
  other endpoints that answer differently for known vs unknown addresses).
- A database-side observer: the new-account branch writes a row.
- Password brute force; this is not rate limiting.
- The dummy hash is public by design: it equalises timing, it is no secret.
