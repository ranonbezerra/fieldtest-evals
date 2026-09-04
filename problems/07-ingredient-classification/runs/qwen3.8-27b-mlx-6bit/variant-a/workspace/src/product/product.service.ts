import { Injectable } from '@nestjs/common';
import { ProductRepository } from './product.repository';

export interface ProductIngredient {
  rawText: string;
  position: number;
}

export interface ProductWithIngredients {
  id: number;
  name: string;
  ingredients: ProductIngredient[];
}

// ASSUMPTION: the repository returns Prisma-shaped objects whose relation is
// named `productIngredients` (matching the Prisma schema field), and the
// service is responsible for mapping it to the public `ingredients` shape.

@Injectable()
export class ProductService {
  constructor(private readonly productRepository: ProductRepository) {}

  async create(name: string, ingredients: string[]): Promise<ProductWithIngredients> {
    const product = await this.productRepository.create(name, ingredients);
    const full = await this.getWithIngredients(product.id);
    if (!full) {
      // should not happen: we just created it
      return { id: product.id, name: product.name, ingredients: [] };
    }
    return full;
  }

  async getWithIngredients(id: number): Promise<ProductWithIngredients | null> {
    const product = await this.productRepository.findById(id);
    if (!product) {
      return null;
    }

    const raw = product as unknown as {
      id: number;
      name: string;
      productIngredients?: ProductIngredient[];
    };

    return {
      id: raw.id,
      name: raw.name,
      ingredients: raw.productIngredients ?? [],
    };
  }
}
