# Rubric — 06 Multi-tenant isolation

## Gate: must-haves (missing any = FAIL)

| # | Must-have | What to look for |
|---|-----------|------------------|
| M1 | **Tenant resolved server-side** | Tenant derived from request origin (host/subdomain) or from the auth token's org claim — never accepted from body, query param, or client-settable header. |
| M2 | **Central enforcement** | Tenant filter applied structurally (Prisma client extension/middleware, or RLS) so a query cannot *forget* it; per-handler `where tenantId` discipline as the only mechanism = fail. |
| M3 | **Writes stamped, not trusted** | `tenantId` on create/update comes from the request context; a client-supplied tenantId is ignored/rejected. |
| M4 | **Tenant-scoped uniqueness** | Unique constraints composed with tenantId (e.g., `@@unique([tenantId, email])`); global uniques on tenant-owned data = fail. |
| M5 | **Leak-proof by test** | Tests create data in tenant A, authenticate as tenant B, and prove: list excludes A's rows, direct-id fetch returns 404 (not 403 revealing existence), update/delete cannot touch A's rows. |
| M6 | **Cross-tenant id probing safe** | Fetching another tenant's resource id behaves exactly like a nonexistent id. |

## Graded criteria (0–3 each)

1. **Context propagation** — request-scoped tenant context (CLS/DI) clean through async boundaries; no tenant param threading through every signature.
2. **Config/theming** — per-tenant config endpoint (branding, feature flags) resolved by tenant, cache-safe.
3. **Escape hatch design** — deliberate, audited mechanism for legitimately cross-tenant ops (admin/backoffice), not a default-open client.
4. **Tests** — beyond M5: uniqueness per tenant proven (same email, two tenants), context isolation under concurrent requests.
5. **Code quality** — migration path sanity (backfilling tenantId), idiomatic Nest.
6. **Process** — transcript shows the model reasoning about *structural* vs *disciplinary* enforcement.

## Verdict template

The shared shape lives in [`harness/verdict-template.md`](../../harness/verdict-template.md).
`gate` carries this problem's must-haves; `graded` carries its graded criteria above.
