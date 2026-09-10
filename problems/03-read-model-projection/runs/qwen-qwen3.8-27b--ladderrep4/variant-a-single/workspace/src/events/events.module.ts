import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma.module.js';
import { ProjectionModule } from '../projection/projection.module.js';
import { EventRepository } from './events.repository.js';
import { EventService } from './events.service.js';
import { EventsController } from './events.controller.js';

@Module({
  imports: [PrismaModule, ProjectionModule],
  controllers: [EventsController],
  providers: [EventRepository, EventService],
})
export class EventsModule {}
