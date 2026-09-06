# 11-SECURITY.md

## reasoning

```
The task is to write exactly one file: `SECURITY.md`, 15-25 lines, covering:
1. The mechanism (how timing-equal enumeration is prevented)
2. Why I chose it over the alternatives
3. What it does NOT protect against

Let me base this strictly on the PLAN.md:

Mechanism:
- For sign-up: SELECT the email, then always run argon2.verify (against real hash or DUMMY_HASH), discard result. Then branch on DB write (INSERT vs no-op touch) and mail template. Return identical 200 body.
- For sign-in: SELECT the email, always run argon2.verify (real or DUMMY_HASH). Only if existing AND verify===true → 200 token. Otherwise 401 with identical envelope.
- DUMMY_HASH: argon2id, same params (t=3, m=65536, p=1), generated once at module init.
- The no-op touch (UPDATE users SET created_at = created_at) equalizes DB round-trip.
- argon2id t=3, m=65536 KiB, p=1.

Why chosen over alternatives:
- Alternative 1: Just return same response but skip the hash on the "not found" branch → attacker measures time, the missing argon2.verify is a ~50-200ms gap. Rejected because the dominant cost (argon2) would differ.
- Alternative 2: Use a fixed-delay / sleep to pad the shorter branch → fragile under load, under different hardware, and under clock jitter; a sleep of "the right amount" is a moving target. Rejected because it's brittle and adds latency to all requests.
- Alternative 3: Use HMAC or a symmetric token instead of argon2 → doesn't satisfy "real cost factor" and doesn't actually protect password storage.
- The dummy-hash approach makes the expensive operation (argon2.verify) execute in every branch with identical parameters, so the dominant cost is constant. The no-op DB write closes the residual sub-millisecond gap.

What it does NOT protect against:
- Rate-limiting / brute-force: an attacker can still hammer sign-in to guess passwords; equal-timing only prevents *which* email exists, not password guessing for a known account.
- Email-based enumeration via the mail port itself: the "sign-up-attempt" email is sent to the owner, so if an attacker controls the mailbox or can observe mail delivery side-channels (e.g., DMARC logs, bounce messages), they could enumerate.
- Network-level timing: DNS resolution, TCP handshake, TLS negotiation vary independently of our code; the test threshold (10 ms) assumes a controlled network.
- The in-memory token map: tokens are lost on restart; not a session store.
- Brute force on the dummy hash is meaningless (it's a fixed string), but an attacker who knows the dummy password "timing-equalization-dummy" could in theory verify it — but that gives no info about real users.
- Side channels in the mail system: different templates may produce different SMTP latencies observable to a passive network observer.
- The no-op touch doesn't equalize if the DB connection pool behaves differently for writes vs reads under contention.

Let me count lines carefully. Target: 15-25 lines.

Let me draft:

```markdown
# Security — Equal-timing anti-enumeration

## Mechanism

Both `sign-up` and `sign-in` follow the same sequence in every branch:

1. `SELECT` the user by email (one round-trip).
2. `argon2.verify(password, hash)` where `hash` is the stored hash if the
   row exists, otherwise a module-level **dummy hash** (argon2id t=3 m=65536
   p=1, generated once at boot). The result is used for sign-in; it is
   discarded for sign-up.
3. Sign-up additionally issues a no-op `UPDATE … SET created_at = created_at`
   in the "already exists" branch so both paths perform one read + one write.

The dominant cost (argon2.verify ≈ 50–200 ms at the chosen parameters) is
therefore identical regardless of whether the address is registered. Residual
sub-millisecond differences from the extra/missing INSERT are closed by the
no-op write. Response bodies, status codes and headers are byte-identical
across branches.

## Why this over the alternatives

- **Sleep / fixed-delay padding**: a `setTimeout` of "the right amount" is
  brittle under load, clock drift and hardware variance; it adds latency to
  every request. The dummy hash makes the expensive step *actually execute*
  rather than being compensated by an arbitrary pause.
- **Skipping the hash on the not-found branch**: leaves a 50–200 ms gap that
  is trivially distinguishable with N > 10 samples.
- **HMAC / symmetric token in place of argon2**: fails the "real cost factor"
  requirement and does not protect stored passwords.

## What this does NOT protect against

- **Password brute-force** on a known account: equal timing hides *which*
  emails exist, not whether a guess is correct for an existing one.
- **Mail-side enumeration**: the "sign-up-attempt" notification is delivered
  to the owner; an attacker with mailbox access or who can observe SMTP
  bounces / delivery receipts can still enumerate.
- **Network-level timing jitter**: DNS, TCP/TLS handshakes vary outside our
  code; the 10 ms test threshold assumes a stable LAN.
- **SMTP latency side-channel**: different email templates may produce
  measurably different send times visible to a passive network observer.
