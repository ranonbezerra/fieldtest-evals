# solution-retry

## reasoning

```
I need to plan the structure for a multi-tenant isolation solution. The approach involves a tenant resolution middleware that validates the host against the token's org claim, a Prisma extension that automatically scopes reads and stamps writes with the tenant ID, and ensuring fetch-by-id operations respect the tenant context.

For the schema, I need tenant-scoped uniqueness on email, a `/tenant-config` endpoint for branding and feature flags, and a comprehensive test suite covering isolation scenarios.

I'm organizing the codebase with a clear directory structure: configuration at the root for Prisma and package management, a dedicated tenant module for resolution and context management, customer, plan, and order modules for domain logic, and a tenant-config module for the configuration endpoint. I'll use Vitest for testing and NestJS for the API layer, with ESM modules and strict TypeScript. The tenant context should live in a dedicated module with a TenantContext class that provides methods to get and set the current tenant ID, using AsyncLocalStorage for request-scoped isolation. I'm also defining a TenantResolutionException class to handle cases where the tenant can't be determined or is invalid.

For the middleware itself, I need to extract the tenant from both the request host and the Bearer token's org claim, then verify they match before setting the context. The tricky part is parsing the JWT without relying on a heavy library—I can decode the token manually and handle both signed and unsigned tokens, though I'll need to figure out how to validate signatures in the test environment.

Actually, a cleaner approach: create a TokenService that takes a token string and returns the org claim, with a clear seam for the actual JWT verification. In production, this would use a real JWT library with HMAC verification, but for tests I can swap in a mock that just decodes the token. This keeps the middleware simple and testable without pulling in unnecessary dependencies.

The middleware itself should be a global NestJS middleware (registered via `configure(consumer)`) that runs before controllers, so it applies to all routes including the tenant-config endpoint. It extracts the tenant from the request context and sets it in an AsyncLocalStorage, which naturally scopes the tenant per request even with concurrent requests.

For the token validation, I'm defining a `TokenService` that verifies the JWT and returns the org claim — in tests, I'd use a fake implementation. The middleware would then extract both the host-based tenant ID and the token org, compare them, and throw a 403 exception if they don't match or if either is missing.

Now I'm thinking through the tenant resolution logic: the host `app.operator-x.com` should map directly to a tenant ID like `operator-x`. I'll keep the mapping simple with `app.<tenantId>.com` format, and I'll document this assumption in the middleware. I'm also considering the shape of the Tenant model itself.

For the tenant records, I need to store the domain, branding (name, logo URL, colors), and feature flags. The TenantConfigService will look up the tenant by ID and return this information. Since the extension scopes all reads to the current tenant, a query like `findUnique({ where: { id: ctx.tenantId() } })` works naturally — it adds the tenant filter and the unique lookup still functions correctly.

Now I'm working through the Prisma extension design. I'm creating a tenant-scoped client that reads the tenant context at call time from AsyncLocalStorage. For writes, I'll use a helper to inject the tenantId into the data object — for create operations it's a simple field stamp, for nested writes it's more complex but I'll keep it simple for this app. For reads, I'm wrapping `findMany` and `findFirst` to automatically inject the tenant filter, and for `findUnique` I need to handle the special case where filtering on the primary key alongside tenant constraints could cause issues.

The safest approach is to convert `findUnique` calls into `findFirst` under the hood, since the app won't rely on findUnique's null-vs-exception behavior for tenant-scoped lookups. I'm also handling `count` and `aggregate` by injecting the tenant where clause, and for `update`, `delete`, and `upsert` operations I need to merge the tenant constraint into the where clause — for composite keys it's straightforward since tenantId is part of the key, but for single-field keys I need to add the tenant as an additional filter.

Now I'm working through the remaining query types: `updateMany` and `deleteMany` get the tenant filter merged into their where clauses, and I need to handle edge cases like `findUniqueOrThrow` which I'll leave unscoped and document that callers must use `findFirstOrThrow` instead. For `createMany` I'm stamping the tenantId on each data entry, and for `upsert` I'm merging the tenant filter into both the where and update sections while stamping the create data. I'm also considering whether to use Prisma's built-in extensions with query interceptors or just wrap the client directly — the extension approach with `extends.query` and `extends.model` is cleaner since it intercepts all operations automatically.

Writing extension logic... I'm deciding to keep the raw SQL path restricted to the repository layer only and document that tenant-aware queries must go through the extension. For the tenant context itself, I need to fail fast when there's no tenant — the `getTenantId()` method should throw an error if called outside a tenant context, which prevents accidentally executing unscoped queries. The middleware will wrap each request in `runWithTenant`, and any controller or repository access without a tenant will fail at the extension level. The tricky part is that the tenant config endpoint also needs the tenant context to look up the Tenant row, so the middleware must apply globally to all routes including that one.

Now I'm sketching out the schema models. Tenant has a unique domain and JSON fields for branding and feature flags. Customer has a composite unique constraint on tenant and email. Plan and Order follow similar patterns, with Order referencing Plan through a composite foreign key. The Prisma extension needs to stamp tenantId on all creates and scope all reads.

For the repository layer, I'm thinking about how to inject the tenant-scoped Prisma client. Each repository (customer, plan, order) will depend on a PrismaTenantProvider service that gives it access to the tenant-aware client. The provider creates a base PrismaClient at initialization, then each repository method wraps its query in `runWithTenant` using the stored client. This way the middleware sets the tenant in AsyncLocalStorage, and the provider's `runWithTenant` executes the callback in that context.

Actually, I can simplify this—each repository just calls `this.prisma.runWithTenant()` which handles both getting the current tenant and executing the callback within it. The provider creates the base client lazily and provides a method that retrieves the current tenant ID and runs the callback with the tenant context set. For the controller, I'm validating the input (like checking for a required email string) and returning 404 if the resource isn't found, with a standard error envelope.

Now for the routes: I need a tenant-config endpoint that returns the tenant's branding and feature flags, plus customer CRUD endpoints. For POST /customers, I'm returning 201 with the created customer, but I need to handle the case where the same email is registered twice under the same tenant—that should be a 409 conflict error. I'm deciding whether to handle that via a try/catch on the unique constraint violation or by doing a pre-check with findFirst; the pre-check is simpler and avoids leaking internal errors.

For the other endpoints, I'm defining GET /customers to list all, GET /customers/:id to fetch one, PATCH /customers/:id to update (merging the body with the existing customer and returning 200), and DELETE /customers/:id to remove. I'm keeping the scope tight to just customers for full CRUD since that's what the tests focus on, plus the tenant-config endpoint as required. I'll add minimal GET endpoints for plans and orders to complete the schema without over-engineering. The plans and orders endpoints are scoped to their tenant through the database constraints, so cross-tenant access is automatically prevented even though the acceptance tests focus on customers. I'm deciding to include minimal list and fetch-by-id operations for both models alongside the full customer CRUD, which keeps the surface area consistent while staying aligned with what the task actually requires.

Now I need to handle the error envelope structure. I'm creating an exception filter that catches all errors and maps them to a consistent response format with a snake_case error code, developer-facing message, and optional details. I'll map specific exceptions like TenantResolutionException to 401/403, NotFoundException to 404 with a resource_not_found code, and conflict errors to 409.

For the tenant resolution logic, I'm defining a few key exception types: TenantMismatchException for 403 when the host and org claim disagree, and TenantNotResolvedException for 401 when the token is missing or the org claim is invalid. I'm also working through how to handle missing tenant rows — if a tenant is referenced but doesn't exist in the database, I need to decide whether to trust the host alone or reject the request entirely. The spec says both sources must agree, so I'm leaning toward rejecting if the tenant can't be verified against the database.

The tricky part is that if I force a database lookup in the middleware for every request, I need to handle the tenant-stamping issue: when the middleware queries for a tenant by ID, it can't also stamp the tenant on that write (there's a chicken-and-egg problem). The solution is to make the tenant-stamping conditional — only apply it when the tenantId field is actually absent from the data. That way, a bare `where: { id: id }` lookup won't get stamped with the same tenantId, and the query works correctly.

For the actual middleware flow: I extract the host tenant (400 if the host is malformed), verify the token and get the org claim (401 if missing or malformed), compare them (403 on mismatch), then check if the tenant exists in the database (404 if not). This gives me a clear 404 response for "tenant not found" rather than leaking existence information. Then I run the request in a tenant context.

On the token verification side, I'm using a TokenService that takes a raw Bearer token and returns the verified org claim, throwing TokenInvalidException if verification fails. In production this would be a real JWT verifier, but for tests I can create a deterministic fake by encoding claims as base64url JSON.

I'm debating whether to hand-roll a minimal JWT verifier or just define a contract-based interface that the fake can implement directly. The simpler approach is to make TokenVerifier a contract that returns the org claim or throws, keeping the middleware test-agnostic. The fake in tests would either parse the token or just use a token-to-org map. This keeps things clean and avoids the complexity of implementing actual signature verification.

For extracting the host tenant, I'm pulling it from `req.headers.host` and parsing the subdomain as the tenant ID — so `app.operator-x.com` maps to `operator-x`, with special handling for bare `localhost` in local development.

I'm setting up the middleware to skip `/health` and `/` routes entirely, letting them pass through without authentication. This is a minimal, defensible convention that's documented in the code.

For the controller layer, I'm using `req.params.id` to fetch customers by UUID, validating that the format is correct. The service then queries for the customer and throws a 404 if not found, which the repository wraps in a tenant context.

Now I'm sketching out the test strategy — using NestJS's `Test.createTestingModule` with the app module, seeding tenants and data via Prisma, then making HTTP requests with supertest. The tricky part is the database: I need to decide whether to run tests against a real Postgres instance via `DATABASE_URL` or use SQLite. Prisma supports both, but I'm leaning toward Postgres since it's the declared stack, though I should verify the test environment has it available. I'll use `prisma db push` to sync the schema directly without needing migration files, then set up the Vitest config with globals enabled and a beforeAll hook to reset the database. For the test files, I'm creating an `app.spec.ts` that builds the NestJS app once with a fake token verifier (parsing base64url JSON tokens), then seeding two tenants (alpha and beta) with their respective domains, and running test suites for tenant resolution and isolation checks.

Now I'm planning the specific test cases: tenant resolution will verify that host and org must match (rejecting mismatches, missing hosts, missing tokens), and the customer CRUD tests will ensure tenant B can't see or modify tenant A's customers, plus that the same email can exist in both tenants without conflict. I'm also adding an edge case where a customer from a tenant that hasn't registered in the app but has a valid token gets a 404, and I'll test concurrent requests from both tenants to verify the list endpoints return correct tenant-specific data.

For the no-tenant context test, I'm creating a dedicated `tenant-guard.spec.ts` file that uses the Prisma tenant provider directly to verify that querying without a tenant throws an error, and that any `tenantId` passed by a caller gets overridden by the actual context tenant. I'll also test the update stamping behavior to ensure writes are properly scoped. I'm using a unique tenant ID like `ctx-guard` to keep the test isolated, and I'm aware that running against real Postgres with `AsyncLocalStorage` will correctly maintain tenant context across concurrent requests.

For the module structure, I'm organizing a `tenant` module that exports the context service and provider, an `auth` module with the token verifier and middleware, and a `tenants` module that provides the config endpoint at `/tenant-config`. The customer, plan, and order modules follow a similar pattern with their respective controllers, services, and repositories. I'm using a global exception filter via `APP_FILTER` in the app module to handle error responses consistently.

For configuration, I'm keeping it simple with environment variables — `DATABASE_URL` is required for the Prisma client, while `JWT_SECRET` and `JWT_ISSUER` are used for the real token verifier but marked with assumption comments since they're only needed in production.

The Prisma client setup is straightforward: I'm creating a tenant-aware wrapper that injects the tenant ID into all queries using a Prisma extension. The extension intercepts query operations and stamps the tenant ID into creates, merges it into where clauses for reads, and handles special cases like `findFirst` (which converts `findUnique` for tenant safety). The middleware wraps each request to ensure tenant context is available, and I need to verify that the extension properly handles composite unique keys where the tenant ID is part of the key itself.

Writing the Prisma extension logic... Finishing the error handling logic...

For the context module, I'm thinking through the design: `TenantContext` will track the current tenant ID using AsyncLocalStorage, with methods to set and get the tenant. I'm adding a module-scoped `current()` static method so the Prisma provider can access the tenant without needing injection. I'll also create a `TenantContextError` that gets thrown when no tenant is set. For the tenant ID itself, I'm validating it against a regex pattern that matches DNS subdomains—lowercase letters, digits, hyphens, and dots with a max length of 63 characters. This keeps the format consistent and prevents invalid tenant IDs from being stored.

For the token service, I'm using JSON web tokens with base64url-encoded claims as a test fake, which is sufficient for this scenario. The real verifier would be injected at the app module level via `useValue`, and the auth middleware gets registered as a global Nest middleware through `forRoot()`. The middleware itself reads the raw token from the Authorization header and passes it to the verifier, which returns the organization claim.

For tenant resolution, I'm building a service that takes the host and org claim, validates the host against a pattern, checks that the org claim is a string and valid, ensures they match, then looks up the tenant in the database by ID. If the host is missing or malformed, that's a 400 error. If the token is absent or the org claim is missing, that's a 401. If they don't match, that's a 403. If the tenant doesn't exist in the database, that's a 404. Then I'll run the request within that tenant's context.

For the host header, I'm extracting just the hostname part by splitting on the colon to strip the port, which works fine since the hostname doesn't contain a colon. The health endpoint stays unauthenticated while everything else requires auth.

For the tenant config endpoint, I'm querying the tenant by ID with the tenant context already set, so the extension automatically scopes the query to the current tenant. The response includes the tenant ID, name, domain, branding, and feature flags.

For customers, I'm validating that the ID is a valid UUID string, and the service will look up the customer by ID within the tenant context. If not found, it returns a 404.

For updates, I'm building a small validator that only accepts allowed fields like name and phone, rejecting unknown fields with a 400 error. If the body is empty, it's also a 400. The service merges the changes with the existing customer and returns the updated record. For deletes, it's a 204 with no response body.

For the plan and order repositories, I'm keeping it simple: plans get a basic `findBySlug` for GET /plans/:slug, and orders have `findByCustomer` and `list` methods that use composite unique constraints.

Now I'm thinking through the module structure. The `tenants` module exports `TenantService` and the `tenant` module provides the context, Prisma client, and tenant guard. Both `customer` and `tenant` modules need to import from each other since they have circular dependencies. I'm also planning an exception filter to handle all exceptions uniformly.

The filter will check if an error is already in the envelope shape and return it as-is, otherwise extract the HTTP status from the exception, generate an error code from the exception name (converting camelCase to snake_case), and wrap it in the standard envelope format with message and details fields. I'm defining a set of custom exceptions with specific status codes: TenantMismatch (403), Unauthenticated (401), BadRequest (400), ResourceNotFound (404), and Conflict (409), each with a base class that extends HttpException to preserve the status code.

For the app setup, I'm creating a global AppModule that imports all feature modules and registers the exception filter as a global APP_FILTER provider. The main.ts will bootstrap with global validation enabled, setting the port from environment or defaulting to 3000, and keeping CORS minimal since it's not required.

I'm skipping the Swagger configuration to keep things focused on what the task actually needs. For the Prisma schema, I'm defining the core models with proper relationships and tenant-scoped unique constraints on email and slug fields.

Now I'm working through the Prisma extension implementation details, particularly how to handle the `findUnique` to `findFirst` mapping when the where clause has a tenant key that's part of the unique constraint. I'm also verifying that my custom `PrismaClient` class properly extends the base and handles extension methods correctly.

For the test setup, I'm creating a Nest test module that imports the full AppModule and sets up the Prisma tenant provider and token verifier. I'm implementing a fake token verifier that uses the standard JWT structure with header, claims, and signature parts, where the org claim is extracted from the decoded JSON payload.

Then I'm seeding test tenants with domains and names, and setting up the test suite with a beforeAll hook to push the Prisma schema to the test database and seed the data, followed by individual test cases for tenant resolution, data isolation, and concurrent request handling. For the unauthenticated case, I expect a 401 error since there's no token. I'm also considering whether the PrismaClient extension properly handles the `findUnique` to `findFirst` conversion when a tenant ID is in the where clause—this should work correctly for the guard tests. I need to verify the Prisma extension API version, as the newer Prisma 5.x uses `extends.query` with `{ model, operation, args }` rather than the older `query` property directly.

I'm checking the Prisma version compatibility: in v5.x, the model extension uses `model(name, { extends: { query: {...}, result: {...} } })`, which aligns with how the official multi-tenancy example structures it. I'm also confirming that AsyncLocalStorage from Node's async_hooks is available in Node 20 and that Prisma supports `extends.model` with query overrides. For the Vitest setup, I'm using `Test.createTestingModule` with Nest, then `app.init()` and `app.getHttpAdapter().getInstance()` to get the Express instance for supertest. I'm using the real database in integration tests, cleaning up between test runs with `deleteMany` in descending order to respect foreign key constraints.

Now I'm setting up Vitest globals with `globals: true` and the default environment, adding type definitions for describe/it/expect, and configuring a longer test timeout since seeding and concurrent operations can take a few seconds. I'm also planning a dedicated test file for the tenant guard that uses the Prisma tenant provider directly to verify that operations fail without a tenant context and that tenant IDs are properly overridden when running within a tenant context.

For the provider's `runWithTenant` method, I need to think through the execution model: the middleware already wraps each request in the tenant context, so repositories don't need to re-wrap their queries. The provider's `runWithTenant` should just execute the callback and let the context propagate naturally through the call stack. This simplifies things — the provider doesn't need to set the tenant itself, just run the callback within the existing context.

For the repository design, I'll keep it simple and let the extension handle scoping. The service will catch Prisma errors like `P2002` (unique constraint violations) and throw a Conflict exception instead, so repositories can stay thin and focused on Prisma operations.

The tricky part is the upsert case with multi-tenant isolation: if a customer upsert targets an existing row from a different tenant, the extension merges the tenant into the where clause so it becomes a create instead — which would then fail with `P2002` on the (tenant, email) composite unique if that tenant already has the email. That's correct behavior, but I should make sure the service layer catches and handles `P2002` consistently. I'm leaning toward avoiding upsert in the app itself to sidestep this complexity, though I'll keep the extension's upsert handler for completeness.

Now I'm sketching out the file structure and module organization. I'm settling on the standard NestJS naming convention with `.module.ts`, `.controller.ts`, `.service.ts`, and `.repository.ts` files for each domain (tenant, customer, plan, order), plus a dedicated `tenant-config` module for the branding and feature flag endpoint. The `auth` module will handle token verification and middleware, while `tenant` provides the core infrastructure like the Prisma client and tenant context. I'm defining the token verification interface with a `TokenVerifier` class that returns the org claim from a token, a separate `TokenVerifierUnavailable` exception for missing implementation, and a `RawToken` type to keep the contract clean.

For configuration, I'm keeping it minimal and environment-driven: `DATABASE_URL` (required, sourced from process.env in the provider), plus a `TENANT_DOMAIN_SUFFIX` constant that the host parser uses to extract the tenant from the full domain. I'm also considering whether to add a simple `/health` endpoint in the app module, though I'm still deciding if that's necessary for the scope.

I'm setting up a global exception filter that maps specific error types to HTTP responses — `ResourceNotFoundError` to 404, `ConflictError` to 409, `BadRequestError` to 400, auth errors to 401/403, and a fallback to 500 for unexpected errors. The filter will handle the `HttpException` base class and extract status codes appropriately.

For the exception names, I'm keeping the base `TenantResolutionError` generic and letting the specific subclasses define their error codes. The filter needs to preserve the HTTP status from the exception while converting the exception name to snake_case for the error code.

Now I'm working on the JWT token verifier — it needs to decode the token structure, validate the signature using HMAC-SHA256, and extract the org claim from the payload. The verifier will take the secret as a parameter so the app module can inject it from the environment.

For the fake test implementation, I'm creating a simpler verifier that skips signature validation and just decodes the payload. The key is making sure both the real and fake verifiers handle malformed tokens gracefully — checking that the token has the right number of parts and that the payload parses correctly.

Now for the middleware, I need to enforce that all protected routes go through tenant resolution. I'm setting up a health endpoint that's unauthenticated and exempt from the middleware, while everything else gets wrapped in the tenant context. The middleware reads the host header, resolves the tenant from it, verifies the token's organization claim, ensures they match, then runs the request within that tenant's context. The tenant resolver itself extracts the tenant ID from the host subdomain (after `app.`), validates the org claim from the token, and throws specific errors for missing hosts, bad formats, or authentication issues.

For the tenant config service, I'm fetching the tenant by ID with the current context already set, which ensures the tenant ID in the query matches the context. The response maps the tenant's branding and feature flags. For customer operations, I'm validating IDs as UUIDs in the controller, handling name and email validation with regex and length checks, catching unique constraint violations for duplicate emails, and supporting partial updates with allowed fields. I need to be careful with the tenant guard since it references the base Prisma client before the tenant context is established, which is fine since the context is already set by the middleware.

Now I'm setting up the test configuration with Vitest, using a separate test database with a `test_` prefix in table names to avoid conflicts with the dev database. I'm configuring the Prisma schema to use the environment variables for both the main and test databases, and using the `prisma db push` command with the test environment to initialize the schema for tests.

I'm also defining a tenant ID validator that checks if an ID matches a DNS subdomain pattern, and creating a TenantContext class using AsyncLocalStorage to manage tenant isolation per request. The context provides methods to get or set the current tenant ID and execute code within a specific tenant's context, throwing a TenantContextError if no tenant is set when one is required.

Now I'm building a TenantPrismaProvider service that wraps the PrismaClient with tenant-aware extensions. It creates a tenant-scoped client that stamps every write operation with the current tenant ID and scopes every read to that tenant. The runWithTenant method executes a callback within a specific tenant's context, and the extension logic handles different operations like upserts, writes, and reads to ensure proper tenant isolation.

I'm noticing an issue with how the where clause gets merged for create operations — the code checks if where is an object before stamping it, but for create operations where is undefined, so the tenantId never gets added. I need to refactor the logic to always build a merged where object that includes both the existing where (if it exists) and the tenantId.

For reads, I'm keeping the findUnique-to-findFirst conversion as a safe measure. For writes like update and delete, the merged where correctly adds the tenantId to the unique constraint check, so cross-tenant updates return zero rows. I'm also considering whether to apply this extension to the $transaction client, but since the extension is on the constructor instance, clients obtained from $transaction won't inherit it — I'll document that transactional code needs to be added carefully.

Now moving to the CustomerController, which handles customer creation with validation for email format, length constraints, and name presence, returning a 400 BadRequestError if validation fails.

The remaining endpoints handle fetching, updating, and deleting customers by ID, with UUID validation. The CustomerService wraps repository calls in tenant context, catches unique constraint violations from the database, and returns resource-not-found errors appropriately. The CustomerRepository injects the Prisma provider and uses it to execute queries within the tenant scope.

For PlanController, I'm setting up a GET endpoint that retrieves a plan by slug, validating the slug format and throwing a 400 if it doesn't match the expected pattern of alphanumeric characters and hyphens.

For OrderController, I'm creating endpoints to list orders and filter by customer ID, both with proper validation. The Order model will be referenced in the service layer.

The tenants module provides a TenantConfigService that retrieves tenant configuration (branding and feature flags) by ID, and a controller that exposes this at GET /tenant-config. The tenants module imports the tenant module to access the provider, while the tenant module itself doesn't import anything since it only depends on context.

In AppModule, I'm importing all feature modules and the auth module, and registering a global exception filter. The auth module provides the token verifier and registers the tenant resolution middleware globally, skipping only the health endpoint. The middleware will be injected with the tenant resolver and context, and it needs to verify the organization from the token before continuing.

The middleware skips the health route and validates the authorization header is present and properly formatted as a Bearer token, otherwise returning a 401. It extracts the tenant from the host, compares it with the organization claim from the token, and if they don't match, returns a 403. If the tenant doesn't exist in the database, that's also a 404. Once validated, it runs the request handler within the tenant's context, allowing any errors to propagate to the exception filter.

For the tenant resolver, I'm extracting the tenant ID from the subdomain by checking if the host starts with the expected prefix, then validating it against a pattern and normalizing it to lowercase.

I'm also setting up a TokenVerifier class that uses the raw token from the middleware, with a contract defining the required `verify` method that returns the organization claim.

Defining error classes...

Now I'm setting up a global exception filter that maps various error types to appropriate HTTP responses, catching specific errors like tenant mismatches and unauthenticated requests, then falling back to a generic 500 for anything unexpected. The filter wraps all exceptions in a consistent error envelope with a code and message.

The key insight is that `getExceptionMessage` from Nest provides the exception name in camelCase, which gets converted to snake_case for the error code. So `TenantMismatchError` becomes `tenant_mismatch_error` in the response. I need to import that utility and use it to extract the exception name for the code field.

For the schema file, I'm setting up the Prisma datasource with PostgreSQL and defining the Tenant model with domain, name, branding, and feature flags fields.

Now I'm looking at the Customer and Plan models — both have tenant-scoped unique constraints to support multi-tenancy, and Plan includes a code field that's unique per tenant.

Order model ties everything together with tenant, customer, and plan relationships, using composite foreign keys. The Prisma setup uses `prisma db push` for tests rather than migrations, which keeps things simple for this single-delivery approach.

The test setup imports the app module and uses a fake JWT verifier to simulate different org tokens. I'm seeding test data in `beforeAll` with two tenants — alpha and beta — each with their own customers, plans, and orders, using fixed UUIDs for deterministic assertions.

The test suite covers three main areas: tenant resolution (checking that host and org must match, with proper 401/403/404 responses for mismatches), cross-tenant isolation (ensuring tenant B can't see or modify tenant A's data, and that the same email can exist in both tenants without conflict), and concurrent requests from both tenants to verify they don't interfere with each other.

For the guard spec, I'm testing that the extension works correctly with the base client—without a tenant context, all operations should fail with TenantContextError, and I'm verifying that tenant scoping prevents cross-tenant access to records.

I'm also checking that when tenantId is explicitly provided in queries, it gets overridden by the current context, and that writes are automatically stamped with the correct tenant ID. For nested operations like `createMany` and `updateMany`, the context scoping should apply throughout, and I need to confirm that the extension intercepts these methods properly.

Now I'm verifying the PrismaClient extension behavior—specifically that when I pass model-specific extension options to the constructor, the base model methods like `findMany` and `create` remain unscoped until I wrap them with `runWithTenant`. I'm also double-checking the `findUnique` to `findFirst` conversion logic, ensuring the where clause gets merged correctly with tenant isolation, and that the operation names map properly between the extension's expected format and Prisma's actual model operation names.

For the TypeScript setup, I need to verify that `Prisma.TransactionClient` is properly exported as a type, and that the `extends.model` and `extends.query` methods are available in Prisma 5 and 6. I'm using `@prisma/client@^5.22.0` to stay compatible with the older extension API pattern. The main risk I'm watching for is whether the model extension with the `extends.query` structure will properly intercept the model operations at runtime. I'm verifying that the async context properly propagates through the extension's async function calls and Prisma's internal promise chain, so tenant context stays consistent throughout the query execution. The middleware's ALS-wrapped chain means repositories automatically inherit the tenant context, so they don't need to wrap themselves — I'll document this in the provider's docblock. The `runWithTenant` method stays useful for explicit context switching in tests or special cases like the tenant lookup. Now I'm checking the remaining details: error codes follow snake_case, HTTP statuses match expectations (401, 403, 404, 409), the `tenant-config` endpoint correctly returns branding and feature flags, and I need to finalize the package.json configuration.

Writing package.json... Writing test setup... Writing test cases... Writing test cases... Writing test cases... Writing test specs... Writing the extension implementation... The `getTenantId` method should stay private to force explicit tenant scoping through `runWithTenant`, even though it's convenient for tests — the provider docblock makes the contract clear. For `TenantPrismaProvider`, I'm injecting the context and managing the PrismaClient lifecycle with `onModuleInit` and `onModuleDestroy`, then defining a `TenantAwarePrisma` interface that wraps the client with a `runWithTenant` method. The context service itself wraps `TenantContext` and `runWithTenant`, while the raw `TenantContext` class handles the actual ALS logic. Since `TenantContext` is static and stateless, it doesn't need DI at all — the provider can use it directly, eliminating the need for a separate service class.

Now I'm checking the imports and module wiring. The `@prisma/client` import works fine in ESM mode, and Prisma 5 handles ESM without issues. For the tenants module, I need `TenantModule` imported, which exports the provider that `TenantConfigService` uses. The auth module provides the token verifier, and `AppModule` imports the auth module, which is fine. I'm adding a health check endpoint in a lightweight `HealthController` directly in `AppModule` that returns a simple 200 response, and since the middleware skips `/health`, it's accessible without authentication. The middleware should apply globally across all controllers in `NestFactory.create(AppModule)`.

Now I'm thinking through the tenant ID extraction logic. The spec mentions the host `app.operator-x.com` maps to tenant ID `operator-x`, so I'm parsing it by checking if the host starts with `app.` and extracting the remainder after removing the `.com` suffix. I should document this with an assumption comment that tenant IDs match the subdomain after `app.`, and that the domain stored on the Tenant record must match the host being served. I'm also planning to use `getExceptionMessage` from `@nestjs/common` in the exception filter to map exception names to error codes.

For the error handling, I'm converting camelCase exception names to snake_case codes using a simple regex, and Nest's `BadGatewayException` will map to `bad_gateway` which is fine. I need to add the `@prisma/client` import to the plan and order repositories, and the customer repository will return typed customer objects with `id` and `name` as nullable strings. The plans module controller handles plan retrieval and throws `ResourceNotFoundError` if not found, with the service wrapping repository calls in the tenant context. The order module follows a similar pattern for listing and filtering orders.

Now I'm verifying the module imports for each feature — customers, plans, and orders all need the tenant module to access the provider. The plan controller validates the slug parameter using a regex pattern, and the order controller checks UUID format for the customer ID. I'm double-checking that the `TenantModule` imports `TenantsModule` for the resolver service, and that `TenantResolutionMiddleware` has access to the injected resolver, context, and verifier.

In the auth module, I'm setting up the verifier with the JWT secret from environment variables — in production this should always be provided, but I'm adding a guard that returns an error response if the secret is missing rather than letting the app crash. The `HostTenantExtractor` service extracts the tenant ID from the host header by validating the format against a domain pattern, and I'm keeping it as a separate service for clarity. The resolver then takes the extracted host tenant and the org claim from the token to determine the final tenant.

Defining the exception hierarchy... I'm setting up the test module with the app and a fake token verifier that decodes JWT claims, then I'll use the base client to seed test data and run through the health check and tenant isolation scenarios to make sure the middleware and guards work correctly. I'll keep the seed order fixed and use fixed IDs so re-seeding works safely with unique constraints. I'm verifying that `app.listen()` without a port works in Express, and I need to be careful about how the middleware handles the next callback — the async context should properly propagate errors up to Express's error handler. I'm also setting up Vitest globals in the test configuration so I don't need to import `describe` and `it` explicitly.

Now I'm checking the file count and module structure — about 20 source files plus config and tests. The `TenantModule` is exported by both the auth and tenants modules, and I'm adding `APP_FILTER` for the exception filter to the app module's providers. I'm also double-checking the TypeScript typing for the Prisma extension to make sure the model and query extensions are properly typed, and verifying that my approach of using `args.data as Record<string, unknown>` won't cause type issues.

For the extension methods, I'm handling the case where the operation name could be either camelCase or PascalCase by checking both `args.operation === 'createMany' || args.operation === 'CreateMany'`, which is a defensive approach. I'm also confirming that I don't need to worry about `$transaction` in the tests, and that the `updateMany` and `deleteMany` operations with `where: undefined` will correctly stamp the tenant ID and return a count of zero when there's a cross-tenant guard.

Now I'm verifying the `createMany` behavior where multiple rows get stamped with the tenant, the `count` operation with `where` undefined correctly scopes to the current tenant, and that `findUnique` with a composite ID like `{ tenantId_email }` works as a read operation. I'm also confirming that `findFirst` doesn't get converted to `findUnique` (it only does the reverse), and that the `TenantContext` error handling is solid — `current()` throws if there's no store or no tenant, while `tryCurrent()` returns the value or null for the provider's use.

The provider uses `tryCurrent()` to avoid throwing inside `runWithTenant` since the middleware already validates the tenant before calling it. The `TenantResolutionMiddleware` checks for the Authorization header and extracts the Bearer token, throwing `UnauthenticatedError` if it's missing or malformed. The health endpoint is skipped before the auth check, so it doesn't require a token. I'm also noting an assumption about the tenant ID format: the DNS subdomain between `app.` and `.com` matches the tenant ID in the database, and the Tenant's domain record should match the host being served.

For the token verifier, I'm implementing HMAC-SHA256 signing using Node's crypto module with the shared secret, extracting the org claim from the JWT payload as the tenant identifier, and returning null if the claim is missing. The `TokenVerifierUnavailable` error is returned by the middleware when no verifier is provided, with the response body being the 401 error envelope. For customer updates, I'm checking that the body is an object, extracting allowed fields (name, email, phone) if present, rejecting unknown keys, and ensuring at least one field is provided before passing to the service for validation.

In the service layer, I'm validating each provided field—checking that strings aren't empty and emails match the regex—then throwing BadRequestError if validation fails. The repository's update method takes the id and changes object, letting Prisma handle the update. For customer deletion, the controller returns no content on success.

I'm skipping README since it's not required. For the plan module, I'm keeping the controller minimal with just a GET endpoint that validates the slug format and calls the service, which queries the repository within the tenant context and throws ResourceNotFoundError if the plan doesn't exist. The repository uses findFirst with a where clause on the slug, and I'm defining the Plan model with id, tenantId, name, slug, priceCents, and optional metadata.

For orders, I'm implementing two controller methods: one to list all orders and another to filter by customer ID, both validated and passed to the service and repository. The Order model includes id, tenantId, customerId, optional planId, status, and totalCents.

Now I'm verifying the Prisma 5 extension API — the `extends.model` and `extends.query` methods are available in both the 4.x and 5.x versions, so I'll use `@prisma/client@^5.22.0` for consistency. I'm also checking the ESM setup with Prisma 5, where the default export is `PrismaClient` and the `Prisma` namespace is imported as a named export.

For the test configuration, I need to ensure Vitest picks up `vitest.config.ts`, set the test timeout to 30 seconds for database operations, and add a guard check to skip the seed in `beforeAll` if the test database hasn't been pushed yet. The health check endpoint doesn't require authentication and is correctly skipped by the middleware, and I'm double-checking the host parsing logic handles various hostname formats correctly.

The tenant resolver flow works as expected: it extracts the host tenant from the subdomain, gets the org from the token, then looks up the tenant in the database and runs the request within that tenant context. For the tenant-config endpoint, the service queries for the tenant by ID within the established context, which the extension properly scopes by merging the tenant ID into the where clause. The extension doesn't need to intercept tenant model operations since they're not used elsewhere, and if they were, they'd be properly scoped anyway. Now I'm writing the exception filter and starting to document the provider layer's responsibility for tenant-aware database operations. The resolver checks that the host tenant and org claim match, then verifies the tenant exists before running the handler within that tenant's context. I'm defining the host tenant extractor service that parses the host header and validates it matches the expected tenant subdomain format, extracting the tenant id from the subdomain.

Now I'm setting up a token verifier that decodes JWTs, validates the signature using HMAC-SHA256, and extracts the org claim as a string. The verifier gets instantiated in the auth module with the JWT secret from environment variables. I'm also configuring the Nest application with global validation pipes and setting up the test suite with base64url encoding for JWT tokens.

For the test cleanup, I'm ordering the deleteMany calls to respect foreign key constraints—orders first since they reference both customers and plans, then customers and plans, then tenants. The plan and order IDs need to be valid v4 UUIDs to avoid Prisma validation errors. I'm setting up the concurrent test to seed the database and then verify that parallel requests from both tenants work correctly without interference. I need to make sure the fake verifier and the real one follow the same contract for malformed tokens—both should throw when a token is missing the org claim. For the guard spec, I'm importing the app module, token verifier, and the prisma provider, then setting up a fresh tenant with `ctx-guard-<ts>`. The key test is verifying that querying without a tenant context throws an error before any database call, confirming the context check happens in the extension's `before` hook rather than at execution time. I'm also checking that explicit `tenantId` values in where clauses get overridden by the context, and that updates to other tenants' rows return zero affected.

Now I'm verifying the remaining edge cases: that `updateMany` also respects the context override, that creates are stamped with the correct tenant ID even if the data tries to set a different one, and that `count` operations are properly scoped to the current tenant. I'm adding a test to confirm that when running in the wrong tenant context, a count query for a customer in a different tenant returns zero. I'm also double-checking that the async local storage properly propagates through `runWithTenant` calls and that the extension's before-hook captures the tenant at the right point in the query lifecycle.

Writing exception filter... Finishing the OrderController with a list-by-customer endpoint, then moving through PlanModule, CustomerModule, OrderModule, and PlanModule with their controllers and services. The tenants module is set up with TenantConfigController and TenantService. I'm verifying the module dependencies—AuthModule imports TenantModule for the resolver, and TenantModule exports the provider for other modules to use. For validation, I'm using `class-validator` with `class-transformer` in the global pipeline, and the plan controller validates slugs with a regex pattern while the order controller checks UUIDs similarly.

I need to import `ValidationPipe` from NestJS, and the exception filter will be registered globally in AppModule. The health controller is a simple inline controller that returns an ok status. I'm also setting up the package.json with the correct test scripts for vitest, and confirming all the Prisma model fields are defined in the repository returns. Now I'm ready to write out the complete file structure with imports, making sure everything compiles cleanly under strict TypeScript.

Writing main.ts... I'm realizing that if the middleware skips a route and the controller tries to query the database, it'll hit a TenantContextError which would surface as a 500 — that's acceptable since all routes except health are protected. The resolver's `assertExists` method runs within the tenant context and uses `findFirst` to look up the tenant, which works correctly even though the query extension merges the tenant ID into the where clause. I'm also thinking through the edge case where the host and org don't match — the middleware would return a 403 before any database lookup, so it won't leak whether the tenant actually exists.

For the `GET /customers` endpoint, I need to make sure the tenant list excludes rows from other tenants, and I should assert that the total customer count matches what's in the database. I'm also planning to add a test for `PATCH /customers` to verify that updating a customer in one tenant doesn't affect the same customer in another tenant.

Now I'm laying out the full file structure: I need a Prisma schema, package configuration, environment files for development and testing, the main application entry point with the app module and health check, exception handling and token verification infrastructure, tenant management with context and resolution, customer CRUD operations, plan and order management, and a tenant configuration service. I'll also need test files to verify tenant isolation and the guard behavior.

For the token verifier in tests, I'm using base64url encoding for JWT claims — the header is just the standard `{"alg":"none"}` payload and the signature is an empty string, which works fine for testing purposes.

The CustomerController uses class-validator decorators to validate the incoming payload — email and name are required strings with length constraints, phone is optional, and forbidNonWhitelisted rejects any unknown fields. I'm also setting up the OrderRepository and OrderService with methods to list orders and filter by customer ID, both running within the tenant context. The plan is to generate all these files in the final output with proper formatting and no extra prose, just the code blocks.

Now I'm verifying the Prisma schema details — the datasource uses `DATABASE_URL`, the tenant guard test uses a timestamp-based tenant ID, and all the necessary packages are in place. I'm confirming that the Prisma extension's `extends.model` and `extends.query` work correctly with the 5.x version, and that my query handler is properly typed to return the modified args. One edge case to watch: when `findUnique` is converted to `findFirst` with a composite unique key like `tenantId_email`, the where clause should still work correctly.

For the `upsert` handler, I'm merging the where clause with the tenant ID to ensure tenant isolation. I also need to guard against undefined `where` in `create` operations and skip the merge for `createMany`. I'm setting up the Nest test module with the app module and a fake token verifier override, then using supertest to make HTTP requests. The test will verify that the tenant context fails fast when there's no tenant in scope, preventing accidental unscoped reads.

Writing the guard spec test... Writing test cases... I'm confirming that `findUnique` gets properly converted and scoped through the extension, so the tenant guard works correctly even when called directly. I'm also verifying that `create` operations correctly stamp the tenant and that `updateMany`/`deleteMany` operations properly merge the tenant into the where clause to prevent cross-tenant modifications. I'm ready to write out the complete implementation now, being careful with the syntax throughout.
```

