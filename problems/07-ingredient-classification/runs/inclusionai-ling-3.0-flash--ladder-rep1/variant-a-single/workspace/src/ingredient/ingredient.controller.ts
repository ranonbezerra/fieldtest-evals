import { Controller, Post, Get, Body } from "@nestjs/common";
import { IngredientService } from "./ingredient.service.js";

@Controller("ingredients")
export class IngredientController {
  constructor(private readonly ingredientService: IngredientService) {}

  @Post()
  create(@Body("name") name: string) {
    return this.ingredientService.create(name);
  }

  @Get()
  getAll() {
    return this.ingredientService.getAll();
  }
}
