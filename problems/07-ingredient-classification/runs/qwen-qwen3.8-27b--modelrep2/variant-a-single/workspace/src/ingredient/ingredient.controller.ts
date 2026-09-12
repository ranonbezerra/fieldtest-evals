import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { assertNonEmptyString, assertObject, assertUuid } from '../common/validate.js';
import { IngredientService } from './ingredient.service.js';

@Controller('ingredients')
export class IngredientController {
  constructor(private readonly ingredients: IngredientService) {}

  @Get()
  list() {
    return this.ingredients.list();
  }

  @Post()
  create(@Body() body: unknown) {
    const payload = assertObject(body, 'body');
    const name = assertNonEmptyString(payload['name'], 'name');
    return this.ingredients.createIngredient({ name });
  }

  @Post(':ingredientId/synonyms')
  createSynonym(@Param('ingredientId') ingredientId: string, @Body() body: unknown) {
    const payload = assertObject(body, 'body');
    const alias = assertNonEmptyString(payload['alias'], 'alias');
    return this.ingredients.createSynonym({
      ingredientId: assertUuid(ingredientId, 'ingredientId'),
      alias,
    });
  }
}
