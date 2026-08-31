# 07-anchor.module.ts

## reasoning

```
Let's analyze what's needed for `src/anchor/anchor.module.ts` based on the plan.

From PLAN.md Section 3:
- `src/anchor/anchor.module.ts`
  - `class AnchorModule` — providers: `AnchorService`, `AnchorRepository`, `ChainClient` (bound to `FakeChainClient` in this build); controllers: `AnchorController`.

From Section 1 (assumptions):
- File layout follows the repository conventions: feature folder `anchor` with module/controller/service/repository files, `chain.ts` for the client interface + fake, and `canonical.ts` for hashing.

Wiring conventions:
- Services, repositories, processors are listed in the module's `providers`. Providers used by other modules are `exports`ed from their own module, and that module is `imports`ed by the other. Controllers are declared in the module.

So this module:
- providers: `AnchorService`, `AnchorRepository`, `ChainClient` (bound to `FakeChainClient`)
- controllers: `AnchorController`

Since this is the only module that uses these, exports are unnecessary (no other modules import them). The plan doesn't mention `exports`, so I shouldn't add it.

Imports needed:
- `Module` from `@nestjs/common`
- `AnchorController` from `./anchor.controller`
- `AnchorService` from `./anchor.service`
- `AnchorRepository` from `./anchor.repository`
- `ChainClient`, `FakeChainClient` from `./chain`

Binding `ChainClient` to `FakeChainClient`: use a custom provider `{ provide: ChainClient, useClass: FakeChainClient }`.

Wait — but is `FakeChainClient` the right thing for the production module? The plan says "providers: `AnchorService`, `AnchorRepository`, `ChainClient` (bound to `FakeChainClient` in this build)". So yes, in this build the ChainClient provider is bound to FakeChainClient. This is per the plan: "No real keys or RPC: implement against the interface and use a fake in tests." The plan explicitly states to bind ChainClient to FakeChainClient in this build. So I'll do that.

Let me check the constructor signatures:
- `AnchorService` constructor: `(repo: AnchorRepository, chain: ChainClient)` — NestJS DI will resolve `AnchorRepository` by class token and `ChainClient` by the interface token (which is a value, so it can be used as an injection token).
- `AnchorRepository` constructor: `(prisma: PrismaClient)`.

Hmm, wait. `PrismaClient` — the repository takes `PrismaClient` in its constructor. Who provides `PrismaClient`? Normally the `PrismaModule` from `@nestjs-modules/...` or a custom provider. But the plan for this file only lists providers: `AnchorService`, `AnchorRepository`, `ChainClient`. There's no mention of a Prisma provider.

Looking at the plan's manifest:
```
src/anchor/anchor.module.ts | reads: src/anchor/anchor.controller.ts, src/anchor/anchor.service.ts, src/anchor/anchor.repository.ts, src/anchor/chain.ts | AnchorModule wiring
```

So this module reads the controller, service, repository, and chain files. It doesn't read app.module.ts or anything about Prisma. The plan says providers: AnchorService, AnchorRepository, ChainClient (bound to FakeChainClient). So I should write exactly that.

But then how does `PrismaClient` get injected? That's a concern for `app.module.ts`, which presumably provides PrismaClient globally or the AnchorModule would need it. But the plan for this file doesn't mention it. The instructions say "implement exactly what the plan specifies in this file. Do not add exports, features, or files the plan doesn't name."

Hmm, this is a tension. The repository needs `PrismaClient` injected. If the module doesn't provide it, NestJS will fail at runtime with "Nest can't resolve dependencies". But the plan explicitly lists only three providers.

Let me re-read the plan:

"`src/anchor/anchor.module.ts`
- `class AnchorModule` — providers: `AnchorService`, `AnchorRepository`, `ChainClient` (bound to `FakeChainClient` in this build); controllers: `AnchorController`."

That's the complete spec for this file. The plan doesn't mention PrismaClient provisioning. This is likely handled in `app.module.ts` (which provides PrismaClient as a global provider, e.g., via a `PrismaService` or direct `PrismaClient` provider). Since I'm only writing this file and the plan governs, I should write exactly what the plan says.

But wait — if `PrismaClient` isn't provided in this module's scope, the DI will fail. Unless app.module provides it globally (e.g., `@Global()` module or direct provider in root). The plan's manifest shows app.module.ts is a separate file (from layout: `src/app.module.ts`). The plan doesn't give me the app.module spec here, but presumably it handles Prisma.

Actually, let me reconsider. The instructions say: "If a symbol you truly need is missing from both the plan and the references, don't guess silently or reason around it: write the file with the most defensible interpretation and mark it at the important spot with a single `// ASSUMPTION: <what was unresolved>` comment."

