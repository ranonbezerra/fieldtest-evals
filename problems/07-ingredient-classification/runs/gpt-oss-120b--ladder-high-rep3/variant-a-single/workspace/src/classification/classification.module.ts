import { Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller.js';
import { ClassificationService } from './classification.service.js';
import { ClassificationRepository } from './classification.repository.js';
import { ProductsModule } from '../products/products.module.js';
import { IngredientsModule } from '../ingredients/ingredients.module.js';
import { MethodologiesModule } from '../methodologies/methodologies.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { PrismaService } from '../prisma.service.js';

@Module({
  imports: [
    ProductsModule,
    IngredientsModule,
    MethodologiesModule,
    ProfilesModule,
  ],
  controllers: [ClassificationController],
  providers: [
    ClassificationService,
    ClassificationRepository,
    PrismaService,
  ],
  exports: [ClassificationService],
})
export class ClassificationModule {}
