# Variant C — "It works on my machine" (deliberately underspecified)

A NestJS + Prisma service is in `fixtures/api/`. You are handed it with one
message, from the engineer who merged three features last week and is now on
leave:

> CI is green and it deploys, but it keeps falling over and I never worked out
> why. Works on my machine. Can you have a look before Thursday?

That is the entire specification. No error output, no reproduction, no list of
what changed.

## What is expected of you

Reproduce it first, then fix it. Part of what is judged is whether you get a
failing signal in front of yourself before you start editing — and whether you
say what you did when the tools you would normally trust all report success.

Deliver:

1. `DIAGNOSIS.md` — how you reproduced it, what each defect actually was, and
   why `tsc` and the test suite were both green throughout.
2. The fixes, confined to wiring.
3. A check that fails when this class of defect is present, and one line on what
   it does not cover.
4. `ASSUMPTIONS.md` for anything you had to decide without being told — which
   module should own a provider is a convention, and picking one silently counts
   against you even when the pick is right.
