import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { IngredientRepository } from './ingredient.repository.js';

@Module({
  imports: [PrismaModule],
  providers: [IngredientRepository],
  exports: [IngredientRepository],
})
export class IngredientModule {}
