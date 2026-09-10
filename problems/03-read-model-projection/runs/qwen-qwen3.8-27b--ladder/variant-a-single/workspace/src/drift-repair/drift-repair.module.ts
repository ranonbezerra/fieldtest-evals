import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectionModule } from '../projection/projection.module';
import { DriftRepairRepository } from './drift-repair.repository';
import { DriftRepairService } from './drift-repair.service';

@Module({
  imports: [PrismaModule, ProjectionModule],
  providers: [DriftRepairService, DriftRepairRepository],
  exports: [DriftRepairService],
})
export class DriftRepairModule {}
