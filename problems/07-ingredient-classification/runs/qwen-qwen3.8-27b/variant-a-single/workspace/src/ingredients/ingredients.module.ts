import { Module } from '@nestjs/common';
import { IngredientRepository } from './ingredient.repository.js';
import { IngredientService } from './ingredient.service.js';

@Module({
  providers: [IngredientRepository, IngredientService],
  exports: [IngredientService],
})
export class IngredientsModule {}
