import { Module } from '@nestjs/common';
import { InvitesController, TripsController } from './trips.controller.js';
import { TripsRepository } from './trips.repository.js';
import { TripsService } from './trips.service.js';

/**
 * A provider another module needs is exported here and imported there.
 * An unresolved dependency typechecks perfectly and fails at boot.
 */
@Module({
  controllers: [TripsController, InvitesController],
  providers: [TripsService, TripsRepository],
  exports: [TripsService],
})
export class TripsModule {}
