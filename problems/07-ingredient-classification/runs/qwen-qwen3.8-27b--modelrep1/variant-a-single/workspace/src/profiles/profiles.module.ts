import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ProfilesController } from './profiles.controller.js';
import { ProfilesRepository } from './profiles.repository.js';
import { ProfilesService } from './profiles.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [ProfilesController],
  providers: [ProfilesService, ProfilesRepository],
})
export class ProfilesModule {}
