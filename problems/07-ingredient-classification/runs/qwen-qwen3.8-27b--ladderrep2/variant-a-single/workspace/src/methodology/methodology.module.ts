import { Module, forwardRef } from '@nestjs/common';
import { ClassificationModule } from '../classification/classification.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { IngredientModule } from '../ingredient/ingredient.module.js';
import { MethodologyController } from './methodology.controller.js';
import { MethodologyRepository } from './methodology.repository.js';
import { MethodologyService } from './methodology.service.js';

// forwardRef: MethodologyService triggers re-scoring through
// ClassificationService, while ClassificationService reads methodology rules —
// a genuine cycle, declared here and at the injection site.
@Module({
  imports: [PrismaModule, IngredientModule, forwardRef(() => ClassificationModule)],
  controllers: [MethodologyController],
  providers: [MethodologyService, MethodologyRepository],
  exports: [MethodologyService, MethodologyRepository],
})
export class MethodologyModule {}
