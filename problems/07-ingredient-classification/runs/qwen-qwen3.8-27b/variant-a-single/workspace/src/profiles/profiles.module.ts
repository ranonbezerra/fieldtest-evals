import { Module } from '@nestjs/common';
import { ProfileRepository } from './profile.repository.js';
import { ProfileService } from './profile.service.js';

@Module({
  providers: [ProfileRepository, ProfileService],
  exports: [ProfileService],
})
export class ProfilesModule {}
