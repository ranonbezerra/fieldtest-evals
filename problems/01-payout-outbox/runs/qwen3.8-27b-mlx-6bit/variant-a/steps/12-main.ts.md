# 12-main.ts

## reasoning

```
The task is to write `src/main.ts` — the NestJS bootstrap file. Let me look at what the plan specifies for this file:

From the manifest:
```
src/main.ts | reads: src/app.module.ts | NestJS bootstrap
```

So it imports from `src/app.module.ts` and bootstraps NestJS. The reference shows `src/app.module.ts` exports `AppModule`.

A standard NestJS bootstrap file:
1. Import `NestFactory` from `@nestjs/core`
2. Import `AppModule` from the app module
3. Create the Nest application
4. Listen on a port

Let me write this in the ESM style (the project uses `"type": "module"` and imports use `.js` extensions as seen in the app.module.ts reference).

Looking at the app.module.ts reference, imports use `.js` extension: `from './payout/payout.module.js'`. So I should follow the same pattern.

The plan says:
- `src/main.ts | reads: src/app.module.ts | NestJS bootstrap`

Standard NestJS main.ts:
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

The plan doesn't specify a port explicitly, but 3000 is the NestJS default. I'll use that. No additional features are mentioned in the plan for this file — just bootstrap.

Let me keep it minimal and exactly as the plan specifies: NestJS bootstrap that imports AppModule and starts the app.
```

## reply

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```
