import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ClassifyModule } from './classify/classify.module.js';
import { MethodologyModule } from './methodology/methodology.module.js';
import { ProductsModule } from './products/products.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';

@Module({
  imports: [
    PrismaModule,
    ClassifyModule,
    MethodologyModule,
    ProductsModule,
    ProfilesModule,
  ],
})
export class AppModule {}
