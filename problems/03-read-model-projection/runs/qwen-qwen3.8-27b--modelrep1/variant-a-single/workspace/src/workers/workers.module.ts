import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module.js';
import { ProjectionModule } from '../projection/projection.module.js';
import { WorkersController } from './workers.controller.js';
import { WorkersRepository } from './workers.repository.js';
import { WorkersService } from './workers.service.js';

@Module({
  controllers: [WorkersController],
  providers: [WorkersService, WorkersRepository],
  imports: [CommonModule, ProjectionModule],
  exports: [WorkersRepository],
})
export class WorkersModule {}
