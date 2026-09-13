import { Module } from '@nestjs/common';
import { TripsController } from './trips.controller.js';
import { InvitesController } from './invites.controller.js';
import { TripsService } from './trips.service.js';
import { TripsRepository } from './trips.repository.js';

@Module({
  controllers: [TripsController, InvitesController],
  providers: [TripsService, TripsRepository],
  exports: [TripsService],
})
export class TripsModule {}
