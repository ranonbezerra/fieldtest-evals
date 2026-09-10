import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { CompanyTotalsModule } from '../company-totals/company-totals.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { ProjectionRepository } from './projection.repository.js';
import { ProjectionService } from './projection.service.js';

@Module({
  providers: [ProjectionService, ProjectionRepository],
  imports: [CommonModule, OperationsModule, CompanyTotalsModule],
  exports: [ProjectionService],
})
export class ProjectionModule {}
