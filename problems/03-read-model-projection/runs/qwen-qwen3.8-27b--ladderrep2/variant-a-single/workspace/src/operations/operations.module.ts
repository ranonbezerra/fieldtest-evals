import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { OperationsRepository } from './operations.repository';
import { ProjectionMaintenanceService } from './projection-maintenance.service';
import { ReprojectionService } from './reprojection.service';

@Module({
  controllers: [OperationsController],
  providers: [OperationsService, OperationsRepository, ProjectionMaintenanceService, ReprojectionService],
  exports: [OperationsRepository, ProjectionMaintenanceService, ReprojectionService],
})
export class OperationsModule {}
