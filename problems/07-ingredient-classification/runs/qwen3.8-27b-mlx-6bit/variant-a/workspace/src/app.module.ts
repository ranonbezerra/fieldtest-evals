import { Module } from '@nestjs/common';
import { IngredientModule } from './ingredient/ingredient.module.js';
import { ProductModule } from './product/product.module.js';
import { MethodologyModule } from './methodology/methodology.module.js';
import { ClassificationModule } from './classification/classification.module.js';
import { ProfileModule } from './profile/profile.module.js';

@Module({
  imports: [
    IngredientModule,
    ProductModule,
    MethodologyModule,
    ClassificationModule,
    ProfileModule,
  ],
})
export class AppModule {}
