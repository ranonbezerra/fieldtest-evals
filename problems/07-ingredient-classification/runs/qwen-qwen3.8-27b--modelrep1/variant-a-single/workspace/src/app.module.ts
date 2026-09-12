import { Module } from '@nestjs/common';
import { ClassificationModule } from './classification/classification.module.js';
import { MethodologyModule } from './methodology/methodology.module.js';
import { ProductsModule } from './products/products.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';

@Module({
  imports: [ProductsModule, ProfilesModule, ClassificationModule, MethodologyModule],
})
export class AppModule {}