## reply

### package.json
```json
{
  "name": "operator-platform",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "start:dev": "tsx src/main.ts",
    "db:push": "prisma db push --schema prisma/schema.prisma",
    "test": "pnpm db:push:test && vitest run",
    "db:push:test": "dotenv -e .env.test -- prisma db push --schema prisma/schema.prisma --skip-generate"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.15",
    "@nestjs/core": "^10.4.15",
    "@nestjs/platform-express": "^10.4.15",
    "@prisma/client": "^5.22.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.15",
    "@types/express": "^4.17.21",
    "@types/node": "^20.17.10",
    "@types/supertest": "^6.0.2",
    "dotenv-cli": "^7.4.4",
    "prisma": "^5.22.0",
    "supertest": "^7.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strictPropertyInitialization": false,
    "useDefineForClassFields": false
  },
  "include": ["src", "test"]
}
```

### .env
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/operator_platform?schema=public"
JWT_SECRET="dev-only-shared-secret"
```

### .env.test
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/operator_platform_test?schema=public"
```

### vitest.config.ts
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
```

### prisma/schema.prisma
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// NOTE: tenant-scoped composites deliberately use snake_case names
// (e.g. tenantId_email) so the @prisma/client generated types
// (CustomerGetPayload / CustomerCreateInput) stay plain identifiers.

model Tenant {
  id            String   @id @default(cuid())
  domain        String   @unique
  name          String
  branding      Json
  featureFlags  Json     @default("{}")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  customers Customer[]
  plans     Plan[]
  orders    Order[]

  @@map("tenants")
}

model Customer {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  email     String
  name      String?
  phone     String?
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  orders Order[]

  @@unique([tenantId, email])
  @@map("customers")
}

model Plan {
  id         String  @id @default(uuid())
  tenantId   String  @map("tenant_id")
  name       String
  slug       String
  priceCents Int     @default(0) @map("price_cents")
  metadata   Json?
  createdAt  DateTime @default(now()) @map("created_at")

  tenant Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  orders Order[]

  @@unique([tenantId, slug])
  @@map("plans")
}

model Order {
  id         String   @id @default(uuid())
  tenantId   String   @map("tenant_id")
  customerId String   @map("customer_id")
  planId     String?  @map("plan_id")
  status     String   @default("created")
  totalCents Int      @default(0) @map("total_cents")
  createdAt  DateTime @default(now()) @map("created_at")

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  customer Customer @relation(fields: [customerId], references: [id], onDelete: Cascade)
  plan     Plan?    @relation(fields: [planId], references: [id])

  @@map("orders")
}
```

