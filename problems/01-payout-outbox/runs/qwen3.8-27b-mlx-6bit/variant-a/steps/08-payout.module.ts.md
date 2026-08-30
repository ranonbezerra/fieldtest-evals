# 08-payout.module.ts

## reasoning

```
Let me analyze what's needed for `src/payout/payout.module.ts`.

According to the plan (PLAN.md §3 and the manifest):
- `src/payout/payout.module.ts` | reads: controller, service, repository, worker, provider | PayoutModule: wires up provider, repository, service, worker, controller

Wiring rules from the conventions:
- Services, repositories, and processors are listed in their module's `providers`.
- Providers used by other modules are `exports`ed from their own module, and that module is `imports`ed by the other side.
- Controllers are declared by their module.

So the module should:
- Declare `PayoutController` in `controllers`
- List `PayoutService`, `PayoutRepository`, `PayoutWorker`, and the provider (as a token-based provider) in `providers`

The provider is an interface `PayoutProvider` — it's not a concrete class. The plan says "the provider SDK is injected, not real: `PayoutProvider` is a dependency-injected interface... tests use fakes." So in the module we need to wire it up somehow. The plan doesn't specify a concrete provider implementation class. Hmm.

The manifest says "PayoutModule: wires up provider, repository, service, worker, controller." The plan's assumption is that the provider is injected and tests use fakes. No concrete implementation file is named in the manifest (there's no `payout.provider.impl.ts` or similar). So how do we wire it up?

Options:
1. Use `useFactory` with a factory that reads from environment variables... but no concrete SDK exists.
2. Use `useExisting` — no, there's nothing to reference.
3. Provide the token `PayoutProvider` with a factory that creates a stub? That would be inventing behavior.
4. `useFactory` returning a placeholder that throws "not implemented"? That's a guess.

Wait — let me reconsider. The task says: "If a symbol you truly need doesn't exist in either the plan or the references, don't silently guess... write the file using the most defensible interpretation and mark it with a single `// ASSUMPTION:` comment."

The plan says the provider is an injected interface and tests use fakes. The module has to wire it up somehow. The most defensible interpretation: the module provides `PayoutProvider` via a factory token, and in production that would be the real SDK. Since no concrete SDK class exists in the plan, the defensible interpretation is to register it with a `useFactory` that instantiates... hmm.

Actually, let me look at the worker: it has `start(intervalMs)` and `stop()`, and the plan says "starts the interval timer (called from the module's onModuleInit)" and "stops the timer (called from the module's onModuleDestroy)." So the module should implement `OnModuleInit` and `OnModuleDestroy` lifecycle hooks to start/stop the worker with `PAYOUT_WORKER_INTERVAL_MS` (default 1000) from environment variables.

From the plan: "Polling interval and max retries are env-configured: `PAYOUT_WORKER_INTERVAL_MS` (default 1000) and `PAYOUT_MAX_ATTEMPTS` (default 3)."

So the module:
```ts
import { Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';
import { PayoutWorker } from './payout.worker';
import { PayoutProvider } from './payout.provider';

@Module({
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository, PayoutWorker, { provide: PayoutProvider, useFactory: ... }],
})
export class PayoutModule implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly worker: PayoutWorker) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.PAYOUT_WORKER_INTERVAL_MS ?? 1000);
    this.worker.start(intervalMs);
  }

  onModuleDestroy(): void {
    this.worker.stop();
  }
}
```

Now, the provider wiring. The plan doesn't name a concrete provider class. Options:

Option A: `useFactory` returning a stub that throws. This invents behavior not in the plan.

Option B: `useFactory` that reads from env... no.

Option C: The most defensible interpretation is that the module registers the `PayoutProvider` token with a factory that constructs the real SDK — but since the SDK is out of scope, we can't import it.

Hmm, wait. Let me re-read the plan's assumption: "The provider SDK is injected, not real: `PayoutProvider` is a dependency-injected interface with `transfer(to: string, amount: bigint): Promise<{ txHash: string }>`; tests use fakes. Reason: the SDK is out of scope and must be mockable for the retry-exhaustion test."

