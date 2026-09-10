import { Module } from '@nestjs/common';
import { ProjectionService } from './projection.service.js';
import { ProjectionRepository } from './projection.repository.js';

@Module({
  providers: [ProjectionService, ProjectionRepository],
  exports: [ProjectionService],
})
export class ProjectionModule {}
