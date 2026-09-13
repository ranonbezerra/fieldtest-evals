import { Injectable } from "@nestjs/common";
import { IngredientRepository } from "./ingredient.repository.js";
import { AppException } from "../common/app-exception.js";

@Injectable()
export class IngredientService {
  constructor(private readonly ingredientRepo: IngredientRepository) {}

  async create(name: string): Promise<any> {
    return this.ingredientRepo.create(name);
  }

  async getByName(name: string): Promise<any | null> {
    return this.ingredientRepo.findByName(name);
  }

  async getById(id: string): Promise<any | null> {
    return this.ingredientRepo.findById(id);
  }

  async getAll(): Promise<any[]> {
    return this.ingredientRepo.findAll();
  }
}
