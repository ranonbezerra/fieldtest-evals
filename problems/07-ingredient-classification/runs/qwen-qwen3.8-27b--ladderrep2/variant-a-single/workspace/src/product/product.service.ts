import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { ProductRepository } from './product.repository.js';

@Injectable()
export class ProductService {
  constructor(@Inject(ProductRepository) private readonly products: ProductRepository) {}

  create(name: string, ingredientNames: string[]) {
    return this.products.create(name.trim(), ingredientNames.map((raw) => raw.trim()));
  }

  list() {
    return this.products.list().then((rows) =>
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt.toISOString(),
        ingredientCount: row._count.ingredients,
      })),
    );
  }

  async findById(id: string) {
    const product = await this.products.findByIdWithIngredients(id);
    if (!product) {
      throw new ApiError(404, 'resource_not_found', 'Product not found.', { productId: id });
    }
    return {
      id: product.id,
      name: product.name,
      createdAt: product.createdAt.toISOString(),
      ingredients: product.ingredients.map((entry) => ({ position: entry.position, raw: entry.raw })),
    };
  }
}
