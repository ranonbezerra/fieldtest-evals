# 06 — Multi-tenant white label: isolation you can't forget

## The real situation

A working single-operator system needed to become a white-label product: the same
codebase serving multiple operators, each with its own domain, branding, users,
and completely isolated data. The monorepo restructure (shared backend, per-tenant
frontend builds with theme/config injected at build time, identity provider with
one organization per tenant) was the visible part. The dangerous part was the
backend: retrofitting tenancy onto an API where every existing query was written
for a single operator.

The core insight this problem tests: **per-query discipline does not survive a
team**. If isolation depends on every developer remembering `where tenantId = ?`,
one forgotten clause leaks customer data across operators. Isolation has to be
structural — tenant resolved server-side from the request origin (domain/token),
injected into a request context, and enforced centrally at the data-access layer,
with cross-tenant access tests that prove a leak is impossible, not assumed.
Uniqueness also changes meaning: "email is unique" becomes "email is unique *per
tenant*", and getting that wrong blocks a tenant's signup because of another
tenant's user.

## Stack

TypeScript, NestJS, Prisma, PostgreSQL. Tenant-aware Prisma client extension (or
middleware) expected; a per-tenant config/theme endpoint included.
