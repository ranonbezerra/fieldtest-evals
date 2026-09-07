import { Module } from '@nestjs/common';
import { PrismaModule } from '../common/prisma.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { MethodologyController } from './methodology.controller.js';
import { MethodologyService } from './methodology.service.js';
import { MethodologyRepository } from './methodology.repository.js';

@Module({
  imports: [PrismaModule, ProfilesModule],
  controllers: [MethodologyController],
  providers: [MethodologyService, MethodologyRepository],
  exports: [MethodologyService],
})
export class MethodologiesModule {}
