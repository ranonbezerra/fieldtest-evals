# 06-payouts.module.ts

## reasoning

```
Looking at the plan's manifest for this file:

```
src/payouts/payouts.module.ts | reads: src/payouts/payouts.controller.ts, src/payouts/payouts.service.ts, src/payouts/payouts.repository.ts | NestJS module wiring providers, controller
```

From the plan:
- Feature folder: `src/payouts/`
- Providers: `PayoutsService`, `PayoutsRepository`, `BankClient` (as an interface that needs to be provided)
- Controller: `PayoutsController`

Looking at the references:
- `PayoutsController` in `src/payouts/payouts.controller.ts`
- `PayoutsService` in `src/payouts/payouts.service.ts`
- `PayoutsRepository` in `src/payouts/payouts.repository.ts`
- `BankClient` is an interface in `src/payouts/bank-client.ts`

The module needs to:
1. Declare the controller: `PayoutsController`
2. Provide: `PayoutsService`, `PayoutsRepository`, and `BankClient` (as a token for DI)

Wait, looking more carefully at the plan. The `BankClient` is an interface. In NestJS, you'd need to provide it via a token (like `useFactory` or a provider with `{ provide: BankClient, useClass: ... }`). But the plan says "Injectable interface `BankClient` with a real HTTP impl and a mock in tests."

The manifest says: "NestJS module wiring providers, controller"

The plan's assumptions state: "Bank client | Injectable interface `BankClient` with a real HTTP impl and a mock in tests."

So the module should provide `BankClient` as a token. But what's the concrete class? The plan doesn't name a concrete implementation file for the bank client in the manifest. The manifest only lists:
- `src/payouts/bank-client.ts` — "BankClient interface, BankSendRequest/Result, BankSettlement types"

So `bank-client.ts` only has the interface. There's no concrete HTTP implementation file listed in the manifest. This means the module likely provides `BankClient` as a token that would be overridden in tests, or there's an assumption needed.

Looking at the plan more carefully:
- The manifest lists `bank-client.ts` as containing just the interface and types.
- No concrete implementation file is listed.

So the module needs to provide `BankClient` somehow. The most defensible reading is that the module provides it as a token with a `useFactory` or expects it to be injected from outside (e.g., via a parent module or app module).

Actually, re-reading the conventions: "A service, repository or processor is listed in its module's `providers`." and "A provider used by another module is `exports`ed by its own module."

The simplest and most defensible approach: The module provides `PayoutsService`, `PayoutsRepository`, and declares `PayoutsController`. For `BankClient`, since there's no concrete class in the manifest, the most defensible reading is to provide it as an injection token that gets its implementation from outside (or via a factory). But since there's no factory file in the manifest either...

Actually, looking at this more carefully - the plan says the module wires "providers, controller". The providers that exist as concrete classes are `PayoutsService` and `PayoutsRepository`. `BankClient` is an interface. 

The most defensible approach: provide `BankClient` as a token in the providers array so that DI knows about it, and assume it will be provided via a factory or an external module. But that's speculative.

Wait - let me reconsider. In many NestJS patterns, you'd have:

```ts
@Module({
  controllers: [PayoutsController],
  providers: [PayoutsService, PayoutsRepository],
})
```

And `BankClient` would be provided at the app level or via a parent module. But the plan says this module wires providers. Let me look at what makes sense.

Actually, the most standard pattern when you have an interface that needs to be provided: you either provide it here with a `useFactory`, or you expect it to be imported from another module. Since the plan doesn't name any other module for the bank client, and the manifest only lists these files, I think the cleanest approach is:

The module provides `PayoutsService` and `PayoutsRepository`. The `BankClient` token is expected to be provided from outside (e.g., in the app module). This is common in NestJS - a module can use tokens provided by a parent.

But wait - the convention says "A provider used by another module is exportsed by its own module and that module is imported by the other." This implies providers are self-contained within their module.

Hmm, but `BankClient` is just an interface - there's no concrete class to list as a provider. The most defensible reading: include `BankClient` as a token in providers with a note, or just don't list it (expecting it from the parent).

I think the cleanest and most standard NestJS pattern here is:

```ts
@Module({
  controllers: [PayoutsController],
  providers: [PayoutsService, PayoutsRepository, BankClient],
})
export class PayoutsModule {}
```

Wait, `BankClient` is an interface, not a class. You can't just list an interface as a provider unless you use it as a token:

```ts
providers: [
  PayoutsService,
  PayoutsRepository,
  { provide: BankClient, useFactory: ... }
]
```

But there's no factory. Let me just go with the simplest defensible reading: the module lists the concrete providers it owns (`PayoutsService`, `PayoutsRepository`) and declares the controller. The `BankClient` token is expected to be provided externally (from the app module or a config module). This is the standard NestJS pattern for external dependencies.

Actually, I'll add `BankClient` as a provider token without a factory - no, that won't work. You need either `useClass`, `useFactory`, `useValue`, or `useExisting`.

The most defensible reading: just list the two concrete providers. `BankClient` is an external dependency that the consuming module (app.module) provides. This is standard NestJS - a module can depend on tokens provided by its parent.

Let me go with:

```ts
import { Module } from '@nestjs/common';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { PayoutsRepository } from './payouts.repository';

@Module({
  controllers: [PayoutsController],
  providers: [PayoutsService, PayoutsRepository],
})
export class PayoutsModule {}
```

This is clean, follows the plan exactly ("NestJS module wiring providers, controller"), doesn't add anything the plan doesn't name, and follows standard NestJS conventions. The `BankClient` token would be provided at the app level.

Wait, but should I export anything? The plan says "A provider used by another module is exportsed by its own module." Is `PayoutsService` used by another module? The plan doesn't indicate that. So no exports needed.

Let me finalize this.
```

## reply

```ts
import { Module } from '@nestjs/common';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { PayoutsRepository } from './payouts.repository';

@Module({
  controllers: [PayoutsController],
  providers: [PayoutsService, PayoutsRepository],
})
export class PayoutsModule {}
```
