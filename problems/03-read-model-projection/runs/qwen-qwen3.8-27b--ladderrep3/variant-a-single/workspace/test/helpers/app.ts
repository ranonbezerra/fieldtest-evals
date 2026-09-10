import 'reflect-metadata';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module.js';
import { ApiExceptionFilter } from '../../src/common/api-exception-filter.js';

export interface TestApp {
  app: INestApplication;
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startTestApp(): Promise<TestApp> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0);
  const server = app.getHttpServer() as Server;
  const address = server.address();
  if (!address || typeof address === 'string') {
    await app.close();
    throw new Error('test server did not bind to a TCP port');
  }
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => app.close(),
  };
}
