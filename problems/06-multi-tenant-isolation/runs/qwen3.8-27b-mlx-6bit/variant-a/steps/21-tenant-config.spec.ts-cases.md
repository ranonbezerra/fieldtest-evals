# 21-tenant-config.spec.ts-cases

## reasoning

```
The user wants me to list test cases for `test/tenant-config.spec.ts` based on the PLAN.md specification and the implementation files shown.

Let me focus on what `test/tenant-config.spec.ts` covers based on the plan:

From PLAN.md §5, the tenant-config tests are:
- `GET /tenant-config` with a matching host and token `org` returns that tenant's branding and feature flags.
- Same host with a token whose `org` claim differs returns 403 `tenant_mismatch`.
- Host that maps to no tenant returns 403 `unknown_tenant`.

But I should think about what other branches could be wrong specifically for the tenant-config endpoint and its supporting machinery (middleware, context, service).

Let me think about what `test/tenant-config.spec.ts` would cover vs `test/customer-isolation.spec.ts`. The plan says:
- `test/tenant-config.spec.ts` — tenant-config success and rejection cases
- `test/customer-isolation.spec.ts` — cross-tenant isolation, duplicate email, concurrency

So tenant-config.spec.ts focuses on:
1. The happy path for GET /tenant-config
2. Rejection cases (mismatch, unknown tenant, no token, invalid token)
3. The middleware behavior as it pertains to tenant resolution

Let me enumerate the branches that could be wrong:

1. **Happy path**: GET /tenant-config with correct host + matching org claim → returns branding + featureFlags. Would fail if: middleware doesn't set context, service can't read from ALS, repo query fails, response shape is wrong, branding/featureFlags are null instead of objects.

2. **Tenant mismatch**: host resolves to tenant A, token org says tenant B → 403 tenant_mismatch. Would fail if: comparison is case-insensitive when it should be exact, or the middleware doesn't compare at all, or it compares against the wrong field (e.g., domain instead of slug).

3. **Unknown tenant from host**: host doesn't match any tenant → 403 unknown_tenant. Would fail if: hostToTenantSlug parsing is wrong, or the middleware doesn't check the registry, or it falls through to 404 instead of 403.

4. **No bearer token**: request without Authorization header → 401 unauthorized. Would fail if: middleware lets it through, or returns a different status/code.

5. **Invalid/malformed token**: bearer token with wrong signature → 401 unauthorized. Would fail if: middleware catches the JWT error and returns 500, or doesn't verify signature at all.

6. **Token missing org claim**: valid JWT but no `org` field in payload → should be 403 tenant_mismatch (org is undefined, won't match slug) or possibly a validation error. Actually per the plan, the token's org claim is compared to slug. If org is undefined, it won't equal the slug → tenant_mismatch. Would fail if: middleware doesn't handle missing org claim and crashes (500) or lets it through.

7. **Error envelope shape**: all error responses have `{ error: { code, message, details } }` where details is always an object (never null). Would fail if: filter doesn't wrap, or details is null/missing on some path.

8. **Feature flags default**: tenant with no feature_flags set returns `{}` (empty object), not null. Would fail if: service passes through null, or Prisma returns null for the jsonb column.

9. **Branding is passthrough**: the branding jsonb content is returned as-is. Would fail if: service transforms it, or it's stringified.

10. **Host with no subdomain / bare base domain**: host equals the base domain (no slug prefix) → unknown_tenant. Would fail if: hostToTenantSlug incorrectly parses the base domain as a slug.

11. **Host with extra subdomain levels**: e.g., `sub.operator-x.com` vs `app.operator-x.com`. The plan says host is tenant-owned if it ends in `.<base>` or equals `<slug>.<base>`. So `app.operator-x.com` where base is `operator-x.com` → slug is `app`. But wait, the plan says "subdomain label of the host (e.g. app.operator-x.com → operator-x)". Hmm, that's confusing. Let me re-read.

Actually re-reading: "The tenant slug is the subdomain label of the host (e.g. app.operator-x.com → operator-x)". Wait, that doesn't parse right. If the host is `app.operator-x.com`, the subdomain label would be `app`, not `operator-x`. But the plan says it maps to `operator-x`. Let me re-read more carefully.

"The tenant slug is the subdomain label of the host (e.g. `app.operator-x.com` → `operator-x`) and is also the value of the token's `org` claim"

Hmm, that's odd. Maybe the base domain is something like `fieldtest.com` and the tenant domain is `operator-x.com`, so the full host would be `app.operator-x.fieldtest.com`? No, the plan says "Base domain from env. TENANT_BASE_DOMAIN (e.g. operator-x.com) configures host→slug parsing; host is considered tenant-owned only if it ends in .<base> or equals <slug>.<base>."

Wait, I think I'm overcomplicating this. The base domain is something like `fieldtest.com`, and a tenant's host would be `operator-x.fieldtest.com` where slug = `operator-x`. The example in the task statement says `app.operator-x.com` but that's just illustrative.

Actually looking again at the plan: "TENANT_BASE_DOMAIN (e.g. operator-x.com)" — so the base domain itself IS `operator-x.com`? That seems like it's the tenant's own domain, not a shared base. Let me re-read: "host is considered tenant-owned only if it ends in .<base> or equals <slug>.<base>"

So if base = `fieldtest.com`, then host `app.fieldtest.com` → slug `app`, and host `operator-x.fieldtest.com` → slug `operator-x`. The "e.g. operator-x.com" in the plan is probably just an example of what a base domain looks like, not the actual value used in tests.

For the test spec, what matters is:
- A host that correctly maps to a registered tenant slug
- A host that doesn't map to any registered slug

Let me not get too deep into the parsing edge cases for this spec file since those are more about the middleware unit. The tenant-config spec should test the HTTP-level behavior.

Let me also think about what's "awkward":
- The error path that looks like success: e.g., a tenant exists but has null branding (should return {} or the null?)
- Actually the plan says branding is jsonb with no default specified... let me check. The schema says `branding | jsonb | arbitrary branding payload`. No default mentioned. So it could be null. The TenantConfigDto says `branding: Record<string, unknown>`. So the service should handle null → {}.

Let me finalize my list. I'll focus on what's specifically testable through the `GET /tenant-config` endpoint (since that's all this spec file covers per the plan), plus the middleware rejection paths that are exercised through it.

Test cases:

1. Returns branding and feature flags for the resolved tenant
2. Tenant mismatch (host says A, token org says B) → 403
3. Unknown tenant (host doesn't match any registered tenant) → 403
4. No authorization header → 401
5. Invalid token signature → 401
6. Token with no org claim → 403 tenant_mismatch (or some appropriate error)
7. Error envelope shape is correct (code, message, details always object)
8. Feature flags default to empty object when not set on tenant
9. Branding null is normalized to empty object (or returned as-is? need to check plan)
10. Host parsing boundary: host that is the bare base domain (no slug) → unknown_tenant

Wait, I should also consider: does the tenant-config endpoint have any customer-specific isolation to test? No — it's purely about resolving which tenant you are and returning their config. The cross-tenant isolation of data rows is in customer-isolation.spec.ts.

But one thing: the tenant-config endpoint proves that the ALS context is set correctly, because the service calls `requireTenant()` and then looks up by slug. If ALS isn't set, it would throw tenant_context_missing (500). So:

11. If somehow the context is missing (e.g., middleware didn't run) → 500 tenant_context_missing. This is a fail-closed guarantee. But in practice, the middleware always runs for all routes, so this might be hard to trigger through HTTP. Maybe skip or note it as a unit-level concern.

Actually, I think for an integration test hitting the HTTP endpoint, you can't easily get tenant_context_missing because the middleware always sets it before reaching the controller. Unless there's a route that bypasses the middleware. But the plan says it's applied to `'*'`. So this is more of a unit test concern for the guard. I'll skip it or mention it briefly.

Let me also think about: what if the tenant slug in ALS doesn't match any tenant row? The middleware already checks this (unknown_tenant), so by the time we reach the service, the tenant exists. So this path is already covered by case 3.

One more: the response for tenant-config should NOT include sensitive fields (like id, domain?) — actually looking at TenantConfigDto: `slug, name, branding, featureFlags`. So domain and id are not returned. That's fine, not really a test case unless we're testing that sensitive data isn't leaked.

Let me write up the final list.
```

