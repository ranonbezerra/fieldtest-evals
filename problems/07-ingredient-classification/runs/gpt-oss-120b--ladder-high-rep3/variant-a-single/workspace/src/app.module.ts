import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { IngredientsModule } from './ingredients/ingredients.module.js';
import { ProductsModule } from './products/products.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';
import { MethodologiesModule } from './methodologies/methodologies.module.js';
import { ClassificationModule } from './classification/classification.module.js';

@Module({
  imports: [
    IngredientsModule,
    ProductsModule,
    ProfilesModule,
    MethodologiesModule,
    ClassificationModule,
  ],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
