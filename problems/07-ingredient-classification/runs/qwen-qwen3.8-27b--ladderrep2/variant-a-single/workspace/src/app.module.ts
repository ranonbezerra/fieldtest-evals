import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/api-exception.filter.js';
import { ClassificationModule } from './classification/classification.module.js';
import { IngredientModule } from './ingredient/ingredient.module.js';
import { MethodologyModule } from './methodology/methodology.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProductModule } from './product/product.module.js';
import { ProfileModule } from './profile/profile.module.js';

@Module({
  imports: [PrismaModule, IngredientModule, ProductModule, ProfileModule, MethodologyModule, ClassificationModule],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
