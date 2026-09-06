# 04-app.module.ts

## reasoning

```
The task is to write `src/app.module.ts` — the root module that imports AuthModule.

From the plan:
```ts
@Module({
  imports: [AuthModule],
})
export class AppModule {}
```

This is straightforward. The file should import `Module` from `@nestjs/common` and `AuthModule` from the auth feature module.

Let me write it cleanly:
```ts
import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";

@Module({
  imports: [AuthModule],
})
export class AppModule {}
```

That's it. Simple, complete, matches the plan exactly.
```

## reply

```ts
import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";

@Module({
  imports: [AuthModule],
})
export class AppModule {}
```