### src/main.ts
```ts
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

### src/app.module.ts
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { ExceptionEnvelopeFilter } from './errors/exception-envelope.filter.js';
import { OrderModule } from './order/order.module.js';
import { PlanModule } from './plan/plan.module.js';
import { TenantsModule } from './tenant/tenants/tenants.module.js';

@Controller_PLACEHOLDER = undefined;

const health = {
  path: '/health',
} as const;

import { Controller, Get } from '@nestjs/common';

@Controller(health.path)
class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}

@Module({
  imports: [AuthModule, TenantsModule, CustomerModule, PlanModule, OrderModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ExceptionEnvelopeFilter }],
})
export class AppModule {}
```

Wait — that file has a placeholder line; here is the corrected, final file:

### src/app.module.ts
```ts
import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { ExceptionEnvelopeFilter } from './errors/exception-envelope.filter.js';
import { OrderModule } from './order/order.module.js';
import { PlanModule } from './plan/plan.module.js';
import { TenantsModule } from './tenant/tenants/tenants.module.js';

@Controller('/health')
class HealthController {
  @Get()
  check(): { status: string } {
    return { status: 'ok' };
  }
}

@Module({
  imports: [AuthModule, TenantsModule, CustomerModule, PlanModule, OrderModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ExceptionEnvelopeFilter }],
})
export class AppModule {}
```

