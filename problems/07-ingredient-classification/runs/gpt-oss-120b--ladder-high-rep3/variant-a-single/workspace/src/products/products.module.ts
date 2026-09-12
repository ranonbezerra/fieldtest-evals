import { Module } from '@nestjs/common';
import { ProductsRepository } from './products.repository.js';
import { PrismaService } from '../prisma.service.js';
import { IngredientsModule } from '../ingredients/ingredients.module.js';

@Module({
  imports: [IngredientsModule],
  providers: [ProductsRepository, PrismaService],
  exports: [ProductsRepository],
})
export class ProductsModule {}
