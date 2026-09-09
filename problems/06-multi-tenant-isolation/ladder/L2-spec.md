# Issue #205 — Tenant B can read tenant A's customers

**Repo:** `operator-platform` · **Labels:** `security` `blocker`
**Reported by:** security review · **Diagnosed by:** platform

---

## What is happening

The system was built for one operator and is being sold as a white label: each
operator gets `app.operator-x.com`, its own branding, users, and data — customers,
plans, orders — that no other operator may see.

The pre-launch security review found three ways across the boundary.

**Handlers pass `tenantId` by hand.** Most do. The ones that forgot return everyone's
rows. There are 41 query sites and the review found four misses; the number that
matters is that a fifth can be added by anyone at any time and nothing catches it.

**Fetch-by-id ignores the tenant entirely.** `GET /customers/:id` loads by primary key.
An id from another operator returns that operator's customer. Guessing ids is not the
threat — an id in a support ticket or a URL someone pasted is.

**Uniqueness is global.** The same person is a customer of two operators and cannot
register with the second, which tells the second operator that the first has them.

## What we need

### 1. Tenant resolution, server-side, from two sources that must agree

The host (`app.operator-x.com`) and the `org` claim in the auth token. Both are
resolved, both must point at the same tenant, and a mismatch is rejected rather than
resolved in favour of one. Neither alone is enough: the host is attacker-controllable
in some deployments and the token can outlive a tenant migration.

The resolved tenant lives in request-scoped context.

### 2. Isolation is structural, not remembered

A tenant-aware Prisma client — an extension or middleware — that **scopes every read
and stamps every write** from that context. Handlers and repositories never mention
`tenantId`. This is the fix for the first finding: the correctness of a query site
stops depending on whoever wrote it.

Two properties it must have:

- when no tenant is in context, it **fails** rather than returning everything
- a `tenantId` supplied by a caller is overwritten by the context, not trusted

### 3. Fetch-by-id is scoped like everything else

Another tenant's id behaves exactly as a nonexistent id: **404**, same body. Not 403 —
the difference between "not yours" and "not there" tells the caller the row exists.

### 4. Tenant-scoped uniqueness

`@@unique([tenantId, email])` and equivalently wherever uniqueness applies. The same
email registers in two tenants independently.

### 5. `GET /tenant-config`

Branding and feature flags for the resolved tenant.

## Acceptance

Tests, authenticated as tenant B against tenant A's data:

- list → excludes A's rows entirely
- fetch A's customer by id → **404**
- update A's row → 404, and A's row is unchanged afterwards
- delete A's row → 404, and A's row still exists afterwards
- the same email registers in both tenants
- concurrent requests from two tenants do not cross contexts
- a query issued with no tenant in context fails rather than returning everything

The last two are the ones that fail quietly under load, and they are the reason this
is a test suite rather than a code review.

## Deliverables

Tenant resolution middleware · the tenant-aware Prisma client · schema for customers,
plans and orders with tenant-scoped uniqueness · `GET /tenant-config` · the tests above.

## Notes

Stack is fixed: TypeScript, NestJS, Prisma, PostgreSQL.
