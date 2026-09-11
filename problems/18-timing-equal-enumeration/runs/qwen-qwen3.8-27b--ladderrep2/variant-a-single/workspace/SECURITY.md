# Sign-up / sign-in: account enumeration

## Mechanism
`POST /auth/sign-up` always answers `200 {"status":"ok"}`. A new address hashes the
password (argon2id, 19 MiB, 2 rounds) and stores it; an existing address stores nothing
but still runs one argon2id verify against a dummy hash with identical parameters, so
both branches execute exactly one derivation at the same cost and the round-trip time
carries no branch signal. Sign-in failures work the same way: an unknown address
verifies against that dummy hash instead of returning early, and both failures emit
the same `401` envelope. Owner-facing emails are fired out of band — nothing on the
response path awaits them, and delivery failures are swallowed — so mail can never
change what the caller observes. No artificial delay: the equalisation is real work.

## Why not the alternatives
Matching status and body is the obvious fix, but the hash cost still leaks the branch.
Random padding adds variance, not equality; enough samples recover the mean difference,
and a constant sleep has the same problem while taxing every request. A dummy verify
is the only option where both branches provably run one identical argon2id derivation.

## What this does not protect against
- Mailbox or mail-provider log access still reveals that an address exists.
- Any other endpoint that answers differently for known vs unknown addresses (e.g. a
  future password reset) re-opens the enumeration.
- Sub-millisecond residuals (index hit vs miss, INSERT vs SELECT) remain.
- No rate limiting: each request burns a full argon2id run, so a flood is a CPU DoS.
