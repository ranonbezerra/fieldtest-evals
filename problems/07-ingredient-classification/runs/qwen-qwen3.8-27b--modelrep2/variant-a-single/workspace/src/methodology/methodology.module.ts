import { Module } from '@nestjs/common';
import { IngredientModule } from '../ingredient/ingredient.module.js';
import { MethodologyController } from './methodology.controller.js';
import { MethodologyRepository } from './methodology.repository.js';
import { MethodologyService } from './methodology.service.js';

@Module({
  controllers: [MethodologyController],
  providers: [MethodologyService, MethodologyRepository],
  imports: [IngredientModule],
  exports: [MethodologyService, MethodologyRepository],
})
export class MethodologyModule {}
