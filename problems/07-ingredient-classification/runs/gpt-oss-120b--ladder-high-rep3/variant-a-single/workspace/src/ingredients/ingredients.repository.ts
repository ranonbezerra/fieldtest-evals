import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { Ingredient, IngredientSynonym } from '@prisma/client';
import { normalizeString } from '../utils/normalizer.js';

@Injectable()
export class IngredientsRepository {
  // ... (rest of the file remains unchanged)
}
