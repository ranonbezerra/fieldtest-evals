$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 8, reused 8, downloaded 0, added 0
Packages: +85
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 132, reused 85, downloaded 0, added 84
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

Done in 2.6s using pnpm v10.28.2

$ prisma format -> 0
Prisma schema loaded from prisma/schema.prisma
Formatted prisma/schema.prisma in 13ms 🚀

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 25ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want real-time updates to your database without manual polling? Discover how with Pulse: https://pris.ly/tip-0-pulse



$ tsc --noEmit (attempt 0) -> 2
src/app.module.ts(2,30): error TS2307: Cannot find module './common/prisma.module' or its corresponding type declarations.
src/app.module.ts(3,30): error TS2307: Cannot find module './tenant/tenant.module' or its corresponding type declarations.
src/app.module.ts(4,33): error TS2307: Cannot find module './customers/customers.module' or its corresponding type declarations.
src/app.module.ts(5,29): error TS2307: Cannot find module './plans/plans.module' or its corresponding type declarations.
src/app.module.ts(6,30): error TS2307: Cannot find module './orders/orders.module' or its corresponding type declarations.
src/app.module.ts(7,44): error TS2307: Cannot find module './common/tenant-resolution.middleware' or its corresponding type declarations.
src/app.module.ts(8,35): error TS2307: Cannot find module './common/error-format.filter' or its corresponding type declarations.
src/common/app-exception.ts(3,14): error TS2415: Class 'AppException' incorrectly extends base class 'HttpException'.
  Property 'status' is private in type 'HttpException' but not in type 'AppException'.
src/common/error-format.filter.ts(23,14): error TS2349: This expression is not callable.
  Type 'Number' has no call signatures.
src/common/prisma.module.ts(2,31): error TS2307: Cannot find module './prisma.service' or its corresponding type declarations.
src/common/prisma.service.ts(3,34): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './tenant-middleware.js'?
src/common/tenant-middleware.ts(1,29): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './tenant-context.js'?
src/common/tenant-resolution.middleware.ts(2,49): error TS2307: Cannot find module 'express' or its corresponding type declarations.
src/common/tenant-resolution.middleware.ts(3,22): error TS2307: Cannot find module 'jsonwebtoken' or its corresponding type declarations.
src/common/tenant-resolution.middleware.ts(4,31): error TS2307: Cannot find module '../tenant/tenant.service' or its corresponding type declarations.
src/common/tenant-resolution.middleware.ts(5,34): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './tenant-context.js'?
src/customers/customers.module.ts(2,30): error TS2307: Cannot find module '../common/prisma.module' or its corresponding type declarations.
src/customers/customers.module.ts(3,34): error TS2307: Cannot find module './customers.service' or its corresponding type declarations.
src/customers/customers.module.ts(4,37): error TS2307: Cannot find module './customers.controller' or its corresponding type declarations.
src/main.ts(2,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.
src/tenant/tenant.controller.ts(2,31): error TS2307: Cannot find module './tenant.service' or its corresponding type declarations.
src/tenant/tenant.controller.ts(3,30): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../common/app-exception.js'?
src/tenant/tenant.controller.ts(4,29): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../common/tenant-context.js'?
src/tenant/tenant.module.ts(2,30): error TS2307: Cannot find module '../common/prisma.module' or its corresponding type declarations.
src/tenant/tenant.module.ts(3,31): error TS2307: Cannot find module './tenant.service' or its corresponding type declarations.
src/tenant/tenant.module.ts(4,34): error TS2307: Cannot find module './tenant.controller' or its corresponding type declarations.
src/tenant/tenant.service.ts(2,31): error TS2307: Cannot find module '../common/prisma.service' or its corresponding type declarations.


$ tsc --noEmit (attempt 1) -> 2
src/app.module.ts(5,29): error TS2307: Cannot find module './plans/plans.module.js' or its corresponding type declarations.
src/app.module.ts(6,30): error TS2307: Cannot find module './orders/orders.module.js' or its corresponding type declarations.
src/common/tenant-resolution.middleware.ts(2,49): error TS2307: Cannot find module 'express' or its corresponding type declarations.
src/customers/customers.module.ts(3,34): error TS2307: Cannot find module './customers.service.js' or its corresponding type declarations.
src/customers/customers.module.ts(4,37): error TS2307: Cannot find module './customers.controller.js' or its corresponding type declarations.


$ tsc --noEmit (attempt 2) -> 2
src/common/tenant-resolution.middleware.ts(15,25): error TS2339: Property 'split' does not exist on type 'string | string[]'.
  Property 'split' does not exist on type 'string[]'.
src/common/tenant-resolution.middleware.ts(35,34): error TS2339: Property 'startsWith' does not exist on type 'string | string[]'.
  Property 'startsWith' does not exist on type 'string[]'.
src/common/tenant-resolution.middleware.ts(36,32): error TS2339: Property 'substring' does not exist on type 'string | string[]'.
  Property 'substring' does not exist on type 'string[]'.