So the question is: does `AnchorModule` need to provide `PrismaClient`? The plan doesn't say so. The most defensible interpretation is to follow the plan exactly: providers are AnchorService, AnchorRepository, ChainClient. If PrismaClient is missing, that's an app.module concern.

But actually — hmm. Let me think about whether I should add a PrismaClient provider. The plan is explicit and complete about the providers list. Adding a PrismaClient provider would be "adding a feature the plan doesn't name" — well, it's not a feature, it's a provider. But the plan says "providers: AnchorService, AnchorRepository, ChainClient (bound to FakeChainClient in this build)". That's a closed list.

I think the safest reading is: follow the plan exactly. The PrismaClient resolution is out of scope for this file per the plan. If it's a problem, it's an app.module problem. I'll write exactly what the plan says.

Actually, wait. Let me reconsider whether there's an assumption I should flag. The plan is very explicit. I don't think I need an ASSUMPTION comment here because the plan fully specifies this file's content. The only "unresolved" thing is PrismaClient, but the plan deliberately omits it from this module's providers, implying it's provided elsewhere (app.module). Since the plan governs and is explicit about the provider list, I'll follow it without an assumption comment. Adding an assumption comment would be reasoning around the plan, which I'm told not to do when the plan is clear.

Hmm, but let me reconsider once more. Is it possible the plan intends for PrismaClient to be provided here? Let me look at the repository again — it takes `PrismaClient` directly (not a wrapper service). In a typical NestJS + Prisma setup, you'd have:

```ts
@Module({})
export class AppModule {
  providers: [
    {
      provide: PrismaClient,
      useFactory: () => new PrismaClient(),
    },
  ],
}
```

Or a global PrismaModule. Since the layout shows `src/app.module.ts`, and the plan's manifest for anchor.module doesn't read app.module, I believe PrismaClient is provided at the app level. So AnchorModule just declares its own providers.

Actually, in NestJS, if PrismaClient is provided in AppModule (root module), it's available to all child modules by default (providers are visible to the module they're declared in and its child modules... wait, no). Let me recall NestJS DI scope:

In NestJS, a provider declared in a module is only visible to that module and its controllers. Child modules (imported modules) do NOT automatically see the parent's providers unless the parent exports them.

Wait, actually it's the opposite of what I said. Let me get this right:
- A module's providers are injectable into that module's controllers and into other providers within the same module.
- For a provider to be used by another module, it must be `exports`ed by the module that declares it, and that module must be `imports`ed by the consuming module.

So if `PrismaClient` is declared in `AppModule`, it's NOT visible to `AnchorModule` unless `AppModule` exports it AND `AnchorModule` imports `AppModule`. That would be circular (AppModule imports AnchorModule, AnchorModule imports AppModule).

So the standard pattern is a separate `PrismaModule` (often `@Global()`) that provides and exports `PrismaClient`, and `AnchorModule` imports it. OR `PrismaClient` is provided directly in each module that needs it (not DRY but works).

Given the plan says AnchorModule's providers are exactly `AnchorService`, `AnchorRepository`, `ChainClient`, and the manifest says anchor.module reads only controller/service/repository/chain (not app.module or a prisma module), there's an inconsistency in the plan regarding how PrismaClient gets injected.

But my job is to write exactly what the plan specifies for THIS file. The plan is explicit: providers are those three. I should not add a PrismaClient provider or an import of a PrismaModule because the plan doesn't name them.

The instruction: "Implement exactly what the plan specifies in this file. Do not add exports, features, or files the plan doesn't name."

