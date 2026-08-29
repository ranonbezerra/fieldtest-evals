# 11 — Behavior-preserving refactor (instructed and open tracks)

## The real situation

Codebases that live long enough accumulate the same shape of debt: near-identical
logic copy-pasted across modules (a status-mapping function that exists three
times, three slightly different report builders), a module that grew every
sprint until nobody wants to touch it, a monorepo consolidation where the same
concept is implemented per-app. The professional task is to make the code better
**without changing what it does** — and "what it does" includes its quirks,
because callers depend on them.

Research gives this problem its two-track design: agents implement refactorings
well when told exactly what to do, but when only pointed at a problematic area —
asked to *find* the refactoring — they discover a small fraction of what humans
propose, and often "fix" behavior along the way. So variants A and B are
**instructed** (the refactor is specified; discipline is measured), and variant
C is the **open track** (only the pain is described; judgment is measured).

The other trap is coverage. Real duplicated code is often half-tested; moving it
without first pinning its behavior means the refactor's safety is vibes. The
gate therefore requires characterization tests *before* moving uncovered logic —
including tests that lock in existing oddities as-is, documented, not repaired.

## Stack

TypeScript, NestJS, Prisma, PostgreSQL. Each variant ships a small working
codebase with partial test coverage as fixtures.
