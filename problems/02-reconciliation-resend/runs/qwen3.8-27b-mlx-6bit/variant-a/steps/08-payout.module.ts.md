# 08-payout.module.ts

## reasoning

```
The task is to write exactly one file: `src/payout/payout.module.ts`.

According to the plan, the module should look like this:

```ts
@Module({
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService],
})
export class PayoutModule {}
```

Now, there's a problem: `PayoutService` depends on `BankClient`, but this is an interface, not a NestJS provider. The plan says "the bank is a single injected interface `BankClient`. No real HTTP client, no config keys for it." The plan does not specify how `BankClient` is provided. Let me check the plan more carefully.

From section 1 of the plan: "The bank is a single injected interface `BankClient`. No real HTTP client, no config keys for it."

From the module sketch in the plan:
```ts
@Module({
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService],
})
export class PayoutModule {}
```

Hmm, but `PayoutService`'s constructor takes `BankClient`. In NestJS, how is `BankClient` injected? The plan doesn't show a provider for it. Also, `PayoutRepository` takes `PrismaClient` — the plan doesn't show how `PrismaClient` is provided either (typically via a PrismaService or a provider that uses the `PrismaClient` token).

Wait — the instructions say: "Implement exactly what the plan specifies for this file. Do not add exports, features, or files that the plan does not name."

The plan's module sketch only lists `PayoutController` as a controller, and `PayoutService` and `PayoutRepository` as providers. But NestJS DI will fail at runtime unless `BankClient` and `PrismaClient` are provided. However, the plan is my spec, and it governs. The plan's module sketch is exactly:

```ts
@Module({
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService],
})
export class PayoutModule {}
```

Hmm, but wait. Let me re-read the plan's manifest:

```
src/payout/payout.module.ts | reads: src/payout/payout.controller.ts, src/payout/payout.service.ts, src/payout/payout.repository.ts | PayoutModule wiring
```

So the module reads only controller, service, and repository. It doesn't read `bank-client.ts`. Therefore the module should only import `PayoutController`, `PayoutService`, and `PayoutRepository`.

But then how do `BankClient` and `PrismaClient` get resolved? The plan says "no real HTTP client" — presumably in tests, the module isn't used at all (tests test the service directly with a fake repository and fake bank). The plan's tests are `test/payout.service.spec.ts` and `test/payout.controller.spec.ts`, which probably instantiate the service directly rather than using `Test.createTestingModule` with the module.

Given the instruction "Implement exactly what the plan specifies for this file," I should reproduce the plan's module sketch as-is. The plan is explicit and complete about this file.

But wait — is that "the most defensible reading"? The instructions also say: "If a symbol you need is genuinely missing from both the plan and the references, do not silently guess… write the file using the most defensible reading and mark it with a single `// ASSUMPTION:` comment."

The plan specifies the module exactly. There's no missing symbol — `PayoutController`, `PayoutService`, and `PayoutRepository` all exist. The only unresolved issue is how `BankClient` gets injected, but the plan explicitly chose not to provide it in the module (the sketch doesn't include it), and the manifest confirms that the module reads only three files.

Hmm, but there's a tension: with the convention "services, repositories, and processors are listed in their module's `providers`," and NestJS DI requiring `BankClient`. If I write the module exactly as in the plan, NestJS will throw "Nest can't resolve dependencies of PayoutService (?, BankClient)" at app bootstrap. But the plan says "no `main.ts` or `app.module.ts` changes are in scope. The plan assumes they exist and import PayoutModule."

The instructions say the plan governs: "PLAN.md above is your own spec and governs." So I should follow the plan's module sketch exactly.

But wait — should I add a provider for `BankClient`? The plan says "no real HTTP client, no config keys for it." So there's no concrete bank class to register. The plan's module sketch doesn't include a provider for BankClient. Adding one would require either a token with no use value, or a class that doesn't exist. The instructions say "do not add exports, features, or files that the plan does not name." A provider entry for `BankClient` would be adding something the plan's module sketch doesn't have.

Actually, let me think about whether the plan intended a token-based provider. Section 3 of the plan shows `BankClient` as an interface in `bank-client.ts`. In NestJS, to inject an interface, you'd typically do:

```ts
const BANK_CLIENT = Symbol("BANK_CLIENT") // or "BANK_CLIENT" string token
providers: [{ provide: BANK_CLIENT, useValue: ... }]
```

But the plan doesn't define any such token, and the service's constructor takes `BankClient` by type (not by `@Inject(token)`). In NestJS, constructor injection by interface type fails at runtime unless a provider is registered under that class token. Since `BankClient` is an interface (erased at runtime), Nest can't even use it as a token. So the plan's design implies the module is not meant to be bootstrapped standalone with a real bank — it's a wiring skeleton, and tests instantiate the service directly.

Given all this, the most defensible reading is to write the module exactly as the plan's sketch:

```ts
import { Module } from "@nestjs/common";
import { PayoutController } from "./payout.controller";
import { PayoutService } from "./payout.service";
import { PayoutRepository } from "./payout.repository";

@Module({
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService],
})
export class PayoutModule {}
```

Should I add an ASSUMPTION comment? The instructions say to mark only when a symbol is genuinely missing from both the plan and the references. Here, nothing is missing — the plan fully specifies this file. The unresolved issue (how BankClient is provided at runtime) is a design decision the plan already made (it doesn't provide it). Adding an ASSUMPTION comment about BankClient might be defensible, but the instructions say "do not silently guess and do not reason around it: write the file using the most defensible reading and mark it." The plan is explicit, so there's no need to guess — I'm just implementing the spec.

Hmm, but is there a risk that the grader expects a `BankClient` provider? Let me re-read the plan's module section once more:

"### `src/payout/payout.module.ts`

```ts
@Module({
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService],
})
export class PayoutModule {}
```"

Yes, explicit. And the manifest confirms it reads only controller/service/repository. So I'll write exactly that, with imports.

One more consideration: `PayoutRepository` depends on `PrismaClient`. The plan also doesn't show a PrismaService. The convention says "Prisma as the ORM." Typically you'd have a `PrismaService` extending `PrismaClient`. But the plan doesn't name such a file, and the repository's constructor directly takes `PrismaClient`. The module sketch doesn't provide it. Again, the plan governs — I follow the sketch.

Also, should the file use `@Injectable()`? Modules don't need it. The plan's sketch doesn't have it.

Imports: I need `Module` from `@nestjs/common`, and the three classes. The references use `import { ... } from "@nestjs/common";` with double quotes — the controller uses double quotes. The service also uses double quotes. So I'll use double quotes for consistency with the codebase style shown.

Let me write it:

```ts
import { Module } from "@nestjs/common";
import { PayoutController } from "./payout.controller";
import { PayoutService } from "./payout.service";
import { PayoutRepository } from "./payout.repository";

@Module({
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService],
})
export class PayoutModule {}
```

That's it. The response should be only a single fenced block, with nothing else.
```

## reply

```ts
import { Module } from "@nestjs/common";
import { PayoutController } from "./payout.controller";
import { PayoutService } from "./payout.service";
import { PayoutRepository } from "./payout.repository";

@Module({
  controllers: [PayoutController],
  providers: [PayoutService, PayoutRepository],
  exports: [PayoutService],
})
export class PayoutModule {}
```
