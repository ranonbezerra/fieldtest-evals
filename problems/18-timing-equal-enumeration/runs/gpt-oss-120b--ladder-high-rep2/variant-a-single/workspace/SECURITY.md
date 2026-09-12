# Security Design for Timing‑Equalised Authentication

## Mechanism
Both the **sign‑up** and **sign‑in** endpoints perform **identical cryptographic work**
regardless of whether the supplied e‑mail address exists in the database or whether a
password is correct.  

A pre‑computed **dummy Argon2id hash** is generated once at service start‑up.
When the fast branch would otherwise return immediately (e.g. e‑mail already taken
on sign‑up, unknown e‑mail on sign‑in), the supplied password is verified against this
dummy hash. Verification runs the full Argon2 hashing algorithm, consuming the same
CPU time as a real password hash verification.

All user‑visible responses are generic:
- Sign‑up always returns HTTP 200 with a static message.
- Sign‑in returns a token only on success; on failure it returns a 401 with an
  error envelope that does **not** indicate which check failed.

E‑mail notifications are sent **out‑of‑band** (`void sendEmail(...)`) so that
mail‑related latency never influences the HTTP response.

## Why Argon2id
Argon2id is a memory‑hard password‑hashing algorithm with configurable cost
parameters. Using a real cost factor guarantees a non‑trivial amount of work,
making timing differences observable unless deliberately equalised. It also provides
strong resistance against GPU‑accelerated brute‑force attacks.

## Alternatives Considered
- **Random artificial delays** – rejected because they add variance without removing
  the mean timing difference; an attacker can average out the noise.
- **Early exits without dummy work** – would leak enumeration via timing, which is the
  core vulnerability this design addresses.

## What It Does Not Protect Against
- **Side‑channel attacks** unrelated to timing (e.g., power analysis, cache attacks)
  that could be performed on the server.
- **Brute‑force password guessing** – the design does not limit login attempts;
  rate‑limiting or account lockout must be added separately.
- **Network latency variability** – while the implementation equalises server‑side
  processing time, an attacker can still be affected by variable network delays;
  however, averaging many samples mitigates this.
- **Compromise of the dummy hash** – the dummy hash is public knowledge and does not
  reveal any user‑specific data.

## Conclusion
By forcing every authentication‑related code path to perform a full Argon2id
verification, we make the observable timing characteristics indistinguishable.
Combined with constant, generic HTTP responses, this prevents an attacker from
enumerating existing e‑mail addresses via timing or response‑content analysis.
