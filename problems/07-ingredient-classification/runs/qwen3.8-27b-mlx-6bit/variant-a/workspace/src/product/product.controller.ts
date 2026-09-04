import { Controller, Post, Get, Param, Body, ParseIntPipe } from '@nestjs/common';
import { ProductService } from './product.service.js';
import { ClassificationService } from '../classification/classification.service.js';

@Controller()
export class ProductController {
  constructor(
    private readonly productService: ProductService,
    private readonly classificationService: ClassificationService,
  ) {}

  @Post('products')
  create(@Body() body: { name: string; ingredients: string[] }) {
    return this.productService.create(body.name, body.ingredients);
  }

  @Get('products/:id/results')
  getResults(@Param('id', ParseIntPipe) id: number) {
    // ASSUMPTION: ClassificationService exposes a getResults(productId: number) method returning stored results across all methodology versions, since the plan's service signature only lists classify and rescoreAll but the endpoint requires reading persisted results.
    return this.classificationService.getResults(id);
  }
}
