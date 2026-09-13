import { Controller, Post, Get, Body, Param } from "@nestjs/common";
import { ProductService } from "./product.service.js";

@Controller("products")
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  create(@Body("name") name: string, @Body("inciList") inciList: string[]) {
    return this.productService.create(name, inciList);
  }

  @Get(":id")
  getById(@Param("id") id: string) {
    return this.productService.getById(id);
  }

  @Get()
  getAll() {
    return this.productService.getAll();
  }
}
