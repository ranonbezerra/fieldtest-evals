import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { IngredientModule } from '../ingredient/ingredient.module.js';
import { MethodologyModule } from '../methodology/methodology.module.js';
import { ProductModule } from '../product/product.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { ClassificationController } from './classification.controller.js';
import { ClassificationRepository } from './classification.repository.js';
import { ClassificationService } from './classification.service.js';

// MethodologyModule is imported through forwardRef because MethodologyService
// (in that module) calls ClassificationService.recomputeForVersion on publish,
// while this module reads methodology rules — a genuine cycle.
@Module({
  imports: [PrismaModule, IngredientModule, forwardRef(() => MethodologyModule), ProductModule, ProfileModule],
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
  exports: [ClassificationService],
})
export class ClassificationModule {}
