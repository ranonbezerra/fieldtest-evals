import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { OperationsModule } from '../operations/operations.module.js';
import { EventsController } from './events.controller.js';
import { EventRepository } from './events.repository.js';
import { EventService } from './events.service.js';

@Module({
  imports: [DatabaseModule, OperationsModule],
  controllers: [EventsController],
  providers: [EventService, EventRepository],
  exports: [EventRepository],
})
export class EventsModule {}
