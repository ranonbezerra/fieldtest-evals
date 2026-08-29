# 18 — The defence no status code can see

## The real situation

An account-enumeration defence is easy to describe and easy to believe you have
implemented. Sign-up must not reveal whether an email is already registered.
Sign-in must not reveal whether the account exists. So both paths return the same
status and the same body, and the ticket is closed.

Then someone times it.

The registered address returns in 180 ms because a password was hashed. The
unregistered one returns in 4 ms because there was nothing to hash. The bodies
are identical and the oracle is perfect. **No assertion on a status code or a
response body can see this**, which is why it survives review, survives tests,
and ships.

Three real variations of the same mistake:

- **Sign-up.** The 409 path skips the work the 201 path does. Equalising means
  doing the same work either way — hashing a discarded password, or nothing at
  all on both branches — not adding a random delay, which averages out under
  repetition.
- **Sign-in.** Two rejection bodies that were "the same" differed by one word,
  and nobody noticed because both were read by eye rather than compared with a
  diff.
- **The regression that came back.** A telemetry call was added and `await`ed on
  exactly one branch. The defence had been correct, was tested, and the test still
  passed — because the test asserted the bodies, and the difference had moved into
  the timing again.

The last one is the reason this is a problem and not a checklist. The property is
not "the responses match". It is "an observer cannot distinguish the branches",
and holding that requires a test that measures the thing.

## Stack

TypeScript, NestJS, Prisma, PostgreSQL. Argon2 or bcrypt — the work being skipped
is the point, so a real password hash is required, not a stub.
