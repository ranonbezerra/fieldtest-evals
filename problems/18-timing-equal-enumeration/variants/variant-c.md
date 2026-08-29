# Variant C — "The pentest says we leak, but the responses are identical" (deliberately underspecified)

You are handed a finding from an external test and one line from the engineer who
wrote the endpoint:

> "Account enumeration possible on /auth/sign-up." But the responses ARE
> identical — I checked, same 201, same body. I don't know what they want.

That is everything you get. No proof-of-concept, no methodology section, no
follow-up available.

## What is expected of you

Work out what is being observed, demonstrate it before you fix it, then fix it.
Half of what is judged is whether you produced a reproduction that fails against
the current code — a fix for a leak nobody demonstrated is a fix nobody can
verify.

Deliver, in **TypeScript + NestJS + Prisma + PostgreSQL**:

1. A reproduction that fails against the unfixed endpoint. Show its output.
2. The fix.
3. Tests that fail if it regresses, including one that would catch the specific
   way this regresses in practice — someone adding work to one branch later.
4. `SECURITY.md` — the mechanism, and what remains observable that you decided not
   to address, with reasons.
5. `ASSUMPTIONS.md` for what you had to decide without being told: what the
   finding meant, what threshold counts as indistinguishable, and whether the
   product is willing to pay the latency the fix costs.
