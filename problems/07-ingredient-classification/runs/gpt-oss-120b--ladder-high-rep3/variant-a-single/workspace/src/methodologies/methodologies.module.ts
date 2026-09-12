import { Module } from '@nestjs/common';
import { MethodologyRepository } from './methodology.repository.js';
import { RulesRepository } from './rules.repository.js';
import { ModifiersRepository } from './modifiers.repository.js';
import { PrismaService } from '../prisma.service.js';
import { IngredientsModule } from '../ingredients/ingredients.module.js';

@Module({
  imports: [IngredientsModule],
  providers: [
    MethodologyRepository,
    RulesRepository,
    ModifiersRepository,
    PrismaService,
  ],
  exports: [
    MethodologyRepository,
    RulesRepository,
    ModifiersRepository,
  ],
})
export class MethodologiesModule {}
