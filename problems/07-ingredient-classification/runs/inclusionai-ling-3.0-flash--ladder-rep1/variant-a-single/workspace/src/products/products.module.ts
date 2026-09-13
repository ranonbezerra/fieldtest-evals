import { Module } from '@nestjs/common';
import { ProductsService } from './products.service.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsController } from './products.controller.js';

@Module({
  providers: [ProductsService, ProductsRepository],
  exports: [ProductsService, ProductsRepository],
  controllers: [ProductsController],
})
export class ProductsModule {}
