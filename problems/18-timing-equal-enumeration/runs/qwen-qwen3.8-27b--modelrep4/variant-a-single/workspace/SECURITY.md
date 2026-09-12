# Security notes — sign-up / sign-in enumeration

**Mechanism.** Both endpoints perform one full argon2id pass per request,
in every outcome branch. sign-up always runs: hash → SELECT → INSERT
attempt → exactly one email. sign-in always runs: SELECT → verify, where an
unknown address is verified against a dummy hash pre-computed at boot with
identical parameters. Both branches answer with the same status, body and
headers. The real outcome (account created, or "someone tried to sign up
with your address") is delivered out-of-band only.

**Why this over the alternatives.** Distinct "already taken" vs. "created"
responses are the classic enumeration leak and are ruled out by design.
Fixed sleep() padding drifts with hardware, config and load, and taxes every
request; the argon2 pass the feature must run anyway is a better pad.

**What this does NOT protect against.**
- The mailbox owner, or an attacker who has taken over that mailbox, can
  still confirm the address exists, via the notification itself.
- Other enumeration channels: password reset, search, profiles, or rate
  limiting that keys on known accounts.
- Brute force on a known address: argon2id slows it, but sign-in rate
  limiting / lockout is a separate control, not implemented here.
- Timing equality is statistical, not cryptographic: with many samples and
  precise instrumentation, residual micro-deltas (e.g. the INSERT on new
  accounts) are in principle measurable; the argon2 cost swamps them.
