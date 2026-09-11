# Enumeration resistance for /auth/sign-up and /auth/sign-in

## Mechanism
Every request performs exactly one argon2id operation, in every branch. A known
address verifies the supplied password against the stored hash; an unknown
address verifies it against a dummy hash built at boot with identical
parameters (memoryCost 19456 KiB, timeCost 2, parallelism 1). Responses are
fixed per status: sign-up returns the same 202 body whether or not the address
was new; sign-in returns the same 401 envelope for a wrong password and an
unknown address. Mail is fire-and-forget with a catch, so the response path
never awaits it and a mailer failure cannot change what the caller observes.

## Why this over the alternatives
A constant or random delay does not remove the mean difference between
branches; enough samples recover it, and random padding only adds variance.
Equalising the work removes the difference at the source, so no delay is
needed at all. Verifying a dummy hash pins the cost to the stored parameters,
the ones real accounts pay.

## What this does not protect against
It hides membership only from an observer of the API. It does not stop an
attacker who can read the target's mailbox, since the out-of-band mail remains
the owner's oracle; it does not remove side channels in the database or logs,
where the new-account branch still performs an insert; and it adds no rate
limiting or lockouts, which are a separate control.
