import { Injectable } from '@nestjs/common';
import { IngredientRepository, IngredientRecord } from './ingredient.repository.js';
import { normalizeIngredientName } from './normalize.js';

@Injectable()
export class IngredientService {
  constructor(private readonly repository: IngredientRepository) {}

  /** Normalizes (case, accents, whitespace) then resolves to a canonical ingredient. */
  async resolve(rawName: string): Promise<(IngredientRecord & { matchedBy: 'name' | 'synonym' }) | null> {
    return this.repository.resolve(normalizeIngredientName(rawName));
  }

  async create(name: string, synonyms: string[] = []): Promise<IngredientRecord> {
    return this.repository.create({ name: normalizeIngredientName(name), synonyms });
  }
}
