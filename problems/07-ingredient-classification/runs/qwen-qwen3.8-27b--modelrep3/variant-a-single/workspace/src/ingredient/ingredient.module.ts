import { Module } from '@nestjs/common';
import { IngredientRepository } from './ingredient.repository.js';

@Module({
  providers: [IngredientRepository],
  exports: [IngredientRepository],
})
export class IngredientModule {}
