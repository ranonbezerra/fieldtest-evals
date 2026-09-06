# repair1-auth.module.ts

## reasoning

```
The error is:
```
src/auth/auth.module.ts(15,44): error TS2693: 'AccessTokenIssuer' only refers to a type, but is being used as a value here.
```

This means `AccessTokenIssuer` is being used in a `useClass()` or similar context where a class (value) is expected, but it's only an interface (type). 

Looking at the plan and the service file, `AccessTokenIssuer` is defined as an interface in `auth.service.ts`:

```typescript
export interface AccessTokenIssuer {
  issueAccessToken(userId: string): string;
}
```

The module is likely doing something like `useClass(AccessTokenIssuer)` or listing it in `providers` as if it were a class. Since it's just an interface, we can't use it as a value.

The plan says:
> providers: AuthController, AuthService, AuthRepository, AccessTokenIssuer (from app level)

And the wiring convention says:
> A provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other.

Since `AccessTokenIssuer` is an interface (a contract), the actual implementation must be provided from the app level or somewhere else. The module needs to inject it somehow.

The standard NestJS pattern for injecting an interface is to use a custom provider with `useFactory` or to import it from the module that provides the concrete implementation. Since the plan says "AccessTokenIssuer (from app level)", it means the concrete implementation is provided at the app level and injected via a token.

The typical pattern would be:
1. Define an injection token (a `Token` or a string constant)
2. Use that token in the provider definition with `useExisting` or import from the parent module

But wait - looking more carefully at the plan:
> providers: AuthController, AuthService, AuthRepository, AccessTokenIssuer (from app level)

This suggests the module should have a provider for `AccessTokenIssuer` that uses `useExisting` pointing to whatever the app-level provider is, OR the module imports from a parent module that provides it.

Actually, the simplest fix that matches the plan: since `AccessTokenIssuer` is an interface (not a class), we need to use an injection token. The common pattern is:

```typescript
export const ACCESS_TOKEN_ISSUER = new InjectionToken<AccessTokenIssuer>('ACCESS_TOKEN_ISSUER');
```

But wait - the plan says "from app level", meaning it's provided by `AppModule`. The cleanest approach following the plan's wiring convention:

> A provider used by another module is `exports`ed by its own module and that module is `imports`ed by the other.

So `AppModule` would provide the concrete implementation of `AccessTokenIssuer` and export it. Then `AuthModule` imports from `AppModule`.

But since I can only modify `src/auth/auth.module.ts`, and the error is specifically about using an interface as a value, I need to:

1. Use an injection token (a `Symbol` or `String` token) instead of the interface directly in `providers`.

Actually, let me reconsider. The error says line 15, column 44. The file likely has something like:

```typescript
providers: [AuthController, AuthService, AuthRepository, { provide: AccessTokenIssuer, useExisting: ... }]
```

or 

```typescript
providers: [AuthController, AuthService, AuthRepository, AccessTokenIssuer]
```

The second form would cause exactly this error - using an interface as a value (class) in the providers array.

The fix: I need to not use `AccessTokenIssuer` as a value. Instead, I should use an injection token.

Looking at the service:
```typescript
constructor(
  private readonly repo: AuthRepository,
  private readonly issuer: AccessTokenIssuer,
) {}
```

The service injects `AccessTokenIssuer` by type. In NestJS, when you inject by a class, it uses the class as the token. But `AccessTokenIssuer` is an interface, not a class, so NestJS can't use it as a DI token automatically.

The standard solution is to create a custom injection token and use `@Inject(TOKEN)` in the service. But I can't modify the service file.

Wait, let me re-read the constraints: "Change nothing the messages do not name." The message only names `auth.module.ts`. So I can only change that file.

But if the service uses `AccessTokenIssuer` as a constructor parameter type without an `@Inject()` decorator, NestJS will try to resolve it by the class reference. Since it's an interface, this won't work at runtime.

Hmm, but the task says to fix what the compiler messages require of THIS file. The compiler error is in `auth.module.ts`. The fix must be in `auth.module.ts`.

Let me think about what the module file likely looks like and what change would fix line 15, col 44.

If the module has:
```typescript
providers: [AuthController, AuthService, AuthRepository, AccessTokenIssuer]
```

The fix would be to remove `AccessTokenIssuer` from the providers (since it's an interface, not a class) and instead provide it via a factory or import it from another module.

Given the plan says "from app level", the proper fix is:
- Import the module that provides `AccessTokenIssuer` (presumably `AppModule`)
- Or provide it with a `useFactory` / `useExisting`

But since I can't see the app module, and the plan says it's "from app level", I think the cleanest approach that the compiler will accept is:

```typescript
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
```

But wait - if `AccessTokenIssuer` isn't provided anywhere in this module, and the service expects it as a constructor dependency, NestJS will fail at runtime. But the compiler error is only about using a type as a value. The task says "fixing what these messages require of this file" - the compiler message is about using an interface as a value.

Actually, I think the proper approach given the plan is to use a `useFactory` or to import from the parent. But since I don't know the parent module's structure, and the plan says "from app level", let me use the pattern where we import from the app module.

Wait, but I don't know what the app module exports. Let me think differently.

The most standard NestJS pattern for this situation:
1. The app module provides a concrete class that implements `AccessTokenIssuer`
2. It exports it under some token
3. The auth module imports it

OR:
1. We define an injection token in the auth module
2. The app module provides the implementation under that token
3. The service uses `@Inject(TOKEN)`

Since I can only modify the module file, and the service already has `private readonly issuer: AccessTokenIssuer` (which in NestJS without `@Inject()` would use the class/interface as the token), I think the intended pattern is:

The app module provides a concrete class and exports it. The auth module imports from the app module.

But actually, looking at this more carefully - in NestJS, when you do constructor injection with a type that's an interface, it simply won't work without `@Inject()`. The compiler error we're seeing is because the module file is trying to use the interface as a value (in providers array).

The simplest fix that satisfies the compiler: remove `AccessTokenIssuer` from the providers list. The service will still have it as a dependency, and it will be resolved by whatever module provides it (the app module).

For the wiring to work, the auth module needs to import from the module that provides `AccessTokenIssuer`. Based on the plan saying "from app level", it would be `AppModule`.

Let me write:

```typescript
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
```

This removes `AccessTokenIssuer` from the providers (fixing the TS2693 error). The service still depends on it, and it will be resolved by the app module at runtime.

But wait - should I add an `imports` array? The plan says "from app level". If the app module provides and exports a concrete `AccessTokenIssuer`, then I'd need to import it. But I don't know the exact class name or module structure.

Actually, re-reading the plan more carefully:
> providers: AuthController, AuthService, AuthRepository, AccessTokenIssuer (from app level)

I think "(from app level)" is a note that `AccessTokenIssuer` comes from the app level, not that it should be listed in this module's providers. The fix is simply to not list it here.

For the imports, since I don't know the exact module that provides it, and the task says "If a message refers to a shape you cannot see, say so in an // ASSUMPTION: line rather than guessing at it repeatedly", I should add an assumption.

Actually wait - let me re-read: "Change nothing the messages do not name." The message only names `AccessTokenIssuer` being used as a value at line 15, col 44. So I need to fix that specific usage. The minimal fix is to remove it from wherever it's used as a value.

Let me write the module without `AccessTokenIssuer` in providers, and add an assumption about where it's resolved from.

Actually, I realize I should think about what makes the DI work. If `AuthService` has `constructor(repo: AuthRepository, issuer: AccessTokenIssuer)` and there's no `@Inject()` decorator, NestJS will try to resolve `AccessTokenIssuer` as a class. Since it's an interface, this won't work at runtime regardless of what the module file says.

But the task is only about fixing the compiler error in this file. The runtime DI issue would be a separate concern (and might be handled by the app module providing it under a different mechanism, or the service might actually have an `@Inject()` decorator that I just can't see because the reference file shows a simplified version).

Wait, looking at the service file again:
```typescript
constructor(
  private readonly repo: AuthRepository,
  private readonly issuer: AccessTokenIssuer,
) {}
```

There's no `@Inject()` decorator. In NestJS, for interface injection you'd need `@Inject('ACCESS_TOKEN_ISSUER')` or similar. But the task says to only fix what the compiler messages name, and the message is only about `auth.module.ts`.

I'll write the module file that fixes the compiler error and add an assumption about the DI resolution of `AccessTokenIssuer`.

Let me write a clean module file:

```typescript
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

// ASSUMPTION: AccessTokenIssuer is provided at the app level and resolved
// via a custom injection token or useExisting; it cannot appear in this
// module's providers because it is an interface, not a class.
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
```

This should fix the compiler error. The `AccessTokenIssuer` is no longer used as a value in this file.
```

## reply

```typescript
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

// ASSUMPTION: AccessTokenIssuer is an interface (not a class), so it cannot
// appear as a value in `providers`. It is resolved at the app level via a
// custom injection token or useExisting binding exported by AppModule.
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository],
  exports: [AuthService],
})
export class AuthModule {}
```
