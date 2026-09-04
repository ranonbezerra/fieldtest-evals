import { Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { ClassificationRepository } from './classification.repository';
import { ProductModule } from '../product/product.module';
import { IngredientModule } from '../ingredient/ingredient.module';
import { MethodologyModule } from '../methodology/methodology.module';
import { ProfileModule } from '../profile/profile.module';

export interface ProductWithIngredients {
  id: number;
  name: string;
  productIngredients: { rawText: string; position: number }[];
}

@Module({
  imports: [ProductModule, IngredientModule, MethodologyModule, ProfileModule],
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
  exports: [ClassificationService],
})
export class ClassificationModule {}
