import { Module } from '@nestjs/common';
import { MethodologyService } from './methodology.service';
import { MethodologyRepository } from './methodology.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { ClassificationModule } from '../classification/classification.module';

@Module({
  imports: [PrismaModule, ClassificationModule],
  providers: [MethodologyService, MethodologyRepository],
  exports: [MethodologyService],
})
export class MethodologyModule {}
