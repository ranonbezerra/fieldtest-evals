import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { json } from 'express';
import { TenantResolutionMiddleware } from './tenant/tenant.middleware.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(json());

  // Apply tenant resolution middleware globally using Nest's middleware consumer style
  const tenantMiddleware = app.get(TenantResolutionMiddleware);
  app.use(tenantMiddleware.use.bind(tenantMiddleware));

  await app.listen(3000);
}
bootstrap();
