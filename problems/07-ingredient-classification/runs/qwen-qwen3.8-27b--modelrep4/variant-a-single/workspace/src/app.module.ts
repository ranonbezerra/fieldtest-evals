import { Module } from '@nestjs/common';
import { ClassificationModule } from './classification/classification.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, ClassificationModule],
})
export class AppModule {}
