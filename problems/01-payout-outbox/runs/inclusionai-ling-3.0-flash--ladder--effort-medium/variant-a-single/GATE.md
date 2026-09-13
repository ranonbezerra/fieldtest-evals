$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 37, reused 37, downloaded 0, added 0
Progress: resolved 131, reused 84, downloaded 0, added 0
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
+ @types/node 22.20.2
+ prisma 5.22.0 (8.0.0-rc.14 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 3.1s using pnpm v10.28.2

$ prisma format -> 0
Prisma schema loaded from prisma/schema.prisma
Formatted prisma/schema.prisma in 12ms 🚀

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 26ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Need your database queries to be 1000x faster? Accelerate offers you that and more: https://pris.ly/tip-2-accelerate



$ tsc --noEmit (attempt 0) -> 2
src/app.module.ts(2,31): error TS2307: Cannot find module './prisma/prisma.service' or its corresponding type declarations.
src/app.module.ts(3,30): error TS2307: Cannot find module './payout/payout.module' or its corresponding type declarations.
src/main.ts(2,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.


$ tsc --noEmit (attempt 1) -> 2
src/app.module.ts(2,31): error TS2307: Cannot find module './prisma/prisma.service' or its corresponding type declarations.
src/app.module.ts(3,30): error TS2307: Cannot find module './payout/payout.module' or its corresponding type declarations.
src/main.ts(2,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.


$ tsc --noEmit (attempt 2) -> 2
src/app.module.ts(2,31): error TS2307: Cannot find module './prisma/prisma.service' or its corresponding type declarations.
src/app.module.ts(3,30): error TS2307: Cannot find module './payout/payout.module' or its corresponding type declarations.
src/main.ts(2,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.

