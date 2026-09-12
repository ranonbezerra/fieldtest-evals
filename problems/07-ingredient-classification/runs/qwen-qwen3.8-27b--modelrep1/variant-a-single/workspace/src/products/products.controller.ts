import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ArrayMinSize, IsArray, IsNotEmpty, IsString } from 'class-validator';
import type { ProductRecord } from '../classification/classification.types.js';
import { ProductsService } from './products.service.js';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  ingredients!: string[];
}

@Controller('products')
export class ProductsController {
  constructor(@Inject(ProductsService) private readonly service: ProductsService) {}

  @Post()
  create(@Body() dto: CreateProductDto): Promise<ProductRecord> {
    return this.service.create(dto);
  }

  @Get()
  list(): Promise<ProductRecord[]> {
    return this.service.list();
  }

  @Get(':id')
  find(@Param('id', ParseUUIDPipe) id: string): Promise<ProductRecord> {
    return this.service.find(id);
  }
}
