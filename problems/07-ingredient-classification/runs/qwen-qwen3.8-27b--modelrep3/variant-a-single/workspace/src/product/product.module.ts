import { Module } from '@nestjs/common';
import { ProductRepository } from './product.repository.js';

@Module({
  providers: [ProductRepository],
  exports: [ProductRepository],
})
export class ProductModule {}
