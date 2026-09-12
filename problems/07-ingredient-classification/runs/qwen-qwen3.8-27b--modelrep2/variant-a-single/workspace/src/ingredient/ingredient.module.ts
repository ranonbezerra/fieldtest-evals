import { Module } from '@nestjs/common';
import { IngredientController } from './ingredient.controller.js';
import { IngredientRepository } from './ingredient.repository.js';
import { IngredientService } from './ingredient.service.js';

@Module({
  controllers: [IngredientController],
  providers: [IngredientService, IngredientRepository],
  exports: [IngredientService, IngredientRepository],
})
export class IngredientModule {}
