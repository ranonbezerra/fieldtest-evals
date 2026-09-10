import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectionRepository } from './projection.repository';
import { ProjectionService } from './projection.service';

@Module({
  imports: [PrismaModule],
  providers: [ProjectionService, ProjectionRepository],
  exports: [ProjectionService],
})
export class ProjectionModule {}
