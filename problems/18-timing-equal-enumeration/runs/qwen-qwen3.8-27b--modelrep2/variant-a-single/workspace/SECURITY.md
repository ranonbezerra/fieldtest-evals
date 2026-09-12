# Anti-enumeration hardening for /auth/sign-up and /auth/sign-in

## Mechanism
Every request runs the same sequence before responding: one account lookup, one argon2id
operation at fixed cost, one fire-and-forget mail send. A new sign-up hashes and inserts;
a taken sign-up verifies the password against a dummy hash built at boot with identical
parameters and discards the result. Sign-in for an unknown address verifies against that
same dummy hash; a wrong password verifies against the stored hash; both failures return
the same 401 body. The dominant cost (the argon2id core) is equal in every branch and the
response bytes are branch-independent, so neither bytes nor timing separate the branches.

## Why this over the alternatives
- Generic errors without dummy work leak a timing oracle: the hashing branch is orders of
  magnitude slower, so one measurement pass finds every taken address.
- Padding both branches with sleep needs a global cost ceiling and slows every request;
  the dummy op matches the real work exactly, at no added latency.
- Creating blindly cannot pick the mail template and races itself on the unique key.
- argon2id over bcrypt: memory-hard cost is predictable and hardware-stable.

## What this does NOT protect against
- Mail is fire-and-forget: a crash before the send loses it; use a durable queue.
- Residual differences (an INSERT vs. a read, DB jitter) remain; they are buried under
  the argon2 cost and network jitter, but a co-located low-jitter attacker is not covered.
- Privileged observers are not covered: mail-provider and access logs still show which
  template went to which address. Rate limits and other oracles are out of scope.
