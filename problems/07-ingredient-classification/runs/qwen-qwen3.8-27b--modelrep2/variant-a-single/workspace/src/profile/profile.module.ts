import { Module } from '@nestjs/common';
import { IngredientModule } from '../ingredient/ingredient.module.js';
import { ProfileController } from './profile.controller.js';
import { ProfileRepository } from './profile.repository.js';
import { ProfileService } from './profile.service.js';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService, ProfileRepository],
  imports: [IngredientModule],
  exports: [ProfileService, ProfileRepository],
})
export class ProfileModule {}
