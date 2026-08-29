# 12 — Dependency migration under partial coverage

## The real situation

Swapping a load-bearing dependency while the app keeps its contract is routine
senior work: an ORM the team is leaving (a real project here moved its data
layer plans from Prisma to Drizzle), a framework major upgrade, an inference
provider swap in an LLM product (Ollama → a cloud provider, same product
behavior). The migration itself is mechanical 80% of the way; the job is the
other 20%: semantic differences between the old and new dependency
(transaction behavior, null vs undefined, BigInt/Decimal mapping, error types,
implicit ordering) that the type checker won't catch.

The trap this problem plants is the one migration studies keep documenting:
**spurious solutions that exploit low test coverage** — the suite is green, the
migration "worked", and an uncovered behavior quietly changed. Each variant's
fixture has deliberately partial coverage plus at least one behavior that no
test covers but callers depend on (documented in the reference answer key). A
model that treats "tests pass" as "done" fails; the work includes *finding*
what the tests don't say, pinning it, and preserving it.

Completeness is also graded structurally: a migration that leaves both
dependencies half-installed, or a compatibility shim that just wraps the old
API forever, is not a migration.

Variant C is deliberately underspecified about the target.

## Stack

TypeScript, NestJS, PostgreSQL. Fixtures ship as working services with
package.json, partial test suites, and seeds.
