$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 9, reused 9, downloaded 0, added 0
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
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.4s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 25ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want real-time updates to your database without manual polling? Discover how with Pulse: https://pris.ly/tip-0-pulse

┌─────────────────────────────────────────────────────────┐
│  Update available 5.22.0 -> 8.0.0-rc.13                 │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘


$ tsc --noEmit (attempt 0) -> 2
src/accounts/accounts.controller.ts(2,26): error TS2307: Cannot find module 'express' or its corresponding type declarations.
src/accounts/accounts.controller.ts(3,34): error TS2307: Cannot find module '../payout/payout.repository' or its corresponding type declarations.
src/accounts/accounts.controller.ts(11,28): error TS2339: Property 'stringField' does not exist on type 'AccountsController'.
src/accounts/accounts.controller.ts(29,60): error TS2345: Argument of type '{}' is not assignable to parameter of type 'string | number | bigint | boolean'.
src/accounts/accounts.module.ts(2,30): error TS2307: Cannot find module '../payout/payout.module' or its corresponding type declarations.
src/accounts/accounts.module.ts(3,36): error TS2307: Cannot find module './accounts.controller' or its corresponding type declarations.
src/accounts/accounts.module.ts(4,34): error TS2307: Cannot find module '../payout/payout.repository' or its corresponding type declarations.
src/app.module.ts(2,32): error TS2307: Cannot find module './accounts/accounts.module' or its corresponding type declarations.
src/app.module.ts(3,30): error TS2307: Cannot find module './prisma/prisma.module' or its corresponding type declarations.
src/app.module.ts(4,30): error TS2307: Cannot find module './payout/payout.module' or its corresponding type declarations.
src/main.ts(2,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.
src/main.ts(3,39): error TS2307: Cannot find module './payout/payout.exception-filter' or its corresponding type declarations.
src/main.ts(9,13): error TS2554: Expected 1-3 arguments, but got 0.
src/payout/payout-transfer.provider.ts(2,41): error TS2307: Cannot find module './payout.service' or its corresponding type declarations.
src/payout/payout-transfer.provider.ts(3,34): error TS2307: Cannot find module './transfer.provider' or its corresponding type declarations.
src/payout/payout.module.ts(2,30): error TS2307: Cannot find module '../prisma/prisma.module' or its corresponding type declarations.
src/payout/payout.module.ts(3,32): error TS2307: Cannot find module '../accounts/accounts.module' or its corresponding type declarations.
src/payout/payout.module.ts(4,37): error TS2307: Cannot find module './payout.config.service' or its corresponding type declarations.
src/payout/payout.module.ts(5,34): error TS2307: Cannot find module './payout.controller' or its corresponding type declarations.
src/payout/payout.module.ts(6,34): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.
src/payout/payout.module.ts(7,31): error TS2307: Cannot find module './payout.service' or its corresponding type declarations.
src/payout/payout.module.ts(8,40): error TS2307: Cannot find module './payout-transfer.provider' or its corresponding type declarations.
src/payout/payout.module.ts(9,30): error TS2307: Cannot find module './payout.worker' or its corresponding type declarations.
src/payout/payout.repository.ts(3,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
src/payout/payout.repository.ts(4,32): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './dto-payout.js'?
src/payout/payout.repository.ts(5,37): error TS2307: Cannot find module './payout.config.service' or its corresponding type declarations.
src/payout/payout.repository.ts(65,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/payout/payout.repository.ts(106,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/payout/payout.repository.ts(141,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/payout/payout.repository.ts(166,44): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/payout/payout.repository.ts(198,43): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/payout/payout.service.ts(3,43): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './dto-payout.js'?
src/payout/payout.service.ts(4,34): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.
src/payout/payout.service.ts(5,37): error TS2307: Cannot find module './payout.config.service' or its corresponding type declarations.
src/payout/payout.service.ts(6,34): error TS2307: Cannot find module './transfer.provider' or its corresponding type declarations.
src/payout/payout.service.ts(85,25): error TS7006: Parameter 'p' implicitly has an 'any' type.
src/payout/payout.worker.ts(2,37): error TS2307: Cannot find module './payout.config.service' or its corresponding type declarations.
src/payout/payout.worker.ts(3,34): error TS2307: Cannot find module './payout.repository' or its corresponding type declarations.
src/payout/payout.worker.ts(4,31): error TS2307: Cannot find module './payout.service' or its corresponding type declarations.
src/prisma/prisma.module.ts(2,31): error TS2307: Cannot find module './prisma.service' or its corresponding type declarations.


$ tsc --noEmit (attempt 1) -> 2
src/main.ts(3,39): error TS2307: Cannot find module './payout/payout.exception-filter.js' or its corresponding type declarations.
src/main.ts(9,13): error TS2554: Expected 1-3 arguments, but got 0.
src/payout/payout.module.ts(5,34): error TS2307: Cannot find module './payout.controller.js' or its corresponding type declarations.
src/payout/payout.repository.ts(31,7): error TS2322: Type '{ account: { select: { balance: true; }; }; }' is not assignable to type 'never'.
src/payout/payout.repository.ts(38,7): error TS2322: Type '{ account: { select: { balance: true; }; }; }' is not assignable to type 'never'.


$ tsc --noEmit (attempt 2) -> 2
src/payout/payout.controller.ts(18,38): error TS2345: Argument of type '{ accountId: string; amount: string; destinationAddress: string; idempotencyKey: string; }' is not assignable to parameter of type '{ accountId: string; amount: bigint; destinationAddress: string; idempotencyKey: string; }'.
  Types of property 'amount' are incompatible.
    Type 'string' is not assignable to type 'bigint'.
src/payout/payout.exception-filter.ts(2,26): error TS2307: Cannot find module 'express' or its corresponding type declarations.

