# Security Design – Preventing Email Enumeration via Timing & Response

## Mechanism
The sign‑up and sign‑in endpoints are crafted so that **all observable
characteristics are identical** regardless of whether the supplied e‑mail
belongs to an existing account.

* **Constant HTTP response** – Both success and failure branches return the same
  status code, body shape, and headers. For sign‑up the response is always
  `{ "message": "Request processed" }`. For sign‑in failures the response envelope
  is an identical error object (`invalid_credentials`).

* **Equalised work** –  
  *Sign‑up*: The password is always hashed (argon2id) before any existence check.
  This makes the time spent on a new address (hash + DB insert) and an existing
  address (hash + no‑insert) indistinguishable.  
  *Sign‑in*: When the e‑mail is unknown, the supplied password is verified against
  a pre‑computed **dummy hash**. When the e‑mail exists, the password is verified
  against the real stored hash. Both paths perform exactly one Argon2 verification,
  which dominates execution time.

* **Out‑of‑band notifications** – Email notifications are sent after the response
  is prepared and any failure is ignored, so they never affect observable
  behaviour.

## Why this design
* **Timing attacks** can measure the difference between a fast “user not found”
  path and a slower “hash verification” path. By forcing both branches to execute
  the same expensive cryptographic operation, the mean latency difference is
  eliminated, satisfying the explicit security requirement.
* **Random delays** were deliberately avoided because they add variance without
  removing the mean difference; an attacker can still statistically separate the
  two cases with enough samples.

## What is **not** protected
* **Side‑channel leakage** other than timing (e.g., differences in CPU cache
  usage, power consumption) is out of scope.
* **Brute‑force attacks** on passwords are mitigated only by the Argon2 cost
  factor; rate‑limiting or account lockout mechanisms are not part of this
  implementation.
* **Compromised email delivery** – if the mail service is observable, an attacker
  could infer activity from email traffic, but that is an out‑of‑band channel
  outside the API’s threat model.
* **Application‑level bugs** that cause early returns before the equalising step
  would re‑introduce timing variance. The code must be kept in sync with the
  design contract.

Overall, the approach guarantees that an attacker who can issue arbitrary
requests and measure response times cannot distinguish whether an e‑mail address
is already registered, nor can they infer the existence of an account from the
API’s observable behaviour.
