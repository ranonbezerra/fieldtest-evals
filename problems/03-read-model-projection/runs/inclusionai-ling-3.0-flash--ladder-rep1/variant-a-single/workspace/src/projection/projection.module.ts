import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectionService } from './projection.service';

@Module({
  imports: [PrismaModule],
  providers: [ProjectionService],
  exports: [ProjectionService],
})
export class ProjectionModule {}
