# 09-wiring.spec.ts-cases

## reasoning

```
The user wants me to list the test cases for `test/wiring.spec.ts` based on the PLAN.md and the implementation files provided. I need to follow the format:

- <name of the test> — <what it proves, and what would have to be broken for it to fail>

Let me analyze what the plan says should be tested and what could go wrong:

From PLAN.md section 5, the planned tests are:
1. `compiles the full DI graph` — Every provider in every module is resolvable; no missing export/import boundary; no TDZ / cyclic-initialisation error at file-load time
2. `resolves NotificationsService` — The specific provider that was in the original stack trace is injectable end-to-end
3. `resolves ExportService in UsersModule context` — The cross-module export/import for the export service is correctly wired
4. `resolves RetryProcessor in NotificationsModule context` — The retry processor is exported and imported where needed
5. `QUEUES is a frozen, importable const` — QUEUES lives in a leaf file; importing it has no side-effects

Now let me think about what could be broken for each, and whether I'm missing any cases:

1. Full DI graph compilation — would fail if: any provider is missing from a module's `providers` array, any `@Inject()` token is not provided in the same or an imported module, any module that should be imported isn't in `imports`. This is the "catch-all" but it's also the most important.

2. Resolves NotificationsService — would fail if: NotificationsService is not in NotificationsModule's providers, or if NotificationsModule is not imported by AppModule. Actually this is somewhat redundant with #1 since compile() would catch it. But the plan says "guards against a provider being registered under the wrong token." So maybe the failure is if NotificationsService is provided but under a different injection token, or if it's not exported where needed.

Wait, let me re-think. The plan says:
- Test 1: compile() the full graph — catches missing providers, missing exports/imports, TDZ errors
- Test 2: resolve NotificationsService specifically — guards against wrong token registration
- Test 3: resolve ExportService in UsersModule context — guards against users module forgetting imports: [ExportModule]
- Test 4: resolve RetryProcessor in NotificationsModule context — guards against notifications module missing imports: [RetryModule]
- Test 5: QUEUES is a frozen importable const — structural guarantee against re-introducing the cycle

Now, what are the "awkward" cases the prompt asks me to consider?
- Concurrency: not really applicable here since this is DI wiring, not runtime concurrency
- Duplicate delivery: not applicable
- Exhaustion: not applicable
- Boundary values: not really applicable
- Error path that looks like success: What if compile() succeeds but a provider is actually a stub? The plan says "No provider replaced by a stub to get past an error." So maybe a test that asserts the resolved service is actually the real class, not a mock.

Let me also think about:
- What if AppModule doesn't import ExportModule? Then ExportService wouldn't be available in the root context. But if UsersModule imports it, it would still be available within UsersModule. The question is whether the test checks at the root level or the module level.
- What if a module exports a provider it doesn't provide? That would be a compile error.
- What if there's a duplicate provider registration (same class in two modules in the same scope)? That could cause issues.

Let me also consider: the plan mentions "resolves ExportService in UsersModule context" — this implies getting the service from within the users module's scope, not just the root. This is different from just checking it exists at the root level.

Actually, re-reading the plan more carefully:

The wiring check mechanism is: `Test.createTestingModule({ imports: [AppModule] }).compile()` with PrismaService overridden.

So the tests would:
1. Create a testing module with AppModule imported, override PrismaService
2. Compile it
3. Get specific services from the compiled module

Let me think about what would have to be broken:

For test 1 (full graph compiles):
- Any module missing from AppModule.imports
- Any provider missing from its module's providers array
- Any cross-module dependency where the consumer module doesn't import the provider module
- Any provider that's used across modules but not in exports
- A circular import at the file level (TDZ) — like the original QUEUES issue

For test 2 (resolves NotificationsService):
- NotificationsService not in NotificationsModule.providers
- NotificationsModule not in AppModule.imports
- Actually, if compile() passes (test 1), then getting it should work unless the token is wrong. But in NestJS, class-based tokens are the class itself, so "wrong token" would mean... actually this is hard to break without a compile error. Unless the service is provided but the test gets it from the wrong module scope.

Hmm, let me reconsider. In NestJS testing:
- `module.get(NotificationsService)` gets it from the root scope
- If NotificationsModule is imported by AppModule, and NotificationsService is a provider there, it should be accessible

The "wrong token" scenario: what if someone provides NotificationsService under a custom injection token instead of the class itself? Then `module.get(NotificationsService)` would fail.

For test 3 (ExportService in UsersModule context):
- ExportModule not in UsersModule.imports
- ExportService not in ExportModule.exports
- ExportService not in ExportModule.providers

For test 4 (RetryProcessor in NotificationsModule context):
- RetryModule not in NotificationsModule.imports
- RetryProcessor not in RetryModule.exports
- RetryProcessor not in RetryModule.providers

For test 5 (QUEUES is a leaf):
- QUEUES imported from a feature file instead of common/
- QUEUES file imports something from src/ (creating a potential cycle)
- QUEUES is not `as const` or not frozen

Now, what about additional cases I should consider:

- What if a module is in AppModule.imports but its providers array is empty (the module exists but provides nothing)?
- What if ExportModule is imported by AppModule but NOT by UsersModule, and UsersService depends on ExportService? In this case, the root compile might pass (because ExportService is available at root level through AppModule→ExportModule), but UsersService wouldn't have access to it within its own module scope. Wait, actually in NestJS, if AppModule imports ExportModule, and UsersModule is also imported by AppModule, does UsersModule get access to ExportModule's exports? No! In NestJS, module scope is isolated. UsersModule can only access providers from modules it directly imports. So if UsersModule doesn't import ExportModule, UsersService can't inject ExportService even if it's available at the root level.

This is an important distinction. The full graph compile (test 1) would actually catch this because NestJS validates that every injected dependency is satisfied within the module's scope. So if UsersService has `constructor(private readonly exportService: ExportService)` and UsersModule doesn't import ExportModule, compile() would throw.

So actually test 1 might subsume tests 3 and 4. But the plan explicitly calls them out as separate cases, which makes sense for:
- Clearer failure messages (you know exactly which cross-module boundary broke)
- The plan says "guards against" specific scenarios

Let me also think about: what if PrismaService is not properly overridden? The plan says to override it. If the test forgets to override it, the test would try to connect to a database and fail (or hang). But that's a test implementation issue, not a wiring issue. I won't include this as a test case.

What about: what if a provider is registered twice (e.g., ExportService in both ExportModule.providers and UsersModule.providers)? In NestJS, this would create two separate instances. The test might pass (compile succeeds) but the behavior would be wrong (two instances). However, the plan says "Change wiring, not behaviour" and the test is about wiring correctness. A duplicate provider is a wiring smell but might not be caught by compile(). I could include this as an awkward case.

Actually, in NestJS, if you register the same class as a provider in two modules that are both in the dependency tree, you get two instances. This is a valid wiring defect. But would it be caught? Only if the test checks that there's exactly one instance. The plan doesn't mention this explicitly, but it's an "awkward" case.

Let me also consider: what about the PrismaService override itself? If the override doesn't match the actual provider token, the real PrismaService would be used and try to connect. This is more of a test implementation detail.

I think the key cases are:

1. Full DI graph compiles (the "kitchen sink" test)
2. NotificationsService is resolvable at root level
3. ExportService is resolvable from UsersModule's scope (cross-module boundary)
4. RetryProcessor is resolvable from NotificationsModule's scope (cross-module boundary)
5. QUEUES is importable as a leaf with no side effects (structural cycle prevention)

And maybe:
6. No duplicate provider instances for cross-module services (awkward case)
7. The resolved services are the real classes, not stubs/mocks (guards against "provider replaced by a stub")

Wait, the plan says "No provider replaced by a stub to get past an error" as a constraint on the fix, not necessarily something the test needs to verify. The test verifies wiring, and if a stub is in place, the DI graph would still compile (the stub satisfies the token). So the test CAN'T catch a stub unless it checks the class identity.

Actually, that's a good point. If someone replaces ExportService with `class FakeExport {}` in providers, the compile would pass. The test that does `module.get(ExportService)` would fail because the token wouldn't match. But if they provide `provide: ExportService, useValue: fakeInstance`, the token would match but the instance would be wrong. The test could catch this by checking `instanceof`.

Let me finalize my list:

1. Full DI graph compiles without error
2. NotificationsService resolves at the root module level
3. ExportService is injectable within UsersModule's scope (proving UsersModule imports ExportModule AND ExportModule exports ExportService)
4. RetryProcessor is injectable within NotificationsModule's scope (proving NotificationsModule imports RetryModule AND RetryModule exports RetryProcessor)
5. QUEUES is a structural leaf (importing it pulls in zero feature modules)
6. Resolved cross-module instances are singletons (no duplicate registration) — awkward case
7. Resolved services are the real classes, not useValue stubs — guards against constraint violation

Actually, for #6 and #7, let me think about whether these are realistic:
- #6: In the plan's architecture, each service is provided in exactly one module. A duplicate would be a regression. This is a valid "awkward" case.
- #7: The constraint says no stubs. A test that checks `instanceof` would catch a `useValue` or `useClass` substitution. This is reasonable.

Let me also think: is there a case where the module compiles but a service is `undefined` at runtime? In NestJS, if compile() passes, the instances are created. So no, that's not possible.

What about: what if AppModule doesn't import a module, but that module is still "reachable" through another path? In NestJS, modules are only reachable through the import chain from the root. If AppModule doesn't import ExportModule, and no other module in the tree imports it, then ExportModule is simply not loaded. But if UsersModule imports ExportModule, and AppModule imports UsersModule, then ExportModule IS loaded (as a transitive import). In that case, `module.get(ExportService)` at the root level might or might not work depending on NestJS's scoping rules.

Actually in NestJS, `module.get()` at the root testing module level can only get providers that are exported up to the root. If ExportModule is imported by UsersModule (not by AppModule directly), and ExportModule exports ExportService, then ExportService is available in UsersModule's scope but NOT in AppModule's scope (unless UsersModule also re-exports it, which it doesn't per the plan).

So if the test does `rootModule.get(ExportService)` and ExportModule is only imported by UsersModule (not AppModule), it would fail. But the plan says AppModule imports ALL four modules directly. So this is fine.

But what if someone removes ExportModule from AppModule.imports but leaves it in UsersModule.imports? Then:
- compile() would still pass (UsersService can inject ExportService through UsersModule→ExportModule)
- `rootModule.get(ExportService)` would fail (not available at root scope)

This is why test 3 ("resolves ExportService in UsersModule context") is important — but wait, if we're testing from the root module, how do we test "in UsersModule context"? In NestJS testing, I think you'd just do `module.get(ExportService)` and it would work if ExportModule is in the tree at all (because the testing module flattens things). Hmm, actually I'm not sure about this.

Let me reconsider. In NestJS `Test.createTestingModule({ imports: [AppModule] })`, the resulting module has AppModule as a child. When you call `module.get(SomeService)`, it looks in the module's own providers and its imported modules' exports. Since AppModule imports UsersModule which imports ExportModule which exports ExportService... does the export bubble up? No, in NestJS, exports don't bubble. ExportModule.exports are visible to UsersModule (which imported it), but not to AppModule (unless AppModule also imports ExportModule).

So if the test is at the root level (`Test.createTestingModule({ imports: [AppModule] })`), and AppModule directly imports ExportModule, then `module.get(ExportService)` works. If AppModule doesn't import ExportModule but UsersModule does, then `module.get(ExportService)` at root level would fail.

This means test 3 is actually testing that AppModule imports ExportModule (or at least that ExportService is reachable at the root level). And it ALSO tests that ExportModule exports ExportService.

OK, I think I have a good understanding now. Let me write the final list.

Actually, one more thought: the plan mentions "resolves ExportService in UsersModule context" — this might mean creating a separate testing module that only imports UsersModule (not AppModule), to verify the boundary works in isolation. That would be a stronger test because it proves UsersModule self-sufficiently wires its dependencies. Let me include this interpretation.

Similarly for test 4: a testing module importing only NotificationsModule to verify RetryProcessor is available.

This is actually a much stronger test because:
- If you test through AppModule, you might accidentally have the service available through a transitive path
- Testing the module in isolation proves the module's own imports/exports are correct

Let me restructure:

1. Full AppModule DI graph compiles
2. NotificationsService resolvable from AppModule root
3. UsersModule in isolation: ExportService is injectable (proves UsersModule→ExportModule boundary)
4. NotificationsModule in isolation: RetryProcessor is injectable (proves NotificationsModule→RetryModule boundary)
5. QUEUES is a leaf (no feature imports)
6. [awkward] Single instance per service in the full graph
7. [awkward] Resolved instances are real classes (instanceof check)

I think this is solid. Let me write it up in the required format.
```

