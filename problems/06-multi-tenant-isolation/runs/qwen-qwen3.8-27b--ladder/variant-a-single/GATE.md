$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 15, reused 14, downloaded 1, added 0
Progress: resolved 197, reused 170, downloaded 1, added 0
Packages: +208
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 280, reused 207, downloaded 1, added 207
Progress: resolved 280, reused 207, downloaded 1, added 208, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @nestjs/platform-express 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ jose 5.10.0 (6.2.12 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @nestjs/testing 10.4.22 (12.0.1 is available)
+ @types/express 4.17.25 (5.0.6 is available)
+ @types/node 22.20.2
+ @types/supertest 6.0.3 (7.2.1 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ supertest 7.2.2
+ tsx 4.23.13
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 3.6s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 29ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want real-time updates to your database without manual polling? Discover how with Pulse: https://pris.ly/tip-0-pulse



$ tsc --noEmit (attempt 0) -> 2
src/app.module.ts(13,58): error TS2345: Argument of type '() => boolean' is not assignable to parameter of type 'string | Type<any> | RouteInfo'.
src/customer/customer.repository.ts(23,49): error TS2322: Type '{ email: string; name: string | null; }' is not assignable to type '(Without<CustomerCreateInput, CustomerUncheckedCreateInput> & CustomerUncheckedCreateInput) | (Without<...> & CustomerCreateInput)'.
  Type '{ email: string; name: string | null; }' is not assignable to type 'Without<CustomerUncheckedCreateInput, CustomerCreateInput> & CustomerCreateInput'.
    Property 'tenant' is missing in type '{ email: string; name: string | null; }' but required in type 'CustomerCreateInput'.
src/customer/customer.service.ts(26,42): error TS2345: Argument of type 'CustomerInput' is not assignable to parameter of type '{ email: string; name: string | null; }'.
  Types of property 'name' are incompatible.
    Type 'string | null | undefined' is not assignable to type 'string | null'.
      Type 'undefined' is not assignable to type 'string | null'.
src/prisma/tenant-prisma.service.ts(178,7): error TS2561: Object literal may only specify known properties, but 'Customer' does not exist in type 'DynamicQueryExtensionArgs<{ $queryRaw?: unknown; $queryRawUnsafe?: unknown; $executeRaw?: unknown; $executeRawUnsafe?: unknown; tenant?: unknown; customer?: unknown; plan?: unknown; order?: unknown; $allOperations?: unknown; $allModels?: unknown; }, TypeMap<InternalArgs & DefaultArgs, PrismaClientOptions>>'. Did you mean to write 'customer'?
test/helpers.ts(125,9): error TS2322: Type 'Record<string, unknown>' is not assignable to type 'JsonNull | InputJsonValue | undefined'.
  Type 'Record<string, unknown>' is missing the following properties from type 'readonly (InputJsonValue | null)[]': length, concat, join, slice, and 20 more.
test/helpers.ts(126,9): error TS2322: Type 'Record<string, unknown>' is not assignable to type 'JsonNull | InputJsonValue | undefined'.
  Type 'Record<string, unknown>' is missing the following properties from type 'readonly (InputJsonValue | null)[]': length, concat, join, slice, and 20 more.
test/tenant.spec.ts(126,52): error TS2322: Type '{ email: string; }' is not assignable to type '(Without<CustomerCreateInput, CustomerUncheckedCreateInput> & CustomerUncheckedCreateInput) | (Without<...> & CustomerCreateInput)'.
  Type '{ email: string; }' is not assignable to type 'Without<CustomerUncheckedCreateInput, CustomerCreateInput> & CustomerCreateInput'.
    Property 'tenant' is missing in type '{ email: string; }' but required in type 'CustomerCreateInput'.
test/tenant.spec.ts(129,52): error TS2322: Type '{ email: string; }' is not assignable to type '(Without<CustomerCreateInput, CustomerUncheckedCreateInput> & CustomerUncheckedCreateInput) | (Without<...> & CustomerCreateInput)'.
  Type '{ email: string; }' is not assignable to type 'Without<CustomerUncheckedCreateInput, CustomerCreateInput> & CustomerCreateInput'.
    Property 'tenant' is missing in type '{ email: string; }' but required in type 'CustomerCreateInput'.
test/tenant.spec.ts(146,52): error TS2322: Type '{ email: string; name: string; }' is not assignable to type '(Without<CustomerCreateInput, CustomerUncheckedCreateInput> & CustomerUncheckedCreateInput) | (Without<...> & CustomerCreateInput)'.
  Type '{ email: string; name: string; }' is not assignable to type 'Without<CustomerUncheckedCreateInput, CustomerCreateInput> & CustomerCreateInput'.
    Property 'tenant' is missing in type '{ email: string; name: string; }' but required in type 'CustomerCreateInput'.
test/tenant.spec.ts(149,52): error TS2322: Type '{ email: string; name: string; }' is not assignable to type '(Without<CustomerCreateInput, CustomerUncheckedCreateInput> & CustomerUncheckedCreateInput) | (Without<...> & CustomerCreateInput)'.
  Type '{ email: string; name: string; }' is not assignable to type 'Without<CustomerUncheckedCreateInput, CustomerCreateInput> & CustomerCreateInput'.
    Property 'tenant' is missing in type '{ email: string; name: string; }' but required in type 'CustomerCreateInput'.
test/tenant.spec.ts(178,52): error TS2322: Type '{ email: string; name: string; }' is not assignable to type '(Without<CustomerCreateInput, CustomerUncheckedCreateInput> & CustomerUncheckedCreateInput) | (Without<...> & CustomerCreateInput)'.
  Type '{ email: string; name: string; }' is not assignable to type 'Without<CustomerUncheckedCreateInput, CustomerCreateInput> & CustomerCreateInput'.
    Property 'tenant' is missing in type '{ email: string; name: string; }' but required in type 'CustomerCreateInput'.


$ tsc --noEmit (attempt 1) -> 2
 is possibly 'null'.
test/helpers.ts(80,7): error TS2353: Object literal may only specify known properties, and 'price' does not exist in type 'Without<PlanCreateInput, PlanUncheckedCreateInput> & PlanUncheckedCreateInput'.
test/helpers.ts(96,25): error TS2531: Object is possibly 'null'.
test/helpers.ts(107,5): error TS2322: Type '{ tenantId: string; customerId: string; planId: string; status: string; }' is not assignable to type '(Without<OrderCreateInput, OrderUncheckedCreateInput> & OrderUncheckedCreateInput) | (Without<...> & OrderCreateInput)'.
  Type '{ tenantId: string; customerId: string; planId: string; status: string; }' is not assignable to type 'Without<OrderCreateInput, OrderUncheckedCreateInput> & OrderUncheckedCreateInput'.
    Property 'orderNumber' is missing in type '{ tenantId: string; customerId: string; planId: string; status: string; }' but required in type 'OrderUncheckedCreateInput'.
test/helpers.ts(159,46): error TS2339: Property 'host' does not exist on type '{ id: string; name: string; createdAt: Date; updatedAt: Date; slug: string; domain: string; branding: JsonValue; featureFlags: JsonValue; active: boolean; }'.
test/helpers.ts(160,46): error TS2339: Property 'host' does not exist on type '{ id: string; name: string; createdAt: Date; updatedAt: Date; slug: string; domain: string; branding: JsonValue; featureFlags: JsonValue; active: boolean; }'.
test/tenant.spec.ts(49,25): error TS2349: This expression is not callable.
  Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ((app?: App | undefined, options?: AgentOptions | undefined) => TestAgent<...>); }' has no call signatures.
test/tenant.spec.ts(59,25): error TS2349: This expression is not callable.
  Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ((app?: App | undefined, options?: AgentOptions | undefined) => TestAgent<...>); }' has no call signatures.