So in tests, fakes are used — meaning tests override the provider via `overrideProvider(PayoutProvider).useValue(fake)`. In production, the module must provide something. Since no concrete implementation file is in the manifest, the module itself has to supply a provider registration for the token.

The most defensible interpretation: use `useFactory` that returns an instance of... hmm, but there's no class.

Alternative: maybe the plan intends for the module to not provide a concrete implementation and leave it to the app module or environment-based configuration. But the wiring rules say "services, repositories, processors are listed in their module's providers" — and the manifest explicitly says the module "wires up provider, repository, service, worker, controller." So the provider must appear in this module's providers.

Given that no concrete class exists, the cleanest defensible approach is:

```ts
{
  provide: PayoutProvider,
  useFactory: (): PayoutProvider => {
    // ASSUMPTION: the plan names no concrete provider implementation; in production this factory would construct the real SDK client. Until then it throws on use so misconfiguration fails loudly instead of silently no-op'ing transfers.
    return {
      transfer: () => {
        throw new Error('PayoutProvider is not configured; set up the blockchain provider SDK');
      },
    };
  },
}
```

Hmm, but that's inventing behavior. Alternatively, the factory could read a config... no.

Actually wait — maybe I'm overthinking this. Let me reconsider: perhaps the intended interpretation is that since tests use fakes and the SDK is out of scope, the module simply registers the token via a factory that returns a placeholder. The instructions say: "If a symbol you truly need doesn't exist in either the plan or the references, don't silently guess and don't work around it: write the file using the most defensible interpretation and mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters."

So a single ASSUMPTION comment is allowed/expected when something is unresolved. The concrete provider implementation is truly absent from the plan and references. So I should write the most defensible interpretation and mark it with one `// ASSUMPTION:` comment.

What's the most defensible interpretation? A factory that throws on `transfer` is safe (it will never silently drop or double-pay a transfer; it fails loudly). Actually, hmm — if the worker picks up a message and the provider throws "not configured," that gets treated as an ambiguous error → retries → NEEDS_REVIEW. That's actually a safe outcome (funds stay reserved, human review). But it's still inventing behavior.

Alternative defensible interpretation: the module doesn't start the worker in... no, the plan explicitly says the module calls start/stop.

