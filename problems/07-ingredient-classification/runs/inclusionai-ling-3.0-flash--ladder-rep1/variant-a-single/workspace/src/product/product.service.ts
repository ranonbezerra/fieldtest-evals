import { Injectable } from "@nestjs/common";
import { ProductRepository } from "./product.repository.js";
import { AppException } from "../common/app-exception.js";

@Injectable()
export class ProductService {
  constructor(private readonly productRepo: ProductRepository) {}

  async create(name: string, inciList: string[]): Promise<any> {
    return this.productRepo.create(name, inciList);
  }

  async getById(id: string): Promise<any> {
    const product = await this.productRepo.findById(id);
    if (!product) {
      throw new AppException("product_not_found", "Product not found", 404);
    }
    return product;
  }

  async getAll(): Promise<any[]> {
    return this.productRepo.findAll();
  }
}
