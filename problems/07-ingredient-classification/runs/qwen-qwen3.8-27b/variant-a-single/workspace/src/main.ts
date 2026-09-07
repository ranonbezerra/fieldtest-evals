import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { PrismaService } from './common/prisma.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());

  const prisma = app.get(PrismaService);
  await prisma.$connectWithRetry();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`Ingredient scanner listening on ${port}`, 'Bootstrap');
}

void bootstrap();