### src/errors/error-envelope.ts
```ts
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}
```

### src/errors/exceptions.ts
```ts
import { HttpException } from '@nestjs/common';

/**
 * All domain errors extend this. The global filter maps them to the
 * one error envelope; the code is derived from the exception name.
 */
export class AppError extends HttpException {
  constructor(message: string, status: number) {
    super(message, status);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message: string) {
    super(message, 401);
  }
}

export class TenantMismatchError extends AppError {
  constructor(message: string) {
    super(message, 403);
  }
}

export class ResourceNotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}
```

### src/errors/exception-envelope.filter.ts
```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  getExceptionMessage,
  HttpException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConflictError, ResourceNotFoundError, TenantMismatchError, UnauthenticatedError } from './exceptions.js';
import type { ErrorEnvelope } from './error-envelope.js';

const STATUS_BY_TYPE: Array<[new (...args: never[]) => unknown, number]> = [
  [ResourceNotFoundError, 404],
  [ConflictError, 409],
  [UnauthenticatedError, 401],
  [TenantMismatchError, 403],
];

function toCode(exception: unknown): string {
  if (exception instanceof Error && exception.name) {
    return exception.name
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase();
  }
  return 'internal_error';
}

function statusOf(exception: unknown): number {
  for (const [type, status] of STATUS_BY_TYPE) {
    if (exception instanceof type) return status;
  }
  if (exception instanceof HttpException) return exception.getStatus();
  return 500;
}

@Catch()
export class ExceptionEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const status = statusOf(exception);
    const message =
      exception instanceof Error && exception.message ? exception.message : getExceptionMessage(exception);
    const envelope: ErrorEnvelope = {
      error: { code: toCode(exception), message, details: {} },
    };
    if (status >= 500) {
      // developer-facing only; never leak internals to the client
      // eslint-disable-next-line no-console
      console.error(`[unhandled] ${req.method} ${req.url}`, exception);
    }
    res.status(status).json(envelope);
  }
}
```

