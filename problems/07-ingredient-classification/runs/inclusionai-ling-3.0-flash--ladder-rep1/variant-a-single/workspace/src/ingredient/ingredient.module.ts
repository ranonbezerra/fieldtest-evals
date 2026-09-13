import { Module } from "@nestjs/common";
import { IngredientService } from "./ingredient.service.js";
import { IngredientRepository } from "./ingredient.repository.js";
import { IngredientController } from "./ingredient.controller.js";

@Module({
  controllers: [IngredientController],
  providers: [IngredientService, IngredientRepository],
  exports: [IngredientService, IngredientRepository],
})
export class IngredientModule {}