## reply

- compiles the full AppModule DI graph — every provider in every module is resolvable within its own scope and across import boundaries; fails if any `@Inject`/constructor param has no matching provider in the module or its direct imports, if a module missing from `AppModule.imports` leaves a service unregistered, or if a file-level circular import (the original `QUEUES` TDZ) makes a module class `undefined` at decorator-evaluation time

- resolves NotificationsService from the compiled root module — proves the specific provider named in the original stack trace is constructible end-to-end under its own class token; fails if `NotificationsService` is absent from `NotificationsModule.providers`, if it is registered under a custom string token instead of the class, or if `NotificationsModule` is dropped from `AppModule.imports`

- UsersModule in isolation injects ExportService — proves the `UsersModule → ExportModule` boundary is correct on both sides (users imports export, export exports the service); fails if `ExportModule` is missing from `UsersModule.imports`, if `ExportService` is absent from `ExportModule.exports`, or if `ExportService` is not in `ExportModule.providers`; testing the module in isolation (not through AppModule) rules out a transitive path masking a missing direct import

- NotificationsModule in isolation injects RetryProcessor — proves the `NotificationsModule → RetryModule` boundary is correct on both sides; fails if `RetryModule` is missing from `NotificationsModule.imports`, if `RetryProcessor` is absent from `RetryModule.exports`, or if it is not in `RetryModule.providers`; same isolation rationale as above

- QUEUES is a structural leaf with zero feature imports — importing `src/common/queues.ts` pulls in no module, service, or processor file; fails if `QUEUES` is re-homed into a feature file (e.g. `retry.processor.ts`) that transitively imports another feature, re-introducing the cycle that caused the original `ReferenceError`; also fails if `queues.ts` itself gains an import from under `src/`

- each cross-module service is a singleton in the full graph — `module.get(ExportService) === module.get(ExportService)` and the instance identity matches across scopes; fails if `ExportService` (or `RetryProcessor`) is accidentally listed in the `providers` of two modules that are both loaded, creating two independent instances that would silently diverge at runtime

- resolved services are the real classes, not `useValue`/`useClass` substitutes — `module.get(NotificationsService) instanceof NotificationsService`; fails if a provider was swapped for a stub object or a different class to silence a DI error, which is the constraint the task explicitly forbids but which `compile()` alone cannot detect (a stub satisfies the token and compiles cleanly)

Deliberately not testing: HTTP request handling, business-logic return values, Prisma query execution, queue-broker dispatch, or concurrent/duplicate-delivery behaviour — these are outside the wiring contract; the check proves the object graph is *constructible and correctly scoped*, nothing about what the objects *do* once constructed.