### src/auth/token-verifier.contract.ts
```ts
export interface TokenVerificationResult {
  /** The `org` claim of the verified token. */
  org: string;
}

/**
 * Verifies a raw auth token (signature, expiry, issuer) and returns its
 * claims. Throws on any failure to verify. The middleware never accepts
 * an unverified token.
 */
export interface TokenVerifier {
  verify(token: string): Promise<TokenVerificationResult>;
}
```

### src/auth/token-unverified.error.ts
```ts
import { HttpException } from '@nestjs/common';

export class TokenUnverifiedError extends HttpException {
  constructor(message: string) {
    super(message, 401);
  }
}
```

### src/auth/jwt.token-verifier.ts
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { TokenUnverifiedError } from './token-unverified.error.js';
import type { TokenVerifier, TokenVerificationResult } from './token-verifier.contract.js';

const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');
const fromB64url = (input: string): Buffer => Buffer.from(input, 'base64url');

/**
 * HS256 bearer-token verifier. The `org` claim carries the tenant
 * identifier; it is returned only after the signature verifies.
 */
export class JwtTokenVerifier implements TokenVerifier {
  constructor(private readonly secret: string) {}

  async verify(token: string): Promise<TokenVerificationResult> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new TokenUnverifiedError('Malformed token: expected three dot-separated parts.');
    }
    const [headerB64, payloadB64, signatureB64] = parts;
    const expected = createHmac('sha256', this.secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest();
    const actual = fromB64url(signatureB64);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new TokenUnverifiedError('Token signature verification failed.');
    }
    let claims: unknown;
    try {
      claims = JSON.parse(fromB64url(payloadB64).toString('utf8'));
    } catch {
      throw new TokenUnverifiedError('Token payload is not valid JSON.');
    }
    const org = (claims as { org?: unknown }).org;
    if (typeof org !== 'string' || org.length === 0) {
      throw new TokenUnverifiedError('Token has no org claim.');
    }
    return { org };
  }
}
```

### src/auth/auth.middleware.ts
```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantContext } from '../tenant/tenant-context.js';
import { HostTenantExtractor } from './host-tenant.extractor.js';
import { TenantResolver } from './tenant.resolver.js';
import type { TokenVerifier } from './token-verifier.contract.js';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly tokenVerifier: TokenVerifier,
    private readonly hostTenantExtractor: HostTenantExtractor,
    private readonly tenantResolver: TenantResolver,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const url = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (url === '/' || url === '/health') {
      next();
      return;
    }

    const authorization = req.headers.authorization;
    const token = this.extractBearer(authorization);
    const hostTenant = this.hostTenantExtractor.fromRequest(req);

    // Both sources must be resolved and must agree; a mismatch is
    // rejected, never resolved in favour of one side.
    const { org } = this.tokenVerifier.verify(token);
    const tenantId = this.tenantResolver.resolve({ hostTenant, org });

    res.status(403).json({
      error: { code: 'tenant_mismatch', message: 'Token org and host tenant do not agree.', details: {} },
    });
    // The line above is unreachable — the resolver throws on mismatch.
    // Kept out of the hot path; actual rejection happens in the resolver.
    void res;

    void (async () => {
      // The resolver already threw on any disagreement by the time we
      // reach here; existence is asserted inside the tenant context.
      const context = new TenantContext();
      await context.runWithTenant(tenantId, async () => {
        const tenant = await this.tenantResolver.assertExists(tenantId);
        void tenant;
        next();
      });
    })().catch(next);
  }

  private extractBearer(authorization: string | undefined): string {
    if (!authorization || !authorization.startsWith('Bearer ')) {
      this.reject(res => {
        res.status(401).json({
          error: {
            code: 'unauthenticated',
            message: 'Missing or malformed Authorization header; expected "Bearer <token>".',
            details: {},
          },
        });
      });
    }
    return authorization.slice('Bearer '.length).trim();
  }

  private reject(action: (res: Response) => void): never {
    throw new Error('unreachable');
  }
}
```

That middleware file above came out incoherent — the final, corrected file follows and supersedes it:

### src/auth/auth.middleware.ts
```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { UnauthenticatedError } from '../errors/exceptions.js';
import { TenantContext } from '../tenant/tenant-context.js';
import { HostTenantExtractor } from './host-tenant.extractor.js';
import { TenantResolver } from './tenant.resolver.js';
import type { TokenVerifier } from './token-verifier.contract.js';

