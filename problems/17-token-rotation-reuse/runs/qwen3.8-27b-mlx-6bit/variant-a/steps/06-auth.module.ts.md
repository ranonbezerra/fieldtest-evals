# 06-auth.module.ts

## reasoning

```
Let me analyze what's needed for `src/auth/auth.module.ts` based on the plan and references.

From the plan:
```typescript
// src/auth/auth.module.ts

export class AuthModule implements NestModule {
  // providers: AuthController, AuthService, AuthRepository, AccessTokenIssuer (from app level)
  // exports: AuthService
}
```

Wait, the plan says `implements NestModule` but that's actually for implementing `configure()` (for routes/interceptors). Let me re-read...

Actually, looking more carefully at the plan:
- providers: AuthController, AuthService, AuthRepository, AccessTokenIssuer (from app level)
- exports: AuthService

Wait, `AuthController` is typically a `controllers` entry, not a `providers` entry in NestJS. Let me re-read the plan.

The plan says:
```
// providers: AuthController, AuthService, AuthRepository, AccessTokenIssuer (from app level)
// exports: AuthService
```

But in NestJS, controllers go in `controllers`, not `providers`. The plan's comment is a bit loose - it's listing all the classes involved. Let me think about what the correct NestJS module looks like:

- `controllers`: [AuthController]
- `providers`: [AuthService, AuthRepository]
- `exports`: [AuthService]

Now, what about `AccessTokenIssuer`? The plan says "from app level" - this means it's provided elsewhere (in the AppModule) and imported here. But wait, looking at the service:

```typescript
export interface AccessTokenIssuer {
  issueAccessToken(userId: string): string;
}
```

The service depends on `AccessTokenIssuer` interface. In NestJS DI, this needs to be provided somewhere. The plan says "from app level" meaning it's provided at the app level and this module imports it.

But wait - how does NestJS know to inject the right implementation? If `AccessTokenIssuer` is an interface, we'd need a token for DI. Let me look at the service constructor:

```typescript
constructor(
  private readonly repo: AuthRepository,
  private readonly issuer: AccessTokenIssuer,
) {}
```

In NestJS, for interface-based injection, you'd typically use an injection token. But the plan doesn't specify a token - it just says `AccessTokenIssuer`. This is tricky.

Actually, looking at this more carefully - in NestJS, if you use an interface directly as a parameter type, NestJS can't resolve it automatically. You'd need either:
1. A `@Inject('AccessTokenIssuer')` decorator with a string token
2. Use the interface as a class token (but interfaces don't exist at runtime in TS)

Hmm, but the plan says to implement exactly what it specifies. The plan says:
- providers: AuthController, AuthService, AuthRepository, AccessTokenIssuer (from app level)
- exports: AuthService

The "(from app level)" for AccessTokenIssuer suggests it's provided elsewhere. So this module would need to import the module that provides it, OR provide a token/forwardRef.

Actually, let me reconsider. The plan says "providers: AuthController, AuthService, AuthRepository, AccessTokenIssuer (from app level)". I think the parenthetical "(from app level)" means AccessTokenIssuer is NOT a provider of this module - it comes from the app level. So:

- controllers: [AuthController]
- providers: [AuthService, AuthRepository]
- exports: [AuthService]

And AccessTokenIssuer would need to be imported from wherever it's provided. But the plan doesn't mention an `imports` array explicitly...

Wait, let me re-read the wiring conventions:
"A service, repository or processor is listed in its module's `providers`. A provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other."

So if `AccessTokenIssuer` is provided at the app level (AppModule), then AuthModule would need to import AppModule? That seems circular. More likely, there's a separate module that provides `AccessTokenIssuer`.

Actually, the task says "Sign-in and access-token verification already exist; assume `issueAccessToken(userId): string`." This means it's a pre-existing service. The plan says it's "from app level."

I think the most defensible reading is:
- `AccessTokenIssuer` is provided by the AppModule (or some shared module)
- AuthModule needs to import that module

But since I don't know the exact name of the module that provides it, and the plan just says "from app level", I'll assume it's provided directly in the AppModule. But importing AppModule into AuthModule would be circular...

Actually, a more common pattern: the `AccessTokenIssuer` is provided as a provider in a shared/common module, or it's provided at the app level and AuthModule imports `AppModule`. But that's circular.

Let me think differently. Perhaps the simplest interpretation: `AccessTokenIssuer` is a provider that's defined at the app level (in AppModule), and since NestJS resolves dependencies across the entire application context when a module is imported into AppModule, the service can be resolved. But that's not how NestJS DI works in practice - you need explicit imports.

Actually, the most common pattern for "pre-existing" services that are "from app level" is to just list them as providers in the module that uses them, or to have a dedicated module. Since the plan says it's "from app level" and doesn't specify a separate module, I think the most defensible approach is:

Option 1: Provide `AccessTokenIssuer` directly in AuthModule as a provider (but the plan says "from app level")
Option 2: Import from AppModule (circular)
Option 3: Assume there's a token-based injection and just note the assumption

Actually, re-reading the plan more carefully: "providers: AuthController, AuthService, AuthRepository, AccessTokenIssuer (from app level)"

I think the parenthetical is clarifying that AccessTokenIssuer's implementation comes from the app level (it's not defined in this feature), but for DI purposes, it still needs to be available. In NestJS, the cleanest way when you don't control where the provider is defined is to use an injection token.

But wait - looking at the service code, it uses `private readonly issuer: AccessTokenIssuer` without any `@Inject()` decorator. In NestJS, this means it will try to resolve by the type token. But `AccessTokenIssuer` is an interface - at runtime it doesn't exist as a class.

This is a genuine ambiguity. The most defensible reading:
- The service was written expecting DI to work with `AccessTokenIssuer` as a type
- This implies either: (a) there's actually a class named `AccessTokenIssuer` that implements the interface, or (b) there should be an `@Inject('AccessTokenIssuer')` token

Since the plan says to implement exactly what it specifies, and the service (which I can't modify) uses the interface directly as a type hint, I'll need to make an assumption. The most common pattern in NestJS for this would be to use a string injection token.

But actually, I'm overthinking this. Let me look at what the plan literally says for this file:

```
export class AuthModule implements NestModule {
  // providers: AuthController, AuthService, AuthRepository, AccessTokenIssuer (from app level)
  // exports: AuthService
}
```

The plan literally lists what goes in the module. In proper NestJS:
- AuthController → `controllers` array
- AuthService, AuthRepository → `providers` array  
- AccessTokenIssuer → from app level (imported)
- exports: [AuthService]

For the "from app level" part, I'll need to handle this. The most defensible approach given the constraints:

1. Don't list `AccessTokenIssuer` in providers (it's from app level)
2. The module will need to import whatever provides it

But I don't know what module provides it. The task says "Sign-in and access-token verification already exist" - this suggests there's an existing auth module or app-level provider.

I think the cleanest approach that matches the plan is:
- If `AccessTokenIssuer` is a class provided at the app level, I can just import it as a provider reference. In NestJS, if you list a class in `providers` of the AppModule, it's only available to modules that import AppModule (which is circular) OR if you use a shared module.

Actually, you know what, let me just go with the simplest defensible interpretation: The `AccessTokenIssuer` is provided as a provider in this module. The "(from app level)" might just mean "the implementation exists at the app level" (i.e., it's a pre-existing service), not that it must be provided by a different module. The plan lists it in the providers comment.

Wait, re-reading: "providers: AuthController, AuthService, AuthRepository, AccessTokenIssuer (from app level)"

I think this is listing ALL the classes involved, with a note that AccessTokenIssuer's implementation is from the app level. In NestJS terms:
- controllers: [AuthController]
- providers: [AuthService, AuthRepository, AccessTokenIssuer]  (AccessTokenIssuer is provided here but its implementation is a pre-existing app-level service)
- exports: [AuthService]

Actually no. If it's "from app level", it shouldn't be in this module's providers. It should be imported.

Let me just go with the most standard NestJS pattern:
- `@Module` (not `implements NestModule` - that's for interceptors/guards, not needed here)
- controllers: [AuthController]
- providers: [AuthService, AuthRepository]
- exports: [AuthService]

And for AccessTokenIssuer - since it's "from app level" and the plan doesn't specify a separate module name, I'll assume it's provided at the app level and this module doesn't need to do anything special for it (the app context will resolve it). Actually no, that's not how NestJS works.

OK let me just make a pragmatic decision. The plan says `implements NestModule` - I'll keep that even though it's not strictly necessary (it just means the module CAN implement `configure()`, but doesn't require it). Actually, `NestModule` is an interface that defines `configure(consumer: MiddlewareConsumer): void`. If you implement it but don't provide the method, TypeScript will complain. So maybe the plan means something else by that comment.

Actually in NestJS, you don't need to `implement NestModule` unless you're using the module for middleware/route guards. The plan's comment is just describing the structure loosely. I'll use `@Module` decorator without implementing `NestModule`.

Final decision:
- Use `@Module` decorator
- controllers: [AuthController]
- providers: [AuthService, AuthRepository]
- exports: [AuthService]
- For AccessTokenIssuer: I'll add an assumption comment that it's resolved from the application context (provided at app level). In practice, this means AppModule would need to either provide it or import a module that does. Since the plan says "from app level" and doesn't specify a module to import, I'll note this as an assumption.

Wait, actually - in NestJS, if a provider is registered in the root AppModule, it's only available to the root module's controllers and providers, not to child modules unless imported. So AuthModule would need to either:
1. Provide AccessTokenIssuer itself
2. Import a module that provides and exports it

Since the plan doesn't name another module, and says the provider is "from app level", I think the most defensible reading is that it's provided in this module (the "app level" just means it's a pre-existing service whose class is defined elsewhere in the app, not that it's provided by a different NestJS module).

Let me go with:
- providers: [AuthService, AuthRepository, AccessTokenIssuer]

And add an assumption comment about the token/class resolution.

Actually, I just realized - if `AccessTokenIssuer` is an interface (as shown in the service code), it can't be used as a class token in NestJS DI. You'd need either:
1. A concrete class that implements it
2. An `@Inject('ACCESS_TOKEN_ISSUER')` token

Since the service code uses it directly without `@Inject`, it must be a concrete class at runtime. The interface in the code is just TypeScript typing. So there must be a concrete class somewhere.

I'll write the module assuming `AccessTokenIssuer` is a concrete class that can be used as a provider token. I'll add an assumption comment noting this.

Let me write the final file:

```typescript
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService, AccessTokenIssuer } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, AccessTokenIssuer], // ASSUMPTION: ...
  exports: [AuthService],
})
export class AuthModule {}
```

Hmm, but `AccessTokenIssuer` is an interface in the service file. At runtime, interfaces don't exist. So using it as a class in `providers` would fail at runtime.

The most defensible reading: There's a concrete class (let's call it `AccessTokenIssuer` or whatever) that exists at the app level. The interface in auth.service.ts is just a type constraint. The concrete class would be imported from wherever it's defined.

But I don't know where it's defined or what its import path is. The plan says "from app level" and "assume `issueAccessToken(userId): string`".

I think the cleanest approach: use a string injection token `ACCESS_TOKEN_ISSUER` and provide it. But the service doesn't use `@Inject('ACCESS_TOKEN_ISSUER')` - it uses the type directly.

You know what, I'll just follow the plan as literally as possible. The plan says to list `AccessTokenIssuer` in providers. I'll do that and add an assumption comment about it being a concrete class resolvable by NestJS DI.

Let me finalize:
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService, AccessTokenIssuer } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

// ASSUMPTION: AccessTokenIssuer is declared as an interface in auth.service.ts,
// but NestJS resolves providers by class reference at runtime. The plan states
// the implementation is "from app level" (pre-existing). We list it in providers
// here on the assumption that a concrete class named AccessTokenIssuer (or a
// factory/token registered under that name) is available at runtime. If the real
// implementation lives in a separate module, AuthModule should instead `imports`
// that module and remove AccessTokenIssuer from this providers array.
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, AccessTokenIssuer],
  exports: [AuthService],
})
export class AuthModule {}
```
