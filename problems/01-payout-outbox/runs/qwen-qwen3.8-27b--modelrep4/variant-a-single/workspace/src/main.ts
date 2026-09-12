import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { PayoutErrorFilter } from './payout/payout.error-filter';

// Environment configuration (env vars only, no secrets in the repo):
//   DATABASE_URL              Postgres connection string (required)
//   PORT                      HTTP port (default 3000)
//   WORKER_POLL_INTERVAL_MS   payout worker poll interval (default 5000)
//   PAYOUT_MAX_ATTEMPTS       bounded provider retries (default 5)
//   PAYOUT_RETRY_BASE_MS      exponential backoff base (default 1000)
//   PAYOUT_RETRY_CAP_MS       backoff cap (default 60000)
//   PAYOUT_WORKER_BATCH_SIZE  messages processed per pass (default 20)
//   PAYOUT_STALE_CLAIM_MS     stale claim recovery threshold (default 120000)
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new PayoutErrorFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
