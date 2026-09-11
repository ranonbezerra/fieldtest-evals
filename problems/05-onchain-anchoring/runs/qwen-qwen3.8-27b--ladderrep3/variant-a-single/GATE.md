$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 9, reused 9, downloaded 0, added 0
Packages: +85
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 132, reused 85, downloaded 0, added 59
Progress: resolved 132, reused 85, downloaded 0, added 85, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @types/node 22.20.2
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.9s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 63ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Curious about the SQL queries Prisma ORM generates? Optimize helps you enhance your visibility: https://pris.ly/tip-2-optimize



$ tsc --noEmit (attempt 0) -> 2
src/app.module.ts(2,30): error TS2307: Cannot find module './anchor/anchor.module.js' or its corresponding type declarations.
src/common/error-envelope.filter.ts(2,31): error TS2307: Cannot find module 'express' or its corresponding type declarations.
src/common/error-envelope.filter.ts(3,35): error TS2307: Cannot find module '../anchor/anchor.types.js' or its corresponding type declarations.
src/common/error-envelope.filter.ts(26,24): error TS18046: 'exception' is of type 'unknown'.
src/common/error-envelope.filter.ts(26,52): error TS18046: 'exception' is of type 'unknown'.
src/common/error-envelope.filter.ts(26,77): error TS18046: 'exception' is of type 'unknown'.
src/common/error-envelope.filter.ts(26,105): error TS18046: 'exception' is of type 'unknown'.


$ tsc --noEmit (attempt 1) -> 2
src/common/error-envelope.filter.ts(5,25): error TS2526: A 'this' type is available only in a non-static member of a class or interface.


$ tsc --noEmit (attempt 2) -> 0

