import { Module } from "@nestjs/common";
import { ProductService } from "./product.service.js";
import { ProductRepository } from "./product.repository.js";
import { ProductController } from "./product.controller.js";

@Module({
  controllers: [ProductController],
  providers: [ProductService, ProductRepository],
  exports: [ProductService, ProductRepository],
})
export class ProductModule {}