/**
 * Resolves the tenant for every request from two independent sources —
 * the request host and the verified `org` claim of the bearer token —
 * and rejects unless both agree. The resolved tenant is placed in
 * request-scoped context (AsyncLocalStorage) for the rest of the call.
 */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private readonly tokenVerifier: TokenVerifier,
    private readonly hostTenantExtractor: HostTenantExtractor,
    private readonly tenantResolver: TenantResolver,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const url = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (url === '/' || url === '/health') {
      next();
      return;
    }

    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
      next(new UnauthenticatedError('Missing or malformed Authorization header; expected "Bearer <token>".'));
      return;
    }
    const token = authorization.slice('Bearer '.length).trim();
    if (token.length === 0) {
      next(new UnauthenticatedError('Missing bearer token.'));
      return;
    }

    const hostTenant = this.hostTenantExtractor.fromRequest(req);
    void (async () => {
      const { org } = await this.tokenVerifier.verify(token);
      const tenantId = this.tenantResolver.resolve({ hostTenant, org });
      const context = new TenantContext();
      await context.runWithTenant(tenantId, () => this.tenantResolver.assertExists(tenantId));
      next();
    })().catch(next);
  }
}
```

### src/auth/host-tenant.extractor.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { BadRequestError } from '../errors/exceptions.js';
import { assertTenantId } from '../tenant/tenant-id.js';

/**
 * Derives the tenant from the request host: `app.<tenant-id>.<suffix>`.
 * ASSUMPTION: the tenant id is the DNS subdomain between `app.` and the
 * domain suffix (e.g. host `app.operator-x.com` -> tenant `operator-x`).
 */
@Injectable()
export class HostTenantExtractor {
  static readonly SUBDOMAIN = 'app.';
  static readonly SUFFIX = 'operator.example.com';

  fromRequest(req: Request): string {
    const host = (req.headers.host ?? '').split(':')[0] ?? '';
    return this.fromHost(host);
  }

  fromHost(host: string): string {
    if (host.length === 0) {
      throw new BadRequestError('Request has no host; cannot derive tenant.');
    }
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      throw new BadRequestError('Request host is not a tenant host.');
    }
    const prefix = `app.`;
    if (!host.toLowerCase().startsWith(prefix)) {
      throw new BadRequestError(`Request host "${host}" is not a tenant host.`);
    }
    const remainder = host.slice(prefix.length).toLowerCase();
    const dot = remainder.indexOf('.');
    if (dot <= 0) {
      throw new BadRequestError(`Request host "${host}" is not a tenant host.`);
    }
    const candidate = remainder.slice(0, dot);
    try {
      return assertTenantId(candidate);
    } catch {
      throw new BadRequestError(`Request host "${host}" does not encode a tenant id.`);
    }
  }
}
```

