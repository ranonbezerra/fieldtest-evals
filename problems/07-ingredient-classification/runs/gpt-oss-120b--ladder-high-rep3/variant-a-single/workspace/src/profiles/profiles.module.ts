import { Module } from '@nestjs/common';
import { ProfilesRepository } from './profiles.repository.js';
import { PrismaService } from '../prisma.service.js';
import { IngredientsModule } from '../ingredients/ingredients.module.js';

@Module({
  imports: [IngredientsModule],
  providers: [ProfilesRepository, PrismaService],
  exports: [ProfilesRepository],
})
export class ProfilesModule {}
