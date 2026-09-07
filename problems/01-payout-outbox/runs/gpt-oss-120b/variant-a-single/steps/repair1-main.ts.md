# repair1-main.ts

## reasoning

```
We need to write main.ts that imports NestFactory, AppModule, etc. Ensure imports exist. Likely missing imports of modules. Provide basic bootstrap. Use async function. No other errors. We'll assume other files exist. Provide main.ts.
```

## reply

```ts
// src/main.ts
// ---------------------------------------------------------------
// Bootstrap file for the NestJS application.
// ---------------------------------------------------------------

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

// ASSUMPTION: All modules (AppModule, controllers, services, repositories, etc.)
// are correctly defined elsewhere in the project. This file only needs to
// create the Nest application and start the HTTP server.

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable global validation pipe (class-validator integration)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🚀 Application is running on: http://localhost:${port}`);
}

void bootstrap();
```
