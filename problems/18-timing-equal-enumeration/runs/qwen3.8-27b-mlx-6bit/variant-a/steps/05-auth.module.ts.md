# 05-auth.module.ts

## reasoning

```
Let me analyze the PLAN.md to understand what `src/auth/auth.module.ts` needs to contain.

From the plan:

```ts
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, MailPort /* token provider */],
  exports: [AuthService],
})
export class AuthModule {}
```

The manifest says:
`src/auth/auth.module.ts | reads: src/auth/auth.controller.ts, src/auth/auth.service.ts, src/auth/auth.repository.ts, src/auth/auth.dto.ts | Feature module wiring`

So I need to import:
- `AuthController` from `./auth.controller`
- `AuthService` from `./auth.service`
- `AuthRepository` from `./auth.repository`
- `MailPort` from `./auth.service` (it's defined in auth.service.ts per the plan)

Wait, let me re-read the plan. The `MailPort` interface is defined in `src/auth/auth.service.ts`:

```ts
export interface MailPort {
  sendEmail(to: string, template: string, vars: Record<string, string>): Promise<void>;
}
```

And the module providers include `MailPort` as a "token provider". This means `MailPort` is used as an injection token. In NestJS, when you provide an interface (which is just a type at compile time), you need to use `{ provide: MailPort, useFactory: ... }` or similar. But wait - interfaces don't exist at runtime in TypeScript. So you can't use `MailPort` directly as a token unless it's actually a class or a constant.

Hmm, but the plan says:
- "Injected as an interface `MailPort` with `sendEmail(to, template, vars)`; a token-level provider is registered in the module"
- providers: [AuthService, AuthRepository, MailPort /* token provider */]

This is a bit ambiguous. In NestJS, if `MailPort` is just an interface, it won't exist at runtime. You'd need to either:
1. Make it a class (but the plan says interface)
2. Use a string token like `provide: 'MAIL_PORT'`

Wait, looking more carefully at the plan's module section:

```ts
providers: [AuthService, AuthRepository, MailPort /* token provider */],
```

The comment says "token provider" - this suggests `MailPort` is being used as an injection token. But since it's an interface in the plan, this won't work at runtime unless we use it differently.

Actually, re-reading: "a token-level provider is registered in the module". This means we need to register a provider that provides the `MailPort` token. In NestJS, you'd typically do:

```ts
providers: [
  AuthService,
  AuthRepository,
  { provide: MailPort, useValue: ... }
]
```

But wait - the plan literally shows `MailPort` in the providers array directly. If `MailPort` were a class, you could just list it. But the plan defines it as an interface...

Let me reconsider. The plan says in the assumptions:
"Mail port | Injected as an interface `MailPort` with `sendEmail(to, template, vars)`; a token-level provider is registered in the module | Task says it "exists"; we depend on the interface only"

And the task says: "Assume a mail port `sendEmail(to, template, vars): Promise<void>` exists."

So the mail port "exists" externally. The module needs to declare it as a dependency. In NestJS, if the `MailPort` is provided by another module (or by the application root), you'd import it. But the plan shows it in `providers` of AuthModule.

Actually, I think the most defensible reading here is:
- `MailPort` is defined as an interface in `auth.service.ts`
- In the module, we need to provide it as a token

But since interfaces don't exist at runtime in TypeScript/JavaScript, you can't use them as DI tokens directly. The common pattern would be to either:
1. Use a string literal as the token
2. Make it an abstract class

But the plan explicitly shows `MailPort` in the providers array. Let me look at this from a different angle - maybe the plan intends for `MailPort` to be provided externally (like from app.module or a separate mail module), and the AuthModule just needs to import it.

Wait, re-reading the plan's module:
```ts
providers: [AuthService, AuthRepository, MailPort /* token provider */],
```

The comment "token provider" next to `MailPort` suggests it's listed as a provider that provides the MailPort token. In NestJS, if you just list a class in providers, it means "instantiate this class." For an interface, this wouldn't work.

I think the most defensible interpretation is:
- `MailPort` should be treated as an injection token
- Since it's an interface (type only), we need a different approach

Actually, you know what - let me reconsider. In many NestJS codebases, people use abstract classes or even just string constants as tokens. The plan says "interface" but the implementation might use it differently.

Given the constraint that I should "Implement exactly what the plan specifies for this file" and the plan shows:
```ts
providers: [AuthService, AuthRepository, MailPort /* token provider */],
```

I think the plan is showing a simplified/pseudocode view. The actual implementation needs to handle the fact that `MailPort` is an interface.

The most defensible reading: Since `MailPort` is an interface (type-only), it cannot be used as a runtime token. The plan's intent is that `MailPort` is provided externally (the task says "Assume a mail port exists"). So the module should:
- Import the `MailPort` type for the service's dependency
- Have it provided by an external module or at the app level

But the plan explicitly lists it in `providers`. Let me just go with the plan's literal specification and use `MailPort` as a provider. In TypeScript, if `MailPort` is an interface, it won't compile as a runtime value in the providers array.

Hmm, let me think about this differently. What if I'm overthinking this? The plan says to write the module wiring. The plan shows:

```ts
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, MailPort /* token provider */],
  exports: [AuthService],
})
export class AuthModule {}
```

Maybe in the actual implementation, `MailPort` is not just an interface but has a companion class or constant that serves as the token. But the plan only defines it as an interface in `auth.service.ts`.

I'll go with the most defensible reading: I'll import `MailPort` from `./auth.service` and use it as a token in the providers. In TypeScript with `emitDecoratorMetadata`, interfaces can't be used as values, but if the codebase compiles, perhaps `MailPort` is meant to be a string constant or the interface itself is used in a way that works.

Actually, you know what - I'll just write it as the plan specifies. If `MailPort` is an interface, in the providers array it would need to be handled. But the plan is explicit about the structure. Let me just follow it literally.

Wait - one more thought. In NestJS, you can provide a value for a token:
```ts
{ provide: MailPort, useFactory: () => ({...}) }
```

But `MailPort` as an interface doesn't exist at runtime. Unless... the plan means something slightly different.

OK, I'll make a pragmatic decision. The plan says:
1. `MailPort` is an interface defined in `auth.service.ts`
2. It's listed in providers as a "token provider"
3. The task says "Assume a mail port exists"

The most defensible implementation: `MailPort` is provided by an external module (since the task says it "exists"). The AuthModule needs to import the module that provides it, OR the MailPort token is provided at the app level.

But the plan's module spec doesn't show an `imports` array. It only shows controllers, providers, and exports.

I think the simplest reading that makes the code actually work: The `MailPort` is provided at the application level (in app.module or main.ts), and the AuthModule just needs to declare it as a dependency. But NestJS requires that if you inject something, it must be provided somewhere in the module's dependency graph.

Given all this ambiguity, I'll write the file exactly as the plan specifies structurally, importing the symbols from their respective files. For `MailPort`, since it's an interface (type-only), I'll import it as a type. But then I can't put it in the providers array as a value...

Let me just go with: the plan is the spec, and I'll write it as literally as possible. If `MailPort` needs to be in providers, I'll put it there. The assumption comment can note that `MailPort` is treated as a runtime token (which would require it to be more than just an interface in practice, or provided externally).

Actually, I just realized - maybe I should look at this from a different angle. What if `MailPort` in the providers array is meant to be a dynamic provider like `{ provide: 'MAIL_PORT', useFactory: ... }`? But the plan doesn't show that syntax.

You know what, I'll just follow the plan's literal structure. The plan says `providers: [AuthService, AuthRepository, MailPort]`. I'll write it that way. If `MailPort` is an interface, the code won't compile as-is, but the plan governs and I should implement what it says. I'll add an ASSUMPTION comment noting that `MailPort` is treated as a runtime-injectable token (requiring it to be a class or constant at runtime, not just a type).

Wait, actually - re-reading the plan one more time:

"Mail port | Injected as an interface `MailPort` with `sendEmail(to, template, vars)`; a token-level provider is registered in the module | Task says it "exists"; we depend on the interface only"

"A token-level provider is registered in the module" - this means the module registers a provider for the MailPort token. In NestJS, this would be:

```ts
{ provide: MailPort, useValue: someMailService }
```

or 

```ts
{ provide: MailPort, useFactory: () => ... }
```

But the plan shows it simply as `MailPort` in the array, which in NestJS means "instantiate this class." 

I think the plan is using a simplified notation. The actual implementation would need `MailPort` to be either:
1. A class (not just an interface) - but the plan says interface
2. A string/constant token used with `{ provide: ..., useValue/useFactory: ... }`

Given that the task says "Assume a mail port exists" and the plan says "we depend on the interface only", I think the intent is:
- The MailPort is provided externally (perhaps in AppModule or a MailModule)
- AuthModule imports whatever provides it

But the plan doesn't show an `imports` array for AuthModule...

OK, final decision: I'll write the module exactly as the plan shows it. `MailPort` in the providers array. I'll import it from `./auth.service`. If it's an interface, in practice you'd need to adjust, but the plan governs. I'll add one ASSUMPTION comment about MailPort being a runtime-injectable token.

Actually wait - let me reconsider one more time. What if in the actual `auth.service.ts` file (which I'm not writing), `MailPort` is defined as an abstract class rather than an interface? The plan shows it as an interface in the type definitions, but the implementation might differ. Abstract classes CAN be used as NestJS providers (they get instantiated... no wait, abstract classes can't be instantiated).

Abstract classes in NestJS are used as tokens: `{ provide: AbstractClass, useClass: ConcreteImplementation }`.

I think the cleanest interpretation that makes everything work:
- `MailPort` is a token (could be an abstract class or a unique symbol/string)
- It's provided at the app level or in this module with a concrete implementation

Since the plan literally shows it in providers, and says "a token-level provider is registered in the module", I'll include it. The plan governs.

Let me just write the file:

```ts
import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService, MailPort } from "./auth.service";
import { AuthRepository } from "./auth.repository";

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, MailPort],
  exports: [AuthService],
})
export class AuthModule {}
```

Hmm but `MailPort` as an interface won't work as a value in the providers array. Let me add the ASSUMPTION comment.

Actually, I just want to double-check: does the plan's "reads" for this file include `auth.dto.ts`? Yes: "reads: src/auth/auth.controller.ts, src/auth/auth.service.ts, src/auth/auth.repository.ts, src/auth/auth.dto.ts"

But the module doesn't directly use DTOs. The "reads" in the manifest might just indicate the dependencies of the whole feature, not that the module file imports all of them. The module only needs to import what it directly references: `AuthController`, `AuthService`, `MailPort`, and `AuthRepository`.

Let me finalize my answer.
```

## reply

```ts
import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService, MailPort } from "./auth.service";
import { AuthRepository } from "./auth.repository";

// ASSUMPTION: MailPort is an interface (type-only) in auth.service.ts; using it
// directly as a provider value requires it to be a runtime-injectable token
// (e.g. an abstract class or a unique constant) at the point where this module
// is compiled. The plan specifies it as a "token-level provider registered in
// the module", so it is listed here as the plan dictates.
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, MailPort],
  exports: [AuthService],
})
export class AuthModule {}
```
