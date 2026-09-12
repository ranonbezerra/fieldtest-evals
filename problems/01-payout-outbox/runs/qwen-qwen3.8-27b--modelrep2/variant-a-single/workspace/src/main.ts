import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { PayoutExceptionFilter } from './payout/payout.exception-filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new PayoutExceptionFilter());
  app.setGlobalPrefix('api');
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  await app.listen(port);
}

void bootstrap();
