import { Injectable } from '@nestjs/common';
import { ResourceNotFoundException } from '../common/exceptions.js';
import { ProductRepository } from './product.repository.js';

@Injectable()
export class ProductService {
  constructor(private readonly products: ProductRepository) {}

  create(input: { name: string; description?: string; ingredients: string[] }) {
    return this.products.create(input);
  }

  async get(id: string) {
    const product = await this.products.findById(id);
    if (!product) {
      throw new ResourceNotFoundException('product', { id });
    }
    return product;
  }

  list() {
    return this.products.list();
  }
}
