// ASSUMPTION: None of the compiler messages reference src/ingredient/ingredient.module.ts; the errors are in test/classification.spec.ts about a type expecting `ingredients` where `productIngredients` is provided. The shape of that expected type is not visible from this file, so no change is made here beyond providing the module as specified by the plan.
import { Module } from '@nestjs/common';
import { IngredientController } from './ingredient.controller';
import { IngredientService } from './ingredient.service';
import { IngredientRepository } from './ingredient.repository';

@Module({
  controllers: [IngredientController],
  providers: [IngredientService, IngredientRepository],
  exports: [IngredientService, IngredientRepository],
})
export class IngredientModule {}
