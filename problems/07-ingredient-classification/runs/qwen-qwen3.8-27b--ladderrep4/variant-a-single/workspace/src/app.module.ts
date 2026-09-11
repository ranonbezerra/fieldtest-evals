import { Module } from '@nestjs/common';
import { ClassificationModule } from './classification/classification.module.js';
import { MethodologyModule } from './methodology/methodology.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, ClassificationModule, MethodologyModule],
})
export class AppModule {}
