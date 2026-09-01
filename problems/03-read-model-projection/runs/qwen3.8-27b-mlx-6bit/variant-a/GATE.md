$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 30ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Want real-time updates to your database without manual polling? Discover how with Pulse: https://pris.ly/tip-0-pulse

┌─────────────────────────────────────────────────────────┐
│  Update available 5.22.0 -> 8.0.0-rc.12                 │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘


$ tsc --noEmit (attempt 0) -> 2
src/projections/projections.service.ts(22,5): error TS1128: Declaration or statement expected.


$ tsc --noEmit (attempt 1) -> 2
src/app.module.ts(2,34): error TS2307: Cannot find module './operations/operations.module' or its corresponding type declarations.
src/app.module.ts(3,35): error TS2307: Cannot find module './projections/projections.module' or its corresponding type declarations.
src/app.module.ts(4,30): error TS2307: Cannot find module './writes/writes.module' or its corresponding type declarations.
src/app.module.ts(5,35): error TS2307: Cannot find module './drift-repair/drift-repair.module' or its corresponding type declarations.
src/drift-repair/drift-repair.module.ts(2,35): error TS2307: Cannot find module '../projections/projections.module' or its corresponding type declarations.
src/drift-repair/drift-repair.module.ts(3,38): error TS2307: Cannot find module './drift-repair.processor' or its corresponding type declarations.
src/drift-repair/drift-repair.processor.ts(3,38): error TS2307: Cannot find module '@nestjs/schedule' or its corresponding type declarations.
src/drift-repair/drift-repair.processor.ts(5,36): error TS2307: Cannot find module '../projections/projections.service' or its corresponding type declarations.
src/drift-repair/drift-repair.processor.ts(6,34): error TS2307: Cannot find module '../projections/projections.types' or its corresponding type declarations.
src/projections/projections.module.ts(3,39): error TS2307: Cannot find module './projections.repository' or its corresponding type declarations.
src/projections/projections.module.ts(4,36): error TS2307: Cannot find module './projections.service' or its corresponding type declarations.
src/projections/projections.repository.ts(3,58): error TS2307: Cannot find module './projections.types' or its corresponding type declarations.
src/projections/projections.service.ts(2,39): error TS2307: Cannot find module './projections.repository' or its corresponding type declarations.
src/projections/projections.service.ts(9,8): error TS2307: Cannot find module './projections.types' or its corresponding type declarations.
src/projections/projections.service.ts(121,47): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/projections/projections.service.ts(122,55): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/projections/projections.service.ts(155,25): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/projections/projections.service.ts(156,29): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/projections/projections.service.ts(161,32): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/projections/projections.service.ts(164,28): error TS7006: Parameter 'r' implicitly has an 'any' type.
src/writes/writes.service.ts(3,36): error TS2307: Cannot find module '../projections/projections.service' or its corresponding type declarations.
src/writes/writes.service.ts(4,47): error TS2307: Cannot find module '../projections/projections.types' or its corresponding type declarations.
test/operations.spec.ts(542,81): error TS2339: Property 'id' does not exist on type 'string'.
test/operations.spec.ts(542,95): error TS2339: Property 'id' does not exist on type 'string'.
test/operations.spec.ts(545,88): error TS2339: Property 'id' does not exist on type 'string'.
test/operations.spec.ts(545,102): error TS2339: Property 'id' does not exist on type 'string'.
test/operations.spec.ts(556,35): error TS2339: Property 'id' does not exist on type 'string'.
test/operations.spec.ts(557,35): error TS2339: Property 'id' does not exist on type 'string'.


$ tsc --noEmit (attempt 2) -> 2
src/app.module.ts(2,34): error TS2307: Cannot find module './operations/operations.module' or its corresponding type declarations.
src/app.module.ts(3,35): error TS2307: Cannot find module './projections/projections.module' or its corresponding type declarations.
src/app.module.ts(4,30): error TS2307: Cannot find module './writes/writes.module' or its corresponding type declarations.
src/app.module.ts(5,35): error TS2307: Cannot find module './drift-repair/drift-repair.module' or its corresponding type declarations.
src/drift-repair/drift-repair.module.ts(2,32): error TS2307: Cannot find module '@nestjs/schedule' or its corresponding type declarations.
src/drift-repair/drift-repair.module.ts(3,35): error TS2307: Cannot find module '../projections/projections.module' or its corresponding type declarations.
src/drift-repair/drift-repair.module.ts(4,38): error TS2307: Cannot find module './drift-repair.processor' or its corresponding type declarations.
src/drift-repair/drift-repair.processor.ts(3,38): error TS2307: Cannot find module '@nestjs/schedule' or its corresponding type declarations.
src/drift-repair/drift-repair.processor.ts(5,36): error TS2307: Cannot find module '../projections/projections.service' or its corresponding type declarations.
src/drift-repair/drift-repair.processor.ts(6,34): error TS2307: Cannot find module '../projections/projections.types' or its corresponding type declarations.
src/projections/projections.module.ts(2,39): error TS2307: Cannot find module './projections.repository' or its corresponding type declarations.
src/projections/projections.module.ts(3,36): error TS2307: Cannot find module './projections.service' or its corresponding type declarations.
src/projections/projections.repository.ts(3,58): error TS2307: Cannot find module './projections.types' or its corresponding type declarations.
src/projections/projections.repository.ts(88,7): error TS2322: Type '{ worker: true; event: true; }' is not assignable to type 'never'.
src/projections/projections.repository.ts(98,28): error TS2339: Property 'name' does not exist on type 'never'.
src/projections/projections.repository.ts(100,27): error TS2339: Property 'title' does not exist on type 'never'.
src/projections/projections.repository.ts(101,30): error TS2339: Property 'location' does not exist on type 'never'.
src/projections/projections.service.ts(2,39): error TS2307: Cannot find module './projections.repository' or its corresponding type declarations.
src/projections/projections.service.ts(9,8): error TS2307: Cannot find module './projections.types' or its corresponding type declarations.
src/writes/writes.service.ts(3,36): error TS2307: Cannot find module '../projections/projections.service' or its corresponding type declarations.
src/writes/writes.service.ts(4,47): error TS2307: Cannot find module '../projections/projections.types' or its corresponding type declarations.
test/operations.spec.ts(8,39): error TS2307: Cannot find module '../src/projections/projections.repository' or its corresponding type declarations.
test/operations.spec.ts(9,36): error TS2307: Cannot find module '../src/projections/projections.service' or its corresponding type declarations.
test/operations.spec.ts(10,38): error TS2307: Cannot find module '../src/operations/operations.repository' or its corresponding type declarations.
test/operations.spec.ts(11,35): error TS2307: Cannot find module '../src/operations/operations.service' or its corresponding type declarations.
test/operations.spec.ts(12,31): error TS2307: Cannot find module '../src/writes/writes.service' or its corresponding type declarations.
test/operations.spec.ts(17,8): error TS2307: Cannot find module '../src/projections/projections.types' or its corresponding type declarations.
test/operations.spec.ts(53,16): error TS2551: Property 'companyFinancialTotals' does not exist on type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>'. Did you mean 'companyFinancialTotal'?
test/operations.spec.ts(126,35): error TS7006: Parameter 'o' implicitly has an 'any' type.
test/operations.spec.ts(150,25): error TS7006: Parameter 'o' implicitly has an 'any' type.
test/operations.spec.ts(151,24): error TS7006: Parameter 'o' implicitly has an 'any' type.
test/operations.spec.ts(256,40): error TS7006: Parameter 'o' implicitly has an 'any' type.