test/tenant.spec.ts(71,25): error TS2349: This expression is not callable.
  Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ((app?: App | undefined, options?: AgentOptions | undefined) => TestAgent<...>); }' has no call signatures.
test/tenant.spec.ts(90,17): error TS2559: Type 'string' has no properties in common with type 'TenantCreateNestedOneWithoutCustomersInput'.
test/tenant.spec.ts(93,17): error TS2559: Type 'string' has no properties in common with type 'TenantCreateNestedOneWithoutCustomersInput'.
test/tenant.spec.ts(96,17): error TS2559: Type 'string' has no properties in common with type 'TenantCreateNestedOneWithoutCustomersInput'.
test/tenant.spec.ts(101,25): error TS2349: This expression is not callable.
  Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ((app?: App | undefined, options?: AgentOptions | undefined) => TestAgent<...>); }' has no call signatures.
test/tenant.spec.ts(114,18): error TS2322: Type 'string' is not assignable to type '(Without<TenantRelationFilter, TenantWhereInput> & TenantWhereInput) | (Without<TenantWhereInput, TenantRelationFilter> & TenantRelationFilter) | undefined'.
test/tenant.spec.ts(117,25): error TS2349: This expression is not callable.
  Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ((app?: App | undefined, options?: AgentOptions | undefined) => TestAgent<...>); }' has no call signatures.
