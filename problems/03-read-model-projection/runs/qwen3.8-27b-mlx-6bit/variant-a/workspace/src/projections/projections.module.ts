import { Module } from '@nestjs/common';
import { ProjectionsRepository } from './projections.repository';
import { ProjectionsService } from './projections.service';

@Module({
  providers: [ProjectionsService, ProjectionsRepository],
  exports: [ProjectionsService],
})
export class ProjectionsModule {}
