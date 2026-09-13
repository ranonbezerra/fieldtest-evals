import { Injectable } from '@nestjs/common';
import { ProductsRepository } from './products.repository.js';

@Injectable()
export class ProductsService {
  constructor(private readonly repository: ProductsRepository) {}

  async create(name: string, ingredientList: string) {
    return this.repository.create(name, ingredientList);
  }

  async getById(id: string) {
    return this.repository.getById(id);
  }

  async getAll() {
    return this.repository.getAll();
  }
}