test/tenant.spec.ts(128,18): error TS2322: Type 'string' is not assignable to type '(Without<TenantRelationFilter, TenantWhereInput> & TenantWhereInput) | (Without<TenantWhereInput, TenantRelationFilter> & TenantRelationFilter) | undefined'.
test/tenant.spec.ts(131,25): error TS2349: This expression is not callable.
  Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ((app?: App | undefined, options?: AgentOptions | undefined) => TestAgent<...>); }' has no call signatures.
test/tenant.spec.ts(149,18): error TS2322: Type 'string' is not assignable to type '(Without<TenantRelationFilter, TenantWhereInput> & TenantWhereInput) | (Without<TenantWhereInput, TenantRelationFilter> & TenantRelationFilter) | undefined'.
test/tenant.spec.ts(152,13): error TS2349: This expression is not callable.
  Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ((app?: App | undefined, options?: AgentOptions | undefined) => TestAgent<...>); }' has no call signatures.
test/tenant.spec.ts(167,25): error TS2349: This expression is not callable.
  Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ((app?: App | undefined, options?: AgentOptions | undefined) => TestAgent<...>); }' has no call signatures.
test/tenant.spec.ts(176,26): error TS2349: This expression is not callable.
  Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ((app?: App | undefined, options?: AgentOptions | undefined) => TestAgent<...>); }' has no call signatures.
test/tenant.spec.ts(187,25): error TS2349: This expression is not callable.
  Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ((app?: App | undefined, options?: AgentOptions | undefined) => TestAgent<...>); }' has no call signatures.
test/tenant.spec.ts(208,17): error TS2559: Type 'string' has no properties in common with type 'TenantCreateNestedOneWithoutCustomersInput'.
test/tenant.spec.ts(211,17): error TS2559: Type 'string' has no properties in common with type 'TenantCreateNestedOneWithoutCustomersInput'.
test/tenant.spec.ts(217,9): error TS2349: This expression is not callable.
  Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ((app?: App | undefined, options?: AgentOptions | undefined) => TestAgent<...>); }' has no call signatures.
test/tenant.spec.ts(222,9): error TS2349: This expression is not callable.
  Type '{ default: SuperTestStatic; Test: typeof Test; agent: typeof TestAgent & ((app?: App | undefined, options?: AgentOptions | undefined) => TestAgent<...>); }' has no call signatures.


$ tsc --noEmit (attempt 2) -> 2
antUncheckedCreateInput, TenantCreateInput> & TenantCreateInput'.
    Type '{ id: string; }' is missing the following properties from type 'TenantCreateInput': slug, domain, name
test/customer.spec.ts(142,3): error TS2582: Cannot find name 'it'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.
test/customer.spec.ts(144,5): error TS2304: Cannot find name 'expect'.
test/customer.spec.ts(147,5): error TS2304: Cannot find name 'expect'.
test/customer.spec.ts(150,3): error TS2582: Cannot find name 'it'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.
test/customer.spec.ts(152,5): error TS2304: Cannot find name 'expect'.
test/customer.spec.ts(153,11): error TS2304: Cannot find name 'expect'.
test/customer.spec.ts(156,3): error TS2582: Cannot find name 'it'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.
test/customer.spec.ts(158,11): error TS2304: Cannot find name 'expect'.
test/customer.spec.ts(163,3): error TS2582: Cannot find name 'it'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.
test/customer.spec.ts(165,11): error TS2304: Cannot find name 'expect'.
test/customer.spec.ts(167,5): error TS2304: Cannot find name 'expect'.
test/customer.spec.ts(170,3): error TS2582: Cannot find name 'it'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.
test/customer.spec.ts(173,5): error TS2304: Cannot find name 'expect'.
test/customer.spec.ts(174,5): error TS2304: Cannot find name 'expect'.
test/customer.spec.ts(175,5): error TS2304: Cannot find name 'expect'.
test/customer.spec.ts(178,3): error TS2582: Cannot find name 'it'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.
test/customer.spec.ts(183,5): error TS2304: Cannot find name 'expect'.
test/customer.spec.ts(184,5): error TS2304: Cannot find name 'expect'.
test/helpers.ts(20,5): error TS2322: Type '{ name: string; }' is not assignable to type '(Without<TenantCreateInput, TenantUncheckedCreateInput> & TenantUncheckedCreateInput) | (Without<...> & TenantCreateInput)'.
  Type '{ name: string; }' is not assignable to type 'Without<TenantUncheckedCreateInput, TenantCreateInput> & TenantCreateInput'.
    Type '{ name: string; }' is missing the following properties from type 'TenantCreateInput': slug, domain
