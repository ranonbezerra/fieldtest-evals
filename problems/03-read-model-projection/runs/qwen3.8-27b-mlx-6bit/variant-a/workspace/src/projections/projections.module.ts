import { Module } from '@nestjs/common';
import { ProjectionsService } from './projections.service';
import { ProjectionsRepository } from './projections.repository';

@Module({
  providers: [ProjectionsService, ProjectionsRepository],
  exports: [ProjectionsService],
})
export class ProjectionsModule {}
