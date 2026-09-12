import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

/**
 * Global request pipeline: input validation plus the single error envelope.
 * Applied identically by src/main.ts and the test bootstrap so behaviour
 * under test matches production.
 */
export function applyGlobalAppConfig(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
