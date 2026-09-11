$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 17, reused 10, downloaded 6, added 0
Progress: resolved 237, reused 179, downloaded 25, added 0
Packages: +221
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 293, reused 192, downloaded 29, added 221, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @nestjs/platform-express 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ class-transformer 0.5.1
+ class-validator 0.14.4 (0.15.1 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @nestjs/testing 10.4.22 (12.0.1 is available)
+ @types/express 4.17.25 (5.0.6 is available)
+ @types/node 20.19.43 (22.20.2 is available)
+ @types/supertest 6.0.3 (7.2.1 is available)
+ dotenv-cli 7.4.4 (11.0.0 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ supertest 7.2.2
+ tsx 4.23.13
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 3.4s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 28ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Interested in query caching in just a few lines of code? Try Accelerate today! https://pris.ly/tip-3-accelerate



$ tsc --noEmit (attempt 0) -> 2
src/app.module.ts(4,32): error TS2307: Cannot find module './customer/customer.module.js' or its corresponding type declarations.
src/app.module.ts(6,29): error TS2307: Cannot find module './order/order.module.js' or its corresponding type declarations.
src/app.module.ts(7,28): error TS2307: Cannot find module './plan/plan.module.js' or its corresponding type declarations.
src/auth/auth.module.ts(17,16): error TS2693: 'TokenVerifier' only refers to a type, but is being used as a value here.
src/auth/tenant.resolver.ts(35,48): error TS2345: Argument of type '(scoped: any) => Promise<any>' is not assignable to parameter of type '() => any'.
  Target signature provides too few arguments. Expected 1 or more, but got 0.
src/auth/tenant.resolver.ts(35,55): error TS7006: Parameter 'scoped' implicitly has an 'any' type.
src/customer/customer.controller.ts(5,33): error TS2307: Cannot find module './customer.service.js' or its corresponding type declarations.
src/customer/customer.repository.ts(13,46): error TS2345: Argument of type '(scoped: any) => Promise<never>' is not assignable to parameter of type '() => Promise<never>'.
  Target signature provides too few arguments. Expected 1 or more, but got 0.
src/customer/customer.repository.ts(13,53): error TS7006: Parameter 'scoped' implicitly has an 'any' type.
src/errors/exception-envelope.filter.ts(5,3): error TS2305: Module '"@nestjs/common"' has no exported member 'getExceptionMessage'.
src/tenant/tenant-prisma.provider.ts(33,5): error TS2322: Type 'DynamicClientExtensionThis<TypeMap<InternalArgs & { result: {}; model: {}; query: {}; client: {}; }, PrismaClientOptions>, TypeMapCb, { result: {}; model: {}; query: {}; client: {}; }, {}>' is not assignable to type 'PrismaClient<PrismaClientOptions, never, DefaultArgs> | null'.
  Type 'DynamicClientExtensionThis<TypeMap<InternalArgs & { result: {}; model: {}; query: {}; client: {}; }, PrismaClientOptions>, TypeMapCb, { result: {}; model: {}; query: {}; client: {}; }, {}>' is missing the following properties from type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>': $on, $use
src/tenant/tenant-prisma.provider.ts(39,17): error TS2322: Type '({ args, operation, model }: { args: any; operation: any; model: any; }, query: any) => Promise<any>' is not assignable to type 'DynamicQueryExtensionCb<TypeMap<InternalArgs & DefaultArgs, PrismaClientOptions>, "model", "Tenant" | "Customer" | "Plan" | "Order", "findUnique" | ... 14 more ... | "count">'.
  Target signature provides too few arguments. Expected 2 or more, but got 1.
src/tenant/tenant-prisma.provider.ts(39,34): error TS7031: Binding element 'args' implicitly has an 'any' type.
src/tenant/tenant-prisma.provider.ts(39,40): error TS7031: Binding element 'operation' implicitly has an 'any' type.
src/tenant/tenant-prisma.provider.ts(39,51): error TS7031: Binding element 'model' implicitly has an 'any' type.
src/tenant/tenant-prisma.provider.ts(39,60): error TS7006: Parameter 'query' implicitly has an 'any' type.
src/tenant/tenant-prisma.provider.ts(40,35): error TS2339: Property 'context' does not exist on type '{ $allOperations?: DynamicQueryExtensionCb<TypeMap<InternalArgs & DefaultArgs, PrismaClientOptions>, "model", "Tenant" | "Customer" | "Plan" | "Order", "findUnique" | ... 14 more ... | "count"> | undefined; ... 15 more ...; count?: DynamicQueryExtensionCb<...> | undefined; }'.
src/tenant/tenants/tenant.service.ts(15,48): error TS2345: Argument of type '(scoped: any) => Promise<{ tenantId: any; name: any; domain: any; branding: any; featureFlags: any; }>' is not assignable to parameter of type '() => { tenantId: any; name: any; domain: any; branding: any; featureFlags: any; } | Promise<{ tenantId: any; name: any; domain: any; branding: any; featureFlags: any; }>'.
  Target signature provides too few arguments. Expected 1 or more, but got 0.
src/tenant/tenants/tenant.service.ts(15,55): error TS7006: Parameter 'scoped' implicitly has an 'any' type.


$ tsc --noEmit (attempt 1) -> 2
src/customer/customer.repository.ts(34,85): error TS2322: Type '{ email: string; name?: string | undefined; phone?: string | undefined; }' is not assignable to type '(Without<CustomerCreateInput, CustomerUncheckedCreateInput> & CustomerUncheckedCreateInput) | (Without<...> & CustomerCreateInput)'.
  Type '{ email: string; name?: string | undefined; phone?: string | undefined; }' is not assignable to type 'Without<CustomerUncheckedCreateInput, CustomerCreateInput> & CustomerCreateInput'.
    Property 'tenant' is missing in type '{ email: string; name?: string | undefined; phone?: string | undefined; }' but required in type 'CustomerCreateInput'.
src/tenant/tenant-prisma.provider.ts(54,63): error TS2339: Property 'where' does not exist on type 'TenantFindUniqueArgs<InternalArgs & DefaultArgs> | TenantFindUniqueOrThrowArgs<InternalArgs & DefaultArgs> | ... 61 more ... | OrderCountArgs<...>'.
  Property 'where' does not exist on type 'TenantCreateArgs<InternalArgs & DefaultArgs>'.
src/tenant/tenant-prisma.provider.ts(57,33): error TS2339: Property 'data' does not exist on type 'TenantFindUniqueArgs<InternalArgs & DefaultArgs> | TenantFindUniqueOrThrowArgs<InternalArgs & DefaultArgs> | ... 61 more ... | OrderCountArgs<...>'.
  Property 'data' does not exist on type 'TenantFindUniqueArgs<InternalArgs & DefaultArgs>'.
src/tenant/tenant-prisma.provider.ts(61,34): error TS2339: Property 'data' does not exist on type 'TenantFindUniqueArgs<InternalArgs & DefaultArgs> | TenantFindUniqueOrThrowArgs<InternalArgs & DefaultArgs> | ... 61 more ... | OrderCountArgs<...>'.
  Property 'data' does not exist on type 'TenantFindUniqueArgs<InternalArgs & DefaultArgs>'.
src/tenant/tenant-prisma.provider.ts(67,41): error TS2339: Property 'where' does not exist on type 'TenantFindUniqueArgs<InternalArgs & DefaultArgs> | TenantFindUniqueOrThrowArgs<InternalArgs & DefaultArgs> | ... 61 more ... | OrderCountArgs<...>'.
  Property 'where' does not exist on type 'TenantCreateArgs<InternalArgs & DefaultArgs>'.
src/tenant/tenant-prisma.provider.ts(68,44): error TS2339: Property 'data' does not exist on type 'TenantFindUniqueArgs<InternalArgs & DefaultArgs> | TenantFindUniqueOrThrowArgs<InternalArgs & DefaultArgs> | ... 61 more ... | OrderCountArgs<...>'.
  Property 'data' does not exist on type 'TenantFindUniqueArgs<InternalArgs & DefaultArgs>'.
src/tenant/tenant-prisma.provider.ts(72,34): error TS2339: Property 'data' does not exist on type 'TenantFindUniqueArgs<InternalArgs & DefaultArgs> | TenantFindUniqueOrThrowArgs<InternalArgs & DefaultArgs> | ... 61 more ... | OrderCountArgs<...>'.
  Property 'data' does not exist on type 'TenantFindUniqueArgs<InternalArgs & DefaultArgs>'.
src/tenant/tenant-prisma.provider.ts(75,41): error TS2339: Property 'where' does not exist on type 'TenantFindUniqueArgs<InternalArgs & DefaultArgs> | TenantFindUniqueOrThrowArgs<InternalArgs & DefaultArgs> | ... 61 more ... | OrderCountArgs<...>'.
  Property 'where' does not exist on type 'TenantCreateArgs<InternalArgs & DefaultArgs>'.
src/tenant/tenant-prisma.provider.ts(83,63): error TS2339: Property 'where' does not exist on type 'TenantFindUniqueArgs<InternalArgs & DefaultArgs> | TenantFindUniqueOrThrowArgs<InternalArgs & DefaultArgs> | ... 61 more ... | OrderCountArgs<...>'.
  Property 'where' does not exist on type 'TenantCreateArgs<InternalArgs & DefaultArgs>'.
src/tenant/tenant-prisma.provider.ts(86,63): error TS2339: Property 'where' does not exist on type 'TenantFindUniqueArgs<InternalArgs & DefaultArgs> | TenantFindUniqueOrThrowArgs<InternalArgs & DefaultArgs> | ... 61 more ... | OrderCountArgs<...>'.
  Property 'where' does not exist on type 'TenantCreateArgs<InternalArgs & DefaultArgs>'.
src/tenant/tenant-prisma.provider.ts(90,61): error TS2339: Property 'where' does not exist on type 'TenantFindUniqueArgs<InternalArgs & DefaultArgs> | TenantFindUniqueOrThrowArgs<InternalArgs & DefaultArgs> | ... 61 more ... | OrderCountArgs<...>'.
  Property 'where' does not exist on type 'TenantCreateArgs<InternalArgs & DefaultArgs>'.


$ tsc --noEmit (attempt 2) -> 0

