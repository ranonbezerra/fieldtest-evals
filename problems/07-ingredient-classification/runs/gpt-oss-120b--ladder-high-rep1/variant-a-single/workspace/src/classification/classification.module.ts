import { Module } from '@nestjs/common';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { ClassificationRepository } from './classification.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { ProfileModule } from '../profiles/profile.module';
import { ProductModule } from '../products/product.module';

@Module({
  imports: [PrismaModule, ProfileModule, ProductModule],
  controllers: [ClassificationController],
  providers: [ClassificationService, ClassificationRepository],
  exports: [ClassificationService],
})
export class ClassificationModule {}
