# Security notes — refresh-token rotation

## Check order on POST /auth/refresh, and why it is in that order

1. **Malformed, before any lookup.** A missing, empty, non-string, oversized, or
   wrong-alphabet value cannot identify a session, so it is rejected without a
   database touch and audited as `malformed`.
2. **Reuse, checked as the write.** Rotation is one conditional UPDATE that
   retires the token only if it is live, unrevoked, unexpired, and in an
   unrevoked family; the database serialises concurrent claims on the row, so
   exactly one wins. The losers read the token back: retired, revoked, or
   family-revoked is `reuse`; still live means a deadline passed, `expired`; no
   row is `unknown`. Reuse is evaluated before expiry on purpose — a token both
   retired and expired is an attack signal, and reading expiry first would
   downgrade a replay into a routine log line.
3. **Whole-family blast radius on reuse.** Every token descended from the
   sign-in is revoked in one UPDATE against the family, and the family itself is
   marked revoked. A lost race is a reuse event too: indistinguishable from a
   replay. A successor minted after the revocation is inert — the claim requires
   an unrevoked family — and its presentation is itself a reuse event.
4. **Deadline fixed at sign-in.** The absolute expiry lives on the family, set
   once at sign-in; successors are minted into the same family, so rotation can
   never extend it.
5. **One rejection shape.** Malformed, unknown, expired, and reuse all return
   401 with the same body; the audit table is where the causes are separated.
