import { Injectable } from '@nestjs/common';
import { IngredientRepository } from './ingredient.repository.js';

@Injectable()
export class IngredientService {
  constructor(private readonly ingredientRepository: IngredientRepository) {}

  list() {
    return this.ingredientRepository.list();
  }
}
