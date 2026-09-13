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
+ @types/node 22.20.2
+ prisma 5.22.0 (8.0.0-rc.14 is available)
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 2.1.9 (5.0.0 is available)

Done in 2.8s using pnpm v10.28.2

$ prisma format -> 0
┌─────────────────────────────────────────────────────────┐
│  Update available 5.22.0 -> 8.0.0-rc.14                 │
│                                                         │
│  This is a major update - please follow the guide at    │
│  https://pris.ly/d/major-version-upgrade                │
│                                                         │
│  Run the following to update                            │
│    npm i --save-dev prisma@latest                       │
│    npm i @prisma/client@latest                          │
└─────────────────────────────────────────────────────────┘

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 20ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Interested in query caching in just a few lines of code? Try Accelerate today! https://pris.ly/tip-3-accelerate



$ tsc --noEmit (attempt 0) -> 2
src/anchor/anchor.controller.ts(2,31): error TS2307: Cannot find module './anchor.service' or its corresponding type declarations.
src/anchor/anchor.controller.ts(3,49): error TS2307: Cannot find module './anchor.types' or its corresponding type declarations.
src/anchor/anchor.module.ts(3,29): error TS2307: Cannot find module '../chain/chain-client.interface' or its corresponding type declarations.
src/anchor/anchor.module.ts(4,33): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../chain/fake-chain-client.js'?
src/anchor/anchor.module.ts(5,34): error TS2307: Cannot find module './anchor.controller' or its corresponding type declarations.
src/anchor/anchor.module.ts(6,31): error TS2307: Cannot find module './anchor.service' or its corresponding type declarations.
src/anchor/anchor.module.ts(7,34): error TS2307: Cannot find module './anchor.repository' or its corresponding type declarations.
src/anchor/anchor.module.ts(8,36): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './confirmation-worker.js'?
src/anchor/anchor.module.ts(9,31): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './recovery-sweep.js'?
src/anchor/anchor.repository.ts(3,54): error TS2307: Cannot find module './anchor.types' or its corresponding type declarations.
src/anchor/anchor.repository.ts(50,42): error TS2304: Cannot find name 'AnchorStatus'.
src/anchor/anchor.service.ts(4,34): error TS2307: Cannot find module '../chain/chain-client.interface' or its corresponding type declarations.
src/anchor/anchor.service.ts(5,34): error TS2307: Cannot find module './anchor.repository' or its corresponding type declarations.
src/anchor/anchor.service.ts(12,8): error TS2307: Cannot find module './anchor.types' or its corresponding type declarations.
src/anchor/confirmation-worker.ts(2,34): error TS2307: Cannot find module './anchor.repository' or its corresponding type declarations.
src/anchor/confirmation-worker.ts(3,34): error TS2307: Cannot find module '../chain/chain-client.interface' or its corresponding type declarations.
src/anchor/confirmation-worker.ts(4,35): error TS2307: Cannot find module './anchor.types' or its corresponding type declarations.
src/anchor/recovery-sweep.ts(2,34): error TS2307: Cannot find module './anchor.repository' or its corresponding type declarations.
src/anchor/recovery-sweep.ts(3,34): error TS2307: Cannot find module '../chain/chain-client.interface' or its corresponding type declarations.
src/anchor/recovery-sweep.ts(4,35): error TS2307: Cannot find module './anchor.types' or its corresponding type declarations.
src/app.module.ts(2,30): error TS2307: Cannot find module './anchor/anchor.module' or its corresponding type declarations.
src/chain/fake-chain-client.ts(3,48): error TS2307: Cannot find module './chain-client.interface' or its corresponding type declarations.
src/main.ts(2,27): error TS2307: Cannot find module './app.module' or its corresponding type declarations.
test/anchor.spec.ts(1,22): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/anchor.spec.ts(3,29): error TS2307: Cannot find module '../src/chain/chain-client.interface' or its corresponding type declarations.
test/anchor.spec.ts(4,33): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../src/chain/fake-chain-client.js'?
test/anchor.spec.ts(5,31): error TS2307: Cannot find module '../src/anchor/anchor.service' or its corresponding type declarations.
test/anchor.spec.ts(6,34): error TS2307: Cannot find module '../src/anchor/anchor.repository' or its corresponding type declarations.
test/anchor.spec.ts(7,36): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../src/anchor/confirmation-worker.js'?
test/anchor.spec.ts(8,31): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean '../src/anchor/recovery-sweep.js'?
test/anchor.spec.ts(9,34): error TS2307: Cannot find module '../src/anchor/anchor.controller' or its corresponding type declarations.
test/anchor.spec.ts(10,35): error TS2307: Cannot find module '../src/anchor/anchor.types' or its corresponding type declarations.
test/anchor.spec.ts(62,33): error TS1308: 'await' expressions are only allowed within async functions and at the top levels of modules.
test/anchor.spec.ts(62,46): error TS2307: Cannot find module '../src/anchor/anchor.service' or its corresponding type declarations.
test/anchor.spec.ts(69,33): error TS1308: 'await' expressions are only allowed within async functions and at the top levels of modules.
test/anchor.spec.ts(69,46): error TS2307: Cannot find module '../src/anchor/anchor.service' or its corresponding type declarations.
test/anchor.spec.ts(75,33): error TS1308: 'await' expressions are only allowed within async functions and at the top levels of modules.
test/anchor.spec.ts(75,46): error TS2307: Cannot find module '../src/anchor/anchor.service' or its corresponding type declarations.
test/anchor.spec.ts(88,28): error TS2708: Cannot use namespace 'jest' as a value.
test/anchor.spec.ts(184,28): error TS2708: Cannot use namespace 'jest' as a value.
test/anchor.spec.ts(204,28): error TS2708: Cannot use namespace 'jest' as a value.
test/anchor.spec.ts(235,28): error TS2708: Cannot use namespace 'jest' as a value.


