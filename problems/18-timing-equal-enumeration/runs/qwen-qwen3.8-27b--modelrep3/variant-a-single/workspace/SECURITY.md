# Security notes: timing-equal sign-up / sign-in

Mechanism
- Both sign-up branches run one argon2id hash of the supplied password (m=64MiB, t=3, p=4)
  and one database write (insert for new, equalizing touch for existing); both sign-in
  branches verify against a cost-identical hash (stored, or a precomputed dummy).
- Ambiguous responses are fixed bytes: sign-up always 202 {"status":"accepted"}; sign-in
  always the same 401 invalid_credentials envelope for a wrong password or unknown address.
- The real outcome travels by email, one message per request in every branch: verification
  for new addresses, a "someone tried to sign up with your address" alert for existing ones.

Why this over the alternatives
- Padding the fast branch to a constant sleep adds latency to every request and would keep
  the timing test green even if the equal work were removed; identical expensive work in
  both branches equalizes real cost without padding.
- Distinct status codes or bodies (e.g. 409 "email taken") are the classic enumeration
  channel; the byte-equality tests in test/auth.spec.ts pin the responses together.
- A dummy verify on sign-up would not match a real hash cost; hashing in both branches does.

What this does not protect against
- Observers who can read outbound mail or mail logs can still tell which branch ran; the
  indistinguishability holds only at the HTTP boundary, and timing equality is statistical
  (CPU frequency scaling and network jitter remain).
- No rate limiting exists and successful sign-ins are distinguishable by design, so
  credential stuffing and offline password guessing remain possible.
