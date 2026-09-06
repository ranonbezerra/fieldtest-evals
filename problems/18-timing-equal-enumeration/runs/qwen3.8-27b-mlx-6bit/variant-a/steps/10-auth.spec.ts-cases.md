# 10-auth.spec.ts-cases

## reasoning

```
The user wants me to list the test cases for `test/auth.spec.ts` based on the PLAN.md and the implementation files shown. I need to produce one line per case in the specified shape, covering all branches and edge cases, naming what would have to break for each test to fail. Let me go through the plan's test table and the implementation carefully, then add awkward cases the plan might have missed.

Let me think through what needs to be tested:

**Sign-up:**
1. New email → 200, creates account, returns message
2. Existing email → 200, same body
3. Byte-equality of responses (new vs existing) — status, body bytes, Content-Type
4. Timing comparison (N samples each branch)
5. Verification email sent for new address
6. "Sign-up-attempt" email sent for existing address
7. Password stored as argon2id with correct params
8. Validation: missing/malformed fields → 400

**Sign-in:**
9. Correct credentials → 200 + token
10. Wrong password (known email) → 401
11. Unknown email → 401
12. Byte-equality of failure responses (wrong-password vs unknown-email)
13. Timing comparison (N samples each failure branch)
14. Validation: missing/malformed → 400

**Awkward cases the plan mentions or that I should add:**
- Concurrency: two simultaneous sign-ups with the same email (race condition on unique constraint)
- Token reuse / exhaustion: using the same token twice, or signing in again with a new token
- Boundary: password exactly 8 chars (min length boundary)
- The error path that looks like success: what if sign-up for existing email returns 200 (it does) but the body subtly differs
- Dummy hash timing: the verify against dummy hash must take the same time as against a real hash
- Mail failure: if mail.sendEmail throws, does sign-up still succeed? (Plan says "if mail fails the user is still created" but looking at the code... actually the code does `await this.mail.sendEmail(...)` after `createUser`, so if mail fails the user IS already created but the error would propagate. Let me re-read... The plan says "No transaction wraps the write + mail; if mail fails the user is still created (at-least-once delivery)." But the code doesn't catch mail errors, so it would propagate as a 500. Hmm, this is actually a gap. The plan says it should be at-least-once but the code doesn't implement that. I should test what the code actually does or flag this.)

Wait, let me re-read the plan: "No transaction wraps the write + mail; if mail fails the user is still created (at-least-once delivery)." This means the user creation succeeds even if mail fails. But the code as written would throw if mail fails. So either the plan is aspirational or I should test the actual behavior. Since I'm listing tests for what the code does, I should note this.

Actually, looking more carefully at the code:
```ts
if (existing === null) {
  const realHash = await argon2.hash(password, ARGON2_PARAMS);
  await this.repo.createUser(email, realHash);
  await this.mail.sendEmail(email, "verification", { email });
} else {
  await this.repo.touchUser(existing.id);
  await this.mail.sendEmail(email, "sign-up-attempt", { email });
}
```

If mail throws, the whole signUp throws. The user would already be in the DB (in the new-email branch) but the caller gets a 500. This is a real edge case worth testing.

**Concurrency:** Two simultaneous POST /auth/sign-up with the same email. One should create, the other should hit the unique constraint and... actually with Prisma, if you INSERT a duplicate unique value, you get a P2002 error. The code doesn't catch this. So one request gets 500. This breaks the "same response" property under concurrency. Worth testing.

**Token expiry:** The plan mentions 15 min TTL but there's no endpoint that validates tokens (no /auth/me or similar). The token is just returned. So expiry isn't really testable without another endpoint. I'll note this as "not testing."

**Duplicate delivery:** If you sign up with an existing email multiple times, you get "sign-up-attempt" emails each time. Is that a problem? The task says "an existing address gets a 'someone tried to sign up with your address' email" — so yes, every attempt should trigger it. Testing that repeated sign-ups all return 200 and send the same template.

Let me now structure the list:

1. sign-up with a new email returns 200 and the expected message body
2. sign-up with an existing email returns 200 and the same message body
3. byte-equality: sign-up response (status, body bytes, Content-Type) is identical for new vs existing
4. timing: sign-up latency distributions (new vs existing, N≥30 samples) overlap within threshold
5. sign-up with a new email sends a "verification" email to that address
6. sign-up with an existing email sends a "sign-up-attempt" email to that address
7. password is stored as argon2id with the specified cost parameters (parse $argon2id$ prefix)
8. sign-in with correct credentials returns 200 and an opaque token string
9. sign-in with a known email but wrong password returns 401 invalid_credentials
10. sign-in with an unknown email returns 401 invalid_credentials
11. byte-equality: sign-in failure responses (wrong-password vs unknown-email) are identical in status, body bytes, headers
12. timing: sign-in failure latency distributions (wrong-password vs unknown-email, N≥30 samples) overlap within threshold
13. sign-up with missing email field returns 400 validation_failed
14. sign-up with a password shorter than 8 chars returns 400 validation_failed
15. sign-in with missing password field returns 400 validation_failed
16. sign-in with a malformed email (not an email) returns 400 validation_failed
17. concurrency: two simultaneous sign-up requests with the same new email — at most one creates the row; the other must still return 200 (not a 500 from unique-constraint violation)
18. mail port failure during sign-up (new email): user row is still persisted; the response to the caller must not change (still 200) — OR if the plan says it should propagate, then verify it's a 500 but the row exists
19. repeated sign-up with an existing email: each call returns 200 and sends "sign-up-attempt" (no deduplication, no rate-limit visible to caller)
20. sign-in success: calling sign-in twice with same credentials produces two different tokens (no session pinning / token reuse leak)

Hmm, for #18, looking at the code again — there's no try/catch around mail. So if mail throws, signUp throws. The plan says "if mail fails the user is still created (at-least-once delivery)" which implies the user IS in the DB. But the caller gets a 500. The plan's statement is about the data integrity (user exists) not about the HTTP response. So the test would be: after a mail failure, the user row exists in DB. The HTTP response would be 500 (unhandled rejection). Actually wait — NestJS would catch the unhandled error and return a 500. The plan doesn't explicitly say what HTTP status to return on mail failure. I think the test should verify that the row is created (data integrity) and note that the response may be 500.

Actually, I should be careful. The task says "Do not create a file it does not call for." But the task here is to LIST test cases, not write them. So I should list what needs to be tested based on the plan and implementation.

Let me also think about:
- The dummy hash: is it actually being used correctly? If `existing` is null, we verify against `this.dummyHash`. The timing test implicitly covers this.
- The `touchUser` no-op: does it actually execute? If it doesn't, the timing would differ. The timing test covers this.
- Token is a 64-char hex string (32 bytes). Test that the token format is consistent.

Let me also think about what I'm NOT testing:
- Token validation (no endpoint consumes tokens in this feature)
- Email normalization (plan says "skip if not implemented" and the code doesn't normalize)
- Rate limiting / brute-force protection (out of scope per task)
- Mail content correctness beyond template name (task says assume mail port exists)
- Token expiry (no endpoint to validate against)

Let me finalize my list. I'll aim for clarity and specificity on "what would have to break."
```