Another thought: maybe `useFactory` should be minimal and just document that the real SDK would go there. Let me think about what a careful engineer following this plan would write. The plan says tests use fakes (via Nest's testing module overrides). In a real app, `app.module.ts` would import `PayoutModule`. The provider token has to resolve. Since the SDK is out of scope, a stub that throws is the standard placeholder pattern.

I think the throwing stub is the most defensible: it guarantees no silent fund movement, and with the worker's retry logic it lands in NEEDS_REVIEW (safe state). And I'll mark it with an ASSUMPTION comment.

Actually, let me reconsider once more. Is there any hint in the references about how the provider is wired? The controller, service, repository, worker, and provider files are shown. None of them instantiate a concrete provider. The service takes `PayoutProvider` via constructor injection. So the module has to provide it.

Also, should the module `exports` anything? The wiring rules say "providers used by other modules are exportsed from their own module." Does any other module use the payout service? The manifest doesn't name any other feature module. `app.module.ts` presumably imports PayoutModule for the controller. No other module is named, so no exports needed. Adding exports not required by the plan would violate "don't add exports the plan doesn't name." The manifest line says "PayoutModule: wires up provider, repository, service, worker, controller" — no mention of exports. So no `exports` array.

Now the lifecycle: the plan says "starts the interval timer (called from the module's onModuleInit)" and "stops the timer (called from the module's onModuleDestroy)." So PayoutModule implements `OnModuleInit` and `OnModuleDestroy`.

Interval: `PAYOUT_WORKER_INTERVAL_MS` default 1000. From the plan's assumption: "Polling interval and max retries are env-configured: `PAYOUT_WORKER_INTERVAL_MS` (default 1000) and `PAYOUT_MAX_ATTEMPTS` (default 3)." The worker's `start(intervalMs)` takes the interval. So the module reads env and calls `worker.start(intervalMs)`.

Should I use NestJS's `@nestjs/config` ConfigService? The conventions say "configuration comes only from environment variables." The plan doesn't mention `@nestjs/config` or ConfigService anywhere. No package.json is shown, but the plan doesn't name `@nestjs/config` as a dependency. Safest: read `process.env` directly, consistent with how the service reads `process.env.PAYOUT_MAX_ATTEMPTS`. The reference service file does `Number(process.env.PAYOUT_MAX_ATTEMPTS ?? 3)`. So direct `process.env` access is the established pattern in this codebase. I'll use that.

Now, do we need `PrismaModule`/PrismaService? The repository takes `PrismaClient` directly (constructor `private readonly prisma: PrismaClient`). The plan says the repository is constructed with `PrismaClient`. Hmm — how does Nest provide `PrismaClient`? The plan's repository signature: `constructor(prisma: PrismaClient)`. For DI to work, something has to provide the `PrismaClient` token. But the plan doesn't name a PrismaService or a PrismaModule in the manifest. The manifest for this file only lists wiring up provider, repository, service, worker, controller.

Hmm, this is a gap. If I don't provide `PrismaClient`, the app won't start (Nest can't instantiate PayoutRepository). But the plan doesn't name a prisma service file. Options:

1. Add `{ provide: PrismaClient, useFactory: () => new PrismaClient() }` to the module's providers. This is a guess but defensible: the repository needs a `PrismaClient` instance, and the module is the only place to wire it. The plan says "PayoutModule: wires up provider, repository, service, worker, controller" — wiring the repository implies making it instantiable.

2. Leave it out and let app.module handle it — but I'm only writing this file, and the plan governs this file as wiring these five. If app.module provides PrismaClient globally... but there's no global PrismaModule in the manifest.

Given "don't add exports, features, or files the plan doesn't name" — adding a provider registration for `PrismaClient` in this module isn't adding a file or feature; it's wiring. But is it "what the plan specifies"? The plan says the module wires up the repository. For the repository to be wired, its dependencies must resolve. The most defensible interpretation is to include a `PrismaClient` provider via `useFactory`.

Hmm, but wait — maybe I should be careful. The instructions say "implement exactly what the plan specifies for this file." The plan specifies: "PayoutModule: wires up provider, repository, service, worker, controller." The `PrismaClient` token isn't named in the plan. But without it, the module is broken. The instructions also say: "If a symbol you truly need doesn't exist in either the plan or the references, don't silently guess and don't work around it: write the file using the most defensible interpretation and mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters."

But "a single `// ASSUMPTION` comment" — does that mean at most one ASSUMPTION comment in the file? Re-reading: "mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters." I read that as: for each unresolved symbol, one comment (not multiple scattered comments). If there are two unresolved things (concrete provider impl, PrismaClient wiring), I might need two comments. Hmm, risky. Let me try to minimize.

Actually, let me reconsider the PrismaClient issue. In many NestJS+Prisma setups, you create a `PrismaService extends PrismaClient` and provide it. But here the repository's constructor takes `PrismaClient` directly (the type from `@prisma/client`). Nest DI uses the design-time type as the token, so the token is the `PrismaClient` class itself. To provide it: `{ provide: PrismaClient, useFactory: () => new PrismaClient() }`.

Is this in the plan? No. Is it in the references? The repository file shows `constructor(private readonly prisma: PrismaClient) {}` — so yes, the repository needs a `PrismaClient` injected. The module has to make that resolvable. I'll include it with an ASSUMPTION comment.

Hmm, wait, actually — let me reconsider whether the plan intends for the module to handle Prisma at all. The manifest's "reads" for payout.module.ts lists only the five payout files. If the module imported `PrismaClient` from `@prisma/client`, that's an import not in the "reads" list... but the reads list is about project files, and `@prisma/client` is an external package. The repository imports from `@prisma/client` too, and its reads list doesn't include it. So external imports are fine.

Alternatively — should the module not start the worker and instead rely on...? No, the plan is explicit: "starts the interval timer (called from the module's onModuleInit)."

OK, my plan for the file:

```ts
import { Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';
import { PayoutWorker } from './payout.worker';
import { PayoutProvider } from './payout.provider';

@Module({
  controllers: [PayoutController],
  providers: [
    // ASSUMPTION: ...PrismaClient...
    { provide: PrismaClient, useFactory: () => new PrismaClient() },
    PayoutRepository,
    PayoutService,
    // ASSUMPTION: ...provider stub...
    { provide: PayoutProvider, useFactory: () => ({ transfer: ... }) },
    PayoutWorker,
  ],
})
export class PayoutModule implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly worker: PayoutWorker) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.PAYOUT_WORKER_INTERVAL_MS ?? 1000);
    this.worker.start(intervalMs);
  }

  onModuleDestroy(): void {
    this.worker.stop();
  }
}
```

Wait, but two ASSUMPTION comments — the instructions say "mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters." I think this means one comment per unresolved matter, placed where it matters. Two genuinely unresolved matters → two comments. But to be safe, can I resolve one of them without an assumption?

The PrismaClient one: is it really unresolved? The plan says the repository takes `PrismaClient`. The module wires up the repository. Hmm, actually — maybe the intended design is that `app.module.ts` (which I'm not writing) provides PrismaClient. But then PayoutModule's providers would fail to resolve unless PrismaClient is global. Without evidence, the self-contained defensible interpretation is for PayoutModule to provide it.

Hmm, actually, let me reconsider once more. Is it possible the plan intends for the module file to not deal with Prisma at all, and the evaluation only checks that the module wires up the five named things plus lifecycle? Adding a PrismaClient provider is extra wiring not named in the plan. The discipline says "do exactly what the task asks. Don't create files it doesn't call for, don't improve code you weren't asked to change." But a broken module (unresolvable PrismaClient) is worse.

Let me weigh: the manifest line is "PayoutModule: wires up provider, repository, service, worker, controller." If I include `{ provide: PrismaClient, useFactory: () => new PrismaClient() }`, I'm wiring up the repository's dependency. I think that's within the spirit of "wires up ... repository." And I'll mark it with an ASSUMPTION comment since the plan doesn't name how PrismaClient is provided.

Actually, hmm, wait. Let me reconsider whether to include it at all. The test file `test/payout.spec.ts` — the plan says tests use fakes for the provider. Tests probably instantiate the service/repository directly or via a testing module with overrides. The module file itself isn't necessarily tested. But it has to compile and be correct.

Decision: include the PrismaClient provider with an ASSUMPTION comment. It's the most defensible interpretation for a working module, and the instructions explicitly allow marked assumptions for truly absent symbols.

Now the provider stub. What's the most defensible? Let me think about what happens with a throwing stub:
- Worker polls, claims message, calls service.processMessage → provider.transfer throws "not configured" → treated as ambiguous (message doesn't contain 'invalid'/'rejected'/'404') → retries → eventually NEEDS_REVIEW. Funds stay reserved. Safe.

A stub that resolves with a fake txHash would be dangerous (silently "completes" payouts without on-chain transfer). A stub that rejects with a definitive-looking error ("invalid") would fail payouts and release funds — also wrong. A throwing stub with a neutral message is safest.

Actually, hold on. Let me reconsider: maybe the most defensible interpretation is that the module should not fabricate a provider at all, and instead the plan's "wires up provider" means registering the token so it can be overridden. But Nest requires a concrete provider registration for the token to exist in the module's injector... actually no — if PayoutModule doesn't provide `PayoutProvider` and it's not imported from elsewhere, Nest will throw at startup: "Nest can't resolve dependencies of the PayoutService (?)." So the module must provide it. A throwing stub is the answer.

Let me also double-check the worker's start signature: `start(intervalMs: number): void`. Yes. And env var name: `PAYOUT_WORKER_INTERVAL_MS` default 1000. Good.

Should the module guard against invalid interval values? The plan says default 1000. `Number(process.env.PAYOUT_WORKER_INTERVAL_MS ?? 1000)` — if the env var is set to garbage, Number returns NaN and setInterval(NaN) treats it as 0... that's an edge case; the plan doesn't specify validation. Keep it simple, match the service's pattern (`Number(process.env.PAYOUT_MAX_ATTEMPTS ?? 3)`). Don't add validation not in the plan.

Now ordering of providers: PrismaClient first, then repository, service, worker. Order doesn't matter for Nest DI but it's cleaner.

Imports: `Module, OnModuleInit, OnModuleDestroy` from '@nestjs/common'; `PrismaClient` from '@prisma/client'; the five local files.

Class name: `PayoutModule` (PascalCase per conventions).

Let me also consider: should the module `exports` PayoutService in case app.module or another feature needs it? No other module is named in the plan/manifest. Wiring rules only require exports when used by another module. Don't add.

One more consideration on the provider factory: should it be a `useFactory` that takes no args, or should it read env for the SDK config? The plan says no secrets in the repo; provider config would come from env, but the plan doesn't name any provider env vars. So no env reads in the factory — just a stub that throws. Keep it minimal.

Let me write the stub:

```ts
{
  // ASSUMPTION: the plan names no concrete blockchain SDK class; the real client
  // would be constructed here from environment configuration. The stub throws on
  // use so a misconfigured deployment can never move funds silently — the worker
  // will treat it as an ambiguous failure and park the payout in NEEDS_REVIEW.
  provide: PayoutProvider,
  useFactory: (): PayoutProvider => ({
    transfer: () => {
      throw new Error('PayoutProvider is not configured');
    },
  }),
},
```

Hmm, that's a multi-line comment. The instructions say "a single `// ASSUMPTION: <what was unresolved>` comment." Maybe I should keep it as a compact single-line `// ASSUMPTION:` comment. Let me make each assumption one line to comply strictly:

`// ASSUMPTION: the plan names no concrete provider implementation, so the token is backed by a stub that throws on use; a real SDK client would be constructed here from environment configuration.`

And for PrismaClient:
`// ASSUMPTION: the plan does not name a Prisma provider, so the module instantiates PrismaClient itself to satisfy PayoutRepository's constructor.`

That's two ASSUMPTION comments. Is that allowed? The instruction: "If a symbol you truly need doesn't exist in either the plan or the references, don't silently guess and don't work around it: write the file using the most defensible interpretation and mark it with a single `// ASSUMPTION: <what was unresolved>` comment at the point where it matters."

I read "a single comment" as one comment per unresolved matter (as opposed to scattering multiple comments or a big comment block). Two distinct unresolved matters → two single-line comments. I think that's compliant. But let me see if I can avoid one.

Can I avoid the PrismaClient assumption? If I omit the PrismaClient provider, the module won't boot in production. But is booting in production within scope of this file's correctness? The deliverables include a working NestJS module. A module that can't resolve dependencies is broken. I'll keep it with the assumption comment.

Alternatively, can I avoid the provider stub assumption by... no, there's no way to register a token without a factory/value/useClass.

OK, one more thought — maybe the plan intends for `PayoutModule` to be imported by `app.module.ts`, and app.module provides PrismaClient. Since I can't see app.module and the plan doesn't name it in the manifest... actually, the conventions layout shows `src/app.module.ts` exists. The manifest for this task only lists files to be produced; app.module.ts isn't in the manifest, so it's either pre-existing or out of scope. If app.module already provides PrismaClient globally (e.g., via a global module), my provider would conflict? No — a module-local provider just shadows; no conflict. If app.module provides it as `@Global()`, mine is redundant but harmless. If nothing provides it, mine is essential. So including it is the safe choice either way.

Hmm, but "don't add exports, features, or files the plan doesn't name" — a provider registration isn't a file or feature. It's wiring. I'm comfortable.

Actually, wait. Let me reconsider once more whether including PrismaClient violates "implement exactly what the plan specifies for this file." The plan specifies the module wires up five things. The PrismaClient provider is necessary plumbing for one of those five (repository). I'll keep it, clearly marked.

Now let me also double-check the worker injection: `PayoutWorker`'s constructor takes `(service: PayoutService, repo: PayoutRepository)`. Both provided. Good. The module injects `PayoutWorker` in its own constructor to call start/stop — that's fine, worker is a provider of the module.

Edge: `onModuleInit` — should it be async? `worker.start` returns void. So sync is fine.

Let me also verify the lifecycle interface imports: `OnModuleInit`, `OnModuleDestroy` from '@nestjs/common'. Yes.

Final file:

```ts
import { Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';
import { PayoutWorker } from './payout.worker';
import { PayoutProvider } from './payout.provider';

@Module({
  controllers: [PayoutController],
  providers: [
    // ASSUMPTION: the plan names no Prisma provider, so the module instantiates PrismaClient itself to satisfy PayoutRepository's constructor.
    { provide: PrismaClient, useFactory: () => new PrismaClient() },
    PayoutRepository,
    PayoutService,
    // ASSUMPTION: the plan names no concrete blockchain SDK class; the token is backed by a stub that throws on use so a misconfigured deployment can never move funds silently (the worker parks such payouts in NEEDS_REVIEW). A real client would be constructed here from environment configuration.
    {
      provide: PayoutProvider,
      useFactory: (): PayoutProvider => ({
        transfer: () => {
          throw new Error('PayoutProvider is not configured');
        },
      }),
    },
    PayoutWorker,
  ],
})
export class PayoutModule implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly worker: PayoutWorker) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.PAYOUT_WORKER_INTERVAL_MS ?? 1000);
    this.worker.start(intervalMs);
  }

  onModuleDestroy(): void {
    this.worker.stop();
  }
}
```

Wait — one concern about the provider stub's error message: the service's `isAmbiguousError` treats errors containing 'invalid', 'rejected', '404' as definitive. "PayoutProvider is not configured" contains none of those → ambiguous → NEEDS_REVIEW after retries. Good, safe.

Another check: the `useFactory` returning an object literal typed as `PayoutProvider` — `transfer: () => { throw ... }` returns `never`, which is assignable to `Promise<{txHash: string}>`. Yes, `never` is assignable to anything. Good.

Should the factory be `useFactory: () => new PrismaClient()` — do I need to handle `onModuleDestroy` for prisma disconnect? The plan doesn't mention it. Don't add.

ESM consideration: the codebase is ESM with `"type": "module"`. Imports without extensions — NestJS/TS handles that; the reference files use extensionless relative imports (`'./payout.service'`). Match that.

Let me also double-check naming conventions: file `payout.module.ts` ✓, class `PayoutModule` ✓.

One more thought on the two ASSUMPTION comments: to be extra safe about "a single comment," could I merge? They're at different points in the file (different providers). Merging into one would place it away from where one of them matters. I'll keep two single-line comments; each marks its own unresolved matter at the point where it matters. I believe that's the intended reading.

Hmm, actually, let me reconsider the PrismaClient one more time. Is there any chance the plan intends for the repository to be provided with PrismaClient from somewhere else, and this module file should just list `PayoutRepository` in providers? If the grader diffs against an expected module... I don't know. The instructions emphasize a working, defensible file with marked assumptions over silent guessing. I'll keep it.

Also: should `PayoutService` be exported? Only if another module uses it. No evidence. No exports array at all.

Let me finalize. I'll also make sure there's nothing else: the plan says the module is "called from the module's onModuleInit" for start — done; "onModuleDestroy" for stop — done.

Response format: one fenced block, nothing else.
```

## reply

```ts
import { Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PayoutController } from './payout.controller';
import { PayoutService } from './payout.service';
import { PayoutRepository } from './payout.repository';
import { PayoutWorker } from './payout.worker';
import { PayoutProvider } from './payout.provider';

@Module({
  controllers: [PayoutController],
  providers: [
    // ASSUMPTION: the plan names no Prisma provider, so the module instantiates PrismaClient itself to satisfy PayoutRepository's constructor.
    { provide: PrismaClient, useFactory: () => new PrismaClient() },
    PayoutRepository,
    PayoutService,
    // ASSUMPTION: the plan names no concrete blockchain SDK class; the token is backed by a stub that throws on use so a misconfigured deployment can never move funds silently (the worker parks such payouts in NEEDS_REVIEW). A real client would be constructed here from environment configuration.
    {
      provide: PayoutProvider,
      useFactory: (): PayoutProvider => ({
        transfer: () => {
          throw new Error('PayoutProvider is not configured');
        },
      }),
    },
    PayoutWorker,
  ],
})
export class PayoutModule implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly worker: PayoutWorker) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.PAYOUT_WORKER_INTERVAL_MS ?? 1000);
    this.worker.start(intervalMs);
  }

  onModuleDestroy(): void {
    this.worker.stop();
  }
}
```