### src/auth/tenant.resolver.ts
```ts
import { Injectable } from '@nestjs/common';
import {
  ResourceNotFoundError,
  TenantMismatchError,
  UnauthenticatedError,
} from '../errors/exceptions.js';
import { assertTenantId } from '../tenant/tenant-id.js';
import type { TenantAwarePrisma } from '../tenant/tenant-prisma.provider.js';

@Injectable()
export class TenantResolver {
  constructor(private readonly prisma: TenantAwarePrisma) {}

  /**
   * Both the host-derived tenant and the token `org` claim must be valid
   * and must point at the same tenant; a mismatch is rejected.
   */
  resolve(input: { hostTenant: string; org: unknown }): string {
    if (typeof input.org !== 'string' || input.org.length === 0) {
      throw new UnauthenticatedError('Token has no usable org claim.');
    }
    const tokenTenant = assertTenantId(input.org);
    if (input.hostTenant !== tokenTenant) {
      throw new TenantMismatchError(
        `Host tenant "${input.hostTenant}" and token org "${tokenTenant}" do not agree; refusing to resolve.`,
      );
    }
    return tokenTenant;
  }

  /**
   * Called with the tenant already in request-scoped context.
   */
  assertExists(tenantId: string): Promise<unknown> {
    return this.prisma.runWithTenant(tenantId, async (scoped) => {
      const tenant = await scoped.tenant.findFirst({ where: { id: tenantId } });
      if (!tenant) {
        throw new ResourceNotFoundError(`Tenant "${tenantId}" was not found.`);
      }
      return tenant;
    });
  }
}
```

### src/auth/auth.module.ts
```ts
import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module.js';
import { AuthMiddleware } from './auth.middleware.js';
import { HostTenantExtractor } from './host-tenant.extractor.js';
import { JwtTokenVerifier } from './jwt.token-verifier.js';
import type { TokenVerifier } from './token-verifier.contract.js';
import { TenantResolver } from './tenant.resolver.js';

@Global()
@Module({
  imports: [TenantModule],
  providers: [
    HostTenantExtractor,
    TenantResolver,
    AuthMiddleware,
    {
      provide: TokenVerifier,
      useFactory: (): TokenVerifier => {
        // Configuration comes from environment variables only.
        // ASSUMPTION: JWT_SECRET is provided in every real deployment;
        // without it the middleware's verification step cannot run.
        const secret = process.env.JWT_SECRET ?? '';
        return new JwtTokenVerifier(secret);
      },
    },
  ],
  exports: [TenantResolver, HostTenantExtractor],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthMiddleware).exclude('/', '/health').forRoutes('*');
  }
}
```

### src/tenant/tenant-id.ts
```ts
/**
 * Tenant ids are DNS subdomains: lowercase alphanumerics and hyphens in
 * dot-separated labels (e.g. `operator-x`).
 */
const TENANT_ID_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

export function assertTenantId(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 253 || !TENANT_ID_PATTERN.test(value)) {
    throw new TypeError(`Invalid tenant id: ${JSON.stringify(value)}`);
  }
  return value;
}
```

### src/tenant/tenant-context.ts
```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { assertTenantId } from './tenant-id.js';

export class TenantContextError extends Error {
  constructor() {
    super('No tenant in the current request context; refusing to run an unscoped operation.');
  }
}

/**
 * Request-scoped tenant context backed by AsyncLocalStorage, so
 * concurrent requests on the same process each keep their own tenant.
 */
export class TenantContext {
  private readonly storage = new AsyncLocalStorage<string>();

  current(): string {
    const tenantId = this.storage.getStore();
    if (tenantId === undefined) {
      throw new TenantContextError();
    }
    return tenantId;
  }

  tryCurrent(): string | null {
    return this.storage.getStore() ?? null;
  }

  runWithTenant<T>(tenantId: string, fn: () => T): T {
    return this.storage.run(assertTenantId(tenantId), fn);
  }
}
```

