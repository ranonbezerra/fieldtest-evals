# 19-app.module.ts

## reasoning

```
Analyzing the plan for `src/app.module.ts`:

```ts
export class AppModule implements NestModule {
  constructor();
  configure(consumer: MiddlewareConsumer): void; // apply(TenantResolutionMiddleware).forRoutes('*')
}
```

Imports `JwtModule` (global, `JWT_SECRET`), `TenantModule`, `CustomerModule`.

So the app module needs to:
1. Import `JwtModule` as global with `JWT_SECRET` from env
2. Import `TenantModule` and `CustomerModule`
3. Implement `NestModule` with a `configure` method that applies `TenantResolutionMiddleware` to all routes (`'*'`)

Let me look at what's needed:
- `Module` from `@nestjs/common`
- `NestModule, MiddlewareConsumer` from `@nestjs/common`
- `JwtModule` from `@nestjs/jwt`
- `TenantModule` from `./tenant/tenant.module`
- `CustomerModule` from `./customer/customer.module`
- `TenantResolutionMiddleware` from `./tenant/tenant-resolution.middleware`

The middleware is applied via `consumer.apply(TenantResolutionMiddleware).forRoutes('*')`.

For `JwtModule`, it needs to be global and configured with `JWT_SECRET` from env. Looking at the plan: "Imports `JwtModule` (global, `JWT_SECRET`)".

Let me write this:

```ts
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TenantModule } from './tenant/tenant.module';
import { CustomerModule } from './customer/customer.module';
import { TenantResolutionMiddleware } from './tenant/tenant-resolution.middleware';

@Module({
  imports: [
    JwtModule.register({
      global: true,
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

Wait, the plan says `forRoutes('*')`. In NestJS, to match all routes, you can use `forRoutes('*')` or just not specify a route. Let me check - actually in NestJS middleware, `forRoutes('*')` is not the standard way. The standard way to apply to all routes is just `consumer.apply(Middleware)` without `.forRoutes()`, or you can use a path. But the plan explicitly says `forRoutes('*')`.

Actually, looking more carefully at NestJS docs, you can use `consumer.apply(Middleware).forRoutes('*')` - wait no. The typical pattern for all routes is:
- `consumer.apply(Middleware).forRoutes('*')` - I'm not sure this works
- Actually in NestJS, if you want to apply to all routes, you just do `consumer.apply(Middleware)` without forRoutes, or use specific paths.

But the plan explicitly says: `configure(consumer: MiddlewareConsumer): void; // apply(TenantResolutionMiddleware).forRoutes('*')`

So I'll follow the plan exactly. Let me use `forRoutes('*')`.

Actually, wait - I just recalled. In NestJS, `forRoutes` accepts path strings, RouteMatch, etc. The `'*'` might not be a valid glob in NestJS middleware routing. But since the plan explicitly specifies it, I'll follow it.

Let me also check: the plan says "Imports `JwtModule` (global, `JWT_SECRET`)". This means `JwtModule.register({ global: true, secret: process.env.JWT_SECRET })`.

The file looks straightforward. Let me finalize it.
```

## reply

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CustomerModule } from './customer/customer.module';
import { TenantModule } from './tenant/tenant.module';
import { TenantResolutionMiddleware } from './tenant/tenant-resolution.middleware';

@Module({
  imports: [
    JwtModule.register({
      global: true,
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
