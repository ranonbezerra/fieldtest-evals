import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { readObject, requireString, requireStringArray } from '../common/body.js';
import { ProductService } from './product.service.js';

@Controller('products')
export class ProductController {
  constructor(@Inject(ProductService) private readonly products: ProductService) {}

  @Post()
  create(@Body() body: unknown) {
    const payload = readObject(body);
    const name = requireString(payload, 'name');
    const ingredients = requireStringArray(payload, 'ingredients');
    if (ingredients.some((raw) => raw.trim().length === 0)) {
      throw new ApiError(400, 'validation_error', 'Ingredient entries must be non-empty strings.', { field: 'ingredients' });
    }
    return this.products.create(name, ingredients);
  }

  @Get()
  list() {
    return this.products.list();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.products.findById(id);
  }
}