- **In-memory token loss**: sessions in the `Map` do not survive a restart.
```

Let me count lines (excluding blank lines? The requirement says 15-25 lines). Let me count all non-blank lines:

1. # Security — Equal-timing anti-enumeration
2. ## Mechanism
3. Both `sign-up` and `sign-in` follow the same sequence in every branch:
4. 1. `SELECT` the user by email (one round-trip).
5. 2. `argon2.verify(password, hash)` where `hash` is the stored hash if the
6.    row exists, otherwise a module-level **dummy hash** (argon2id t=3 m=65536
7.    p=1, generated once at boot). The result is used for sign-in; it is
8.    discarded for sign-up.
9. 3. Sign-up additionally issues a no-op `UPDATE … SET created_at = created_at`
10.    in the "already exists" branch so both paths perform one read + one write.
11. The dominant cost (argon2.verify ≈ 50–200 ms at the chosen parameters) is
12. therefore identical regardless of whether the address is registered. Residual
13. sub-millisecond differences from the extra/missing INSERT are closed by the
14. no-op write. Response bodies, status codes and headers are byte-identical
15. across branches.
16. ## Why this over the alternatives
17. - **Sleep / fixed-delay padding**: a `setTimeout` of "the right amount" is
18.   brittle under load, clock drift and hardware variance; it adds latency to
19.   every request. The dummy hash makes the expensive step *actually execute*
20.   rather than being compensated by an arbitrary pause.
21. - **Skipping the hash on the not-found branch**: leaves a 50–200 ms gap that
22.   is trivially distinguishable with N > 10 samples.
23. - **HMAC / symmetric token in place of argon2**: fails the "real cost factor"
24.   requirement and does not protect stored passwords.
25. ## What this does NOT protect against
26. - **Password brute-force** on a known account: equal timing hides *which*
27.   emails exist, not whether a guess is correct for an existing one.
28. - **Mail-side enumeration**: the "sign-up-attempt" notification is delivered
29.   to the owner; an attacker with mailbox access or who can observe SMTP
30.   bounces / delivery receipts can still enumerate.
31. - **Network-level timing jitter**: DNS, TCP/TLS handshakes vary outside our
32.   code; the 10 ms test threshold assumes a stable LAN.
33. - **SMTP latency side-channel**: different email templates may produce
34.   measurably different send times visible to a passive network observer.
35. - **In-memory token loss**: sessions in the `Map` do not survive a restart.

That's 35 non-blank lines. Too many. I need to trim to 15-25 lines total (including blanks? Usually "lines" in a file means physical lines including blanks). Let me re-read: "15–25 lines". I'll aim for exactly 20-25 physical lines including blank separators.

Let me rewrite more compactly:

```
# Security — Equal-timing anti-enumeration

## Mechanism

Every branch of sign-up and sign-in executes the same cost-dominant step:
`argon2.verify(password, hash)` where `hash` is the stored row's hash or a
module-level dummy (argon2id t=3 m=65536 p=1, generated at boot). For sign-up
the verify result is discarded; for sign-in it gates the 200-vs-401 decision.
Sign-up additionally issues a no-op `UPDATE … SET created_at = created_at` on
the "exists" path so both branches perform one read + one write. Response
bodies, status codes and headers are byte-identical across branches.

## Why this over the alternatives

A fixed-delay sleep is brittle under load and clock drift, and adds latency
to every request. Skipping the hash on the not-found branch leaves a 50–200 ms
gap trivially visible with N > 10 samples. An HMAC or symmetric token does not
satisfy the "real cost factor" requirement and does not protect stored
passwords. The dummy hash makes the expensive operation *actually execute* in
every branch rather than being compensated by an arbitrary pause.

## What this does NOT protect against

- Password brute-force on a known account (timing hides which emails exist,
  not whether a guess is correct).
- Mail-side enumeration: the "sign-up-attempt" notification reaches the owner;
  mailbox access or SMTP bounce observation still leaks existence.
- Network-level jitter (DNS, TCP/TLS) and SMTP template latency visible to a
  passive observer.
- In-memory token loss on process restart.
```

Let me count physical lines:
1. `# Security — Equal-timing anti-enumeration`
2. (blank)
3. `## Mechanism`
4. (blank)
5. `Every branch of sign-up and sign-in executes the same cost-dominant step:`
6. `` `argon2.verify(password, hash)` where `hash` is the stored row's hash or a ``
7. `module-level dummy (argon2id t=3 m=65536 p=1, generated at boot). For sign-up`
8. `the verify result is discarded; for sign-in it gates the 200-vs-401 decision.`
9. `Sign-up additionally issues a no-op \`UPDATE … SET created_at = created_at\` on`
10. `the "exists" path so both branches perform one read + one write. Response`
11. `bodies, status codes and headers are byte-identical across branches.`
12. (blank)
13. `## Why this over the alternatives`
14. (blank)
15. `A fixed-delay sleep is brittle under load and clock drift, and adds latency`
16. `to every request. Skipping the hash on the not-found branch leaves a 50–200 ms`
17. `gap trivially visible with N > 10 samples. An HMAC or symmetric token does not`
18. `satisfy the "real cost factor" requirement and does not protect stored`
19. `passwords. The dummy hash makes the expensive operation *actually execute* in`
20. `every branch rather than being compensated by an arbitrary pause.`
21. (blank)
22. `## What this does NOT protect against`
23. (blank)
24. `- Password brute-force on a known account (timing hides which emails exist,`
25. `  not whether a guess is correct).`
26. `- Mail-side enumeration: the "sign-up-attempt" notification reaches the owner;`
27. `  mailbox access or SMTP bounce observation still leaks existence.`
28. `- Network-level jitter (DNS, TCP/TLS) and SMTP template latency visible to a`
29. `  passive observer.`
30. `- In-memory token loss on process restart.`

