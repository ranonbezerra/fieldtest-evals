# Security considerations for authentication endpoints

**Mechanism**  
Both the `sign-up` and `sign-in` endpoints are designed to be *enumeration‑safe*.  
For every request the server performs a full Argon2id password hash (or verification) regardless of whether the supplied e‑mail exists. In `sign-up` we always hash the supplied password; in `sign-in` we always verify a password – either against the stored hash or against a pre‑computed dummy hash. The resulting hash work dominates the response time, making the two logical branches indistinguishable in both response payload and timing.

**Why Argon2id**  
Argon2id provides a memory‑hard, CPU‑intensive KDF at a real cost factor. Its verification time is comparable to hashing, which allows us to use the same primitive for timing equalisation without adding artificial delays.

**Email handling**  
Emails are sent *fire‑and‑forget*; any failure is swallowed so that the HTTP response never reflects the outcome of the out‑of‑band mail operation.

**What is not protected**  
- An attacker who knows a valid password can still authenticate and learn the existence of the account.  
- Side‑channel information such as TCP‑level packet size, TLS record length, or server‑side resource usage beyond the HTTP response is not mitigated.  
- Denial‑of‑service attacks that flood the endpoint with expensive hash operations are still possible.  
- The approach does not hide account existence from users who receive the “someone tried to sign up” or verification e‑mails.

**Limitations**  
The constant‑time guarantee relies on the Argon2id implementation’s timing consistency. A change in hashing parameters or a switch to a faster KDF would require re‑evaluation of the timing test. The tests enforce a statistical tolerance; extremely low‑variance environments could still expose a small mean difference.

**Conclusion**  
By forcing the same cryptographic work on all code paths and returning a uniform JSON envelope, the API prevents practical e‑mail enumeration through observable differences in response content or latency while preserving the ability to notify legitimate owners of sign‑up attempts.
