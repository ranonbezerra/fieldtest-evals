$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 9, reused 9, downloaded 0, added 0
Packages: +85
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 132, reused 85, downloaded 0, added 25
Progress: resolved 132, reused 85, downloaded 0, added 85, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @types/node 22.20.2
+ prisma 5.22.0 (8.0.0-rc.14 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.8s using pnpm v10.28.2

$ prisma format -> 0
┌─────────────────────────────────────────────────────────┐
│  Update available 5.22.0 -> 8.0.0-rc.14                 │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 25ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Need your database queries to be 1000x faster? Accelerate offers you that and more: https://pris.ly/tip-2-accelerate



$ tsc --noEmit (attempt 0) -> 2
' or its corresponding type declarations.
src/customers/customers.module.ts(5,37): error TS2307: Cannot find module './customers.controller' or its corresponding type declarations.
src/customers/customers.repository.ts(2,31): error TS2307: Cannot find module '../database/prisma.service' or its corresponding type declarations.
src/customers/customers.repository.ts(6,8): error TS2307: Cannot find module './customers.dto' or its corresponding type declarations.
src/customers/customers.service.ts(2,37): error TS2307: Cannot find module './customers.repository' or its corresponding type declarations.
src/customers/customers.service.ts(3,54): error TS2307: Cannot find module './customers.dto' or its corresponding type declarations.
src/database/database.module.ts(2,31): error TS2307: Cannot find module './prisma.service' or its corresponding type declarations.
src/database/prisma.service.ts(3,39): error TS2307: Cannot find module '../tenant/tenant-prisma.extension' or its corresponding type declarations.
src/database/prisma.service.ts(4,29): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../common/tenant-context.js'?
src/database/prisma.service.ts(12,5): error TS2739: Type 'DynamicClientExtensionThis<TypeMap<InternalArgs & { result: {}; model: {}; query: {}; client: {}; }, PrismaClientOptions>, TypeMapCb, { result: {}; model: {}; query: {}; client: {}; }, {}>' is missing the following properties from type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>': $on, $use
src/main.ts(2,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.
src/plans/plans.controller.ts(2,30): error TS2307: Cannot find module './plans.service' or its corresponding type declarations.
src/plans/plans.controller.ts(3,46): error TS2307: Cannot find module './plans.dto' or its corresponding type declarations.
src/plans/plans.module.ts(2,32): error TS2307: Cannot find module '../database/database.module' or its corresponding type declarations.
src/plans/plans.module.ts(3,33): error TS2307: Cannot find module './plans.repository' or its corresponding type declarations.
src/plans/plans.module.ts(4,30): error TS2307: Cannot find module './plans.service' or its corresponding type declarations.
src/plans/plans.module.ts(5,33): error TS2307: Cannot find module './plans.controller' or its corresponding type declarations.
src/plans/plans.repository.ts(2,31): error TS2307: Cannot find module '../database/prisma.service' or its corresponding type declarations.
src/plans/plans.repository.ts(3,46): error TS2307: Cannot find module './plans.dto' or its corresponding type declarations.
src/plans/plans.service.ts(2,33): error TS2307: Cannot find module './plans.repository' or its corresponding type declarations.
src/plans/plans.service.ts(3,46): error TS2307: Cannot find module './plans.dto' or its corresponding type declarations.
src/tenant-config/tenant-config.controller.ts(2,37): error TS2307: Cannot find module './tenant-config.service' or its corresponding type declarations.
src/tenant-config/tenant-config.module.ts(2,32): error TS2307: Cannot find module '../database/database.module' or its corresponding type declarations.
src/tenant-config/tenant-config.module.ts(3,37): error TS2307: Cannot find module './tenant-config.service' or its corresponding type declarations.
src/tenant-config/tenant-config.module.ts(4,40): error TS2307: Cannot find module './tenant-config.controller' or its corresponding type declarations.
src/tenant-config/tenant-config.service.ts(2,31): error TS2307: Cannot find module '../database/prisma.service' or its corresponding type declarations.
src/tenant-config/tenant-config.service.ts(3,29): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../common/tenant-context.js'?
src/tenant/tenant-prisma.extension.ts(2,29): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../common/tenant-context.js'?
src/tenant/tenant-prisma.extension.ts(5,17): error TS2339: Property '$extends' does not exist on type 'typeof Prisma'.
src/tenant/tenant-prisma.extension.ts(8,32): error TS7031: Binding element 'model' implicitly has an 'any' type.
src/tenant/tenant-prisma.extension.ts(8,39): error TS7031: Binding element 'operation' implicitly has an 'any' type.
src/tenant/tenant-prisma.extension.ts(8,50): error TS7031: Binding element 'args' implicitly has an 'any' type.
src/tenant/tenant-prisma.extension.ts(8,56): error TS7031: Binding element 'query' implicitly has an 'any' type.
src/tenant/tenant.middleware.ts(2,45): error TS2305: Module '"@nestjs/common"' has no exported member 'NextFunction'.
src/tenant/tenant.middleware.ts(3,31): error TS2307: Cannot find module './tenant.service' or its corresponding type declarations.
src/tenant/tenant.middleware.ts(4,34): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../common/tenant-context.js'?
src/tenant/tenant.middleware.ts(22,31): error TS2339: Property 'host' does not exist on type 'Headers'.
src/tenant/tenant.middleware.ts(23,37): error TS2339: Property 'authorization' does not exist on type 'Headers'.
src/tenant/tenant.module.ts(2,31): error TS2307: Cannot find module './tenant.service' or its corresponding type declarations.
src/tenant/tenant.module.ts(3,34): error TS2307: Cannot find module './tenant.middleware' or its corresponding type declarations.
src/tenant/tenant.module.ts(4,32): error TS2307: Cannot find module '../database/database.module' or its corresponding type declarations.
src/tenant/tenant.service.ts(2,31): error TS2307: Cannot find module '../database/prisma.service' or its corresponding type declarations.


$ tsc --noEmit (attempt 1) -> 2
src/app.module.ts(8,30): error TS2307: Cannot find module './orders/orders.module.js' or its corresponding type declarations.
src/customers/customers.repository.ts(23,49): error TS2322: Type 'CreateCustomerDto' is not assignable to type '(Without<CustomerCreateInput, CustomerUncheckedCreateInput> & CustomerUncheckedCreateInput) | (Without<...> & CustomerCreateInput)'.
  Type 'CreateCustomerDto' is not assignable to type 'Without<CustomerUncheckedCreateInput, CustomerCreateInput> & CustomerCreateInput'.
    Property 'tenant' is missing in type 'CreateCustomerDto' but required in type 'CustomerCreateInput'.
src/plans/plans.repository.ts(18,45): error TS2322: Type 'CreatePlanDto' is not assignable to type '(Without<PlanCreateInput, PlanUncheckedCreateInput> & PlanUncheckedCreateInput) | (Without<...> & PlanCreateInput)'.
  Type 'CreatePlanDto' is not assignable to type 'Without<PlanUncheckedCreateInput, PlanCreateInput> & PlanCreateInput'.
    Property 'tenant' is missing in type 'CreatePlanDto' but required in type 'PlanCreateInput'.
src/tenant/tenant.middleware.ts(22,19): error TS7052: Element implicitly has an 'any' type because type 'Headers' has no index signature. Did you mean to call 'req.headers.get'?
src/tenant/tenant.middleware.ts(23,25): error TS7052: Element implicitly has an 'any' type because type 'Headers' has no index signature. Did you mean to call 'req.headers.get'?


$ tsc --noEmit (attempt 2) -> 2
src/customers/customers.repository.ts(25,7): error TS2322: Type '{ tenantId: string | undefined; email: string; name?: string; }' is not assignable to type '(Without<CustomerCreateInput, CustomerUncheckedCreateInput> & CustomerUncheckedCreateInput) | (Without<...> & CustomerCreateInput)'.
  Type '{ tenantId: string | undefined; email: string; name?: string; }' is not assignable to type 'Without<CustomerUncheckedCreateInput, CustomerCreateInput> & CustomerCreateInput'.
    Type '{ tenantId: string | undefined; email: string; name?: string; }' is not assignable to type 'Without<CustomerUncheckedCreateInput, CustomerCreateInput>'.
      Types of property 'tenantId' are incompatible.
        Type 'string | undefined' is not assignable to type 'undefined'.
          Type 'string' is not assignable to type 'undefined'.
src/plans/plans.repository.ts(20,7): error TS2322: Type '{ tenantId: string | undefined; name: string; price: number; }' is not assignable to type '(Without<PlanCreateInput, PlanUncheckedCreateInput> & PlanUncheckedCreateInput) | (Without<...> & PlanCreateInput)'.
  Type '{ tenantId: string | undefined; name: string; price: number; }' is not assignable to type 'Without<PlanUncheckedCreateInput, PlanCreateInput> & PlanCreateInput'.
    Type '{ tenantId: string | undefined; name: string; price: number; }' is not assignable to type 'Without<PlanUncheckedCreateInput, PlanCreateInput>'.
      Types of property 'tenantId' are incompatible.
        Type 'string | undefined' is not assignable to type 'undefined'.
          Type 'string' is not assignable to type 'undefined'.

