import { Module } from '@nestjs/common';
import { ExportService } from './export.service.js';

// ASSUMPTION: ./export.service.ts must exist (providing ExportService) for this import to resolve; it is not created by this file.
@Module({
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