That's 30 lines. Still a bit over 25. Let me compress further.

Actually, let me re-read the constraint: "15–25 lines". I think this means the file should be between 15 and 25 lines total. Let me aim for exactly 25.

Let me try again, more compact:

```
# Security — Equal-timing anti-enumeration

## Mechanism
Every branch executes `argon2.verify(password, hash)` where hash is the stored
row's hash or a module-level dummy (argon2id t=3 m=65536 p=1, generated at
boot). For sign-up the result is discarded; for sign-in it gates 200 vs 401.
Sign-up adds a no-op `UPDATE … SET created_at = created_at` on the "exists"
path so both branches do one read + one write. Bodies, status and headers are
byte-identical across branches.

## Why this over the alternatives
A fixed-delay sleep is brittle under load and clock drift. Skipping the hash
on the not-found branch leaves a 50–200 ms gap visible with N > 10 samples.
An HMAC token fails the "real cost factor" requirement and does not protect
stored passwords. The dummy hash makes the expensive op *actually execute* in
every branch rather than being compensated by a pause.

## What this does NOT protect against
- Password brute-force on a known account (hides email existence, not guesses).
- Mail-side enumeration: the "sign-up-attempt" email reaches the owner; mailbox
  access or SMTP bounce observation still leaks existence.
- Network jitter (DNS, TCP/TLS) and SMTP template latency to a passive observer.
- In-memory token loss on process restart.
```

Count:
1. `# Security — Equal-timing anti-enumeration`
2. (blank)
3. `## Mechanism`
4. `Every branch executes \`argon2.verify(password, hash)\` where hash is the stored`
5. `row's hash or a module-level dummy (argon2id t=3 m=65536 p=1, generated at`
6. `boot). For sign-up the result is discarded; for sign-in it gates 200 vs 401.`
7. `Sign-up adds a no-op \`UPDATE … SET created_at = created_at\` on the "exists"`
8. `path so both branches do one read + one write. Bodies, status and headers are`
9. `byte-identical across branches.`
10. (blank)
11. `## Why this over the alternatives`
12. `A fixed-delay sleep is brittle under load and clock drift. Skipping the hash`
13. `on the not-found branch leaves a 50–200 ms gap visible with N > 10 samples.`
14. `An HMAC token fails the "real cost factor" requirement and does not protect`
15. `stored passwords. The dummy hash makes the expensive op *actually execute* in`
16. `every branch rather than being compensated by a pause.`
17. (blank)
18. `## What this does NOT protect against`
19. `- Password brute-force on a known account (hides email existence, not guesses).`
20. `- Mail-side enumeration: the "sign-up-attempt" email reaches the owner; mailbox`
21. `  access or SMTP bounce observation still leaks existence.`
22. `- Network jitter (DNS, TCP/TLS) and SMTP template latency to a passive observer.`
23. `- In-memory token loss on process restart.`

That's 23 lines. Good, within 15-25. Let me verify the content matches the plan:

- Mechanism: ✓ (argon2.verify always, dummy hash, no-op touch, byte-identical responses)
- Why over alternatives: ✓ (sleep, skip hash, HMAC)
- What it doesn't protect: ✓ (brute force, mail-side, network jitter, token loss)

This looks good. Let me finalize.
```

## reply

```markdown
# Security — Equal-timing anti-enumeration

## Mechanism
Every branch executes `argon2.verify(password, hash)` where hash is the stored
row's hash or a module-level dummy (argon2id t=3 m=65536 p=1, generated at
boot). For sign-up the result is discarded; for sign-in it gates 200 vs 401.
Sign-up adds a no-op `UPDATE … SET created_at = created_at` on the "exists"
path so both branches do one read + one write. Bodies, status and headers are
byte-identical across branches.

## Why this over the alternatives
A fixed-delay sleep is brittle under load and clock drift. Skipping the hash
on the not-found branch leaves a 50–200 ms gap visible with N > 10 samples.
An HMAC token fails the "real cost factor" requirement and does not protect
stored passwords. The dummy hash makes the expensive op *actually execute* in
every branch rather than being compensated by a pause.

## What this does NOT protect against
- Password brute-force on a known account (hides email existence, not guesses).
- Mail-side enumeration: the "sign-up-attempt" email reaches the owner; mailbox
  access or SMTP bounce observation still leaks existence.
- Network jitter (DNS, TCP/TLS) and SMTP template latency to a passive observer.
- In-memory token loss on process restart.
```
