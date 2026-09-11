import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ErrorEnvelopeFilter } from './common/error-envelope.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Every error leaves through one envelope: { error: { code, message, details } }.
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
