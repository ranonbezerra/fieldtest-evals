import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new ApiExceptionFilter());
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
