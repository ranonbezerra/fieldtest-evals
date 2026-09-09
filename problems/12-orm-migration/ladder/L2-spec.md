# Issue #370 — Migrate the billing data layer from Prisma to Drizzle

**Repo:** `billing-service` · **Labels:** `migration` `tech-debt`
**Reported by:** platform · **Diagnosed by:** platform

---

## Context

The service handles accounts, invoices and line items. It works. The team is
standardising on Drizzle and this is the last service on Prisma.

The suite covers roughly the happy path of each endpoint. **It is not a specification
of the service's behaviour** — it is a sample of it, and the gap is where this
migration will hurt.

## What we need

### 1. The schema recreated, and Prisma gone

Same tables, columns and constraints, expressed in Drizzle, with migrations. The
Prisma schema, the generated client and the dependency all removed — including the
import that only survives because it is a type, and the error-mapping helper that
translates Prisma error codes.

Removing it from `package.json` while the code still imports it is the failure mode:
it typechecks against a stale `node_modules` and fails on a clean install.

### 2. Every query ported, with the wire format byte-compatible

Field presence, null versus missing, numeric formats. **Invoice amounts are BigInt and
are serialized as strings today.** A port that lets them become numbers changes the
contract for every consumer and no test in the suite will notice.

### 3. Transactional behaviour preserved, and proven

Invoice creation writes the invoice, its line items and the account counters
atomically. Prove it still does with a test that **injects a failure mid-transaction**
and asserts nothing was written — not a test that calls the happy path and checks the
rows exist.

### 4. Find what the suite does not cover

This is the part that takes the time. Read the call sites, compare old and new output,
and look for behaviour that consumers depend on and no test asserts. Ordering that
happens to be stable today. A null that is currently absent rather than null. An error
path that returns a 404 because of how Prisma reports a missing row.

Pin each one you find with a new test, and record it in `MIGRATION_NOTES.md`: what the
behaviour is, how you found it, and how the Drizzle version preserves it.

### 5. Do not edit the existing suite

It is the only evidence the migration preserved behaviour. Rewriting it — into another
framework, into another style, at all — destroys the comparison this task exists to
make. If a test fails, the migration is wrong, not the test.

## Acceptance

- No Prisma anywhere: not in `package.json`, not in an import, not in the error mapper
- The existing suite passes **unmodified**
- A test injects a mid-transaction failure and proves atomicity
- BigInt amounts still serialize as strings
- `MIGRATION_NOTES.md` documents each semantic difference met and how it was resolved
- New tests pin behaviour the original suite did not cover

## Notes

**Green tests are not the finish line.** The judging includes behaviour the suite never
covered, which is why §4 exists and why it is where the marks are.

TypeScript, NestJS, PostgreSQL. The fixture is plain classes and plain imports — check
what it actually is before assuming a framework.
