import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PlansRepository } from './plans.repository.js';
import { PlansService } from './plans.service.js';
import { PlansController } from './plans.controller.js';

@Module({
  imports: [DatabaseModule],
  providers: [PlansRepository, PlansService],
  controllers: [PlansController],
  exports: [PlansService],
})
export class PlansModule {}