## reply

- Returns branding and feature flags for a valid tenant — proves the full happy path: middleware resolves host→slug, verifies JWT org matches, sets ALS, service reads context, repo fetches the row, controller shapes the response. Fails if any link in that chain is broken: ALS not populated, service can't call `requireTenant()`, repo query misses, response omits or mis-shapes `branding`/`featureFlags`.

- Rejects when host slug and token org disagree (403 `tenant_mismatch`) — proves the middleware compares the two values and refuses to set context on a mismatch. Fails if the comparison is skipped, is case-insensitive where it should be exact, or compares the wrong fields (e.g. domain vs slug).

- Rejects when no host is present or host doesn't map to a registered tenant (403 `unknown_tenant`) — proves the middleware looks up the slug in the registry before proceeding and doesn't fall through to a 404 or let an unscoped request reach the service. Fails if `hostToTenantSlug` returns a slug for an unregistered tenant and the middleware doesn't check, or if the lookup error is swallowed.

- Rejects a request with no `Authorization` header (401 `unauthorized`) — proves the middleware requires a bearer token and does not attempt tenant resolution without one. Fails if the middleware skips JWT verification when the header is absent and proceeds to compare `undefined` org against the slug (which would give a misleading 403 instead of 401).

- Rejects a bearer token with an invalid or tampered signature (401 `unauthorized`) — proves the middleware actually calls `jwt.verify` and treats a thrown `JsonWebTokenError`/`TokenExpiredError` as 401 rather than a 500. Fails if the error is uncaught and bubbles to the default NestJS handler (500 with no envelope) or if the middleware catches it and re-throws as `tenant_mismatch`.