test/tenant.spec.ts(5,22): error TS2307: Cannot find module 'jsonwebtoken' or its corresponding type declarations.
test/tenant.spec.ts(23,1): error TS2582: Cannot find name 'describe'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.
test/tenant.spec.ts(27,3): error TS2304: Cannot find name 'beforeAll'.
test/tenant.spec.ts(37,3): error TS2304: Cannot find name 'afterAll'.
test/tenant.spec.ts(42,3): error TS2304: Cannot find name 'beforeEach'.
test/tenant.spec.ts(51,7): error TS2322: Type '{ id: string; domain: string; name: string; }' is not assignable to type '(Without<TenantCreateInput, TenantUncheckedCreateInput> & TenantUncheckedCreateInput) | (Without<...> & TenantCreateInput)'.
  Type '{ id: string; domain: string; name: string; }' is not assignable to type 'Without<TenantUncheckedCreateInput, TenantCreateInput> & TenantCreateInput'.
    Property 'slug' is missing in type '{ id: string; domain: string; name: string; }' but required in type 'TenantCreateInput'.
test/tenant.spec.ts(60,3): error TS2582: Cannot find name 'it'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.
test/tenant.spec.ts(71,5): error TS2304: Cannot find name 'expect'.
test/tenant.spec.ts(72,5): error TS2304: Cannot find name 'expect'.
test/tenant.spec.ts(75,3): error TS2582: Cannot find name 'it'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.
test/tenant.spec.ts(86,5): error TS2304: Cannot find name 'expect'.
test/tenant.spec.ts(89,3): error TS2582: Cannot find name 'it'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.
test/tenant.spec.ts(101,5): error TS2304: Cannot find name 'expect'.
test/tenant.spec.ts(106,5): error TS2304: Cannot find name 'expect'.
test/tenant.spec.ts(109,3): error TS2582: Cannot find name 'it'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.
test/tenant.spec.ts(120,5): error TS2304: Cannot find name 'expect'.
test/tenant.spec.ts(125,5): error TS2304: Cannot find name 'expect'.
test/tenant.spec.ts(128,3): error TS2582: Cannot find name 'it'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.
test/tenant.spec.ts(137,5): error TS2304: Cannot find name 'expect'.
test/tenant.spec.ts(145,5): error TS2304: Cannot find name 'expect'.
test/tenant.spec.ts(150,5): error TS2304: Cannot find name 'expect'.
test/tenant.spec.ts(153,3): error TS2582: Cannot find name 'it'. Do you need to install type definitions for a test runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha`.
test/tenant.spec.ts(169,5): error TS2304: Cannot find name 'expect'.
test/tenant.spec.ts(170,5): error TS2304: Cannot find name 'expect'.
test/tenant.spec.ts(179,5): error TS2304: Cannot find name 'expect'.
test/tenant.spec.ts(180,5): error TS2304: Cannot find name 'expect'.
test/tenant.spec.ts(185,5): error TS2304: Cannot find name 'expect'.
test/tenant.spec.ts(190,5): error TS2304: Cannot find name 'expect'.


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/06-multi-tenant-isolation/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace

 ❯ test/customer.spec.ts (0 test)
 ❯ test/tenant.spec.ts (0 test)

 Test Files  2 failed (2)
      Tests  no tests
   Start at  03:20:50
   Duration  489ms (transform 30ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 49ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/customer.spec.ts [ test/customer.spec.ts ]
Error: Failed to load url ../src/tenant/tenant-context.service (resolved id: ../src/tenant/tenant-context.service) in /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/06-multi-tenant-isolation/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace/test/customer.spec.ts. Does the file exist?
 ❯ loadAndTransform node_modules/.pnpm/vite@5.4.21_@types+node@22.20.2/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  test/tenant.spec.ts [ test/tenant.spec.ts ]
Error: Failed to load url jsonwebtoken (resolved id: jsonwebtoken) in /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/06-multi-tenant-isolation/runs/qwen-qwen3.8-27b--ladder/variant-a-single/workspace/test/tenant.spec.ts. Does the file exist?
 ❯ loadAndTransform node_modules/.pnpm/vite@5.4.21_@types+node@22.20.2/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


