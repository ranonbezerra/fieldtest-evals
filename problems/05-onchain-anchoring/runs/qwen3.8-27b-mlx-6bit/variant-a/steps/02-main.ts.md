# 02-main.ts

## reasoning

```
The user wants me to write `src/main.ts` for a NestJS application. Based on the plan:

- It's the NestJS bootstrap file
- It reads `src/app.module.ts` (the root module)
- Configuration comes from environment variables only
- The project uses ESM (`"type": "module"`)
- Node 20+

For a standard NestJS bootstrap in ESM mode, I need:
- Import `NestFactory` from `@nestjs/core`
- Import `AppModule` from `./app.module.js` (ESM requires explicit `.js` extension)
- Create the app, listen on a port

The plan says `src/main.ts` reads `src/app.module.ts`. The environment section says configuration comes from environment variables only. I should read the port from an env variable (e.g., `PORT` or `APP_PORT`).

Let me write a clean, minimal NestJS bootstrap:

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
```

Wait, the plan says "ESM, `"type": "module"`". In ESM mode with TypeScript, imports need the `.js` extension when referencing other files. So `./app.module.js` is correct.

The plan doesn't specify a specific port variable name. The environment section says "Configuration comes from environment variables only." I'll use `PORT` with a default of 3000 as that's the most conventional. Actually, let me think about whether I should even have a default. The plan says no hardcoded connection strings, but a port default is standard practice and not a secret. I'll keep it simple with a default.

Actually, looking more carefully - the plan just says "NestJS bootstrap". Let me keep it minimal. The standard pattern is:

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
}

void bootstrap();
```

This is clean, complete, and does exactly what's specified. No extra features, no exports beyond what's needed for bootstrap.
```

## reply

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
}

void bootstrap();
```
