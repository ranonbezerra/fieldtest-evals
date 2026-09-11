# SECURITY.md — equal-timing sign-up / sign-in

Mechanism: every hash is argon2id at m=64 MiB, t=3, p=1, so one KDF run
(≈200–400 ms) dominates the response path. Sign-up: every request hashes the
supplied password and attempts the insert — a new address commits the row, an
existing address loses on the unique index and discards the hash; both branches
run exactly one argon2id plus one insert attempt, the "empty" branch throwing
the result away instead of skipping the work. Sign-in: an unknown address
verifies against a decoy hash built at startup with identical parameters, so
both branches run exactly one argon2id. No Math.random, no padding: equalised
work, not delay. Owner mail is sent out of band, never awaited, and its
failure is swallowed, so it cannot change what the caller observes.

Why not the alternatives: delay padding adds variance without moving the mean,
and enough samples recover the signal (a constant floor layered over equal
work is acceptable, a floor instead of it is not). A cheaper KDF shrinks the
hash until the residual (failed vs successful insert, DB, network jitter) is
measurable again. Single sample pairs are not a test: noise is tens of ms.

What this does not protect against: sign-in success (200) is distinguishable
from failure (401) by design, and every other surface that answers differently
for known vs unknown addresses (password reset, deletion, lockouts, rate
limits) can still leak. Nothing stops a determined attacker from paying the
KDF cost, which is also a server-side DoS vector — rate limiting is a separate
duty. Email normalisation is trim + lowercase only (no NFKC).
