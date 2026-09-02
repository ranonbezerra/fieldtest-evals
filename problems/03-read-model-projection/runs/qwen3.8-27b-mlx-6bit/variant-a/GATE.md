$ pnpm install -> 0
Progress: resolved 1, reused 0, downloaded 0, added 0

   ╭──────────────────────────────────────────╮
   │                                          │
   │   Update available! 10.28.2 → 11.25.0.   │
   │   Changelog: https://pnpm.io/v/11.25.0   │
   │     To update, run: pnpm self-update     │
   │                                          │
   ╰──────────────────────────────────────────╯

Progress: resolved 36, reused 36, downloaded 0, added 0
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
+ @types/node 22.20.1 (26.4.1 is available)
+ prisma 5.22.0 (8.0.0-rc.12 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (4.1.11 is available)

Done in 2.8s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 29ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Interested in query caching in just a few lines of code? Try Accelerate today! https://pris.ly/tip-3-accelerate



$ tsc --noEmit (attempt 0) -> 2
src/app.module.ts(2,34): error TS2307: Cannot find module './operations/operations.module' or its corresponding type declarations.
src/app.module.ts(3,36): error TS2307: Cannot find module './re-derivation/re-derivation.module' or its corresponding type declarations.
src/app.module.ts(4,35): error TS2307: Cannot find module './drift-repair/drift-repair.module' or its corresponding type declarations.
src/drift-repair/drift-repair.module.ts(2,34): error TS2307: Cannot find module '../operations/operations.module' or its corresponding type declarations.
src/drift-repair/drift-repair.module.ts(3,36): error TS2307: Cannot find module './drift-repair.service' or its corresponding type declarations.
src/drift-repair/drift-repair.service.ts(2,38): error TS2307: Cannot find module '@nestjs/schedule' or its corresponding type declarations.
src/drift-repair/drift-repair.service.ts(4,38): error TS2307: Cannot find module '../operations/operations.repository' or its corresponding type declarations.
src/drift-repair/drift-repair.service.ts(5,54): error TS2307: Cannot find module '../operations/operations.types' or its corresponding type declarations.
src/main.ts(3,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.
src/operations/operations.controller.ts(2,35): error TS2307: Cannot find module './operations.service' or its corresponding type declarations.
src/operations/operations.controller.ts(10,8): error TS2307: Cannot find module './operations.types' or its corresponding type declarations.
src/operations/operations.controller.ts(11,33): error TS2307: Cannot find module './operations.types' or its corresponding type declarations.
src/operations/operations.module.ts(2,38): error TS2307: Cannot find module './operations.controller' or its corresponding type declarations.
src/operations/operations.module.ts(3,35): error TS2307: Cannot find module './operations.service' or its corresponding type declarations.
src/operations/operations.module.ts(4,38): error TS2307: Cannot find module './operations.repository' or its corresponding type declarations.
src/operations/operations.repository.ts(1,32): error TS2305: Module '"@prisma/client"' has no exported member 'Decimal'.
src/operations/operations.repository.ts(8,8): error TS2307: Cannot find module './operations.types' or its corresponding type declarations.
src/operations/operations.service.ts(1,32): error TS2305: Module '"@prisma/client"' has no exported member 'Decimal'.
src/operations/operations.service.ts(2,38): error TS2307: Cannot find module './operations.repository' or its corresponding type declarations.
src/operations/operations.service.ts(10,8): error TS2307: Cannot find module './operations.types' or its corresponding type declarations.
src/operations/operations.service.ts(15,8): error TS2307: Cannot find module './operations.types' or its corresponding type declarations.
src/re-derivation/re-derivation.controller.ts(2,36): error TS2307: Cannot find module '../operations/operations.types' or its corresponding type declarations.
src/re-derivation/re-derivation.controller.ts(3,37): error TS2307: Cannot find module './re-derivation.service' or its corresponding type declarations.
src/re-derivation/re-derivation.module.ts(2,34): error TS2307: Cannot find module '../operations/operations.module' or its corresponding type declarations.
src/re-derivation/re-derivation.module.ts(3,37): error TS2307: Cannot find module './re-derivation.service' or its corresponding type declarations.
src/re-derivation/re-derivation.module.ts(4,40): error TS2307: Cannot find module './re-derivation.controller' or its corresponding type declarations.
src/re-derivation/re-derivation.repository.ts(1,43): error TS2307: Cannot find module '../operations/operations.repository' or its corresponding type declarations.
src/re-derivation/re-derivation.service.ts(3,43): error TS2307: Cannot find module '../operations/operations.repository' or its corresponding type declarations.
src/re-derivation/re-derivation.service.ts(4,69): error TS2307: Cannot find module '../operations/operations.types' or its corresponding type declarations.
src/re-derivation/re-derivation.service.ts(5,39): error TS2307: Cannot find module '../operations/operations.types' or its corresponding type declarations.
test/drift-repair.spec.ts(2,36): error TS2307: Cannot find module '../src/drift-repair/drift-repair.service' or its corresponding type declarations.
test/drift-repair.spec.ts(166,13): error TS2352: Conversion of type 'MockProjectionRow' to type 'Record<string, unknown>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Index signature for type 'string' is missing in type 'MockProjectionRow'.
test/operations.spec.ts(4,38): error TS2307: Cannot find module '../src/operations/operations.repository' or its corresponding type declarations.
test/operations.spec.ts(5,35): error TS2307: Cannot find module '../src/operations/operations.service' or its corresponding type declarations.
test/operations.spec.ts(10,8): error TS2307: Cannot find module '../src/operations/operations.types' or its corresponding type declarations.
test/operations.spec.ts(295,44): error TS7006: Parameter 'r' implicitly has an 'any' type.
test/operations.spec.ts(343,40): error TS7006: Parameter 'r' implicitly has an 'any' type.
test/re-derivation.spec.ts(2,37): error TS2307: Cannot find module '../src/re-derivation/re-derivation.service' or its corresponding type declarations.
test/re-derivation.spec.ts(3,39): error TS2307: Cannot find module '../src/operations/operations.types' or its corresponding type declarations.
test/re-derivation.spec.ts(4,49): error TS2307: Cannot find module '../src/operations/operations.types' or its corresponding type declarations.


$ tsc --noEmit (attempt 1) -> 2
 Cannot find module './app.module' or its corresponding type declarations.
src/operations/operations.controller.ts(2,35): error TS2307: Cannot find module './operations.service' or its corresponding type declarations.
src/operations/operations.controller.ts(10,8): error TS2307: Cannot find module './operations.types' or its corresponding type declarations.
src/operations/operations.module.ts(6,38): error TS2307: Cannot find module './operations.controller' or its corresponding type declarations.
src/operations/operations.repository.ts(8,8): error TS2307: Cannot find module './operations.types' or its corresponding type declarations.
src/operations/operations.repository.ts(23,14): error TS2551: Property 'operations' does not exist on type 'TransactionClient'. Did you mean 'operation'?
src/operations/operations.repository.ts(47,25): error TS2724: '"/Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/03-read-model-projection/runs/qwen3.8-27b-mlx-6bit/variant-a/workspace/node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client/index".Prisma' has no exported member named 'OperationsWhereInput'. Did you mean 'OperationWhereInput'?
src/operations/operations.repository.ts(60,19): error TS2551: Property 'operations' does not exist on type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>'. Did you mean 'operation'?
src/operations/operations.repository.ts(66,19): error TS2551: Property 'operations' does not exist on type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>'. Did you mean 'operation'?
src/operations/operations.repository.ts(70,23): error TS7006: Parameter 'row' implicitly has an 'any' type.
src/operations/operations.repository.ts(102,24): error TS2551: Property 'workers' does not exist on type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>'. Did you mean 'worker'?
src/operations/operations.repository.ts(109,37): error TS2551: Property 'events' does not exist on type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>'. Did you mean 'event'?
src/operations/operations.repository.ts(118,36): error TS2551: Property 'operations' does not exist on type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>'. Did you mean 'operation'?
src/operations/operations.repository.ts(123,22): error TS7006: Parameter 'row' implicitly has an 'any' type.
src/operations/operations.repository.ts(127,35): error TS2551: Property 'operations' does not exist on type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>'. Did you mean 'operation'?
src/operations/operations.repository.ts(134,35): error TS2551: Property 'companyFinancialTotals' does not exist on type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>'. Did you mean 'companyFinancialTotal'?
src/operations/operations.service.ts(3,38): error TS2307: Cannot find module './operations.repository' or its corresponding type declarations.
src/operations/operations.service.ts(13,8): error TS2307: Cannot find module './operations.types' or its corresponding type declarations.
src/re-derivation/re-derivation.controller.ts(2,31): error TS2307: Cannot find module '../operations/operations.types' or its corresponding type declarations.
src/re-derivation/re-derivation.controller.ts(3,37): error TS2307: Cannot find module './re-derivation.service' or its corresponding type declarations.
src/re-derivation/re-derivation.module.ts(2,34): error TS2307: Cannot find module '../operations/operations.module' or its corresponding type declarations.
src/re-derivation/re-derivation.module.ts(3,37): error TS2307: Cannot find module './re-derivation.service' or its corresponding type declarations.
src/re-derivation/re-derivation.module.ts(4,40): error TS2307: Cannot find module './re-derivation.controller' or its corresponding type declarations.
src/re-derivation/re-derivation.repository.ts(6,36): error TS2307: Cannot find module '../operations/operations.types' or its corresponding type declarations.
src/re-derivation/re-derivation.service.ts(2,38): error TS2307: Cannot find module '../operations/operations.repository' or its corresponding type declarations.
src/re-derivation/re-derivation.service.ts(3,36): error TS2307: Cannot find module '../operations/operations.types' or its corresponding type declarations.
src/re-derivation/re-derivation.service.ts(4,39): error TS2307: Cannot find module '../operations/operations.types' or its corresponding type declarations.
test/drift-repair.spec.ts(3,36): error TS2307: Cannot find module '../src/drift-repair/drift-repair.service' or its corresponding type declarations.
test/drift-repair.spec.ts(75,21): error TS2367: This comparison appears to be unintentional because the types '1' and '0' have no overlap.
test/drift-repair.spec.ts(106,21): error TS2367: This comparison appears to be unintentional because the types '1' and '0' have no overlap.
test/drift-repair.spec.ts(135,21): error TS2367: This comparison appears to be unintentional because the types '1' and '0' have no overlap.
test/operations.spec.ts(2,43): error TS2307: Cannot find module '../src/operations/operations.repository' or its corresponding type declarations.
test/operations.spec.ts(3,35): error TS2307: Cannot find module '../src/operations/operations.service' or its corresponding type declarations.
test/operations.spec.ts(10,8): error TS2307: Cannot find module '../src/operations/operations.types' or its corresponding type declarations.
test/operations.spec.ts(15,8): error TS2307: Cannot find module '../src/operations/operations.types' or its corresponding type declarations.
test/re-derivation.spec.ts(2,37): error TS2307: Cannot find module '../src/re-derivation/re-derivation.service' or its corresponding type declarations.
test/re-derivation.spec.ts(3,54): error TS2307: Cannot find module '../src/operations/operations.types' or its corresponding type declarations.
test/re-derivation.spec.ts(4,43): error TS2307: Cannot find module '../src/operations/operations.repository' or its corresponding type declarations.


$ tsc --noEmit (attempt 2) -> 2
src/app.module.ts(2,32): error TS2307: Cannot find module '@nestjs/schedule' or its corresponding type declarations.
src/app.module.ts(3,34): error TS2307: Cannot find module './operations/operations.module' or its corresponding type declarations.
src/app.module.ts(4,36): error TS2307: Cannot find module './re-derivation/re-derivation.module' or its corresponding type declarations.
src/app.module.ts(5,35): error TS2307: Cannot find module './drift-repair/drift-repair.module' or its corresponding type declarations.
src/drift-repair/drift-repair.module.ts(2,34): error TS2307: Cannot find module '../operations/operations.module' or its corresponding type declarations.
src/drift-repair/drift-repair.module.ts(3,36): error TS2307: Cannot find module './drift-repair.service' or its corresponding type declarations.
src/drift-repair/drift-repair.service.ts(2,38): error TS2307: Cannot find module '../operations/operations.repository' or its corresponding type declarations.
src/drift-repair/drift-repair.service.ts(3,49): error TS2307: Cannot find module '../operations/operations.types' or its corresponding type declarations.
src/drift-repair/drift-repair.service.ts(30,37): error TS7006: Parameter 'o' implicitly has an 'any' type.
src/operations/operations.controller.ts(7,35): error TS2307: Cannot find module './operations.service' or its corresponding type declarations.
src/operations/operations.controller.ts(15,8): error TS2307: Cannot find module './operations.types' or its corresponding type declarations.
src/operations/operations.module.ts(2,38): error TS2307: Cannot find module './operations.controller' or its corresponding type declarations.
src/operations/operations.module.ts(3,35): error TS2307: Cannot find module './operations.service' or its corresponding type declarations.
src/operations/operations.module.ts(4,38): error TS2307: Cannot find module './operations.repository' or its corresponding type declarations.
src/operations/operations.repository.ts(1,32): error TS2305: Module '"@prisma/client"' has no exported member 'Decimal'.
src/operations/operations.repository.ts(8,8): error TS2307: Cannot find module './operations.types' or its corresponding type declarations.
src/operations/operations.repository.ts(22,7): error TS2322: Type '{ orderId: any; companyId: any; status: any; amount: any; currency: any; workerName: string; workerRole: string; lastEventType: string | null; createdAt: Date; }' is not assignable to type '(Without<OperationCreateInput, OperationUncheckedCreateInput> & OperationUncheckedCreateInput) | (Without<...> & OperationCreateInput)'.
  Type '{ orderId: any; companyId: any; status: any; amount: any; currency: any; workerName: string; workerRole: string; lastEventType: string | null; createdAt: Date; }' is not assignable to type 'Without<OperationUncheckedCreateInput, OperationCreateInput> & OperationCreateInput'.
    Type '{ orderId: any; companyId: any; status: any; amount: any; currency: any; workerName: string; workerRole: string; lastEventType: string | null; createdAt: Date; }' is missing the following properties from type 'OperationCreateInput': updatedAt, paymentOrder
src/operations/operations.service.ts(2,38): error TS2307: Cannot find module './operations.repository' or its corresponding type declarations.
src/operations/operations.service.ts(12,8): error TS2307: Cannot find module './operations.types' or its corresponding type declarations.
src/re-derivation/re-derivation.module.ts(2,34): error TS2307: Cannot find module '../operations/operations.module' or its corresponding type declarations.
src/re-derivation/re-derivation.module.ts(3,37): error TS2307: Cannot find module './re-derivation.service' or its corresponding type declarations.
src/re-derivation/re-derivation.module.ts(4,40): error TS2307: Cannot find module './re-derivation.controller' or its corresponding type declarations.
src/re-derivation/re-derivation.repository.ts(1,36): error TS2307: Cannot find module '../operations/operations.types' or its corresponding type declarations.
src/re-derivation/re-derivation.service.ts(23,43): error TS2339: Property 'reDeriveWindow' does not exist on type 'OperationsRepository'.
test/drift-repair.spec.ts(2,36): error TS2307: Cannot find module '../src/drift-repair/drift-repair.service' or its corresponding type declarations.
test/drift-repair.spec.ts(4,38): error TS2307: Cannot find module '../src/operations/operations.repository' or its corresponding type declarations.
test/operations.spec.ts(74,51): error TS18048: 'query.date_from' is possibly 'undefined'.
test/operations.spec.ts(77,51): error TS18048: 'query.date_to' is possibly 'undefined'.
test/re-derivation.spec.ts(2,37): error TS2307: Cannot find module '../src/re-derivation/re-derivation.service' or its corresponding type declarations.
test/re-derivation.spec.ts(3,50): error TS2307: Cannot find module '../src/operations/operations.types' or its corresponding type declarations.
test/re-derivation.spec.ts(4,43): error TS2307: Cannot find module '../src/operations/operations.repository' or its corresponding type declarations.

