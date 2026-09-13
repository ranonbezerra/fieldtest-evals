$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 9, reused 9, downloaded 0, added 0
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

Done in 3.2s using pnpm v10.28.2

$ prisma format -> 0
Prisma schema loaded from prisma/schema.prisma
Formatted prisma/schema.prisma in 11ms 🚀

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 22ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Help us improve the Prisma ORM for everyone. Share your feedback in a short 2-min survey: https://pris.ly/orm/survey/release-5-22



$ tsc --noEmit (attempt 0) -> 2
src/app.module.ts(2,30): error TS2307: Cannot find module './prisma/prisma.module' or its corresponding type declarations.
src/app.module.ts(3,28): error TS2307: Cannot find module './auth/auth.module' or its corresponding type declarations.
src/auth/auth.controller.ts(2,35): error TS2307: Cannot find module 'express' or its corresponding type declarations.
src/auth/auth.controller.ts(3,29): error TS2307: Cannot find module './auth.service' or its corresponding type declarations.
src/auth/auth.controller.ts(4,34): error TS2307: Cannot find module './auth.failed.filter' or its corresponding type declarations.
src/auth/auth.failed.filter.ts(2,26): error TS2307: Cannot find module 'express' or its corresponding type declarations.
src/auth/auth.failed.filter.ts(3,37): error TS2307: Cannot find module './auth.failed.exception' or its corresponding type declarations.
src/auth/auth.module.ts(2,30): error TS2307: Cannot find module '../prisma/prisma.module' or its corresponding type declarations.
src/auth/auth.module.ts(3,32): error TS2307: Cannot find module './auth.controller' or its corresponding type declarations.
src/auth/auth.module.ts(4,29): error TS2307: Cannot find module './auth.service' or its corresponding type declarations.
src/auth/auth.module.ts(5,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.
src/auth/auth.module.ts(6,36): error TS2307: Cannot find module './token-issuer.service' or its corresponding type declarations.
src/auth/auth.module.ts(7,34): error TS2307: Cannot find module './auth.failed.filter' or its corresponding type declarations.
src/auth/auth.repository.ts(2,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
src/auth/auth.service.ts(3,32): error TS2307: Cannot find module './auth.repository' or its corresponding type declarations.
src/auth/auth.service.ts(4,36): error TS2307: Cannot find module './token-issuer.service' or its corresponding type declarations.
src/auth/auth.service.ts(5,37): error TS2307: Cannot find module './auth.failed.exception' or its corresponding type declarations.
src/main.ts(2,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.
src/prisma/prisma.module.ts(2,31): error TS2307: Cannot find module './prisma.service' or its corresponding type declarations.


$ tsc --noEmit (attempt 1) -> 2
src/auth/auth.repository.ts(54,42): error TS2322: Type '{ eventType: string; tokenHash: string | null; familyId: string | null; userId: string | null; ip: string; userAgent: string; details: Record<string, unknown>; }' is not assignable to type '(Without<AuthAuditCreateInput, AuthAuditUncheckedCreateInput> & AuthAuditUncheckedCreateInput) | (Without<...> & AuthAuditCreateInput)'.
  Type '{ eventType: string; tokenHash: string | null; familyId: string | null; userId: string | null; ip: string; userAgent: string; details: Record<string, unknown>; }' is not assignable to type 'Without<AuthAuditUncheckedCreateInput, AuthAuditCreateInput> & AuthAuditCreateInput'.
    Type '{ eventType: string; tokenHash: string | null; familyId: string | null; userId: string | null; ip: string; userAgent: string; details: Record<string, unknown>; }' is not assignable to type 'AuthAuditCreateInput'.
      Types of property 'details' are incompatible.
        Type 'Record<string, unknown>' is not assignable to type 'NullableJsonNullValueInput | InputJsonValue | undefined'.
          Type 'Record<string, unknown>' is missing the following properties from type 'readonly (InputJsonValue | null)[]': length, concat, join, slice, and 20 more.


$ tsc --noEmit (attempt 2) -> 0

