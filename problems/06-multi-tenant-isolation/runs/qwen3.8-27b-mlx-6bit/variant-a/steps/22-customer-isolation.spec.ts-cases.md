# 22-customer-isolation.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/customer-isolation.spec.ts` based on the PLAN.md specification and the implementation files shown. Let me analyze what needs to be tested:

From the task statement (variant-a.md), the tests must cover:
- Tenant B cannot list tenant A's rows
- Tenant B cannot fetch-by-id (expect 404) tenant A's rows
- Tenant B cannot update tenant A's rows
- Tenant B cannot delete tenant A's rows
- Same email registers in both tenants
- Concurrent requests from different tenants don't cross contexts

From PLAN.md §5 (Tests), the specific test cases listed are:
1. GET /tenant-config with matching host and token org returns branding and feature flags
2. Same host with token org claim differs returns 403 tenant_mismatch
3. Host that maps to no tenant returns 403 unknown_tenant
4. Tenant B's GET /customers returns none of tenant A's rows
5. Tenant B fetches one of tenant A's customer ids via GET /customers/:id and receives 404
6. Tenant B's PATCH /customers/:id on tenant A's row returns 404 and leaves the row unchanged
7. Tenant B's DELETE /customers/:id on tenant A's row returns 404 and the row still exists for tenant A
8. The same customer email registers successfully under both tenant A and tenant B (distinct rows)
9. Registering the same email twice under one tenant returns 409 conflict
10. Interleaved concurrent requests from two tenants each see only their own tenant's rows

Now, the file is `test/customer-isolation.spec.ts` specifically. Looking at the manifest:
- `test/tenant-config.spec.ts` covers tenant-config success and rejection cases (cases 1-3)
- `test/customer-isolation.spec.ts` covers cross-tenant isolation, duplicate email, concurrency (cases 4-10)

So for `customer-isolation.spec.ts`, I need to focus on cases 4-10, but also think about what else is in scope.

Let me think about what each test proves and what would have to be broken for it to fail:

