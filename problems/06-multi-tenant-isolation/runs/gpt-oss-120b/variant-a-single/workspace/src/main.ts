// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

// The application entry point. It creates the NestJS app using the root
// AppModule, applies global validation, and starts listening on the port
// defined by the `PORT` environment variable (default 3000).
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

  // Enable class‑validator based DTO validation globally.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🚀 Application is running on: http://localhost:${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Error during application bootstrap', err);
  process.exit(1);
});
