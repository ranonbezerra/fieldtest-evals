# repair1-main.ts

## reasoning

```
We need to rewrite src/main.ts to import correct modules. Likely need to bootstrap Nest app with AppModule. Provide minimal code. Use imports from './app.module'. Ensure using NestFactory. Also need to set up global pipes maybe. We'll just create basic.

Add // ASSUMPTION lines for missing modules like app.module exists.

Return file.
```

## reply

```ts
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

// ASSUMPTION: The project has an AppModule at ./app.module that correctly
// imports the AuthModule and any other required modules.
// No other custom bootstrap logic is required for the current task.

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable class‑validator pipes globally (the DTOs use class-validator).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));

  // The API does not require a specific port in the source code; use the
  // conventional default or the PORT environment variable if set.
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}
bootstrap()
  .then(() => console.log(`🚀 Application started on port ${process.env.PORT ?? 3000}`))
  .catch((err) => {
    console.error('❌ Failed to start application', err);
    process.exit(1);
  });
```
