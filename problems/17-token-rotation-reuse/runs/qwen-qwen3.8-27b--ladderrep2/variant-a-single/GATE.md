$ pnpm install -> 0
 WARN  deprecated supertest@6.3.4: Please upgrade to supertest v7.1.3+, see release notes at https://github.com/forwardemail/supertest/releases/tag/v7.1.3 - maintenance is supported by Forward Email @ https://forwardemail.net
Progress: resolved 1, reused 0, downloaded 0, added 0
Progress: resolved 13, reused 13, downloaded 0, added 0
Progress: resolved 213, reused 166, downloaded 0, added 0
 WARN  1 deprecated subdependencies found: superagent@8.1.2
Packages: +173
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 220, reused 173, downloaded 0, added 173, done

dependencies:
+ @nestjs/common 10.4.22 (12.0.1 is available)
+ @nestjs/core 10.4.22 (12.0.1 is available)
+ @prisma/client 5.22.0 (7.10.0 is available)
+ reflect-metadata 0.2.2
+ rxjs 7.8.2

devDependencies:
+ @nestjs/testing 10.4.22 (12.0.1 is available)
+ @types/express 4.17.25 (5.0.6 is available)
+ @types/node 20.19.43 (22.20.2 is available)
+ @types/supertest 6.0.3 (7.2.1 is available)
+ prisma 5.22.0 (8.0.0-rc.13 is available)
+ supertest 6.3.4 (7.2.2 is available) deprecated
+ typescript 5.9.3 (7.0.2 is available)
+ vitest 1.6.1 (5.0.0 is available)

Done in 3.5s using pnpm v10.28.2

$ prisma generate -> 0
Prisma schema loaded from prisma/schema.prisma

✔ Generated Prisma Client (v5.22.0) to ./node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/@prisma/client in 78ms

Start by importing your Prisma Client (See: https://pris.ly/d/importing-client)

Tip: Interested in query caching in just a few lines of code? Try Accelerate today! https://pris.ly/tip-3-accelerate

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
src/auth/auth.repository.ts(131,47): error TS2322: Type 'SecurityEventInput' is not assignable to type '(Without<SecurityEventCreateInput, SecurityEventUncheckedCreateInput> & SecurityEventUncheckedCreateInput) | (Without<...> & SecurityEventCreateInput)'.
  Type 'SecurityEventInput' is not assignable to type 'Without<SecurityEventUncheckedCreateInput, SecurityEventCreateInput> & SecurityEventCreateInput'.
    Type 'SecurityEventInput' is not assignable to type 'SecurityEventCreateInput'.
      Types of property 'details' are incompatible.
        Type 'Record<string, unknown>' is not assignable to type 'NullableJsonNullValueInput | InputJsonValue | undefined'.
          Type 'Record<string, unknown>' is missing the following properties from type 'readonly (InputJsonValue | null)[]': length, concat, join, slice, and 20 more.
test/auth.spec.ts(249,21): error TS2339: Property 'value' does not exist on type 'PromiseSettledResult<Response>'.
  Property 'value' does not exist on type 'PromiseRejectedResult'.


$ tsc --noEmit (attempt 1) -> 2
test/auth.spec.ts(249,27): error TS2339: Property 'body' does not exist on type 'never'.


$ tsc --noEmit (attempt 2) -> 0


$ vitest run -> 1

  })

     → Cannot read properties of undefined (reading 'close')
   ❯ test/auth.spec.ts > POST /auth/refresh > records a token that is both retired and expired as reuse, not as expiry
     → Nest can't resolve dependencies of the AuthService (?, ACCESS_TOKEN_ISSUER, CLOCK). Please make sure that the argument "AuthRepository" at index [0] is available in the RootTestModule context.

Potential solutions:
- Is RootTestModule a valid NestJS module?
- If "AuthRepository" is a provider, is it part of the current RootTestModule?
- If "AuthRepository" is exported from a separate @Module, is that module imported within RootTestModule?
  @Module({
    imports: [ /* the Module containing "AuthRepository" */ ]
  })

     → Cannot read properties of undefined (reading 'close')

 Test Files  1 failed (1)
      Tests  8 failed | 1 skipped (9)
   Start at  06:00:05
   Duration  342ms (transform 28ms, setup 0ms, collect 217ms, tests 9ms, environment 0ms, prepare 36ms)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 8 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/auth.spec.ts > POST /auth/refresh > rotates a presented token: retires it and issues a new pair with the same absolute deadline
 FAIL  test/auth.spec.ts > POST /auth/refresh > accepts the token from the refresh_token cookie and refreshes the cookie in the response
 FAIL  test/auth.spec.ts > POST /auth/refresh > lets the body win over the cookie when both are present, and clears a stale cookie
 FAIL  test/auth.spec.ts > POST /auth/refresh > lets exactly one of two concurrent refreshes of one token rotate; the loser is a reuse that kills the family
 FAIL  test/auth.spec.ts > POST /auth/refresh > replaying a retired token invalidates every descendant of the family
 FAIL  test/auth.spec.ts > POST /auth/refresh > never extends the absolute deadline fixed at sign-in
 FAIL  test/auth.spec.ts > POST /auth/refresh > returns a byte-identical 401 envelope for malformed, unknown, expired and retired tokens; only the audit log differs
 FAIL  test/auth.spec.ts > POST /auth/refresh > records a token that is both retired and expired as reuse, not as expiry
