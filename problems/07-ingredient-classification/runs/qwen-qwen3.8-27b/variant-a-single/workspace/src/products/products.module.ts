import { Module } from '@nestjs/common';
import { IngredientsModule } from '../ingredients/ingredients.module.js';
import { ProductRepository } from './product.repository.js';
import { ProductService } from './product.service.js';

@Module({
  imports: [IngredientsModule],
  providers: [ProductRepository, ProductService],
  exports: [ProductService],
})
export class ProductsModule {}
