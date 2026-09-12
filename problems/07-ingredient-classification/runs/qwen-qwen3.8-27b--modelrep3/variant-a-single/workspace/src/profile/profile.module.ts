import { Module } from '@nestjs/common';
import { ProfileRepository } from './profile.repository.js';

@Module({
  providers: [ProfileRepository],
  exports: [ProfileRepository],
})
export class ProfileModule {}