Error: Nest can't resolve dependencies of the AuthService (?, ACCESS_TOKEN_ISSUER, CLOCK). Please make sure that the argument "AuthRepository" at index [0] is available in the RootTestModule context.

Potential solutions:
- Is RootTestModule a valid NestJS module?
- If "AuthRepository" is a provider, is it part of the current RootTestModule?
- If "AuthRepository" is exported from a separate @Module, is that module imported within RootTestModule?
  @Module({
    imports: [ /* the Module containing "AuthRepository" */ ]
  })

 ❯ TestingInjector.lookupComponentInParentModules node_modules/.pnpm/@nestjs+core@10.4.22_@nestjs+common@10.4.22_reflect-metadata@0.2.2_rxjs@7.8.2__reflect-metadata@0.2.2_rxjs@7.8.2/node_modules/@nestjs/core/injector/injector.js:262:19
 ❯ TestingInjector.resolveComponentInstance node_modules/.pnpm/@nestjs+core@10.4.22_@nestjs+common@10.4.22_reflect-metadata@0.2.2_rxjs@7.8.2__reflect-metadata@0.2.2_rxjs@7.8.2/node_modules/@nestjs/core/injector/injector.js:215:33
 ❯ TestingInjector.resolveComponentInstance node_modules/.pnpm/@nestjs+testing@10.4.22_@nestjs+common@10.4.22_reflect-metadata@0.2.2_rxjs@7.8.2__@nest_110cf55618a21c66e345c91bbdff3aea/node_modules/@nestjs/testing/testing-injector.js:19:45
 ❯ resolveParam node_modules/.pnpm/@nestjs+core@10.4.22_@nestjs+common@10.4.22_reflect-metadata@0.2.2_rxjs@7.8.2__reflect-metadata@0.2.2_rxjs@7.8.2/node_modules/@nestjs/core/injector/injector.js:129:38
 ❯ TestingInjector.resolveConstructorParams node_modules/.pnpm/@nestjs+core@10.4.22_@nestjs+common@10.4.22_reflect-metadata@0.2.2_rxjs@7.8.2__reflect-metadata@0.2.2_rxjs@7.8.2/node_modules/@nestjs/core/injector/injector.js:144:27
 ❯ TestingInjector.loadInstance node_modules/.pnpm/@nestjs+core@10.4.22_@nestjs+common@10.4.22_reflect-metadata@0.2.2_rxjs@7.8.2__reflect-metadata@0.2.2_rxjs@7.8.2/node_modules/@nestjs/core/injector/injector.js:70:13
 ❯ TestingInjector.loadProvider node_modules/.pnpm/@nestjs+core@10.4.22_@nestjs+common@10.4.22_reflect-metadata@0.2.2_rxjs@7.8.2__reflect-metadata@0.2.2_rxjs@7.8.2/node_modules/@nestjs/core/injector/injector.js:98:9
 ❯ node_modules/.pnpm/@nestjs+core@10.4.22_@nestjs+common@10.4.22_reflect-metadata@0.2.2_rxjs@7.8.2__reflect-metadata@0.2.2_rxjs@7.8.2/node_modules/@nestjs/core/injector/instance-loader.js:56:13

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Serialized Error: { context: { index: +0, dependencies: [ 'AuthRepository', 'ACCESS_TOKEN_ISSUER', 'CLOCK' ], name: 'AuthRepository' }, metadata: { id: '87f8689a52009601de23d' }, moduleRef: { id: '44a9eeb39687f8689a520' }, what: 'Function<what>' }
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/16]⎯

 FAIL  test/auth.spec.ts > POST /auth/refresh > rotates a presented token: retires it and issues a new pair with the same absolute deadline
 FAIL  test/auth.spec.ts > POST /auth/refresh > accepts the token from the refresh_token cookie and refreshes the cookie in the response
 FAIL  test/auth.spec.ts > POST /auth/refresh > lets the body win over the cookie when both are present, and clears a stale cookie
 FAIL  test/auth.spec.ts > POST /auth/refresh > lets exactly one of two concurrent refreshes of one token rotate; the loser is a reuse that kills the family
 FAIL  test/auth.spec.ts > POST /auth/refresh > replaying a retired token invalidates every descendant of the family
 FAIL  test/auth.spec.ts > POST /auth/refresh > never extends the absolute deadline fixed at sign-in
 FAIL  test/auth.spec.ts > POST /auth/refresh > returns a byte-identical 401 envelope for malformed, unknown, expired and retired tokens; only the audit log differs
 FAIL  test/auth.spec.ts > POST /auth/refresh > records a token that is both retired and expired as reuse, not as expiry
TypeError: Cannot read properties of undefined (reading 'close')
 ❯ test/auth.spec.ts:187:15
    185| 
    186|   afterEach(async () => {
    187|     await app.close();
       |               ^
    188|   });
    189| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/16]⎯


