# Security Mechanism Overview

**What we do**

- **Constant‑time work**: Both the *sign‑up* and *sign‑in* flows always perform an Argon2id hash
  (or verification) on the supplied password, even when the e‑mail address does not exist.
- **Dummy hash**: At application start a dummy Argon2id hash is pre‑computed. When an
  unknown e‑mail is presented during sign‑in, we verify the password against this dummy
  hash, ensuring the cryptographic workload is identical to the known‑user branch.
- **Uniform responses**: Successful sign‑up and both failure modes return the same HTTP
  status code, body, and headers. Sign‑in failures (wrong password vs unknown address) also
  share a single error envelope (`invalid_credentials`).

**Why we chose this design**

- Argon2id provides a strong, configurable cost factor that cannot be lowered without
  weakening password security. The attacker’s only observable difference would be timing,
  so we equalise the work rather than padding with random delays (which only adds variance).
- Using a pre‑computed dummy hash removes the need for per‑request dummy hash generation,
  eliminating the extra timing variance that would otherwise appear in the unknown‑email
  branch.
- Keeping the email‑sending logic fire‑and‑forget guarantees that mail delivery failures
  never affect the outward‑facing response, preserving indistinguishability.

**What this does **not** protect against**

- **Side‑channel attacks** beyond timing (e.g., power analysis, cache attacks) are out of scope.
- **Brute‑force enumeration** of passwords after a successful sign‑in; the mechanism only
  hides account existence, not password validity after authentication.
- **Denial‑of‑service**: the constant hashing workload makes the endpoints deliberately
  expensive; a malicious actor could still exhaust server resources by flooding requests.
- **Information leakage through other vectors** (e.g., email bounce messages, rate‑limit
  headers). Those must be handled separately.

By ensuring that every request incurs the same costly cryptographic operation and
returning byte‑identical responses, we prevent an attacker from learning whether an
e‑mail address already has an account via timing or response‑based analysis.