$ tsc --noEmit (attempt 1) -> 2
src/anchor/anchor.module.ts(15,16): error TS2693: 'ChainClient' only refers to a type, but is being used as a value here.
src/anchor/anchor.module.ts(22,28): error TS2693: 'ChainClient' only refers to a type, but is being used as a value here.
src/anchor/anchor.repository.ts(10,51): error TS2322: Type 'CreateAnchorInput' is not assignable to type '(Without<AnchorCreateInput, AnchorUncheckedCreateInput> & AnchorUncheckedCreateInput) | (Without<...> & AnchorCreateInput)'.
  Type 'CreateAnchorInput' is not assignable to type 'Without<AnchorUncheckedCreateInput, AnchorCreateInput> & AnchorCreateInput'.
    Property 'status' is missing in type 'CreateAnchorInput' but required in type 'AnchorCreateInput'.
src/anchor/anchor.service.ts(73,7): error TS2353: Object literal may only specify known properties, and 'status' does not exist in type 'CreateAnchorInput'.
src/anchor/anchor.service.ts(83,5): error TS2322: Type 'AnchorRecord | null' is not assignable to type 'AnchorRecord'.
  Type 'null' is not assignable to type 'AnchorRecord'.
test/anchor.spec.ts(1,22): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/anchor.spec.ts(11,22): error TS2307: Cannot find module '@jest/globals' or its corresponding type declarations.
test/anchor.spec.ts(31,20): error TS2693: 'ChainClient' only refers to a type, but is being used as a value here.
test/anchor.spec.ts(42,50): error TS2693: 'ChainClient' only refers to a type, but is being used as a value here.
test/anchor.spec.ts(219,9): error TS2353: Object literal may only specify known properties, and 'status' does not exist in type 'CreateAnchorInput'.


$ tsc --noEmit (attempt 2) -> 2
src/anchor/anchor.controller.ts(12,7): error TS2322: Type 'AnchorRecord | null' is not assignable to type 'AnchorRecord'.
  Type 'null' is not assignable to type 'AnchorRecord'.
src/anchor/anchor.repository.ts(10,51): error TS2322: Type 'CreateAnchorInput' is not assignable to type '(Without<AnchorCreateInput, AnchorUncheckedCreateInput> & AnchorUncheckedCreateInput) | (Without<...> & AnchorCreateInput)'.
  Type 'CreateAnchorInput' is not assignable to type 'Without<AnchorUncheckedCreateInput, AnchorCreateInput> & AnchorCreateInput'.
    Property 'status' is missing in type 'CreateAnchorInput' but required in type 'AnchorCreateInput'.
src/anchor/anchor.service.ts(74,7): error TS2353: Object literal may only specify known properties, and 'status' does not exist in type 'CreateAnchorInput'.
test/anchor.spec.ts(1,22): error TS2307: Cannot find module '@nestjs/testing' or its corresponding type declarations.
test/anchor.spec.ts(87,28): error TS2708: Cannot use namespace 'jest' as a value.
test/anchor.spec.ts(91,14): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(92,14): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(93,14): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(94,14): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(96,50): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(117,14): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(118,14): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(119,14): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(133,32): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(144,30): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(171,14): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(173,30): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(175,28): error TS2708: Cannot use namespace 'jest' as a value.
test/anchor.spec.ts(191,14): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(193,28): error TS2708: Cannot use namespace 'jest' as a value.
test/anchor.spec.ts(199,49): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(205,32): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(218,9): error TS2353: Object literal may only specify known properties, and 'status' does not exist in type 'CreateAnchorInput'.
test/anchor.spec.ts(221,28): error TS2708: Cannot use namespace 'jest' as a value.
test/anchor.spec.ts(276,20): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(299,14): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(301,30): error TS18047: 'anchor' is possibly 'null'.
test/anchor.spec.ts(307,38): error TS18047: 'anchor' is possibly 'null'.


$ vitest run -> 1

 RUN  v2.1.9 /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/05-onchain-anchoring/runs/inclusionai-ling-3.0-flash--ladder/variant-a-single/workspace

 ❯ test/anchor.spec.ts (0 test)

 Test Files  1 failed (1)
      Tests  no tests
   Start at  02:10:55
   Duration  506ms (transform 358ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 36ms)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/anchor.spec.ts [ test/anchor.spec.ts ]
Error: Failed to load url @nestjs/testing (resolved id: @nestjs/testing) in /Users/ranonbezerra/RnnDev_local/fieldtest-evals/problems/05-onchain-anchoring/runs/inclusionai-ling-3.0-flash--ladder/variant-a-single/workspace/test/anchor.spec.ts. Does the file exist?
 ❯ loadAndTransform node_modules/.pnpm/vite@5.4.21_@types+node@22.20.2/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


