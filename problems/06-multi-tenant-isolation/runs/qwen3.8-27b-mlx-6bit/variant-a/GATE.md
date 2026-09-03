$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 8, reused 8, downloaded 0, added 0
Progress: resolved 72, reused 72, downloaded 0, added 0
Packages: +85
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 132, reused 85, downloaded 0, added 85, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @types/node 22.20.1 (26.4.1 is available)
+ prisma 5.22.0 (8.0.0-rc.12 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (4.1.11 is available)

Done in 3.1s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 29ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want to react to database changes in your app as they happen? Discover how with Pulse: https://pris.ly/tip-1-pulse



$ tsc --noEmit (attempt 0) -> 2
src/customer/customer.repository.ts(10,12): error TS2571: Object is of type 'unknown'.
src/customer/customer.repository.ts(14,12): error TS2571: Object is of type 'unknown'.
src/customer/customer.repository.ts(18,12): error TS2571: Object is of type 'unknown'.
src/customer/customer.repository.ts(22,12): error TS2571: Object is of type 'unknown'.
src/customer/customer.repository.ts(26,11): error TS2571: Object is of type 'unknown'.
src/multi-tenant/tenant-prisma.service.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClientKnownRequestError'.
src/multi-tenant/tenant-prisma.service.ts(34,37): error TS2339: Property 'ctx' does not exist on type '{ [P in "$allOperations" | keyof Q_["$allModels"] | "findUnique" | "findUniqueOrThrow" | "findFirst" | "findFirstOrThrow" | "findMany" | "create" | "createMany" | "createManyAndReturn" | ... 7 more ... | "count"]?: (P extends "$allOperations" ? DynamicQueryExtensionCb<...> : P extends "findUnique" | ... 14 more ... ...'.
src/multi-tenant/tenant-prisma.service.ts(35,41): error TS2339: Property 'injectTenant' does not exist on type '{ [P in "$allOperations" | keyof Q_["$allModels"] | "findUnique" | "findUniqueOrThrow" | "findFirst" | "findFirstOrThrow" | "findMany" | "create" | "createMany" | "createManyAndReturn" | ... 7 more ... | "count"]?: (P extends "$allOperations" ? DynamicQueryExtensionCb<...> : P extends "findUnique" | ... 14 more ... ...'.
src/multi-tenant/tenant-prisma.service.ts(45,19): error TS18046: 'error' is of type 'unknown'.
src/multi-tenant/tenant-resolution.middleware.ts(2,54): error TS2307: Cannot find module 'express' or its corresponding type declarations.
src/multi-tenant/tenant-resolution.middleware.ts(3,17): error TS2307: Cannot find module 'jsonwebtoken' or its corresponding type declarations.
src/order/order.repository.ts(10,12): error TS2571: Object is of type 'unknown'.
src/order/order.repository.ts(14,12): error TS2571: Object is of type 'unknown'.
src/order/order.repository.ts(18,12): error TS2571: Object is of type 'unknown'.
src/order/order.repository.ts(22,12): error TS2571: Object is of type 'unknown'.
src/order/order.repository.ts(26,11): error TS2571: Object is of type 'unknown'.
src/plan/plan.repository.ts(10,12): error TS2571: Object is of type 'unknown'.
src/plan/plan.repository.ts(14,12): error TS2571: Object is of type 'unknown'.
src/plan/plan.repository.ts(18,12): error TS2571: Object is of type 'unknown'.
src/plan/plan.repository.ts(22,12): error TS2571: Object is of type 'unknown'.
src/plan/plan.repository.ts(26,11): error TS2571: Object is of type 'unknown'.


$ tsc --noEmit (attempt 1) -> 2
src/customer/customer.repository.ts(1,37): error TS2307: Cannot find module '../multi-tenant/tenant-prisma.service' or its corresponding type declarations.
src/customer/customer.repository.ts(2,68): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './dto.js'?
src/multi-tenant/tenant-prisma.service.ts(2,38): error TS2307: Cannot find module './tenant-context.service' or its corresponding type declarations.
src/multi-tenant/tenant-prisma.service.ts(3,31): error TS2307: Cannot find module './prisma.service' or its corresponding type declarations.
src/multi-tenant/tenant-prisma.service.ts(4,39): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './errors.js'?
src/multi-tenant/tenant-prisma.service.ts(18,34): error TS7031: Binding element 'args' implicitly has an 'any' type.
src/multi-tenant/tenant-prisma.service.ts(18,40): error TS7031: Binding element 'operation' implicitly has an 'any' type.
src/multi-tenant/tenant-prisma.service.ts(18,53): error TS7006: Parameter 'executeQuery' implicitly has an 'any' type.
src/multi-tenant/tenant-resolution.middleware.ts(1,45): error TS2724: '"@nestjs/common"' has no exported member named 'REQUEST'. Did you mean 'Request'?
src/order/order.repository.ts(1,37): error TS2307: Cannot find module '../multi-tenant/tenant-prisma.service' or its corresponding type declarations.
src/order/order.repository.ts(2,59): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './dto.js'?
src/plan/plan.repository.ts(1,37): error TS2307: Cannot find module '../multi-tenant/tenant-prisma.service' or its corresponding type declarations.
src/plan/plan.repository.ts(2,56): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './dto.js'?


$ tsc --noEmit (attempt 2) -> 2
src/multi-tenant/tenant-prisma.service.ts(23,35): error TS2339: Property 'ctx' does not exist on type '{ $allOperations?: DynamicQueryExtensionCb<TypeMap<InternalArgs & DefaultArgs, PrismaClientOptions>, "model", "Tenant" | "Customer" | "Plan" | "Order", "findUnique" | ... 14 more ... | "count"> | undefined; ... 15 more ...; count?: DynamicQueryExtensionCb<...> | undefined; }'.
src/multi-tenant/tenant-resolution.middleware.ts(1,45): error TS2305: Module '"@nestjs/common"' has no exported member 'ScopeEnum'.
src/multi-tenant/tenant-resolution.middleware.ts(2,54): error TS2307: Cannot find module 'express' or its corresponding type declarations.
src/multi-tenant/tenant-resolution.middleware.ts(3,17): error TS2307: Cannot find module 'jsonwebtoken' or its corresponding type declarations.
src/multi-tenant/tenant-resolution.middleware.ts(8,2): error TS2349: This expression is not callable.
  Type 'typeof Scope' has no call signatures.

