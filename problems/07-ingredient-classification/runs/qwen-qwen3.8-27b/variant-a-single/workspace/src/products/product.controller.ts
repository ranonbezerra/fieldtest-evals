import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsArray, IsNotEmpty, IsString, MaxLength, ArrayNotEmpty, ArrayUnique, IsUUID } from 'class-validator';
import { ProductService } from './product.service.js';

class ProductIngredientDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  rawName!: string;
}

class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsArray()
  ingredients!: ProductIngredientDto[] | string[];
}

class SetIngredientsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  ingredients!: ProductIngredientDto[] | string[];
}

@Controller('products')
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Post()
  create(@Body() body: CreateProductDto) {
    const ingredients = (body.ingredients ?? []).map((entry) =>
      typeof entry === 'string' ? entry : entry.rawName,
    );
    return this.products.create(body.name, ingredients);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.products.findById(id);
  }

  @Post(':id/ingredients')
  setIngredients(@Param('id') id: string, @Body() body: SetIngredientsDto) {
    const ingredients = (body.ingredients ?? []).map((entry) =>
      typeof entry === 'string' ? entry : entry.rawName,
    );
    return this.products.setIngredientEntries(id, ingredients);
  }
}