- Rejects a validly-signed token whose payload has no `org` claim (403 `tenant_mismatch`) — proves the middleware treats a missing claim as "does not match the resolved slug" rather than crashing or silently allowing the request. Fails if `payload.org` is `undefined` and the comparison `undefined === slug` is somehow bypassed (e.g. by an early-return when `org` is falsy), letting an unscoped request through.

- Every error response uses the single envelope `{ error: { code, message, details } }` with `details` always an object (possibly `{}`), never null or absent — proves the global `HttpExceptionFilter` is registered and intercepts `AppException`s raised by the middleware. Fails if the filter isn't wired in `main.ts`, or if a particular error path (e.g. the 401 from JWT) throws a raw NestJS `HttpException` that the filter doesn't re-shape, leaking a non-envelope body.

- Feature flags default to an empty object when the tenant row stores `null` or the column was never set — proves the service normalises a null/absent `featureFlags` jsonb to `{}` before returning it. Fails if the service passes `null` straight through to the response and the client receives `"featureFlags": null`, violating the `Record<string, boolean>` contract.

- Branding is returned as a JSON object matching what was stored on the tenant row — proves no serialization layer (e.g. double-stringify, key transformation) corrupts the payload between Prisma and the response body. Fails if `JSON.stringify` is applied twice or if the service maps keys, so a stored `{ "logo": "/x.png" }` arrives as the string `"{\"logo\":\"/x.png\"}"`.

- Host that equals the bare base domain (no subdomain prefix) is treated as unknown tenant, not as slug = "" — proves `hostToTenantSlug` returns `undefined` for the base domain itself rather than an empty string, so the middleware raises 403 instead of looking up a phantom tenant with slug `""`. Fails if the string split produces an empty first segment that is then looked up and (if a row existed with slug `""`) silently resolves.

- Not testing cross-tenant data isolation (list/fetch/update/delete of another tenant's rows), duplicate-email registration, or concurrent-request context leakage — those are the responsibility of `test/customer-isolation.spec.ts`, which exercises the Prisma guard and repository layer through the customer endpoints.
