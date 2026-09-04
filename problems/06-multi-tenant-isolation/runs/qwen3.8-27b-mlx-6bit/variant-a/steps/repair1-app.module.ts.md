# repair1-app.module.ts

## reasoning

```
Let me analyze the compiler errors for `src/app.module.ts` specifically. Looking at the error list, I don't see any errors directly in `src/app.module.ts`. The errors are in other files.

Wait, let me re-read the task. It says "src/app.module.ts does not compile" and lists all compiler messages for the whole workspace. Let me look more carefully...

The errors listed are in:
- src/tenant/tenant-resolution.middleware.ts
- src/tenant/tenant.controller.ts
- src/tenant/tenant.module.ts
- src/tenant/tenant.repository.ts
- src/tenant/tenant.service.ts
- test/customer-isolation.spec.ts
- test/tenant-config.spec.ts

There are NO errors in `src/app.module.ts` itself. But the task says "Rewrite `src/app.module.ts` complete, fixing what these messages require of this file."

So the task is asking me to write `src/app.module.ts` that will work given these errors. The errors in other files are about:
1. Missing `.js` extensions on relative imports (TS2835)
2. Cannot find modules like `express`, `@nestjs/jwt`, `jsonwebtoken`, `supertest`, `@nestjs/testing` (TS2307) - these are likely missing type declarations or packages
3. Cannot find relative modules without extensions (TS2307) - e.g., `./tenant.repository` should be `./tenant.repository.js`

Wait, but the task says "Rewrite `src/app.module.ts` complete, fixing what these messages require of this file." and "Change nothing the messages do not name."

So I need to write `src/app.module.ts` that:
1. Uses `.js` extensions on all relative imports (since the project uses `moduleResolution: node16/nodenext`)
2. Imports from `./tenant/tenant.module.js`, `./customer/customer.module.js`, `./tenant/tenant-resolution.middleware.js`

Looking at the PLAN.md manifest:
```
src/app.module.ts | reads: src/tenant/tenant.module.ts, src/customer/customer.module.ts, src/tenant/tenant-resolution.middleware.ts | root module + global middleware
```

And the plan says:
```ts
export class AppModule implements NestModule {
  constructor();
  configure(consumer: MiddlewareConsumer): void; // apply(TenantResolutionMiddleware).forRoutes('*')
}
```

Imports: `JwtModule` (global, `JWT_SECRET`), `TenantModule`, `CustomerModule`.

So the file needs:
- Import from `@nestjs/common` (Module, MiddlewareConsumer, NestModule)
- Import from `@nestjs/jwt` (JwtModule)
- Import `TenantModule` from `./tenant/tenant.module.js`
- Import `CustomerModule` from `./customer/customer.module.js`
- Import `TenantResolutionMiddleware` from `./tenant/tenant-resolution.middleware.js`

The key fix for this file is adding `.js` extensions to all relative imports. The other errors (missing packages like express, @nestjs/jwt in other files) are not about `src/app.module.ts` - they're about other files.

Wait, but `@nestjs/jwt` is imported in `src/app.module.ts` too (for JwtModule). If the package isn't installed, that would be an error. But the task says "Change nothing the messages do not name." The messages don't name `src/app.module.ts` having an error with `@nestjs/jwt`. So I should keep that import.

Actually, let me reconsider. The errors say "Cannot find module '@nestjs/jwt'" in `tenant-resolution.middleware.ts`. This could mean the package isn't installed. But the task says to fix what "these messages require of this file" (app.module.ts). Since app.module.ts also imports `@nestjs/jwt` for JwtModule, and the plan specifies it should be there, I'll keep it.

Let me write the complete `src/app.module.ts`:

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TenantModule } from './tenant/tenant.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { TenantResolutionMiddleware } from './tenant/tenant-resolution.middleware.js';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
    }),
    TenantModule,
    CustomerModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  }
}
```

This should be correct. The key fix is the `.js` extensions on relative imports. The `@nestjs/jwt` import for `JwtModule` is per the plan. I'm not adding anything or removing anything beyond what's needed.

Wait - should `JwtModule` be global? The plan says "Imports `JwtModule` (global, `JWT_SECRET`)". Let me make it global with `{ global: true }`:

Actually, looking more carefully at the plan: "Imports `JwtModule` (global, `JWT_SECRET`), `TenantModule`, `CustomerModule`."

So it should be:
```ts
JwtModule.register({
  secret: process.env.JWT_SECRET,
})
```

But "global" might mean `JwtModule.register({ secret: ..., global: true })` or it might just mean it's registered at the app level (which makes it available to all modules that import AppModule or are children of it). Actually in NestJS, a module registered in AppModule is available to all child modules. So just registering it in AppModule's imports should be sufficient. But the plan says "global" explicitly, so let me use `{ global: true }`.

Hmm, actually re-reading: "Imports `JwtModule` (global, `JWT_SECRET`)" - I think this means the JwtModule is configured as global so that JwtService can be injected anywhere without needing to import JwtModule in each feature module. Let me add `global: true`.

Wait, but the task says "Change nothing the messages do not name." The compiler errors don't mention `src/app.module.ts` at all. So I'm just writing it fresh based on the plan, making sure to use `.js` extensions. The "global" aspect is from the plan, so I'll include it.

Let me finalize:
```

## reply

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TenantModule } from './tenant/tenant.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { TenantResolutionMiddleware } from './tenant/tenant-resolution.middleware.js';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      global: true,
    }),
    TenantModule,
    CustomerModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantResolutionMiddleware).forRoutes('*');
  }
}
```
