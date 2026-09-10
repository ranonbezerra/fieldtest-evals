$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 67, reused 67, downloaded 0, added 0
Progress: resolved 440, reused 391, downloaded 2, added 0
 WARN  1 deprecated subdependencies found: glob@10.4.5
Packages: +407
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 454, reused 404, downloaded 3, added 303
Progress: resolved 454, reused 404, downloaded 3, added 407, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @nestjs/platform-express 10.4.22 (12.0.1 is available)
+ @nestjs/schedule 4.1.2 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @nestjs/cli 10.4.9 (12.0.0 is available)
+ @nestjs/testing 10.4.22 (12.0.1 is available)
+ @types/node 20.19.43 (22.20.2 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ ts-node 10.9.2
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 3.9s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 22ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want to turn off tips and other hints? https://pris.ly/tip-4-nohints



$ tsc --noEmit (attempt 0) -> 2
src/app.module.ts(3,30): error TS2307: Cannot find module './orders/orders.module.js' or its corresponding type declarations.
src/bank/bank.module.ts(2,29): error TS2307: Cannot find module './bank.service.js' or its corresponding type declarations.


$ tsc --noEmit (attempt 1) -> 2
src/app.module.ts(3,30): error TS2307: Cannot find module './orders/orders.module.js' or its corresponding type declarations.
src/bank/bank.module.ts(2,29): error TS2307: Cannot find module './bank.service.js' or its corresponding type declarations.


$ tsc --noEmit (attempt 2) -> 2
src/bank/bank.module.ts(2,29): error TS2307: Cannot find module './bank.service.js' or its corresponding type declarations.

