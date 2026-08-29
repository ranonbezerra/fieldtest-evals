# Variant C — "Sessions keep dropping" (deliberately underspecified)

You are handed one message from the product lead of a mobile app:

> People get logged out at random and support is drowning. We also had a scare
> last month — someone's session was used from another country and we had no way
> to see it or stop it. Can you make sessions solid? Something like the "your
> devices" screen other apps have.

That is the entire specification. There is no security review scheduled, no
threat model written down, and nobody will answer a follow-up before you build.

## What is expected of you

The request contains one usability problem and one security problem, and they
pull against each other: the fix for random logouts is to be lenient with
retries, and the fix for the stolen session is to be ruthless about replays.
Resolving that tension is the task.

Decide, build it in **TypeScript + NestJS + Prisma + PostgreSQL**, and record
every non-obvious decision with its rationale in `ASSUMPTIONS.md` — including the
ones you decided *not* to do. An assumption baked silently into code counts
against you; a recorded decision counts for you even where a reviewer would have
chosen otherwise.

Deliver the module, migrations, tests, `ASSUMPTIONS.md`, and a short
`SECURITY.md` naming the properties you believe you now hold — and the ones you
do not.
