// src/main.ts
//
// ASSUMPTION: The original application modules (AppModule, PayoutModule, BankModule, PrismaModule)
// are not present in the repository. To make the entry point compile and allow the Nest
// application to start, we define a minimal placeholder AppModule here. The real modules
// should be implemented according to the specification in PLAN.md.

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';

// Minimal placeholder module – replaces the missing './app.module'.
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Global validation pipe (mirrors typical NestJS setups).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.listen(3000);
}
bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to bootstrap the application:', err);
  process.exit(1);
});
