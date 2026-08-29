# 15 — Compiles clean, fails at boot

## The real situation

This mirrors a class of failure that cost three separate runs on a NestJS +
Drizzle monorepo, each time in a different disguise, and never once caught by a
type-checker: **an unresolved dependency compiles perfectly.**

A framework that resolves providers by name at runtime has a whole category of
error that lives below the compiler. The code is well typed. Every import
resolves. `tsc --noEmit` is clean, the test suite is green, the pull request
looks finished — and the process exits during bootstrap, or worse, starts and
throws on the first request that reaches the unregistered path.

The three real incidents, in order of how long each took to find:

1. **A repository never listed in `providers`.** The service that injects it is
   registered; the repository is not. Nest cannot construct the service, and the
   error names the *service*, not the missing provider.
2. **A provider exported by nobody.** Two modules, one owns the service, the
   other injects it. The owner never `exports` it, or the consumer never
   `imports` the owner. The message is the same as (1), and the fix is in a file
   the error does not mention.
3. **A circular import created by fixing (2).** Making a jobs module import an
   auth module closed a loop back through a constant that happened to live in the
   jobs module file. The symptom was `Cannot access 'QUEUES' before
   initialization`, at runtime, in a file unrelated to the change — and it went
   away and came back depending on import order.

What makes this a good problem is not the difficulty of any single fix. It is
that **the feedback loop lies**: the tools a model trusts most all report
success. Solving it requires knowing that a green typecheck is not evidence of a
running application, and either wiring correctly on the first pass or proving the
application boots.

## Stack

TypeScript, NestJS, Prisma, PostgreSQL. The database need not be reachable —
bootstrap must complete far enough to resolve the dependency graph, and the
fixture provides a fake for anything that would otherwise need a connection.
