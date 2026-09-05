import { Module } from '@nestjs/common';
import { TripsController, InvitesController } from './trips.controller.js';
import { TripsService } from './trips.service.js';
import { TripsRepository } from './trips.repository.js';

@Module({
  controllers: [TripsController, InvitesController],
  providers: [TripsService, TripsRepository],
})
export class TripsModule {}
