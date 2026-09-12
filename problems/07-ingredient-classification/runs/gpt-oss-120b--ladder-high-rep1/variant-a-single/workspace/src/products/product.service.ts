import { Injectable } from '@nestjs/common';
import { ProductRepository } from './product.repository';
import { Product } from '@prisma/client';

@Injectable()
export class ProductService {
  constructor(private readonly productRepo: ProductRepository) {}

  async create(name: string, ingredientStrings: string[]): Promise<Product> {
    return this.productRepo.createProduct(name, ingredientStrings);
  }

  async findById(id: number) {
    return this.productRepo.findById(id);
  }
}
