$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 9, reused 9, downloaded 0, added 0
Packages: +85
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 132, reused 85, downloaded 0, added 82
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

Done in 2.7s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 23ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Easily identify and fix slow SQL queries in your app. Optimize helps you enhance your visibility: https://pris.ly/--optimize



$ tsc --noEmit (attempt 0) -> 2
src/payouts/payouts.controller.ts(2,49): error TS2307: Cannot find module './payouts.service' or its corresponding type declarations.
src/payouts/payouts.module.ts(2,35): error TS2307: Cannot find module './payouts.controller' or its corresponding type declarations.
src/payouts/payouts.module.ts(3,32): error TS2307: Cannot find module './payouts.service' or its corresponding type declarations.
src/payouts/payouts.module.ts(4,35): error TS2307: Cannot find module './payouts.repository' or its corresponding type declarations.
src/payouts/payouts.repository.ts(9,5): error TS2322: Type '{ effectiveDate: Date; id: string; amountCents: number; bankKey: string; status: OrderStatus; attempts: number; txid: string | null; createdAt: Date; updatedAt: Date; }[]' is not assignable to type 'never[]'.
  Type '{ effectiveDate: Date; id: string; amountCents: number; bankKey: string; status: OrderStatus; attempts: number; txid: string | null; createdAt: Date; updatedAt: Date; }' is not assignable to type 'never'.
src/payouts/payouts.repository.ts(15,5): error TS2322: Type '{ effectiveDate: Date; id: string; amountCents: number; bankKey: string; status: OrderStatus; attempts: number; txid: string | null; createdAt: Date; updatedAt: Date; }[]' is not assignable to type 'never[]'.
  Type '{ effectiveDate: Date; id: string; amountCents: number; bankKey: string; status: OrderStatus; attempts: number; txid: string | null; createdAt: Date; updatedAt: Date; }' is not assignable to type 'never'.
src/payouts/payouts.repository.ts(21,5): error TS2322: Type '{ effectiveDate: Date; id: string; amountCents: number; bankKey: string; status: OrderStatus; attempts: number; txid: string | null; createdAt: Date; updatedAt: Date; } | null' is not assignable to type 'null'.
  Type '{ effectiveDate: Date; id: string; amountCents: number; bankKey: string; status: OrderStatus; attempts: number; txid: string | null; createdAt: Date; updatedAt: Date; }' is not assignable to type 'null'.
src/payouts/payouts.service.ts(4,45): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './bank-client.js'?
src/payouts/payouts.service.ts(5,35): error TS2307: Cannot find module './payouts.repository' or its corresponding type declarations.
src/payouts/payouts.service.ts(80,51): error TS7006: Parameter 's' implicitly has an 'any' type.
src/payouts/payouts.service.ts(93,22): error TS2339: Property 'amountCents' does not exist on type '{}'.
src/payouts/payouts.service.ts(95,99): error TS2339: Property 'amountCents' does not exist on type '{}'.
test/payouts.spec.ts(2,32): error TS2307: Cannot find module '../src/payouts/payouts.service' or its corresponding type declarations.
test/payouts.spec.ts(3,49): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../src/payouts/bank-client.js'?
test/payouts.spec.ts(4,40): error TS2307: Cannot find module '../src/payouts/payouts.repository' or its corresponding type declarations.


$ tsc --noEmit (attempt 1) -> 0

