import { Module } from '@nestjs/common';
import { IngredientsRepository } from './ingredients.repository.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  providers: [IngredientsRepository, PrismaService],
  exports: [IngredientsRepository],
})
export class IngredientsModule {}
