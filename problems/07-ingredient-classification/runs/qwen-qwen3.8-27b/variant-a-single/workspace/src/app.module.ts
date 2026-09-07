import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module.js';
import { ClassificationsModule } from './classifications/classifications.module.js';
import { MethodologiesModule } from './methodologies/methodologies.module.js';
import { ProductsModule } from './products/products.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';

@Module({
  imports: [PrismaModule, ProductsModule, ProfilesModule, MethodologiesModule, ClassificationsModule],
})
export class AppModule {}
