import { Module } from '@nestjs/common';
import { MethodologiesModule } from '../methodologies/methodologies.module.js';
import { ProductsModule } from '../products/products.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { ClassificationComputer, ClassificationService } from './classification.js';

@Module({
  imports: [MethodologiesModule, ProductsModule, ProfilesModule],
  providers: [ClassificationComputer, ClassificationService],
  exports: [ClassificationService, ClassificationComputer],
})
export class ClassificationsModule {}
