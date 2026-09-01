// ASSUMPTION: relative ESM imports in this workspace need explicit ".js" extensions (NodeNext resolution), so the two specifiers below use them to reach the planned projections.module.ts and writes.service.ts files.
import { Module } from '@nestjs/common';
import { ProjectionsModule } from '../projections/projections.module.js';
import { WritesService } from './writes.service.js';

@Module({
  imports: [ProjectionsModule],
  providers: [WritesService],
})
export class WritesModule {}
