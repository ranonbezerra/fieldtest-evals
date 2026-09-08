# repair2-main.ts

## reasoning

```
We need to write src/main.ts that imports AppModule correctly, sets up NestFactory. Likely missing imports. Provide basic bootstrap.

Assume other files exist. Just create typical main.ts.

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.listen(3000);
}
bootstrap();
```

Add shebang? Not needed.

Return this.
```

## reply

```ts
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Enable class‑validator pipes globally (used by DTOs)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.listen(3000);
}

bootstrap();
```
