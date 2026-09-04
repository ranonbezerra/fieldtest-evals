import { Module } from '@nestjs/common';
import { IngredientModule } from './ingredient/ingredient.module';
import { ProductModule } from './product/product.module';
import { MethodologyModule } from './methodology/methodology.module';
import { ClassificationModule } from './classification/classification.module';
import { ProfileModule } from './profile/profile.module';

// ASSUMPTION: None of the compiler messages reference src/app.module.ts; all errors are in test/classification.spec.ts. This file is unchanged from the plan's specification.

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