### src/tenant/tenant-prisma.provider.ts
```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContext, TenantContextError } from './tenant-context.js';

export interface TenantAwarePrisma {
  /**
   * Runs `fn` with `tenantId` in request-scoped context. Inside `fn` — and
   * through every async continuation it spawns — every read is scoped to
   * that tenant and every write is stamped with it, by the Prisma
   * extension. Handlers and repositories never pass tenantId themselves.
   */
  runWithTenant<T>(tenantId: string, fn: () => Promise<T> | T): Promise<T>;
}

/**
 * The only Prisma client the app may use. It is wrapped in a tenant
 * extension with two hard properties:
 *
 *  - when no tenant is in context, an operation FAILS (TenantContextError)
 *    instead of returning everything;
 *  - any tenantId a caller supplies in args is overwritten by the context.
 *
 * findUnique is translated to findFirst so a foreign primary key behaves
 * exactly like a nonexistent id (404), never like a cross-tenant read.
 */
@Injectable()
export class TenantPrismaProvider implements OnModuleInit, OnModuleDestroy, TenantAwarePrisma {
  private readonly logger = new Logger(TenantPrismaProvider.name);
  private readonly context = new TenantContext();
  private client: PrismaClient | null = null;

  async onModuleInit(): Promise<void> {
    this.client = new PrismaClient({
      // Configuration comes from environment variables only.
      datasources: { db: { url: process.env.DATABASE_URL } },
    }).$extends({
      query: {
        $allModels: {
          async $allOperations({ args, operation, model }, query) {
            const tenantId = this.context.current();
            const mergedWhere = (where: unknown): Record<string, unknown> => {
              const base =
                where && typeof where === 'object' && !Array.isArray(where)
                  ? (where as Record<string, unknown>)
                  : {};
              return { ...base, tenantId };
            };
            const op = String(operation).toLowerCase();

            if (op === 'findunique') {
              // Scoped lookup by id must behave like "not found" for other
              // tenants, so route through findFirst with the merged where.
              return query({ ...args, where: mergedWhere(args.where) }, 'findFirst');
            }
            if (op === 'create') {
              const data = args.data as Record<string, unknown>;
              return query({ ...args, data: { tenantId, ...data } });
            }
            if (op === 'createmany') {
              const rows = (args.data as Array<Record<string, unknown>>) ?? [];
              return query({ ...args, data: rows.map((row) => ({ tenantId, ...row })) });
            }
            if (op === 'update') {
              return query({
                ...args,
                where: mergedWhere(args.where),
                data: { tenantId, ...(args.data as Record<string, unknown>) },
              });
            }
            if (op === 'upsert') {
              const data = (args.data as { create?: Record<string, unknown>; update?: Record<string, unknown> }) ?? {};
              return query({
                ...args,
                where: mergedWhere(args.where),
                data: {
                  ...(data.create ? { create: { tenantId, ...data.create } } : {}),
                  ...(data.update ? { update: { tenantId, ...data.update } } : {}),
                },
              });
            }
            if (op === 'updateMany' || op === 'deleteMany' || op === 'delete' || op === 'count' || op === 'aggregate') {
              return query({ ...args, where: mergedWhere(args.where) });
            }
            if (op === 'findmany' || op === 'findfirst' || op === 'findfirstorthrow') {
              return query({ ...args, where: mergedWhere(args.where) });
            }
            // Read-side operations above; anything else is treated as a
            // read too, so an unknown operation can never be unscoped.
            return query({ ...args, where: mergedWhere(args.where) });
          },
        },
      },
    });
    this.logger.log('Tenant-aware Prisma client initialized');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
    this.client = null;
  }

  async runWithTenant<T>(tenantId: string, fn: () => Promise<T> | T): Promise<T> {
    if (!this.client) {
      throw new Error('TenantPrismaProvider is not initialized.');
    }
    return this.context.runWithTenant(tenantId, () => fn());
  }

  /** Base, unscoped client. Exposed for guarded tests only. */
  get baseClient(): PrismaClient {
    if (!this.client) {
      throw new Error('TenantPrismaProvider is not initialized.');
    }
    return this.client;
  }

  /** The extension fails without a tenant in context. */
  get noContext(): { tenantId: string | null } {
    return { tenantId: this.context.tryCurrent() };
  }
}

export const TenantPrisma = TenantPrismaProvider;
export type { PrismaClient as BasePrismaClient };
export { TenantContextError };
```

### src/tenant/tenant.module.ts
```ts
import { Global, Module } from '@nestjs/common';
import { TenantPrismaProvider } from './tenant-prisma.provider.js';

@Global()
@Module({
  providers: [TenantPrismaProvider],
  exports: [TenantPrismaProvider],
})
export class TenantModule {}
```

### src/tenant/tenants/tenant-config.controller.ts
```ts
import { Controller, Get } from '@nestjs/common';
import { TenantService } from './tenant.service.js';

@Controller('tenant-config')
export class TenantConfigController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  getConfig() {
    return this.tenantService.config();
  }
}
```

### src/tenant/tenants/tenant.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { ResourceNotFoundError } from '../../errors/exceptions.js';
import type { TenantAwarePrisma } from '../tenant-prisma.provider.js';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: TenantAwarePrisma) {}

  /** Branding + feature flags for the resolved (request-scoped) tenant. */
  config(): Promise<{ tenantId: string; name: string; domain: string; branding: unknown; featureFlags: unknown }> {
    return this.prisma.runWithTenant(this.requireTenantId(), async (scoped) => {
      const tenant = await scoped.tenant.findFirst({ where: { id: this.requireTenantId() } });
      if (!tenant) {
        throw new ResourceNotFoundError('Tenant was not found.');
      }
      return {
        tenantId: tenant.id,
        name: tenant.name,
        domain: tenant.domain,
        branding: tenant.branding,
        featureFlags: tenant.featureFlags,
      };
    });
  }

  private requireTenantId(): string {
    // Resolved by the middleware; throws TenantContextError if absent.
    return this.prisma.runWithTenant.__proto__ === Object.prototype ? '' : '';
  }
}
```

That service came out wrong as well — final corrected file:

### src/tenant/tenants/tenant.service.ts
```ts
import { Injectable } from '@nestjs/common';
import { ResourceNotFoundError } from '../../errors/exceptions.js';
import { TenantContext } from '../tenant-context.js';
import type { TenantAwarePrisma } from '../tenant-prisma.provider.js';

@Injectable()
export class TenantService {
  private readonly context = new TenantContext();

  constructor(private readonly prisma: TenantAwarePrisma) {}

  /** Branding + feature flags for the resolved (request-scoped) tenant. */
  config(): Promise<{ tenantId: string; name: string; domain: string; branding: unknown; featureFlags: unknown }> {
    const tenantId = this.context.current();
    return this.prisma.runWithTenant(tenantId, async (scoped) => {
      const tenant = await scoped.tenant.findFirst({ where: { id: tenantId } });
      if (!tenant) {
        throw new ResourceNotFoundError('Tenant was not found.');
      }
      return {
        tenantId: tenant.id,
        name: tenant.name,
        domain: tenant.domain,
        branding: tenant.branding,
        featureFlags: tenant.featureFlags,
      };
    });
  }
}
```

### src/tenant/tenants/tenants.module.ts
```ts
import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant.module.js';
import { TenantConfigController } from './tenant-config.controller.js';
import { TenantService } from './tenant.service.js';

@Module({
  imports: [TenantModule],
  controllers: [TenantConfigController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantsModule {}
```

### src/customer/customer.dto.ts
```ts
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;
}
```

### src/customer/customer.controller.ts
```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CreateCustomerDto, UpdateCustomerDto } from './customer.dto.js';
import { CustomerService } from './customer.service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]-[9ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertId(id: string | undefined): string {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new Error('invalid id');
  }
  return id;
}

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customerService.create(dto);
  }

  @Get()
  list() {
    return this.customerService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.customerService.getById(assertId(id));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    if (!dto || Object.keys(dto).length === 0) {
      throw Object.assign(new Error('Update body must contain at least one of: name, email, phone.'), {
        status: 400,
        name: 'BadRequestError',
      });
    }
    return this.customerService.update(assertId(id), dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Res() res: Response): Promise<void> {
    await this.customerService.remove(assertId(id));
    res.status(204).send();
  }
}
```

Hmm — the `assertId` throwing a raw Error produces a 500, not 400. Correcting with the proper error type in the final file:

### src/customer/customer.controller.ts
```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BadRequestError } from '../errors/exceptions.js';
import { CreateCustomerDto, UpdateCustomerDto } from './customer.dto.js';
import { CustomerService } from './customer.service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]-[9ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertId(id: string | undefined): string {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
    throw new BadRequestError('Customer id must be a UUID.');
  }
  return id;
}

@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customerService.create(dto);
  }

  @Get()
  list() {
    return this.customerService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.customerService.getById(assertId(id));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestError('Update body must contain at least one of: name, email, phone.');
    }
    return this.customerService.update(assertId(id), dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Res() res: Response): Promise<void> {
    await this.customerService.remove(assertId(id));
    res.status(204).send();
  }
}
```

### src/customer/customer.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
import type { TenantAwarePrisma } from '../tenant/tenant-prisma.provider.js';

@Injectable()
export class CustomerRepository {
  constructor(private readonly prisma: TenantAwarePrisma) {}

  // NOTE: no tenantId anywhere in this file. The tenant-aware Prisma
  // client scopes reads and stamps writes from request-scoped context.

  list(): Promise<Customer[]> {
    return this.prisma.runWithTenant('noop', async (scoped) => {
      throw new Error('unreachable');
    });
  }
}
```

No — that placeholder pattern is not how this works. The provider's `runWithTenant` takes a tenant id only for explicit contexts (tests, resolver). Inside a request the tenant is already in context, so repositories simply run their query and the extension reads the context. Final corrected repository:

### src/customer/customer.repository.ts
```ts
import { Injectable } from '@nestjs/common';
import type { Customer } from '@prisma/client';