So I'll write:
```ts
import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { ChainClient, FakeChainClient } from './chain';

@Module({
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    { provide: ChainClient, useClass: FakeChainClient },
  ],
})
export class AnchorModule {}
```

This matches the plan exactly. The PrismaClient concern is out of scope per the plan's explicit provider list, and I'm told not to add things the plan doesn't name.

Wait, but should I flag the PrismaClient issue with an ASSUMPTION comment? The instruction says to flag when "a symbol you truly need is missing from both the plan and the references." Do I "need" PrismaClient in this file? No — my file doesn't reference PrismaClient directly. The repository references it, but that's the repository's concern, and the repository is a read-only reference I don't rewrite. So I don't need PrismaClient as a symbol in this file. Therefore no ASSUMPTION comment is needed.

Let me double check: does the plan want `exports`? "Providers used by other modules are exportsed from their own module, and that module is importsed by the other." In this build, are AnchorService etc. used by other modules? The only other module is app.module (root). The root module imports AnchorModule to register the controller. It doesn't need to inject AnchorService directly (it's a root module, just wiring). So no exports needed. The plan's manifest for anchor.module doesn't mention exports. So I'll omit `exports`.

Let me verify the import for FakeChainClient — it's exported from `./chain` as a class. Yes: `export class FakeChainClient implements ChainClient`. And `ChainClient` is an interface exported from `./chain`. Good.

Now, one consideration: should the provider be `{ provide: ChainClient, useClass: FakeChainClient }` or just `FakeChainClient` with the service depending on `FakeChainClient`? The service's constructor takes `chain: ChainClient`. For NestJS to inject, the provider token must be `ChainClient` (the interface). So I need `{ provide: ChainClient, useClass: FakeChainClient }`. That's the correct binding. Good.

Let me also confirm the `AnchorService` constructor param types match provider tokens:
- `repo: AnchorRepository` — provided by `AnchorRepository` class token. ✓
- `chain: ChainClient` — provided by `{ provide: ChainClient, useClass: FakeChainClient }`. ✓

And `AnchorRepository` constructor:
- `prisma: PrismaClient` — not provided in this module. This is the gap, but per the plan it's out of scope for this file. I'll follow the plan.

Actually, let me reconsider whether I should be more careful here. The task is a code-generation eval. The plan is "my own spec and governs." The plan explicitly lists the providers. If I deviate by adding PrismaClient, I'd be violating "do not add ... a file the plan doesn't name" — well, PrismaClient isn't a file. But it'd be adding a provider the plan doesn't list.

I'm confident: follow the plan exactly. The three providers, one controller, no exports.

Let me also make sure about ESM / import style. The codebase uses ESM with `"type": "module"`. But NestJS decorators and the existing files use standard imports without `.js` extensions (e.g., `import { AnchorService } from './anchor.service';`). So I'll match that style — no `.js` extensions. Consistent with the reference files.

Let me write the final file.

Actually, let me reconsider the ordering and whether to include a comment. The reference files have minimal comments. I'll keep it clean, matching the plan. No extra comments needed.

Let me also double-check: the plan says "providers: `AnchorService`, `AnchorRepository`, `ChainClient` (bound to `FakeChainClient` in this build)". So the order is AnchorService, AnchorRepository, ChainClient. I'll keep that order for fidelity, though order doesn't matter functionally.

Final answer:

```ts
import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { ChainClient, FakeChainClient } from './chain';

@Module({
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    { provide: ChainClient, useClass: FakeChainClient },
  ],
})
export class AnchorModule {}
```

This is complete, first line to last, implements exactly the plan's spec for this file. No extra exports, features, or files.

I'm confident in this. Let me output it in a single fenced block with nothing else.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { AnchorController } from './anchor.controller';
import { AnchorService } from './anchor.service';
import { AnchorRepository } from './anchor.repository';
import { ChainClient, FakeChainClient } from './chain';

@Module({
  controllers: [AnchorController],
  providers: [
    AnchorService,
    AnchorRepository,
    { provide: ChainClient, useClass: FakeChainClient },
  ],
})
export class AnchorModule {}
```
