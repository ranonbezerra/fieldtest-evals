import { Module } from '@nestjs/common';
import { ProfilesService } from './profiles.service.js';
import { ProfilesRepository } from './profiles.repository.js';
import { ProfilesController } from './profiles.controller.js';

@Module({
  providers: [ProfilesService, ProfilesRepository],
  exports: [ProfilesService, ProfilesRepository],
  controllers: [ProfilesController],
})
export class ProfilesModule {}