1. **Tenant B lists customers — sees only own rows**: Tenant A has a customer, Tenant B lists. Expect empty array (or only B's rows). Fails if: the Prisma guard doesn't inject `tenantId` into `where`, or the ALS context is missing/stale, or the repository uses a raw query bypassing the guard.

2. **Tenant B fetches tenant A's customer by id — 404**: Tenant B requests GET /customers/:idA. Expect 404 resource_not_found. Fails if: the guard doesn't scope `findFirst`, the repository uses `findUnique` (which bypasses tenant scoping), or the service returns the row instead of throwing.

3. **Tenant B patches tenant A's customer — 404, row unchanged**: Tenant B does PATCH /customers/:idA. Expect 404 and the original data intact when tenant A re-fetches. Fails if: the guard doesn't scope `update` with `where.tenantId`, or the update matches across tenants, or the service doesn't check for zero-affected-rows.

4. **Tenant B deletes tenant A's customer — 404, row still exists**: Tenant B does DELETE /customers/:idA. Expect 404 and the row still visible to tenant A. Fails if: the guard doesn't scope `delete` with `where.tenantId`, or the delete removes the row regardless of tenant.

5. **Same email registers in both tenants**: POST /customers with same email under host A then host B. Both succeed, distinct ids. Fails if: the `@@unique([tenant_id, email])` constraint is missing or wrong (e.g., `@@unique([email])`), or the guard doesn't stamp tenantId on create.

6. **Same email twice in one tenant — 409 conflict**: POST /customers with same email under host A twice. Second returns 409. Fails if: the unique constraint is missing, or the P2002 → conflict mapping in the filter is broken.

7. **Concurrent requests from two tenants don't cross contexts**: Fire GET /customers for A and B simultaneously (interleaved). Each sees only its own rows. Fails if: the ALS context is shared/mutated, or the Prisma client caches context, or the guard reads a stale closure value.

Now let me think about additional cases that are awkward or branch-specific:

8. **No tenant context (middleware bypassed or failure) — fail-closed**: If somehow a scoped query runs without ALS context (e.g., middleware didn't run, or context was cleared), the guard should throw `tenant_context_missing` (500). Fails if: the guard silently passes through without a tenant, allowing unscoped queries.

Wait, but this is about the customer-isolation spec specifically. Can I actually test "no tenant context" via the HTTP API? The middleware always runs on all routes. So maybe this is more of a unit-level concern. But I could test it by calling the repository directly without setting ALS. Actually, looking at the test structure — these are integration tests via HTTP. Let me reconsider.

Actually, re-reading the plan: "The guard evaluates per-query and is fail-closed: no tenant in ALS ⇒ throw, never run an unscoped query." This is important but testing it via HTTP is hard since the middleware always sets context. I'll note it as something to test at a lower level or note it's covered by the concurrency/isolation tests implicitly.

Let me also think about:
- **Tenant A can still see its own rows after tenant B's failed operations**: After B's failed get/patch/delete on A's row, A re-fetches and sees original data. This is implicitly in tests 3 and 4 but worth calling out.

- **Tenant B's successful operations only affect its own data**: B creates a customer, B lists it, B deletes it — all work. This proves the guard stamps correctly on writes AND scopes correctly on reads for the same tenant.

Let me also think about the "what would have to break" more carefully:

For the concurrency test: The key risk is that `AsyncLocalStorage` context leaks between requests. In Node.js, ALS contexts are per-async-execution-context. If the implementation used a module-level variable instead of ALS, concurrent requests would clobber each other. The test would fail if:
- The implementation uses a shared mutable variable instead of ALS
- The Prisma client caches the tenant at construction time rather than reading from ALS at query time
- The `tenantStorage.run` wrapper doesn't actually wrap the full downstream execution

Let me also consider: what about the `tenant-config` tests? Those are in `test/tenant-config.spec.ts` per the manifest. So I should NOT include them here.

Let me also think about whether "same email in both tenants" needs to verify the ids are different, or just that both succeed. The plan says "distinct rows" so I should verify distinct ids AND that each tenant sees its own copy.

One more awkward case: **Tenant B creates a customer, then tenant A lists — doesn't see B's new customer**. This is the mirror of test 1 but from the write side. It proves the stamp on create actually uses the correct tenant from ALS, not a default or a cached value.

Let me structure my list now:

1. Tenant B lists customers — sees only its own rows (empty if B has none)
2. Tenant B fetches tenant A's customer id — 404 resource_not_found
3. Tenant B patches tenant A's customer — 404, and tenant A re-fetches to confirm unchanged
4. Tenant B deletes tenant A's customer — 404, and tenant A re-fetches to confirm still exists
5. Same email registers under both tenants — both succeed with distinct ids
6. Same email registered twice under one tenant — second returns 409 conflict
7. Concurrent interleaved requests from two tenants — each sees only its own rows
8. Tenant A creates customer, tenant B lists — doesn't see A's new row (stamp correctness on write)

Wait, case 8 is somewhat covered by case 1 (if A creates then B lists). But it's a distinct concern: case 1 is about reads being scoped, case 8 is about writes being stamped correctly. Actually case 5 covers the write-stamping (both succeed). Let me think...

Actually case 1 already implies this: if A has a customer and B lists, B doesn't see it. The "stamp" is proven by the fact that the customer WAS created under A (case 5 proves creation works). So case 1 + case 5 together cover both read-scoping and write-stamping.

But there's a subtlety: what if the guard stamps tenantId on create but uses the WRONG tenant (e.g., a hardcoded value, or the first tenant that ever connected)? Case 5 would still pass if both happen to get the right stamp by coincidence of test ordering. The concurrency test (7) would catch this if the stamps were wrong.

I think the list is solid. Let me also add:
- A test that verifies the error envelope shape on the 404s (code is `resource_not_found`, details is an object). Actually this is more of a contract test and might be in both spec files. I'll fold it into the individual tests.

Let me finalize:
```

## reply

- **Tenant B lists customers and sees only its own rows** — Proves the Prisma guard injects `where.tenantId` on `findMany`. Would fail if the guard is absent, if it reads a stale/missing ALS context and skips scoping, or if the repository bypasses `prisma.scoped` and uses a raw client.

- **Tenant B fetches tenant A's customer id and receives 404 `resource_not_found`** — Proves the guard scopes `findFirst` by tenant so a cross-tenant id is invisible. Would fail if the repository uses `findUnique` (which Prisma forbids non-unique fields in, so it would either throw or skip the guard), or if the service returns the row instead of throwing on `undefined`.

- **Tenant B patches tenant A's customer — 404, and tenant A re-fetches to confirm the row is unchanged** — Proves the guard scopes `update`'s `where` with `tenantId`, so the UPDATE matches zero rows and the service maps that to 404 rather than silently succeeding. Would fail if the guard only scopes reads, or if the service treats "zero rows updated" as success.

- **Tenant B deletes tenant A's customer — 404, and tenant A re-fetches to confirm the row still exists** — Proves the guard scopes `delete`'s `where` with `tenantId`, so the DELETE matches zero rows. Would fail if the guard skips `delete`/`deleteMany`, or if the service returns 204 on zero-rows-deleted.

- **Same email registers under tenant A and tenant B — both succeed with distinct ids, each tenant sees only its own copy** — Proves the `@@unique([tenant_id, email])` constraint allows cross-tenant duplicates and the guard stamps `data.tenantId` on `create`. Would fail if the unique constraint is on `[email]` alone (second insert gets 409), or if the guard doesn't stamp `tenantId` on create (insert fails NOT NULL, or stamps a wrong value).

- **Same email registered twice under one tenant — second request returns 409 `conflict`** — Proves the tenant-scoped unique constraint rejects intra-tenant duplicates and the global filter maps Prisma P2002 to the `conflict` envelope. Would fail if the constraint is missing entirely, or if the filter doesn't intercept P2002 and lets it bubble as 500.

- **Tenant A creates a customer; tenant B immediately lists — does not see A's new row** — Proves the create-time stamp uses the *current* ALS context (the writing tenant), not a cached/default value. Would fail if `createTenantAwareClient` captures the tenant at construction time, or if the guard stamps a hardcoded id.

- **Concurrent interleaved GET /customers from tenant A and B — each response contains only its own rows** — Proves the ALS context does not leak between in-flight requests on the shared Prisma client. Would fail if the implementation uses a module-level mutable variable instead of `AsyncLocalStorage`, if `tenantStorage.run` doesn't wrap the full downstream chain, or if the Prisma extension caches the first-seen tenant.

- **Concurrent interleaved POST /customers from tenant A and B with the *same* email — both succeed, each row belongs to the correct tenant** — Proves that under concurrent writes the stamp reads the *per-request* ALS context, not a shared slot. Would fail if two in-flight creates race on a single mutable `currentTenantId` and one row gets stamped with the other tenant's id.

- **Tenant A's customer is still fully functional (list, get, patch, delete) after all of tenant B's cross-tenant attempts** — Proves the failed cross-tenant operations are truly no-ops: no partial update, no soft-delete flag, no lock held. Would fail if the guard scopes the `WHERE` but still executes the statement (e.g., a failed UPDATE that acquires and releases a row lock leaving a side-effect), or if the service throws *before* checking affected-rows and the 404 is actually a swallowed 500.

**Deliberately not testing here:** tenant resolution failures (missing/invalid token → 401, unknown host → 403, org mismatch → 403) and `GET /tenant-config` success — those belong to `test/tenant-config.spec.ts` per the plan's file split. Also not tested: plans and orders endpoints (schema-only in this variant), transactional multi-write atomicity (no such path exists), and the `tenant_context_missing` fail-closed guard error (unreachable via HTTP since the middleware always runs on `*`; it is a unit-level invariant of `tenantQueryGuard` that would require calling the guard directly without ALS).
