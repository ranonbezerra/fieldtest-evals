import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

function readPort(): number {
  const raw = process.env.PORT;
  const port = raw === undefined ? 3000 : Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid PORT "${raw ?? ''}"; expected an integer between 0 and 65535`);
  }
  return port;
}

async function bootstrap(): Promise<void> {
  // Configuration comes from environment variables only.
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set to a PostgreSQL connection string');
  }
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(readPort());
}

bootstrap().catch((err: unknown) => {
  console.error('Failed to start the server', err);
  process.exit(1);
});
