import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ClassificationModule } from './classification/classification.module.js';
import { IngredientModule } from './ingredient/ingredient.module.js';
import { MethodologyModule } from './methodology/methodology.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProductModule } from './product/product.module.js';
import { ProfileModule } from './profile/profile.module.js';

@Module({
  imports: [
    PrismaModule,
    EventEmitterModule.forRoot(),
    IngredientModule,
    ProductModule,
    ProfileModule,
    MethodologyModule,
    ClassificationModule,
  ],
})
export class AppModule {}
