import { Module } from '@nestjs/common';
import { IngredientModule } from '../ingredient/ingredient.module.js';
import { MethodologyModule } from '../methodology/methodology.module.js';
import { ProductModule } from '../product/product.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { ClassificationController } from './classification.controller.js';
import { ClassificationRepository } from './classification.repository.js';
import { ClassificationService } from './classification.service.js';

@Module({
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
  imports: [IngredientModule, MethodologyModule, ProductModule, ProfileModule],
  exports: [ClassificationService, ClassificationRepository],
})
export class ClassificationModule {}
