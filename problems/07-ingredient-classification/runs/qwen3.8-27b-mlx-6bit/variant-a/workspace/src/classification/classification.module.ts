import { forwardRef, Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller.js';
import { ClassificationService } from './classification.service.js';
import { ClassificationRepository } from './classification.repository.js';
import { ProductModule } from '../product/product.module.js';
import { IngredientModule } from '../ingredient/ingredient.module.js';
import { ProfileModule } from '../profile/profile.module.js';
import { MethodologyModule } from '../methodology/methodology.module.js';

@Module({
  imports: [
    ProductModule,
    IngredientModule,
    ProfileModule,
    forwardRef(() => MethodologyModule),
  ],
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
  exports: [ClassificationService, ClassificationRepository],
})
export class ClassificationModule {}
