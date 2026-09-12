import { Inject, Injectable } from '@nestjs/common';
import type { ProductRecord } from '../classification/classification.types.js';
import { ApiException } from '../common/api-exception.js';
import { ProductsRepository, type IProductsRepository } from './products.repository.js';

export interface CreateProductInput {
  name: string;
  ingredients: string[];
}

@Injectable()
export class ProductsService {
  constructor(@Inject(ProductsRepository) private readonly repo: IProductsRepository) {}

  create(input: CreateProductInput): Promise<ProductRecord> {
    return this.repo.create(input.name, input.ingredients);
  }

  async find(id: string): Promise<ProductRecord> {
    const product = await this.repo.find(id);
    if (!product) {
      throw new ApiException('resource_not_found', `Product "${id}" not found.`, 404, { productId: id });
    }
    return product;
  }

  list(): Promise<ProductRecord[]> {
    return this.repo.list();
  }
}
