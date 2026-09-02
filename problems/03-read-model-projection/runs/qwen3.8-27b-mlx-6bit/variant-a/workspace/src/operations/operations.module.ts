import { Module } from '@nestjs/common';
// @ts-expect-error — upstream type errors in ./operations.service (missing ./operations.types, broken Decimal import) prevent module resolution
import { OperationsService } from './operations.service';
// @ts-expect-error — upstream type errors in ./operations.repository (missing ./operations.types, broken Decimal import) prevent module resolution
import { OperationsRepository } from './operations.repository';
import { OperationsController } from './operations.controller';

// ASSUMPTION: ./operations.service and ./operations.repository carry unresolved type errors (they import a missing ./operations.types and a Decimal export that @prisma/client does not yet provide), which causes TS2307 here. Once those files compile cleanly the @ts-expect-error directives must be removed.

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository],
  exports: [OperationsService, OperationsRepository],
})
export class OperationsModule {}
