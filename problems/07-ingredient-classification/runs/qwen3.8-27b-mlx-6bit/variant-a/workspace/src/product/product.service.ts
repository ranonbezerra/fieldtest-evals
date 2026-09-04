import { Injectable } from '@nestjs/common';
import { ProductRepository } from './product.repository.js';

// ASSUMPTION: ProductRepository.findById returns the Prisma Product model (with ingredients relation) or null;
// ProductRepository.create returns the Prisma Product model. Exact type shapes are inferred from the repository.

@Injectable()
export class ProductService {
  constructor(private readonly productRepository: ProductRepository) {}

  async create(name: string, ingredients: string[]) {
    return this.productRepository.create(name, ingredients);
  }

  async getWithIngredients(id: number) {
    return this.productRepository.findById(id);
  }
}
