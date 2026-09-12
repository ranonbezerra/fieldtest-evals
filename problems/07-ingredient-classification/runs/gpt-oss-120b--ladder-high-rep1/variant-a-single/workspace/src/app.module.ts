import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ClassificationModule } from './classification/classification.module';
import { MethodologyModule } from './methodology/methodology.module';
import { ProfileModule } from './profiles/profile.module';
import { ProductModule } from './products/product.module';

@Module({
  imports: [
    PrismaModule,
    ClassificationModule,
    MethodologyModule,
    ProfileModule,
    ProductModule,
  ],
})
export class AppModule {}
