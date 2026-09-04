import { Controller, Get } from '@nestjs/common';
import { IngredientService } from './ingredient.service.js';

@Controller('ingredients')
export class IngredientController {
  constructor(private readonly ingredientService: IngredientService) {}

  @Get()
  list() {
    return this.ingredientService.list();
  }
}
