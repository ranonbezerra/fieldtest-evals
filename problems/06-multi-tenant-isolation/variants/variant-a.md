# Variant A — Operator white label

A B2B system built for one operator must serve multiple operators as a white
label: each gets its own domain (`app.operator-x.com`), branding, users, and
fully isolated data (customers, plans, orders). Auth tokens carry an `org`
claim; requests also arrive with the tenant's host.

Build in **TypeScript + NestJS + Prisma + Postgres**:

1. Tenant resolution middleware: derive the tenant from host + token org claim
   (both must agree); reject mismatches. Tenant lives in request-scoped context.
2. Structural isolation at the data layer: a tenant-aware Prisma client
   (extension/middleware) that scopes every read and stamps every write; handlers
   never pass tenantId manually.
3. Schema for customers/plans/orders with tenant-scoped uniqueness (same customer
   email may exist in two tenants).
4. `GET /tenant-config` — branding + feature flags for the resolved tenant.
5. Tests: tenant B cannot list, fetch-by-id (expect 404), update, or delete
   tenant A's rows; same email registers in both tenants; concurrent requests
   from different tenants don't cross contexts.
