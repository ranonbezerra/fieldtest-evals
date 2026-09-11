$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 5, reused 5, downloaded 0, added 0
Progress: resolved 6, reused 6, downloaded 0, added 0
Progress: resolved 7, reused 7, downloaded 0, added 0
Progress: resolved 8, reused 7, downloaded 0, added 0
Progress: resolved 8, reused 8, downloaded 0, added 0
Progress: resolved 57, reused 57, downloaded 0, added 0
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

Done in 9s using pnpm v10.28.2


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
accounts.repository.ts(3,35): error TS2307: Cannot find module '../prisma/prisma.service' or its corresponding type declarations.
accounts.repository.ts(4,34): error TS2307: Cannot find module 'pg' or its corresponding type declarations.
src/transfers/accounts.repository.ts(3,35): error TS2307: Cannot find module '../prisma/prisma.service.js' or its corresponding type declarations.
src/transfers/accounts.repository.ts(4,34): error TS2307: Cannot find module 'pg' or its corresponding type declarations.
src/transfers/transfers.service.ts(3,31): error TS2307: Cannot find module '../prisma/prisma.service.js' or its corresponding type declarations.
src/transfers/transfers.service.ts(5,28): error TS2307: Cannot find module '../risk/risk.client.js' or its corresponding type declarations.
src/transfers/transfers.service.ts(6,38): error TS2307: Cannot find module '../notifications/notifications.service.js' or its corresponding type declarations.
src/transfers/transfers.service.ts(7,35): error TS2307: Cannot find module './serializer.js' or its corresponding type declarations.
src/transfers/transfers.service.ts(28,58): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/transfers/transfers.service.ts(130,28): error TS7006: Parameter 't' implicitly has an 'any' type.
src/transfers/transfers.service.ts(140,34): error TS7006: Parameter 's' implicitly has an 'any' type.
src/transfers/transfers.service.ts(140,37): error TS7006: Parameter 'e' implicitly has an 'any' type.
src/transfers/transfers.service.ts(156,13): error TS7006: Parameter 'r' implicitly has an 'any' type.
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


$ tsc --noEmit (attempt 2) -> 2
prisma/prisma.service.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.
prisma/prisma.service.ts(9,16): error TS2339: Property '$connect' does not exist on type 'PrismaService'.
prisma/prisma.service.ts(12,16): error TS2339: Property '$disconnect' does not exist on type 'PrismaService'.
src/prisma/prisma.service.ts(2,10): error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'.
src/prisma/prisma.service.ts(9,16): error TS2339: Property '$connect' does not exist on type 'PrismaService'.
src/prisma/prisma.service.ts(12,16): error TS2339: Property '$disconnect' does not exist on type 'PrismaService'.
src/transfers/transfers.service.ts(28,38): error TS2339: Property '$transaction' does not exist on type 'PrismaService'.
src/transfers/transfers.service.ts(28,58): error TS7006: Parameter 'tx' implicitly has an 'any' type.
src/transfers/transfers.service.ts(97,38): error TS2339: Property 'transfer' does not exist on type 'PrismaService'.
src/transfers/transfers.service.ts(102,38): error TS2339: Property 'account' does not exist on type 'PrismaService'.
src/transfers/transfers.service.ts(107,25): error TS2339: Property 'account' does not exist on type 'PrismaService'.
src/transfers/transfers.service.ts(111,25): error TS2339: Property 'account' does not exist on type 'PrismaService'.
src/transfers/transfers.service.ts(115,25): error TS2339: Property 'transfer' does not exist on type 'PrismaService'.
src/transfers/transfers.service.ts(124,41): error TS2339: Property 'transfer' does not exist on type 'PrismaService'.
src/transfers/transfers.service.ts(130,28): error TS7006: Parameter 't' implicitly has an 'any' type.
src/transfers/transfers.service.ts(131,43): error TS2339: Property 'ledgerEntry' does not exist on type 'PrismaService'.
src/transfers/transfers.service.ts(134,48): error TS2339: Property 'account' does not exist on type 'PrismaService'.
src/transfers/transfers.service.ts(140,34): error TS7006: Parameter 's' implicitly has an 'any' type.
src/transfers/transfers.service.ts(140,37): error TS7006: Parameter 'e' implicitly has an 'any' type.
transfers.service.ts(28,38): error TS2339: Property '$transaction' does not exist on type 'PrismaService'.
transfers.service.ts(28,58): error TS7006: Parameter 'tx' implicitly has an 'any' type.
transfers.service.ts(97,38): error TS2339: Property 'transfer' does not exist on type 'PrismaService'.
transfers.service.ts(102,38): error TS2339: Property 'account' does not exist on type 'PrismaService'.
transfers.service.ts(107,25): error TS2339: Property 'account' does not exist on type 'PrismaService'.
transfers.service.ts(111,25): error TS2339: Property 'account' does not exist on type 'PrismaService'.
transfers.service.ts(115,25): error TS2339: Property 'transfer' does not exist on type 'PrismaService'.
transfers.service.ts(124,41): error TS2339: Property 'transfer' does not exist on type 'PrismaService'.
transfers.service.ts(130,28): error TS7006: Parameter 't' implicitly has an 'any' type.
transfers.service.ts(131,43): error TS2339: Property 'ledgerEntry' does not exist on type 'PrismaService'.
transfers.service.ts(134,48): error TS2339: Property 'account' does not exist on type 'PrismaService'.
transfers.service.ts(140,34): error TS7006: Parameter 's' implicitly has an 'any' type.
transfers.service.ts(140,37): error TS7006: Parameter 'e' implicitly has an 'any' type.

