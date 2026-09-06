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
