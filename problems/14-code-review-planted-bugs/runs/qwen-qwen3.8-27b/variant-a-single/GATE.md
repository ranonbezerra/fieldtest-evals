$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 8, reused 8, downloaded 0, added 0
Progress: resolved 29, reused 29, downloaded 0, added 0
Progress: resolved 66, reused 66, downloaded 0, added 0
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
+ @types/node 22.20.1 (26.4.1 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 4.9s using pnpm v10.28.2


$ tsc --noEmit (attempt 0) -> 2
accounts.repository.ts(3,35): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
accounts.repository.ts(4,34): error TS2307: Cannot find module 'pg' or its corresponding type declarations.
transfers.service.ts(3,31): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
transfers.service.ts(4,36): error TS2307: Cannot find module './accounts.repository' or its corresponding type declarations.
transfers.service.ts(5,28): error TS2307: Cannot find module '../risk/risk.client' or its corresponding type declarations.
transfers.service.ts(6,38): error TS2307: Cannot find module '../notifications/notifications.service' or its corresponding type declarations.
transfers.service.ts(7,35): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './serializer.js'?
transfers.service.ts(28,58): error TS7006: Parameter 'tx' implicitly has an 'any' type.
transfers.service.ts(130,28): error TS7006: Parameter 't' implicitly has an 'any' type.
transfers.service.ts(140,34): error TS7006: Parameter 's' implicitly has an 'any' type.
transfers.service.ts(140,37): error TS7006: Parameter 'e' implicitly has an 'any' type.
transfers.service.ts(156,13): error TS7006: Parameter 'r' implicitly has an 'any' type.


$ tsc --noEmit (attempt 1) -> 2
accounts.repository.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
accounts.repository.ts(2,18): error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.
transfers.service.ts(3,31): error TS2307: Cannot find module '../prisma/prisma.service.js' or its corresponding type declarations.
transfers.service.ts(7,28): error TS2307: Cannot find module '../risk/risk.client.js' or its corresponding type declarations.
transfers.service.ts(9,38): error TS2307: Cannot find module '../notifications/notifications.service.js' or its corresponding type declarations.
transfers.service.ts(10,10): error TS2305: Module '"./serializer.js"' has no exported member 'serializeMoney'.
transfers.service.ts(11,15): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
transfers.service.ts(52,27): error TS2339: Property 'lockAccount' does not exist on type 'AccountsRepository'.
transfers.service.ts(53,27): error TS2339: Property 'lockAccount' does not exist on type 'AccountsRepository'.
transfers.service.ts(55,47): error TS2339: Property 'getAccount' does not exist on type 'AccountsRepository'.
transfers.service.ts(74,27): error TS2339: Property 'applyDebit' does not exist on type 'AccountsRepository'.
transfers.service.ts(75,27): error TS2339: Property 'applyCredit' does not exist on type 'AccountsRepository'.
transfers.service.ts(154,27): error TS2339: Property 'applyDebit' does not exist on type 'AccountsRepository'.
transfers.service.ts(160,27): error TS2339: Property 'applyCredit' does not exist on type 'AccountsRepository'.
transfers.service.ts(182,41): error TS2339: Property 'fetchRawBalances' does not exist on type 'AccountsRepository'.


$ tsc --noEmit (attempt 2) -> 2
accounts.repository.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.
accounts.repository.ts(2,24): error TS2305: Module '"@prisma/client"' has no exported member 'Prisma'.
transfers.service.ts(5,10): error TS2305: Module '"./serializer.js"' has no exported member 'formatMoney'.
transfers.service.ts(80,54): error TS7006: Parameter 'row' implicitly has an 'any' type.

