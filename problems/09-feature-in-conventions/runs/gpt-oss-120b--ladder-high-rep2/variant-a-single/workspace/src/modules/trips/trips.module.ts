import { Module } from '@nestjs/common';
import { TripsController } from './trips.controller.js';
import { InvitesController } from './invites.controller.js';
import { TripsService } from './trips.service.js';
import { TripsRepository } from './trips.repository.js';
import { UsersRepository } from '../users/users.repository.js';

@Module({
  controllers: [TripsController, InvitesController],
  providers: [TripsService, TripsRepository, UsersRepository],
})
export class TripsModule {}