## reply

- sign-up with a new email returns 200 with the expected message body — fails if the service throws, returns a different status, or returns a different body shape for the new-address branch
- sign-up with an existing email returns 200 with the same message body — fails if the existing-address branch returns a different status (e.g. 409) or a different message string
- sign-up byte-equality: the serialised response (status line, `Content-Type` header, body bytes) is identical for a new address and an existing address — fails if any extra field, whitespace difference, or header (e.g. `Set-Cookie`, custom header) distinguishes the two branches
- sign-up timing: over N ≥ 30 interleaved samples per branch, the median and p95 latencies fall within a tight threshold of each other — fails if the dummy-hash verify is skipped, the no-op `touchUser` write is absent, or the branch order allows one path to skip a DB round-trip
- sign-up with a new email dispatches a "verification" email to that address — fails if the template name is wrong, the `to` field is empty, or the mail call is only in one branch
- sign-up with an existing email dispatches a "sign-up-attempt" email to that address — fails if the template name is wrong or the call is missing from the existing branch
- password is persisted as an argon2id hash with timeCost ≥ 3 and memoryCost ≥ 64 MiB — fails if the stored string does not start with `$argon2id$` or the embedded parameters are below the stated cost
- sign-in with correct credentials returns 200 and a non-empty opaque token string — fails if the happy path throws, returns an empty/undefined token, or the token is not a hex string of the expected length
- sign-in with a known email and wrong password returns 401 `invalid_credentials` — fails if the status is not 401, the error code differs, or the body deviates from the single envelope
- sign-in with an unknown email returns 401 `invalid_credentials` — fails if the status, code, or body differs from the wrong-password case
- sign-in byte-equality: the serialised failure response (status, `Content-Type`, body bytes) is identical for wrong-password and unknown-email — fails if one branch omits a field, adds a hint string, or emits an extra header
- sign-in timing: over N ≥ 30 interleaved samples per failure branch, the median and p95 latencies fall within a tight threshold — fails if the unknown-email path skips argon2.verify or uses a lighter dummy hash
- sign-up missing email returns 400 `validation_failed` — fails if a bare string or undefined passes the pipe, or the error envelope is absent
- sign-up password shorter than 8 characters returns 400 `validation_failed` — fails if the boundary (7 chars) is accepted or the 400 body is not the standard envelope
- sign-in malformed email (e.g. "not-an-email") returns 400 `validation_failed` — fails if the `@IsEmail()` guard is absent or a 500 leaks
- sign-in missing password returns 400 `validation_failed` — fails if an undefined/empty password bypasses validation
- concurrent sign-up race: two simultaneous POSTs with the same previously-unseen email — at most one row is created; the losing request must still return 200 (not a 500 from Prisma P2002 unique-constraint violation), or at minimum the caller cannot distinguish success from the constraint error via timing alone — fails if the unhandled P2002 propagates as a 500 with a different body and timing than the 200 path
- mail port rejection during new-email sign-up: after `sendEmail` throws, the user row still exists in the database — fails if the code wraps create+mail in a transaction that rolls back, or if the INSERT is deferred until after the mail call
- repeated sign-up with the same existing email: every call returns 200 and dispatches "sign-up-attempt" (no silent deduplication, no 429, no body change) — fails if a second call within a short window returns a different status or skips the mail dispatch
- sign-in called twice with identical valid credentials produces two distinct token values — fails if the token is derived deterministically from user id + password (e.g. HMAC of the email) rather than `randomBytes`

Deliberately not testing: token validation or expiry (no consuming endpoint exists in this feature); email case-normalisation (the code stores the email as-received; the plan marks this optional); brute-force rate-limiting (out of scope per the task statement); mail content beyond template name (the port is assumed to exist and its internals are not under test).
