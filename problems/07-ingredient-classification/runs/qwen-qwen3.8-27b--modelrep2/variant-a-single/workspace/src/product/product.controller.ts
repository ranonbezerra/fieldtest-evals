import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InvalidInputException } from '../common/exceptions.js';
import { assertNonEmptyString, assertObject, assertUuid } from '../common/validate.js';
import { ProductService } from './product.service.js';

@Controller('products')
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Get()
  list() {
    return this.products.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.products.get(assertUuid(id, 'id'));
  }

  @Post()
  create(@Body() body: unknown) {
    const payload = assertObject(body, 'body');
    const name = assertNonEmptyString(payload['name'], 'name');
    let description: string | undefined;
    if (payload['description'] !== undefined) {
      description = assertNonEmptyString(payload['description'], 'description');
    }
    return this.products.create({
      name,
      description,
      ingredients: parseIngredientLabels(payload['ingredients']),
    });
  }
}

function parseIngredientLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new InvalidInputException(
      'Field "ingredients" must be an array of non-empty label strings.',
      { field: 'ingredients' },
    );
  }
  return value.map((entry, index) => assertNonEmptyString(entry, `ingredients[${index}]`));
}
