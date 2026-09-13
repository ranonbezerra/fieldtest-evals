import { Injectable } from "@nestjs/common";
import { SynonymRepository } from "./synonym.repository.js";
import { IngredientRepository } from "../ingredient/ingredient.repository.js";
import { AppException } from "../common/app-exception.js";

@Injectable()
export class SynonymService {
  constructor(
    private readonly synonymRepo: SynonymRepository,
    private readonly ingredientRepo: IngredientRepository,
  ) {}

  async create(alternateName: string, ingredientName: string): Promise<any> {
    const ingredient = await this.ingredientRepo.findByName(ingredientName);
    if (!ingredient) {
      throw new AppException(
        "ingredient_not_found",
        `Ingredient "${ingredientName}" not found`,
        404,
      );
    }
    return this.synonymRepo.create(alternateName, ingredient.id);
  }

  async getAll(): Promise<any[]> {
    return this.synonymRepo.findAll();
  }
}
