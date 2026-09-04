# 20-main.ts

## reasoning

```
The user wants me to write `src/main.ts` based on the plan. Let me look at what the plan specifies for this file:

From the plan:
```
`src/main.ts`
```ts
export async function bootstrap(): Promise<void>;
```

The manifest says: `src/main.ts | reads: src/app.module.ts, src/errors/http-exception.filter.ts | bootstrap + global error filter`

So `src/main.ts` needs to:
1. Import `NestFactory` from `@nestjs/core`
2. Import `AppModule` from `./app.module`
3. Import `HttpExceptionFilter` from `./errors/http-exception.filter`
4. Export an async function `bootstrap()` that:
   - Creates the Nest application from `AppModule`
   - Registers the global error filter via `app.useGlobalFilters(new HttpExceptionFilter())`
   - Listens (starts the server)

Let me look at the conventions:
- ESM, `"type": "module"`
- TypeScript strict
- Node 20+
- NestJS

The plan says `export async function bootstrap(): Promise<void>;` — so it's an exported function, not just a self-executing script.

Standard NestJS bootstrap:
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './errors/http-exception.filter';

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen();
}
```

Wait, should I include the port? The plan doesn't mention a specific port. Let me check... The plan just says `bootstrap + global error filter`. No port is mentioned. I'll use `await app.listen()` without a specific port, which defaults to 3000 in NestJS. Actually, looking more carefully, the plan doesn't specify a port at all, so I'll just call `await app.listen()` which uses the default.

Actually, let me reconsider. The environment section says "Configuration comes from environment variables only." But the plan doesn't mention a PORT env variable. I'll keep it simple with just `await app.listen()`.

Let me also consider whether to call `bootstrap()` at the end. The plan says `export async function bootstrap(): Promise<void>;` — it's exported but the plan doesn't explicitly say to call it. In a typical NestJS main.ts, you'd call it. But since the plan only specifies the function signature and the manifest says "bootstrap + global error filter", I think the function should be self-invoking or at least callable. Let me just export it without auto-calling, since the plan defines it as a function to be exported. Actually, in typical NestJS projects, `main.ts` calls bootstrap at the end. But the plan is quite specific: it just says `export async function bootstrap(): Promise<void>;`. 

Hmm, but if I don't call it, the file does nothing when executed. Let me think about this... The plan says the function signature is `export async function bootstrap(): Promise<void>`. In NestJS, `main.ts` is the entry point. It would make sense to call it. But the plan doesn't explicitly say "call bootstrap() at the end." 

I'll include the call since it's a bootstrap file — that's what makes it functional. The plan says "bootstrap + global error filter" which implies it actually bootstraps the app. A function that's never called doesn't bootstrap anything.

Let me write it:

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './errors/http-exception.filter';

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen();
}

bootstrap();
```

This is clean, complete, and matches the plan. The global filter is registered before `listen()`, which is correct per NestJS docs.
```

## reply

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './errors/http-exception.filter';

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen();
}

bootstrap();
```
