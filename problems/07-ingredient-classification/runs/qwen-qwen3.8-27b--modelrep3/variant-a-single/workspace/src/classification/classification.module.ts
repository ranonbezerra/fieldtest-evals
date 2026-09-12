import { Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller.js';
import { ClassificationService } from './classification.service.js';
import { ClassificationRepository } from './classification.repository.js';
import { IngredientModule } from '../ingredient/ingredient.module.js';
import { ProductModule } from '../product/product.module.js';
import { MethodologyModule } from '../methodology/methodology.module.js';
import { ProfileModule } from '../profile/profile.module.js';

@Module({
  imports: [IngredientModule, ProductModule, MethodologyModule, ProfileModule],
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
  exports: [ClassificationService],
})
export class ClassificationModule {}
