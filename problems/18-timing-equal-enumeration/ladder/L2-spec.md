# Issue #182 — Sign-up reveals whether an address has an account

**Repo:** `identity-api` · **Labels:** `security` `privacy` `blocker`
**Reported by:** security · **Diagnosed by:** platform

---

## What is happening

An attacker with a list of email addresses can learn which of them have accounts here.
For this product that is the disclosure that matters — the account list is the
sensitive thing, more than any individual account.

`POST /auth/sign-up` currently returns a different status when the address exists.
That is the obvious half and it is easy to fix.

**The half that survives the obvious fix is timing.** When the address is unknown we
return immediately. When it exists we hash the supplied password to compare it, and
argon2 at a real cost factor takes tens to hundreds of milliseconds. Equalise the
responses and the two branches still differ by an amount an attacker can measure from
across the internet with enough samples.

## What we need

### 1. Identical responses on both branches

`POST /auth/sign-up` with `{ email, password }`: a new address creates the account, an
existing address does not, and **the caller cannot tell which happened**. Same status,
same body, same headers — including anything that leaks a length difference.

`POST /auth/sign-in`: a wrong password and an unknown address produce the same
response.

### 2. Both branches do the same work

This is the requirement the others do not imply, and it is the one to design around.

The cost of the password hash is what the attacker measures, so **the branch that has
no hash to check must pay the same cost anyway** — verify against a dummy hash
generated with identical parameters. Both paths then take the time a hash takes,
because both paths did one.

**Do not pad with a random delay.** Random padding adds variance without removing the
difference in the mean, and enough samples recover the signal. If you want a floor as
well, make it a constant, and layer it over equalised work rather than substituting it
for the equalisation.

### 3. Passwords hashed properly

argon2id or bcrypt at a real cost factor. The cost is what makes §2 necessary and is
not negotiable down to make the timing problem smaller.

### 4. The real outcome still reaches the owner

An existing address gets a "someone tried to sign up with your address" email; a new
one gets a verification email. **Neither may change what the caller observes** — so
the send is out of band, awaited by nothing on the response path, and a mail failure
changes nothing the caller sees.

### 5. A timing test that can fail

Measure both branches across **multiple samples** and compare their distributions, not
one call against one call. A single pair of HTTP round-trips on a machine running a
test suite differs by tens of milliseconds for reasons unrelated to hashing.

Assert two things: that the branches are within a tolerance of each other, **and that
both are slow enough to be real work.** Without the second assertion, deleting the
hashing makes the test pass.

## Acceptance

- Sign-up: existing and new addresses produce byte-identical responses
- Sign-in: wrong password and unknown address produce byte-identical responses
- Both branches take statistically indistinguishable time, over repeated samples
- The timing test fails if the equalisation is removed **and** if the hashing is removed
- Mail is delivered out of band and a mail failure is invisible to the caller
- No `Math.random` on the response path

## Deliverables

Prisma schema and migration · the NestJS module (controller, service, repository) ·
the tests above.

## Notes

TypeScript, NestJS, Prisma, PostgreSQL.
