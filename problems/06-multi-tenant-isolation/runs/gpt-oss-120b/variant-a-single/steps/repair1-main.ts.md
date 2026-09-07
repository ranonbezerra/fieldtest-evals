# repair1-main.ts

## reasoning

```
We need to fix imports etc. Likely main should import NestFactory, AppModule. Use async bootstrap. Ensure correct paths. Provide minimal code. Probably need to import 'express' types? main not involve those. Just create Nest app.

Write:

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
 const app = await NestFactory.create(AppModule);
 app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
 await app.listen(3000);
}
bootstrap();

Make sure tsconfig moduleResolution works. That's it.
```

## reply

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(3000);
}
bootstrap();
```
