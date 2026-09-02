# 04-main.ts

## reasoning

```
The task is to write `src/main.ts` — the NestJS bootstrap file. Let me look at what the plan specifies for this file.

From the manifest:
```
src/main.ts | reads: src/app.module.ts | NestJS bootstrap
```

So `src/main.ts` is a standard NestJS bootstrap file that:
1. Imports `NestFactory` from `@nestjs/core`
2. Imports `AppModule` from `./app.module`
3. Creates the Nest application
4. Sets a global prefix (the endpoints are `/operations`, `/operations/simulate-write`, etc.)
5. Enables a global validation pipe (the plan mentions input validation in controllers)
6. Listens on a port

Looking at the plan more carefully:
- Endpoints are `GET /operations`, `POST /operations/simulate-write`, `GET /operations/totals/:companyId`, `POST /operations/re-derive`
- These are already kebab-case and plural as the conventions require
- The plan says "NestJS bootstrap" — standard stuff

For a standard NestJS bootstrap:
- `import { NestFactory } from '@nestjs/core'`
- `import { AppModule } from './app.module'`
- `import { ValidationPipe } from '@nestjs/common'` (for input validation)

The plan mentions the controller "validates input" — in NestJS this is typically done with a global `ValidationPipe` using `class-validator`. But the plan doesn't explicitly mention class-validator decorators. It just says "validates input." Let me keep it simple.

Actually, looking at the conventions: "Configuration comes from environment variables only." The port should come from an env var.

Let me write a minimal, standard NestJS bootstrap:

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api'); // Hmm, the plan doesn't mention an "api" prefix
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
```

Wait — the endpoints in the plan are `GET /operations`, `POST /operations/simulate-write`, etc. There's no `/api` prefix mentioned. Let me not add one. The plan says the endpoint is `GET /operations` — so no global prefix.

Actually, let me reconsider. The plan says:
- "The dashboard endpoint is `GET /operations` with query-string filters"
- "the write-simulation is `POST /operations/simulate-write`"

So no prefix. Just plain `/operations`.

For the port, the convention says "Configuration comes from environment variables only." So I should use `process.env.PORT`.

Should I enable a validation pipe? The plan says controllers "validate input" but doesn't specify the mechanism. In NestJS, the standard approach is a global `ValidationPipe`. But since the plan doesn't explicitly mention class-validator, I'll include a basic `ValidationPipe` as it's standard NestJS practice and the plan does say controllers validate input. Actually, let me be conservative — the plan says "Do not add a feature the plan does not name." A ValidationPipe is part of standard NestJS bootstrap and the plan does say controllers validate. I'll include it as it's standard practice for the stated requirement.

Hmm, but actually the plan says "controller validates input and calls the service. Zero business logic." This is a layering rule, not necessarily prescribing a specific mechanism. The safest reading for a "NestJS bootstrap" file is the minimal one: create app, listen. I'll add the ValidationPipe since it's a standard part of bootstrap and supports the "validates input" requirement.

Let me also consider: should I set `app.enableShutdownHooks()`? The plan mentions a scheduled drift-repair job with `@Cron`. For proper shutdown of the cron scheduler, `enableShutdownHooks()` would be good practice. But the plan doesn't explicitly call for it. I'll keep it minimal but include it since it's standard for apps with scheduled tasks.

Actually, let me be truly minimal. The plan says "NestJS bootstrap" and reads from `src/app.module.ts`. The most defensible reading:

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
}

void bootstrap();
```

This is clean, standard, and does exactly what a NestJS bootstrap should. The `ValidationPipe` supports the controller-level validation requirement. The port comes from env var per conventions.

Let me finalize this.
```

## reply

```ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
}

void bootstrap();
```
